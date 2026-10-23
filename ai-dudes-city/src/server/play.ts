// The /play page's front door, on this side: who the player is (a token the Cloudflare Worker signed
// after "Login with Kick", see ../../play-worker), and the seats (ten by default). A seat is taken
// when a player's socket opens and kept while it is open; it is given up a minute after the last
// socket closes, or after ten minutes without a key pressed, so a seat never sits held by an empty tab.
// When every seat is taken, newcomers wait in line (first come, first served) with their place shown,
// and while anyone waits a turn lasts fifteen minutes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { WebSocket } from 'ws';

export interface PlayIdentity {
  /** The chatter's userId, the same one chat uses: `kick:<id>`. */
  userId: string;
  name: string;
}

/** Token: base64url(JSON {uid, name, exp}) "." base64url(HMAC-SHA256(secret, that)). */
export function verifyPlayToken(token: string, secret: string | undefined, now = Date.now()): PlayIdentity | undefined {
  if (!secret || !token) return undefined;
  const [body, sig] = token.split('.');
  if (!body || !sig) return undefined;
  const want = crypto.createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return undefined;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { uid?: unknown; name?: unknown; exp?: unknown };
    if (typeof p.exp !== 'number' || p.exp < now) return undefined;
    const uid = String(p.uid ?? '');
    const name = String(p.name ?? '').replace(/[^\w.-]/g, '').slice(0, 40);
    if (!/^\d+$/.test(uid) && !/^dev:[\w.-]+$/.test(uid)) return undefined;
    if (!name) return undefined;
    return { userId: uid.startsWith('dev:') ? uid : `kick:${uid}`, name };
  } catch {
    return undefined;
  }
}

