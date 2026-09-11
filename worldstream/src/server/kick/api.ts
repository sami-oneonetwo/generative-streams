// The slice of Kick's public API this project uses: who am I, event
// subscriptions, and posting as the channel's bot.
import type { KickAuth } from './oauth.js';

export interface KickSubscription {
  id: string;
  event: string;
  version: number;
  method: string;
  broadcaster_user_id?: number;
}

export interface KickUser {
  user_id: number;
  name: string;
  profile_picture?: string;
}

export const WANTED_EVENTS: Array<{ name: string; version: number }> = [
  { name: 'chat.message.sent', version: 1 },
  { name: 'channel.reward.redemption.updated', version: 1 },
  { name: 'livestream.status.updated', version: 1 },
  { name: 'channel.followed', version: 1 },
];

export class KickApi {
  constructor(
    private readonly auth: KickAuth,
    private readonly base = 'https://api.kick.com',
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.auth.accessToken();
    if (!token) throw new Error('kick: not connected');
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) throw new Error(`kick ${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async me(): Promise<KickUser | null> {
    const json = await this.request<{ data?: KickUser[] }>('GET', '/public/v1/users');
    return json.data?.[0] ?? null;
  }

  /** The channel's live stream, or null when offline. */
  async livestream(broadcasterUserId: number): Promise<{ is_live: boolean; viewer_count: number; stream_title?: string } | null> {
    const json = await this.request<{ data?: Array<{ broadcaster_user_id: number; viewer_count?: number; stream_title?: string }> }>('GET', `/public/v1/livestreams?broadcaster_user_id=${broadcasterUserId}`);
    const live = json.data?.find((l) => l.broadcaster_user_id === broadcasterUserId);
    return live ? { is_live: true, viewer_count: live.viewer_count ?? 0, stream_title: live.stream_title } : null;
  }

  async listSubscriptions(): Promise<KickSubscription[]> {
    const json = await this.request<{ data?: KickSubscription[] }>('GET', '/public/v1/events/subscriptions');
    return json.data ?? [];
  }

  async createSubscriptions(events: Array<{ name: string; version: number }>): Promise<Array<{ subscription_id?: string; name: string; version: number; error?: string }>> {
    const json = await this.request<{ data?: Array<{ subscription_id?: string; name: string; version: number; error?: string }> }>('POST', '/public/v1/events/subscriptions', {
      method: 'webhook',
      events,
    });
    return json.data ?? [];
  }

  async deleteSubscriptions(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join('&');
    await this.request<void>('DELETE', `/public/v1/events/subscriptions?${qs}`);
  }

  /** Create whatever is missing from WANTED_EVENTS. Returns the full list afterwards. */
  async ensureSubscriptions(): Promise<{ created: string[]; subscriptions: KickSubscription[] }> {
    const existing = await this.listSubscriptions();
    const missing = WANTED_EVENTS.filter((w) => !existing.some((s) => s.event === w.name && s.method === 'webhook'));
    const created: string[] = [];
    if (missing.length) {
      const res = await this.createSubscriptions(missing);
      for (const r of res) if (!r.error) created.push(r.name);
      const failed = res.filter((r) => r.error);
      if (failed.length) throw new Error(`subscription errors: ${failed.map((f) => `${f.name}: ${f.error}`).join('; ')}`);
    }
    return { created, subscriptions: missing.length ? await this.listSubscriptions() : existing };
  }

  /** Post in the channel (scope chat:write), as the app's bot identity or as the connected user. */
  async sendMessage(content: string, opts: { as: 'bot' | 'user'; broadcasterUserId?: number; replyToMessageId?: string }): Promise<{ is_sent: boolean; message_id?: string }> {
    const json = await this.request<{ data?: { is_sent: boolean; message_id?: string } }>('POST', '/public/v1/chat', {
      type: opts.as,
      content: content.slice(0, 500),
      ...(opts.broadcasterUserId ? { broadcaster_user_id: opts.broadcasterUserId } : {}),
      ...(opts.replyToMessageId ? { reply_to_message_id: opts.replyToMessageId } : {}),
    });
    return json.data ?? { is_sent: false };
  }

  /** Kept for callers that only ever post as the bot. */
  async sendBotMessage(content: string, replyToMessageId?: string): Promise<{ is_sent: boolean; message_id?: string }> {
    return this.sendMessage(content, { as: 'bot', replyToMessageId });
  }
}
