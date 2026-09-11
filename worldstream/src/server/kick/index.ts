// Kick integration: OAuth routes, webhook receiver, subscription bootstrap,
// optional bot replies. Everything here is inert until KICK_CLIENT_ID and
// KICK_CLIENT_SECRET are set.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Config } from '../../shared/config.js';
import type { IncomingChat } from '../ingest.js';
import { log } from '../log.js';
import { KickApi } from './api.js';
import { KickAuth, pkcePair } from './oauth.js';
import { fetchKickPublicKey } from './signature.js';
import { toIncomingChat, WebhookReceiver, type KickChatMessageEvent } from './webhook.js';

export interface KickDeps {
  cfg: Config;
  env: NodeJS.ProcessEnv;
  stateDir: string;
  ingest: (msg: IncomingChat) => void;
  onRedemption?: (payload: unknown) => void;
  onLiveStatus?: (isLive: boolean, payload: unknown) => void;
  onFollow?: (name: string) => void;
  /** Viewer count rose by this many since the last poll. */
  onViewersJoined?: (delta: number, total: number) => void;
}

export interface KickStatus {
  configured: boolean;
  connected: boolean;
  user?: { id: number; name: string };
  expiresAt: number | null;
  subscriptions: string[];
  webhookUrl: string | null;
  botReplies: boolean;
  lastError?: string;
  viewers?: number | null;
}

export class Kick {
  readonly auth: KickAuth;
  readonly api: KickApi;
  private readonly receiver: WebhookReceiver;
  private readonly pending = new Map<string, { verifier: string; at: number }>();
  private publicKey: string | null = null;
  private status: KickStatus;
  private viewerTimer: NodeJS.Timeout | null = null;
  private lastViewers: number | null = null;
  private viewerPollBroken = false;
  private recentBotLines: Array<{ text: string; at: number }> = [];
  /** Whether the character's lines are posted into Kick chat. Starts from config; the admin page flips it live. */
  private botRepliesOn: boolean;
  private lastBotAt = 0;
  private lastBotErrorAt = 0;
  private botFailures = 0;

  constructor(private readonly deps: KickDeps) {
    const env = deps.env;
    this.auth = new KickAuth({
      clientId: env.KICK_CLIENT_ID ?? '',
      clientSecret: env.KICK_CLIENT_SECRET ?? '',
      redirectUri: env.KICK_REDIRECT_URI ?? `http://localhost:${deps.cfg.port}/kick/callback`,
      tokenFile: join(deps.stateDir, 'kick-tokens.json'),
    });
    this.api = new KickApi(this.auth);
    this.botRepliesOn = deps.cfg.kick.botRepliesEnabled;
    this.receiver = new WebhookReceiver({
      publicKey: () => this.getPublicKey(false),
      refreshPublicKey: () => this.getPublicKey(true),
      skipVerify: env.KICK_SKIP_VERIFY === '1',
      onEvent: (type, version, payload) => this.onEvent(type, version, payload),
    });
    this.status = {
      configured: this.auth.configured,
      connected: this.auth.connected,
      expiresAt: this.auth.expiresAt,
      subscriptions: [],
      webhookUrl: env.KICK_WEBHOOK_PUBLIC_URL ?? null,
      botReplies: deps.cfg.kick.botRepliesEnabled,
    };
  }

  getStatus(): KickStatus {
    return { ...this.status, connected: this.auth.connected, expiresAt: this.auth.expiresAt, botReplies: this.botRepliesOn };
  }

  /** Turn posting into Kick chat on or off without a restart. Returns the new setting. */
  setBotReplies(on: boolean): boolean {
    this.botRepliesOn = on;
    log('kick', `chat posting ${on ? 'ON' : 'OFF'}`);
    return on;
  }

  private async getPublicKey(force: boolean): Promise<string> {
    if (!this.publicKey || force) this.publicKey = await fetchKickPublicKey();
    return this.publicKey;
  }

  /** On boot and after login: confirm identity and make sure subscriptions exist. */
  async bootstrap(): Promise<void> {
    if (!this.auth.configured) {
      log('kick', 'not configured (set KICK_CLIENT_ID / KICK_CLIENT_SECRET in .env); chat will not arrive from Kick');
      return;
    }
    if (!this.auth.connected) {
      log('kick', `not connected: open http://localhost:${this.deps.cfg.port}/kick/login while logged into Kick`);
      return;
    }
    try {
      const me = await this.api.me();
      if (me) this.status.user = { id: me.user_id, name: me.name };
      const { created, subscriptions } = await this.api.ensureSubscriptions();
      this.status.subscriptions = subscriptions.map((s) => s.event);
      this.status.lastError = undefined;
      log('kick', `connected as ${me?.name ?? '?'}; subscriptions: ${this.status.subscriptions.join(', ') || 'none'}${created.length ? ` (created ${created.join(', ')})` : ''}`);
      this.startViewerPoll();
    } catch (err) {
      this.status.lastError = String(err);
      log('kick', 'bootstrap failed', String(err));
    }
  }

