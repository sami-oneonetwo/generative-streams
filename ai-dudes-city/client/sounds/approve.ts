// Approve on the sound board (FK-160), the page's side: what Sami has approved (the copy of
// client/dudes/audio-approved.json the server keeps in public/sounds/), his Approve (an admin action
// through /admin/api, behind the operator guard, with the operator token sent as /admin sends it), and
// the renders the board keeps in this browser (IndexedDB) so A/B can play an approved sound against
// the sound now. Nothing else here talks to the server; the fingerprints are prints.ts's.
import type { Approved, Item } from '../../src/shared/audioApproved';
import { RATE, renderOn, renderPlan } from './prints';

/** Where the board reads the approvals: express.static serves public/, and the build and every Approve write this copy. */
export const APPROVED_URL = '/sounds/approved.json';
/** Where Approve goes: the admin API's world actions, behind src/server/http.ts's operatorGuard. */
export const ACTION_URL = '/admin/api/action';
/** The action (src/worlds/ai-dudes/audioApproval.ts). */
export const ACTION = 'audio-approve';

/** What is approved now, fresh from the server. */
export async function loadApproved(): Promise<Approved> {
  const res = await fetch(APPROVED_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${APPROVED_URL}: HTTP ${res.status}`);
  return (await res.json()) as Approved;
}

/** A refusal from the server, with its status: 401 or 403 is the operator guard wanting the token. */
export type ApproveError = Error & { status?: number };
/**
 * Sami's Approve of `item` as it hashes now. The token goes as the admin page sends it (client/admin/
 * main.ts: `Authorization: Bearer …`, only when one is typed), so a server without ADMIN_TOKEN still
 * lets this machine and the trusted addresses in, and turns everyone else away.
 */
export async function sendApproval(item: Item, hash: string, token = ''): Promise<void> {
  const res = await fetch(ACTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ id: ACTION, value: JSON.stringify({ kind: item.kind, name: item.name, hash }) }),
  });
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  let message = text;
  try {
    message = (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    /* plain text */
  }
  const error: ApproveError = new Error(message || `Approve: HTTP ${res.status}`);
  error.status = res.status;
  throw error;
}

// --- renders ---

/** A sound as rendered: its channels at RATE. */
export type Pcm = Float32Array<ArrayBuffer>[];
/** A render kept for A/B: the item, the hash it was rendered at, and its samples as 16-bit (half the room of floats; ample for listening). */
export interface Kept {
  key: string;
  hash: string;
  rate: number;
  data: Int16Array[];
}
export const keyOf = (item: Item) => `${item.kind}:${item.name}`;

export const pack = (pcm: Pcm): Int16Array[] => pcm.map((d) => Int16Array.from(d, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767)));
export const unpack = (data: readonly Int16Array[]): Pcm => data.map((d) => Float32Array.from(d, (x) => x / 32767));
/**
 * The part worth keeping: from `from` seconds (the settle before the first sound is silence) to the
 * last sample above −90 dBFS, and 50 ms more.
 */
export function trim(pcm: Pcm, from: number, rate = RATE): Pcm {
  const start = Math.min(Math.round(from * rate), pcm[0]?.length ?? 0);
  let end = start;
  for (const d of pcm)
    for (let i = d.length - 1; i > end; i--)
      if (Math.abs(d[i]) > 3.2e-5) {
        end = i;
        break;
      }
  const stop = Math.min(pcm[0]?.length ?? 0, end + Math.round(0.05 * rate));
  return pcm.map((d) => d.slice(start, stop));
}

/** `item` as it sounds now, rendered offline from its fingerprint's seed (prints.ts: renderPlan, renderOn). */
export async function renderNow(item: Item): Promise<Pcm> {
  const plan = renderPlan(item);
  const ctx = new OfflineAudioContext(2, Math.ceil(plan.seconds * RATE), RATE);
  const buffer = await renderOn(ctx, plan);
  return trim(
    Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)),
    plan.from,
  );
}

// IndexedDB, one store of renders by item. A browser that has none (or refuses it) just has no A/B.
const DB = 'ai-dudes-sounds',
  STORE = 'renders';
let db: Promise<IDBDatabase> | undefined;
function open(): Promise<IDBDatabase> {
  return (db ??= new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  }));
}
function inStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((ok, fail) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => ok(req.result);
        req.onerror = () => fail(req.error);
      }),
  );
}
/** The render kept for `item`, if this browser has one. */
export const kept = (item: Item) => inStore<Kept | undefined>('readonly', (s) => s.get(keyOf(item))).catch(() => undefined);
/** Keeps `pcm` as `item`'s render at `hash`, in place of any before it. */
export const keep = (item: Item, hash: string, pcm: Pcm) => inStore('readwrite', (s) => s.put({ key: keyOf(item), hash, rate: RATE, data: pack(pcm) } satisfies Kept));
