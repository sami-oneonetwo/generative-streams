// Sami's Approve on the sound board (FK-160). Agents can't hear, so his click is the review: /sounds
// sends what he heard as `{"kind", "name", "hash"}` (the hash of the sound's fingerprint, worked out in
// the page as scripts/audio-voice.test.ts and audio-cues.test.ts work it out), through the operator's
// admin API (/admin/api/action, behind src/server/http.ts's operatorGuard: the operator token, or this
// machine or a trusted address). This writes it into client/dudes/audio-approved.json, by Sami and
// dated, for the coordinator to commit on main at the next check-in; from then on the tests fail on
// any change to that sound he hasn't heard. Agents never write the file.
import fs from 'node:fs';
import path from 'node:path';
import type { AdminAction } from '../../engine/world';
import { HASH, KINDS, MAX_BYTES, NAME, VOICE, dayOf, entryOf, formatApproved, statusOf, withApproval, type Approved, type Item, type Kind } from '../../shared/audioApproved';

/** The approvals, in the checkout the server runs from (4600's is main's). */
export const APPROVED_FILE = path.join(import.meta.dirname, '..', '..', '..', 'client', 'dudes', 'audio-approved.json');
/**
 * The copy /sounds reads, where express.static serves it: scripts/build-client.mjs copies the file
 * there at every build, and each Approve refreshes it, so the board shows what is approved without a
 * route of its own.
 */
export const SERVED_FILE = path.resolve('public', 'sounds', 'approved.json');

export interface Approval extends Item {
  hash: string;
}

/** The action's value as /sounds sends it, `{"kind":"cue","name":"doorbell","hash":"…"}`; or why it isn't one. */
export function parseApproval(value: unknown): Approval | string {
  let o: unknown;
  try {
    o = JSON.parse(String(value ?? ''));
  } catch {
    return 'An approval is JSON: {"kind", "name", "hash"}, as /sounds sends it';
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'An approval is an object: {"kind", "name", "hash"}';
  const { kind, name, hash } = o as Record<string, unknown>;
  if (!KINDS.includes(kind as Kind)) return `kind is one of ${KINDS.join(', ')}`;
  if (typeof name !== 'string' || !NAME.test(name)) return 'name: a letter, then letters, digits or :_.- (40 characters at most)';
  if (kind === 'voice' && name !== VOICE) return `The voices are approved as one, under the name "${VOICE}"`;
  if (typeof hash !== 'string' || !HASH.test(hash)) return 'hash: a sha-256 in lower-case hex (64 characters)';
  return { kind: kind as Kind, name, hash };
}

/** Writes `text` whole or not at all: a reader never sees half a file. */
function writeWhole(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * Sami's approval of `a`, dated `ms`, into `file` and the copy /sounds reads. Refused (a reason, and
 * nothing written) if the file doesn't read or would pass 64 KB; nothing to write if that sound is
 * already approved.
 */
export function approve(a: Approval, ms: number, file = APPROVED_FILE, served = SERVED_FILE): { refused?: string; changed: boolean; stale?: string } {
  let now: Approved;
  try {
    now = JSON.parse(fs.readFileSync(file, 'utf8')) as Approved;
    if (!now || typeof now !== 'object' || Array.isArray(now)) throw new Error('not an object');
  } catch (e) {
    return { refused: `client/dudes/audio-approved.json doesn't read (${(e as Error).message}): fix it before approving`, changed: false };
  }
  if (statusOf(entryOf(now, a), a.hash) === 'approved') return { changed: false };
  const text = formatApproved(withApproval(now, a, a.hash, dayOf(ms)));
  if (Buffer.byteLength(text) > MAX_BYTES) return { refused: `client/dudes/audio-approved.json would pass ${MAX_BYTES / 1024} KB`, changed: false };
  writeWhole(file, text);
  // The page's copy only exists once the board is built (no page, nothing to show); if it can't be
  // written the approval still stands, and /sounds shows it after the next build.
  try {
    if (fs.existsSync(path.dirname(served))) writeWhole(served, text);
  } catch (e) {
    return { changed: true, stale: `public/sounds/approved.json not refreshed (${(e as Error).message})` };
  }
  return { changed: true };
}

/** The admin action /sounds calls, for adminActions in index.ts (`file` and `served` move only for the tests). */
export function audioApproveAction<S>(file = APPROVED_FILE, served = SERVED_FILE): AdminAction<S> {
  return {
    id: 'audio-approve',
    label: "Sound board: record Sami's Approve (sent by /sounds)",
    input: { kind: 'text', label: 'approval from /sounds', maxLength: 200 },
    run: (ctx, value) => {
      const a = parseApproval(value);
      const r: ReturnType<typeof approve> = typeof a === 'string' ? { refused: a, changed: false } : approve(a, Date.now(), file, served);
      if (r.refused) {
        ctx.log(`audio-approve refused: ${r.refused}`, 'warn');
        return r.refused;
      }
      const { kind, name, hash } = a as Approval;
      ctx.log(r.changed ? `audio: Sami approved the ${kind} ${name} (${hash.slice(0, 12)}…): client/dudes/audio-approved.json is ready to commit` : `audio: the ${kind} ${name} was already approved as ${hash.slice(0, 12)}…`);
      if (r.stale) ctx.log(`audio-approve: ${r.stale}`, 'warn');
    },
  };
}
