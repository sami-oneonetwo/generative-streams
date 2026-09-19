// Serializes protagonist dialogue calls: one in flight, a short waiting line,
// overflow dropped. Keeps the character consistent and stops a chat burst from
// stacking minutes of AGENT_MODEL calls.

/**
 * Runaway-output ceiling, not a style rule: the longest line Admin has actually
 * spoken is 269 chars (p99 191), and kick/send.ts caps at 500 graphemes anyway.
 * Sits above real speech so it only ever trims a wall of text.
 */
export const MAX_SPOKEN_CHARS = 320;

// A model occasionally plans out loud inside `content` before answering:
// "thShort, warm-ish reply to Sami about the fish. Mention water cool...that's
// ping and pong." Whatever comes back here can reach the live Kick chat, so the
// spoken line is extracted structurally rather than trusted whole.
//
// Deliberately no word-based heuristics: Admin really does say things like
// "nobody was going to mention the AC?", and a "meta words" filter would eat
// legitimate lines. Only explicit structure is trusted — reasoning tags, the
// SAY: marker the engine asks for, paragraph breaks, and a length cap.
const TAGS = 'think|thinking|reasoning|reflection|scratchpad|analysis|plan';
const CLOSED_BLOCK = new RegExp(`<\\s*(${TAGS})\\b[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>`, 'gi');
const THROUGH_CLOSER = new RegExp(`^[\\s\\S]*<\\s*/\\s*(?:${TAGS})\\s*>`, 'i');
const FROM_OPENER = new RegExp(`<\\s*(?:${TAGS})\\b[^>]*>[\\s\\S]*$`, 'i');
const SAY_MARKER = new RegExp('(?:^|[\\s\\S])say\\s*:\\s*', 'gi');

/**
 * Pull the line the protagonist actually speaks out of a raw completion.
 * Returns '' when nothing usable survives, so the caller can fall back.
 */
export function extractSpokenLine(raw: string, maxLen = MAX_SPOKEN_CHARS): string {
  let text = raw.trim();

  // Tagged reasoning: drop whole blocks, then any half-open block on either side.
  text = text.replace(CLOSED_BLOCK, ' ');
  if (new RegExp(`<\\s*/\\s*(?:${TAGS})\\s*>`, 'i').test(text)) {
    text = text.replace(THROUGH_CLOSER, ' ');
  }
  text = text.replace(FROM_OPENER, ' ').trim();

  // The engine asks for a `SAY:` prefix; anything before the last one is preamble.
  const markers = [...text.matchAll(SAY_MARKER)];
  const last = markers.at(-1);
  if (last?.index !== undefined) {
    text = text.slice(last.index + last[0].length);
  } else {
    // No marker. Multi-paragraph output already breaks the 1-3 sentence rule,
    // and in plan-then-answer form the answer is last.
    const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (paras.length > 1) text = paras[paras.length - 1];
  }

  text = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\*[^*]{0,80}\*\s*/, '') // *shrugs* emote before the words
    .replace(/\s*\*[^*]{0,80}\*$/, '') // ...or trailing it
    .replace(/^[*_>\-\s]+/, '') // leftover markdown lead-in
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const space = cut.lastIndexOf(' ');
  return (space > maxLen * 0.6 ? cut.slice(0, space) : cut).trim();
}

export class DialogueService {
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  constructor(
    private maxWaiting: number,
    private onDrop: () => void,
  ) {}

  run(fn: () => Promise<string>): Promise<string | null> {
    if (this.waiting >= this.maxWaiting) {
      this.onDrop();
      return Promise.resolve(null);
    }
    this.waiting++;
    const result = this.chain.then(
      () => fn(),
      () => fn(),
    );
    this.chain = result.catch(() => {});
    return result.finally(() => {
      this.waiting--;
    });
  }
}