  /** Every 30s: how many are watching. A rise means someone arrived, which the host greets. */
  private startViewerPoll(): void {
    if (this.viewerTimer || !this.status.user) return;
    const poll = async () => {
      if (this.viewerPollBroken || !this.status.user) return;
      try {
        const live = await this.api.livestream(this.status.user.id);
        const n = live?.viewer_count ?? null;
        this.status.viewers = n;
        if (n !== null && this.lastViewers !== null && n > this.lastViewers) this.deps.onViewersJoined?.(n - this.lastViewers, n);
        this.lastViewers = n;
      } catch (err) {
        this.viewerPollBroken = true;
        log('kick', 'viewer count not available (arrival greetings off)', String(err).slice(0, 160));
      }
    };
    void poll();
    this.viewerTimer = setInterval(() => void poll(), 30_000);
  }

  /** Returns true when the request was a Kick route and has been answered. */
  async route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/kick/')) return false;
    switch (url.pathname) {
      case '/kick/webhook':
        if (req.method !== 'POST') break;
        await this.receiver.handle(req, res);
        return true;
      case '/kick/login': {
        if (!this.auth.configured) {
          res.writeHead(503, { 'content-type': 'text/plain' }).end('Kick is not configured: set KICK_CLIENT_ID and KICK_CLIENT_SECRET in .env');
          return true;
        }
        const state = randomBytes(16).toString('hex');
        const { verifier, challenge } = pkcePair();
        this.pending.set(state, { verifier, at: Date.now() });
        for (const [k, v] of this.pending) if (Date.now() - v.at > 600_000) this.pending.delete(k);
        res.writeHead(302, { location: this.auth.loginUrl(state, challenge) }).end();
        return true;
      }
      case '/kick/callback': {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state') ?? '';
        const pending = this.pending.get(state);
        if (!code || !pending) {
          res.writeHead(400, { 'content-type': 'text/plain' }).end('missing code or unknown state; start again at /kick/login');
          return true;
        }
        this.pending.delete(state);
        try {
          await this.auth.exchange(code, pending.verifier);
          await this.bootstrap();
          res.writeHead(200, { 'content-type': 'text/plain' }).end(`connected to Kick as ${this.status.user?.name ?? 'unknown'}. subscriptions: ${this.status.subscriptions.join(', ') || 'none'}. you can close this tab.`);
        } catch (err) {
          res.writeHead(500, { 'content-type': 'text/plain' }).end(`token exchange failed: ${String(err)}`);
        }
        return true;
      }
      case '/kick/status':
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(this.getStatus()));
        return true;
      case '/kick/logout':
        this.auth.forget();
        res.writeHead(200, { 'content-type': 'text/plain' }).end('forgot Kick tokens');
        return true;
    }
    res.writeHead(404).end('not found');
    return true;
  }

  private onEvent(type: string, version: string, payload: unknown): void {
    switch (type) {
      case 'chat.message.sent': {
        const msg = toIncomingChat(payload as KickChatMessageEvent);
        if (this.isOurOwnBotLine(msg)) return;
        this.deps.ingest(msg);
        return;
      }
      case 'channel.reward.redemption.updated':
        log('kick', 'reward redemption', payload);
        this.deps.onRedemption?.(payload);
        return;
      case 'channel.followed': {
        const p = payload as { follower?: { username?: string }; user?: { username?: string } };
        const name = p.follower?.username ?? p.user?.username;
        log('kick', `new follower ${name ?? '?'}`);
        if (name) this.deps.onFollow?.(name);
        return;
      }
      case 'livestream.status.updated': {
        const p = payload as { is_live?: boolean };
        log('kick', p.is_live ? 'stream is live' : 'stream ended');
        this.deps.onLiveStatus?.(Boolean(p.is_live), payload);
        return;
      }
      default:
        log('kick', `unhandled event ${type} v${version}`);
    }
  }

  private isOurOwnBotLine(msg: IncomingChat): boolean {
    const now = Date.now();
    this.recentBotLines = this.recentBotLines.filter((l) => now - l.at < 15_000);
    return this.recentBotLines.some((l) => l.text === msg.content);
  }

  /** Optional: echo a character line into Kick chat, rate limited. Posts as the bot by default and falls back to the user once. */
  async sayInChat(text: string, force = false): Promise<void> {
    if (!this.botRepliesOn || !this.auth.connected) return;
    const now = Date.now();
    if (now - this.lastBotAt < (force ? 1_500 : 10_000)) return;
    this.lastBotAt = now;
    this.recentBotLines.push({ text, at: now });
    const broadcasterUserId = this.status.user?.id;
    const first = this.deps.cfg.kick.chatAs;
    try {
      await this.api.sendMessage(text, { as: first, broadcasterUserId });
      this.botFailures = 0;
      return;
    } catch (err) {
      if (first === 'bot' && this.deps.cfg.kick.fallbackToUser && broadcasterUserId) {
        try {
          await this.api.sendMessage(text, { as: 'user', broadcasterUserId });
          if (now - this.lastBotErrorAt > 60_000) {
            this.lastBotErrorAt = now;
            log('kick', 'bot post failed, sent as the user instead (set kick.chatAs to "user" to skip the bot attempt)', String(err).slice(0, 160));
          }
          return;
        } catch (err2) {
          err = err2;
        }
      }
      this.botFailures++;
      if (now - this.lastBotErrorAt > 60_000) {
        this.lastBotErrorAt = now;
        log('kick', `chat post failed (${this.botFailures} in a row)`, String(err).slice(0, 200));
      }
      this.status.lastError = `chat post: ${String(err).slice(0, 120)}`;
    }
  }
}