export function signPlayToken(uid: string, name: string, secret: string, ttlMs: number): string {
  const body = Buffer.from(JSON.stringify({ uid, name, exp: Date.now() + ttlMs })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** The token from the cookie the Worker set (or `?token=` for testing by hand). */
export function playTokenOf(req: http.IncomingMessage): string {
  const q = new URL(req.url ?? '/', 'http://x').searchParams.get('token');
  if (q) return q;
  const cookie = req.headers.cookie ?? '';
  const m = /(?:^|;\s*)play=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : '';
}

export type PlayServerMsg =
  | { t: 'welcome'; id: string; name: string; position: { x: number; z: number }; facing: number; seats: SeatCount }
  | { t: 'full'; seats: SeatCount }
  | { t: 'queue'; position: number; seats: SeatCount }
  | { t: 'closed' }
  | { t: 'bye'; reason: string }
  | { t: 'note'; text: string };

export interface SeatCount {
  used: number;
  cap: number;
  open: boolean;
  /** Waiting in line for a seat. */
  waiting?: number;
}

interface Seat {
  name: string;
  since: number;
  lastInputAt: number;
  socket?: WebSocket;
  leftAt?: number;
  /** Told their time is nearly up (others are waiting): when. */
  warnedAt?: number;
}

export interface SeatHooks {
  join(userId: string, name: string): { id: string; position: { x: number; z: number }; facing: number } | string;
  input(userId: string, msg: unknown): void;
  leave(userId: string): void;
}

export class PlaySeats {
  seats = new Map<string, Seat>();
  /** Waiting for a seat, first come first served; the socket stays open while they wait. */
  queue: { who: PlayIdentity; ws: WebSocket; at: number }[] = [];
  /** Kicked by the operator: not back in before this (kept in a file, so a restart does not forgive them). */
  private kicked = new Map<string, number>();
  open = true;
  static readonly GRACE_MS = 60_000;
  /** While others wait, a closed tab's seat goes sooner. */
  static readonly GRACE_BUSY_MS = 20_000;
  static readonly IDLE_MS = 10 * 60_000;
  /** While others wait, a turn lasts this long (a minute's warning first). */
  static readonly SESSION_MS = 15 * 60_000;
  static readonly WARN_MS = 60_000;
  static readonly QUEUE_MAX = 60;
  /** Messages per second a player's socket may send before the rest are dropped. */
  static readonly RATE = 40;

  constructor(
    public cap: number,
    private hooks: SeatHooks,
    private log: (line: string, level?: 'info' | 'warn' | 'alert') => void,
    /** Where kicks are kept (data/play-kicks.json); none: in memory only. */
    private kicksFile?: string,
  ) {
    this.loadKicks();
    setInterval(() => this.sweep(Date.now()), 5000).unref();
  }

  count(): SeatCount {
    return { used: this.seats.size, cap: this.cap, open: this.open, ...(this.queue.length ? { waiting: this.queue.length } : {}) };
  }

  /** Kicked (or banned) and not back in yet: until when. */
  kickedUntil(userId: string, now = Date.now()): number | undefined {
    const until = this.kicked.get(userId);
    return until && until > now ? until : undefined;
  }

  /** A player's socket opened: their seat (kept, or a free one), a place in line, or why not. */
  connect(who: PlayIdentity, ws: WebSocket): void {
    const now = Date.now();
    const send = (m: PlayServerMsg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
    if (this.kickedUntil(who.userId, now)) {
      send({ t: 'bye', reason: 'The Mayor sent you out of town for a bit. Try again later.' });
      return void ws.close(4003, 'kicked');
    }
    if (!this.seats.has(who.userId)) {
      if (!this.open) {
        send({ t: 'closed' });
        return void ws.close(4002, 'closed');
      }
      // Full, or others already waiting: into line (first come, first served).
      if (this.seats.size >= this.cap || this.queue.some((q) => q.who.userId !== who.userId)) {
        if (this.queue.length >= PlaySeats.QUEUE_MAX && !this.queue.some((q) => q.who.userId === who.userId)) {
          send({ t: 'full', seats: this.count() });
          return void ws.close(4001, 'full');
        }
        this.enqueue(who, ws, now);
        return this.admitNext();
      }
    }
    this.seat(who, ws, now);
  }

  private enqueue(who: PlayIdentity, ws: WebSocket, now: number): void {
    // A second tab waiting takes the first one's place in line.
    const i = this.queue.findIndex((q) => q.who.userId === who.userId);
    if (i >= 0) {
      const old = this.queue[i].ws;
      if (old !== ws && old.readyState === WebSocket.OPEN) {
        old.send(JSON.stringify({ t: 'bye', reason: 'You opened the town in another tab.' } satisfies PlayServerMsg));
        old.close(4005, 'replaced');
      }
      this.queue[i] = { who, ws, at: this.queue[i].at };
    } else this.queue.push({ who, ws, at: now });
    ws.on('close', () => {
      const before = this.queue.length;
      this.queue = this.queue.filter((q) => q.ws !== ws);
      if (this.queue.length !== before) this.tellQueue();
    });
    this.tellQueue();
  }

  /** Everyone waiting hears where they are in line. */
  private tellQueue(): void {
    const seats = this.count();
    this.queue.forEach((q, i) => {
      if (q.ws.readyState === WebSocket.OPEN) q.ws.send(JSON.stringify({ t: 'queue', position: i + 1, seats } satisfies PlayServerMsg));
    });
  }

  /** Free seats go to the front of the line. */
  private admitNext(): void {
    let moved = false;
    while (this.open && this.seats.size < this.cap && this.queue.length) {
      const next = this.queue.shift()!;
      moved = true;
      if (next.ws.readyState !== WebSocket.OPEN || this.kickedUntil(next.who.userId)) continue;
      this.seat(next.who, next.ws, Date.now());
    }
    if (moved) this.tellQueue();
  }

  /** Into a seat (kept, or a free one): the character is handed over and the page welcomed. */
  private seat(who: PlayIdentity, ws: WebSocket, now: number): void {
    const send = (m: PlayServerMsg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
    let seat = this.seats.get(who.userId);
    let joined: ReturnType<SeatHooks['join']>;
    try {
      joined = this.hooks.join(who.userId, who.name);
    } catch (e) {
      this.log(`play: ${who.name} could not join: ${(e as Error).message}`, 'alert');
      joined = 'Something went wrong getting you into town. Try again in a moment.';
    }
    if (typeof joined === 'string') {
      send({ t: 'bye', reason: joined });
      return void ws.close(4004, 'no room');
    }
    if (!seat) {
      seat = { name: who.name, since: now, lastInputAt: now };
      this.seats.set(who.userId, seat);
      this.log(`play: ${who.name} took a seat (${this.seats.size}/${this.cap})`);
    }
    // One tab drives the character: a newer one takes over from the old.
    if (seat.socket && seat.socket !== ws) {
      const old = seat.socket;
      old.send(JSON.stringify({ t: 'bye', reason: 'You opened the town in another tab.' } satisfies PlayServerMsg));
      old.close(4005, 'replaced');
    }
    seat.socket = ws;
    seat.leftAt = undefined;
    seat.lastInputAt = now;
    send({ t: 'welcome', id: joined.id, name: who.name, position: joined.position, facing: joined.facing, seats: this.count() });

    let windowAt = now,
      inWindow = 0,
      lastErrorAt = 0;
    ws.on('message', (data) => {
      const t = Date.now();
      if (t - windowAt > 1000) [windowAt, inWindow] = [t, 0];
      if (++inWindow > PlaySeats.RATE) return;
      const s = this.seats.get(who.userId);
      if (!s || s.socket !== ws) return;
      let msg: unknown;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return; // a garbled message is dropped
      }
      // The page's two-second heartbeat (a `move` standing still) is not input: an open tab nobody
      // touches still idles out of its seat.
      const m = msg as { t?: unknown; moving?: unknown } | null;
      if (!(m && m.t === 'move' && !m.moving)) s.lastInputAt = t;
      try {
        this.hooks.input(who.userId, msg);
      } catch (e) {
        if (t - lastErrorAt > 10_000) {
          lastErrorAt = t;
          this.log(`play: input from ${who.name} failed: ${(e as Error).message}`, 'warn');
        }
      }
    });
    ws.on('close', () => {
      const s = this.seats.get(who.userId);
      if (s && s.socket === ws) {
        s.socket = undefined;
        s.leftAt = Date.now();
      }
    });
  }

  /** Anything else for one player's page (what they got aboard). */
  send(userId: string, msg: unknown): void {
    const ws = this.seats.get(userId)?.socket;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  /** A note for one player (what their build is doing, why it could not). */
  tell(userId: string, text: string): void {
    const ws = this.seats.get(userId)?.socket;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'note', text } satisfies PlayServerMsg));
  }

  release(userId: string, reason: string): void {
    const seat = this.seats.get(userId);
    if (!seat) return;
    this.seats.delete(userId);
    if (seat.socket?.readyState === WebSocket.OPEN) {
      seat.socket.send(JSON.stringify({ t: 'bye', reason } satisfies PlayServerMsg));
      seat.socket.close(4000, 'released');
    }
    try {
      this.hooks.leave(userId);
    } catch (e) {
      this.log(`play: ${seat.name} leaving failed: ${(e as Error).message}`, 'alert');
    }
    this.log(`play: ${seat.name} gave up their seat (${reason}) (${this.seats.size}/${this.cap})`);
    this.admitNext();
  }

  /** Everyone out (the town was reset under them): their pages say so and offer a reload. */
  releaseAll(reason: string): void {
    for (const id of [...this.seats.keys()]) this.release(id, reason);
  }

  /** Sent out for `minutes` (a long time is a ban); kept across restarts. Works on someone not seated too. */
  kick(userId: string, minutes = 10): boolean {
    this.kicked.set(userId, Date.now() + minutes * 60_000);
    this.saveKicks();
    const waiting = this.queue.find((q) => q.who.userId === userId);
    if (waiting) {
      this.queue = this.queue.filter((q) => q !== waiting);
      if (waiting.ws.readyState === WebSocket.OPEN) {
        waiting.ws.send(JSON.stringify({ t: 'bye', reason: 'The Mayor sent you out of town for a bit.' } satisfies PlayServerMsg));
        waiting.ws.close(4003, 'kicked');
      }
      this.tellQueue();
    }
    if (!this.seats.has(userId)) return false;
    this.release(userId, 'The Mayor sent you out of town for a bit.');
    return true;
  }

  /** Let someone back in before their time is up. */
  unkick(userId: string): boolean {
    const had = this.kicked.delete(userId);
    if (had) this.saveKicks();
    return had;
  }

  private loadKicks(): void {
    if (!this.kicksFile) return;
    try {
      if (!fs.existsSync(this.kicksFile)) return;
      const raw = JSON.parse(fs.readFileSync(this.kicksFile, 'utf8')) as Record<string, unknown>;
      const now = Date.now();
      for (const [id, until] of Object.entries(raw ?? {})) if (typeof until === 'number' && until > now) this.kicked.set(id, until);
    } catch (e) {
      this.log(`play: could not read ${path.basename(this.kicksFile)}: ${(e as Error).message}`, 'warn');
    }
  }

  private saveKicks(): void {
    if (!this.kicksFile) return;
    try {
      const tmp = `${this.kicksFile}.tmp`;
      fs.mkdirSync(path.dirname(this.kicksFile), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.kicked), null, 2));
      fs.renameSync(tmp, this.kicksFile);
    } catch (e) {
      this.log(`play: could not save kicks: ${(e as Error).message}`, 'warn');
    }
  }

  private sweep(now: number): void {
    const busy = this.queue.length > 0;
    for (const [id, s] of this.seats) {
      if (s.leftAt && now - s.leftAt > (busy ? PlaySeats.GRACE_BUSY_MS : PlaySeats.GRACE_MS)) this.release(id, 'left');
      else if (now - s.lastInputAt > PlaySeats.IDLE_MS) this.release(id, 'Your seat went to someone else after ten quiet minutes. Reload to come back.');
      else if (busy && now - s.since > PlaySeats.SESSION_MS - PlaySeats.WARN_MS) {
        // Others are waiting: a turn is fifteen minutes, with a minute's warning.
        if (!s.warnedAt) {
          s.warnedAt = now;
          this.tell(id, 'One more minute: others are waiting for a turn.');
        } else if (now - s.warnedAt >= PlaySeats.WARN_MS && now - s.since >= PlaySeats.SESSION_MS)
          this.release(id, 'Your fifteen minutes are up and others are waiting for a turn. Reload to get back in line.');
      }
    }
    let expired = false;
    for (const [id, until] of this.kicked)
      if (until < now) {
        this.kicked.delete(id);
        expired = true;
      }
    if (expired) this.saveKicks();
    this.admitNext();
  }

  list(): { userId: string; name: string; since: number; lastInputAt: number; connected: boolean }[] {
    return [...this.seats].map(([userId, s]) => ({ userId, name: s.name, since: s.since, lastInputAt: s.lastInputAt, connected: !!s.socket }));
  }
}
