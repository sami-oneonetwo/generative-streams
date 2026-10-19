import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import type { KickTokens } from './types';

export const AUTH_BASE = 'https://id.kick.com';
export const API_BASE = 'https://api.kick.com';
export const SCOPES = 'user:read chat:write events:subscribe';

type LogFn = (line: string, level?: 'info' | 'warn' | 'alert') => void;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

// OAuth 2.1 authorization code + PKCE (S256) against id.kick.com.
// Token refresh ROTATES both tokens, so every refresh is persisted immediately.
export class KickAuth {
  tokens: KickTokens | null = null;
  private pending: { state: string; verifier: string } | null = null;
  private tokenPath: string;
  private refreshing: Promise<void> | null = null;

  constructor(
    dataDir: string,
    private log: LogFn,
  ) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.tokenPath = path.join(dataDir, 'kick-tokens.json');
    try {
      if (fs.existsSync(this.tokenPath)) {
        this.tokens = JSON.parse(fs.readFileSync(this.tokenPath, 'utf8')) as KickTokens;
        this.log(`kick tokens loaded (${this.tokens.username ?? 'unknown user'})`);
      }
    } catch (e) {
      this.log(`kick token file unreadable: ${(e as Error).message}`, 'warn');
    }
  }

  get configured(): boolean {
    return Boolean(config.KICK_CLIENT_ID && config.KICK_CLIENT_SECRET && config.KICK_REDIRECT_URI);
  }

  get connected(): boolean {
    return this.tokens !== null;
  }

  authorizeUrl(): string {
    if (!this.configured) throw new Error('kick app not configured in .env');
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    this.pending = { state, verifier };

    const u = new URL('/oauth/authorize', AUTH_BASE);
    u.searchParams.set('client_id', config.KICK_CLIENT_ID!);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', config.KICK_REDIRECT_URI!);
    u.searchParams.set('scope', SCOPES);
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    return u.toString();
  }

  async handleCallback(code: string, state: string): Promise<void> {
    if (!this.pending || state !== this.pending.state) {
      throw new Error('OAuth state mismatch — restart the connect flow');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.KICK_CLIENT_ID!,
      client_secret: config.KICK_CLIENT_SECRET!,
      redirect_uri: config.KICK_REDIRECT_URI!,
      code_verifier: this.pending.verifier,
    });
    const res = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`token exchange failed: ${res.status} ${detail}`);
    }
    this.setTokens((await res.json()) as Record<string, unknown>);
    this.pending = null;
    await this.fetchIdentity();
    this.log(`kick connected as ${this.tokens?.username ?? 'unknown user'}`);
  }

  private setTokens(j: Record<string, unknown>): void {
    this.tokens = {
      access_token: String(j.access_token),
      refresh_token: String(j.refresh_token),
      expires_at: Date.now() + Number(j.expires_in ?? 3600) * 1000,
      scope: typeof j.scope === 'string' ? j.scope : undefined,
      user_id: this.tokens?.user_id,
      username: this.tokens?.username,
    };
    this.save();
  }

  private save(): void {
    if (!this.tokens) {
      fs.rmSync(this.tokenPath, { force: true });
      return;
    }
    fs.writeFileSync(this.tokenPath, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
  }

  async fetchIdentity(): Promise<void> {
    const res = await this.apiFetch('/public/v1/users');
    if (!res.ok) throw new Error(`identity fetch failed: ${res.status}`);
    const j = (await res.json()) as { data?: { user_id?: number; name?: string; username?: string }[] };
    const u = j.data?.[0];
    if (u && this.tokens) {
      this.tokens.user_id = u.user_id;
      this.tokens.username = u.name ?? u.username;
      this.save();
    }
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      if (!this.tokens) throw new Error('kick not connected');
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refresh_token,
        client_id: config.KICK_CLIENT_ID!,
        client_secret: config.KICK_CLIENT_SECRET!,
      });
      const res = await fetch(`${AUTH_BASE}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) {
        if (res.status === 400 || res.status === 401) {
          this.log('kick refresh token rejected; disconnecting — reconnect from the admin page', 'alert');
          this.disconnect();
        }
        throw new Error(`token refresh failed: ${res.status}`);
      }
      this.setTokens((await res.json()) as Record<string, unknown>);
      this.log('kick tokens refreshed');
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async accessToken(): Promise<string> {
    if (!this.tokens) throw new Error('kick not connected');
    if (Date.now() >= this.tokens.expires_at - 5 * 60_000) await this.refresh();
    if (!this.tokens) throw new Error('kick not connected');
    return this.tokens.access_token;
  }

  async apiFetch(pathname: string, init?: RequestInit): Promise<Response> {
    const token = await this.accessToken();
    return fetch(`${API_BASE}${pathname}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  disconnect(): void {
    this.tokens = null;
    this.save();
  }
}
