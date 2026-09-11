const ID_CAP = 64;
const CONTENT_TTL_MS = 20_000;

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Outbound posts come back to us through the same chat.message.sent webhook as
// real viewer chat, and they carry the token owner's user_id — so the streamer
// typing in their own channel is indistinguishable from an echo by sender alone.
// This tracks the specific messages we posted instead.
//
// Primary key is the message_id returned by POST /public/v1/chat, which matches
// the webhook's message_id. Content is registered before the request goes out as
// a race guard (the webhook can in principle beat our own HTTP response) and as
// a fallback when Kick returns no id; each content entry is consumed by the
// first inbound match and expires on its own.
export class EchoGuard {
  private ids = new Set<string>();
  private idOrder: string[] = [];
  private contents = new Map<string, number>();

  /** Call immediately before POSTing to Kick. */
  noteSending(content: string): void {
    this.contents.set(normalize(content), Date.now() + CONTENT_TTL_MS);
  }

  /** Call with the message_id returned by the send API, when present. */
  noteSentId(messageId: string): void {
    if (this.ids.has(messageId)) return;
    this.ids.add(messageId);
    this.idOrder.push(messageId);
    while (this.idOrder.length > ID_CAP) this.ids.delete(this.idOrder.shift()!);
  }

  /** True if this inbound webhook message is one we posted ourselves. */
  isEcho(messageId: string | undefined, content: string): boolean {
    if (messageId && this.ids.has(messageId)) return true;
    if (this.contents.size === 0) return false;
    const now = Date.now();
    for (const [key, expiry] of this.contents) {
      if (expiry <= now) this.contents.delete(key);
    }
    return this.contents.delete(normalize(content));
  }
}
