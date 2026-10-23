import type { EchoGuard } from './echo';
import type { KickAuth } from './oauth';

type LogFn = (line: string, level?: 'info' | 'warn' | 'alert') => void;

const MAX_GRAPHEMES = 500;
const MAX_BYTES = 2048;
const MIN_INTERVAL_MS = 2000;
const BACKOFF_MS = 10_000;
const QUEUE_MAX = 6;

export function truncateForKick(text: string): string {
  let out = text;
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = [...seg.segment(out)];
  if (graphemes.length > MAX_GRAPHEMES) {
    out = graphemes.slice(0, MAX_GRAPHEMES - 1).map((g) => g.segment).join('') + '…';
  }
  while (Buffer.byteLength(out, 'utf8') > MAX_BYTES) {
    out = out.slice(0, -2) + '…';
  }
  return out;
}

// Outbound chat as the authorized streamer account (type "bot" posts to the
// channel attached to the token). Fire-and-forget with client-side pacing;
// inbound chat is never gated by any of this. Replies that come too soon are dropped; notices
// sent with `queue` (the Town Crier) wait their turn instead, a few at most.
export class KickSender {
  private lastSentAt = 0;
  private backoffUntil = 0;
  private queued: string[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private auth: KickAuth,
    private log: LogFn,
    private echo: EchoGuard,
  ) {}

  send(text: string, opts?: { queue?: boolean }): void {
    if (opts?.queue) {
      if (!this.auth.connected) return;
      this.queued.push(text);
      if (this.queued.length > QUEUE_MAX) this.queued.shift();
      this.drain();
      return;
    }
    void this.trySend(text).catch((e) => this.log(`kick send failed: ${(e as Error).message}`, 'warn'));
  }

  /** The next queued notice goes out once pacing and any backoff allow. */
  private drain(): void {
    if (this.timer || !this.queued.length) return;
    const wait = Math.max(0, this.lastSentAt + MIN_INTERVAL_MS - Date.now(), this.backoffUntil - Date.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const now = Date.now();
      // A reply took the slot while this waited: wait again rather than lose the notice.
      if (now < this.backoffUntil || now - this.lastSentAt < MIN_INTERVAL_MS) return this.drain();
      const text = this.queued.shift();
      if (text !== undefined) void this.trySend(text).catch((e) => this.log(`kick send failed: ${(e as Error).message}`, 'warn'));
      this.drain();
    }, wait + 50);
  }

  private async trySend(text: string): Promise<void> {
    if (!this.auth.connected) return;
    const now = Date.now();
    if (now < this.backoffUntil) return;
    if (now - this.lastSentAt < MIN_INTERVAL_MS) return; // drop rather than queue — chat pacing
    this.lastSentAt = now;

    const content = truncateForKick(text);
    this.echo.noteSending(content); // before the request — the webhook can beat our response
    const res = await this.auth.apiFetch('/public/v1/chat', {
      method: 'POST',
      body: JSON.stringify({ type: 'bot', content }),
    });
    if (res.status === 429) {
      this.backoffUntil = Date.now() + BACKOFF_MS;
      this.log('kick chat rate limited; backing off 10s', 'warn');
      return;
    }
    if (!res.ok) throw new Error(`${res.status}`);
    try {
      const j = (await res.json()) as { data?: { message_id?: string } };
      if (j.data?.message_id) this.echo.noteSentId(j.data.message_id);
    } catch {
      // no/unparseable body — the content entry registered above still guards
    }
  }
}
