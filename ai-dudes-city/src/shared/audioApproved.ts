// What Sami has approved on the sound board (FK-160): client/dudes/audio-approved.json. The guard's
// tests read it (scripts/audio-voice.test.ts for the blips, scripts/audio-cues.test.ts for the cues),
// /sounds reads it to show what is approved, and only his Approve writes it (an admin action through
// the operator guard: src/worlds/ai-dudes/audioApproval.ts). Shared by the server and the page, so
// both read the file and lay it out the same way.

/** What can be approved: the speech blips, a cue (CUES in client/dudes/audio.ts), a mix state (FK-163). */
export const KINDS = ['voice', 'cue', 'mix'] as const;
export type Kind = (typeof KINDS)[number];
/** The blips are approved as one, under the handle they come from (speech()), as each cue goes by its own. */
export const VOICE = 'speech';
/** A name: a letter, then letters, digits or `:_.-`, 40 characters at most ('doorbell', 'play:strum', 'beds:fountain'). */
export const NAME = /^[A-Za-z][\w:.-]{0,39}$/;
/** A sha-256, in lower-case hex. */
export const HASH = /^[0-9a-f]{64}$/;
/** How big the file may grow: it holds a line an approval, so 64 KB is hundreds of them. */
export const MAX_BYTES = 64 * 1024;

export interface Entry {
  hash: string;
  by: string;
  /** YYYY-MM-DD, the day he approved it. */
  date: string;
  note?: string;
}
export interface Approved {
  voice?: Entry;
  cues?: Record<string, Entry>;
  mix?: Record<string, Entry>;
  /** Whatever a later card keeps here (FK-173's castVoices, say): carried over as it is. */
  [key: string]: unknown;
}
/** One thing Sami can approve. */
export interface Item {
  kind: Kind;
  name: string;
}
/** The sound now against the file: "approved <date>", "changed since approval" or "not approved yet". */
export type Status = 'approved' | 'changed' | 'none';

const MAPS = { cue: 'cues', mix: 'mix' } as const;

/** The approval on file for `item`, if there is one. */
export function entryOf(a: Approved, item: Item): Entry | undefined {
  if (item.kind === 'voice') return a.voice;
  const map = a[MAPS[item.kind]] as Record<string, Entry> | undefined;
  return map && Object.hasOwn(map, item.name) ? map[item.name] : undefined;
}

/** Whether the sound that hashes to `hash` is the one on file. */
export function statusOf(entry: Entry | undefined, hash: string): Status {
  return !entry ? 'none' : entry.hash === hash ? 'approved' : 'changed';
}

/** `a` with `item` approved at `hash` by Sami on `date`: a copy. A new hash replaces the old entry, its note with it. */
export function withApproval(a: Approved, item: Item, hash: string, date: string): Approved {
  const entry: Entry = { hash, by: 'Sami', date };
  if (item.kind === 'voice') return { ...a, voice: entry };
  const key = MAPS[item.kind];
  return { ...a, [key]: { ...(a[key] as Record<string, Entry> | undefined), [item.name]: entry } };
}

/** `{ "hash": "…", "by": "Sami" }`: an object on one line, as the file has had its entries from the start. */
const inline = (o: object) => {
  const kv = Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return kv.length ? `{ ${kv.join(', ')} }` : '{}';
};

/**
 * The file as written: a key a line, every approval on a line of its own and the names in order, so
 * each Approve is a one-line diff for the coordinator to commit. The voice first, then the cues, the
 * mix states and anything else, in the order they came.
 */
export function formatApproved(a: Approved): string {
  const keys = [...new Set(['voice', 'cues', 'mix', ...Object.keys(a)])].filter((k) => a[k] !== undefined);
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const value = (k: string) => {
    const v = a[k];
    if (!isObject(v)) return JSON.stringify(v);
    if (!Object.values(MAPS).includes(k as 'cues' | 'mix')) return inline(v);
    const names = Object.keys(v).sort();
    const lines = names.map((n) => `    ${JSON.stringify(n)}: ${isObject(v[n]) ? inline(v[n]) : JSON.stringify(v[n])}`);
    return names.length ? `{\n${lines.join(',\n')}\n  }` : '{}';
  };
  return `{\n${keys.map((k) => `  ${JSON.stringify(k)}: ${value(k)}`).join(',\n')}\n}\n`;
}

/** A moment as the day it fell on, where the server is: YYYY-MM-DD. */
export function dayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
