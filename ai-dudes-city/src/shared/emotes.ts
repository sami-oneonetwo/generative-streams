// Kick emotes arrive in chat text as `[emote:37226:KEKW]`. The bubble draws them as pictures from
// Kick's emote CDN (built as DOM nodes, never as HTML from chat text); everywhere else (an agent's
// inbox, what others overhear, the inspect panel) they read as their names.

/** One emote token; the id is digits only, so it is safe in a URL. */
const TOKEN = /\[emote:(\d{1,12}):([^\]]{0,60})\]/g;

/** A picture of an emote at Kick's CDN. */
export const emoteUrl = (id: string) => `https://files.kick.com/emotes/${id}/fullsize`;

/** `lol [emote:1:KEKW]` → `lol KEKW`. */
export const emoteNames = (text: string) => text.replace(TOKEN, (_m, _id, name: string) => ` ${name.replace(/[^\w-]/g, '')} `).replace(/\s+/g, ' ').trim();

/** Nothing but emotes (and spaces or punctuation): no words for an agent to act on. */
export const emoteOnly = (text: string) => {
  if (!new RegExp(TOKEN.source).test(text)) return false;
  return !/[\p{L}\p{N}]/u.test(text.replace(TOKEN, ''));
};

/** A line cut short must not end in half a token (it would show as raw text). */
export const trimEmoteTail = (text: string) => text.replace(/\[emote:[^\]]*$/, '').trimEnd();

export type EmotePart = { text: string } | { id: string; name: string };

/** The line as text runs and emotes, in order; at most `max` emotes, the rest dropped. */
export function emoteParts(text: string, max = 8): EmotePart[] {
  const out: EmotePart[] = [];
  let last = 0,
    n = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    if (n++ < max) out.push({ id: m[1], name: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
