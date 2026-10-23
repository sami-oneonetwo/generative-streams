// The player page (/play): a chatter logged in with Kick (on the Cloudflare Worker in front, see
// play-worker/) walks their own character round town, the way the streamer walks the Mayor. WASD
// walks (camera-relative), Shift runs, Q/E or a drag turns the camera, the wheel zooms, Enter says
// something aloud, 1–8 strike a pose, B builds on their own lot, and clicking one of their own
// builds reworks or removes it, F fixes your own damaged build. The figure moves here first and the
// server is told twenty times a second; the server checks how far each step goes. Ten seats: when
// they are all taken, the page waits in line (its place shown) and keeps watching the town. On a
// phone a thumb stick walks and buttons fire, ride, fix, say and build. Knocked out, the figure
// lies still and sees stars until it is back up.
import type { DudesScene, Emote, MayorView } from './types';
import { CITY_BOUNDS, SQUARE } from './types';
import { ARMS, rammed, shoot, type Arm, type OperatorHandles } from './operator';

const WALK = 3.4,
  RUN = 7;
const SEND_MS = 50;
const BEAT_MS = 2000;
const POSES: Emote[] = ['wave', 'cheer', 'point', 'laugh', 'dance', 'think', 'bow', 'sit'];
const RADIUS = 0.35;
/** Aboard (as the Mayor's page, operator.ts): top speed, turning and pick-up by how it gets about. */
const RIDE_SPEED = { roam: 5.5, drive: 11, fly: 13, vehicle: 9 } as const;
const RIDE_TURN = { roam: 4.5, drive: 2.6, fly: 2.2, vehicle: 3 } as const;
const RIDE_ACCEL = { roam: 9, drive: 8, fly: 6, vehicle: 8 } as const;
const RIDE_BRAKE = 16;
const CRUISE = 6,
  CEILING = 30,
  CLIMB = 5;
const toward = (a: number, b: number, max: number) => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + Math.max(-max, Math.min(max, d));
};
type Ride = NonNullable<MayorView['riding']>;

type PlayMsg =
  | { t: 'welcome'; id: string; name: string; position: { x: number; z: number }; facing: number; seats: Seats }
  | { t: 'full'; seats: Seats }
  | { t: 'queue'; position: number; seats: Seats }
  | { t: 'ko'; ms: number; position: { x: number; z: number }; facing: number }
  | { t: 'closed' }
  | { t: 'bye'; reason: string }
  | { t: 'note'; text: string }
  | { t: 'ride'; ride?: Ride; position: { x: number; z: number }; facing: number };
interface Seats {
  used: number;
  cap: number;
  open: boolean;
  waiting?: number;
}

export function createPlayer(el: (id: string) => HTMLElement, getState: () => DudesScene | undefined): OperatorHandles {
  document.body.classList.add('player');
  const keys = new Set<string>();
  let id: string | undefined,
    x = 0,
    z = 0,
    facing = Math.PI,
    moving = false,
    placed = false,
    lastSent = 0,
    lastMove = '';
  let ride: Ride | undefined,
    speed = 0,
    alt = 0,
    altWant = 0;
  const arms = { armed: undefined as Arm, lastShot: 0, lastRam: 0 };
  /** Knocked out until this page time: no walking, stars overhead. */
  let koUntil = 0;
  const knocked = () => performance.now() < koUntil;
  /** The thumb stick (phones): forward and right, -1..1 each, camera-relative like WASD. */
  const stick = { f: 0, r: 0, on: false };
  function fireNow(at?: { x: number; z: number }): boolean {
    if (knocked()) return false;
    const turned = shoot({ ...arms, ride, x, z, facing }, send, at);
    if (turned === undefined) return false;
    arms.lastShot = performance.now();
    facing = turned;
    lastSent = 0;
    return true;
  }
  let koShown = '';
  /** "Seeing stars": over the page while knocked out, counting down. */
  function renderKo() {
    const left = Math.ceil((koUntil - performance.now()) / 1000);
    const text = left > 0 ? `★ Seeing stars… back up in ${left} s` : '';
    if (text === koShown) return;
    koShown = text;
    el('pl-ko').textContent = text;
    el('pl-ko').hidden = !text;
  }
  function renderArms() {
    el('pl-arms').textContent = ride?.gun ? 'Aboard with a gun: click or X fires it' : ride ? 'Aboard: R to get off, drive into builds to ram them' : arms.armed ? `Carrying a ${arms.armed === 'rocket' ? 'rocket launcher' : 'blaster'}: click or X fires, G swaps` : '';
  }

  // --- the gate: logged in? a seat? ---
  const gate = el('pl-gate');
  function showGate(title: string, text: string, action?: { label: string; href?: string; onClick?: () => void }) {
    gate.hidden = false;
    el('pl-gate-title').textContent = title;
    el('pl-gate-text').textContent = text;
    const a = el('pl-gate-action') as HTMLAnchorElement;
    a.hidden = !action;
    if (action) {
      a.textContent = action.label;
      a.href = action.href ?? '#';
      a.onclick = action.onClick
        ? (e) => {
            e.preventDefault();
            action.onClick!();
          }
        : null;
    }
  }
  let toastAt = 0;
  function note(text: string) {
    el('pl-note').textContent = text;
    el('pl-note').hidden = false;
    toastAt = Date.now() + 5000 + text.length * 40;
  }
  setInterval(() => {
    if (Date.now() > toastAt) el('pl-note').hidden = true;
  }, 500);

  // --- the socket: this player's moves, words and builds ---
  let socket: WebSocket | undefined,
    retryMs = 2000,
    stopped = false;
  function connect() {
    if (stopped) return;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/player`);
    socket.onmessage = (e) => {
      let msg: PlayMsg;
      try {
        msg = JSON.parse(String(e.data)) as PlayMsg;
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        id = msg.id;
        [x, z, facing] = [msg.position.x, msg.position.z, msg.facing];
        ride = undefined;
        if (arms.armed) send({ t: 'arm', weapon: arms.armed });
        renderArms();
        placed = true;
        lastSent = 0;
        retryMs = 2000;
        gate.hidden = true;
        el('pl-who').textContent = msg.name;
        el('pl-seats').textContent = `${msg.seats.used}/${msg.seats.cap} playing`;
      } else if (msg.t === 'full') {
        showGate('The town is full', `All ${msg.seats.cap} spots are taken and the line is long. This page tries again every 20 seconds; leave it open.`);
        retryMs = 20_000;
      } else if (msg.t === 'queue') {
        showGate(
          msg.position === 1 ? "You're next" : `You're number ${msg.position} in line`,
          `All ${msg.seats.cap} spots are taken right now. Leave this page open: you get the next free one${msg.position > 1 ? ` after ${msg.position - 1} ${msg.position === 2 ? 'other' : 'others'}` : ''}. Turns are fifteen minutes while people wait.`,
        );
        retryMs = 5000;
      } else if (msg.t === 'ko') {
        // Knocked flat: lie still where the server has them, seeing stars, until they are back up.
        koUntil = performance.now() + Math.max(0, msg.ms);
        [x, z, facing] = [msg.position.x, msg.position.z, msg.facing];
        speed = 0;
        lastSent = 0;
      } else if (msg.t === 'closed') {
        showGate('The doors are shut', 'The Mayor has closed the town to visitors for now. This page keeps checking.');
        retryMs = 30_000;
      } else if (msg.t === 'bye') {
        id = undefined;
        placed = false;
        if (/log in/i.test(msg.reason)) {
          stopped = true;
          showGate('Walk your character round town', 'Log in with your Kick account and you play as your own character, the one your chat messages made.', { label: 'Log in with Kick', href: '/login' });
        } else {
          showGate('You left town', msg.reason, { label: 'Come back', onClick: () => location.reload() });
          stopped = true;
        }
      } else if (msg.t === 'note') note(msg.text);
      else if (msg.t === 'ride') {
        // On or off: the server put them in the seat (facing the way it faces), or beside it.
        ride = msg.ride;
        [x, z, facing] = [msg.position.x, msg.position.z, msg.facing];
        speed = 0;
        alt = ride?.altitude ?? 0;
        altWant = ride?.moves === 'fly' ? Math.max(alt, CRUISE) : 0;
        lastSent = 0;
        renderArms();
      }
    };
    socket.onclose = () => {
      id = undefined;
      placed = false;
      if (!stopped) setTimeout(connect, retryMs);
    };
  }
  // Who is this? The Worker in front knows; without a login there is nothing to connect.
  void fetch('/api/play/me', { cache: 'no-store' })
    .then((r) => r.json())
    .then((me: { user: { id: string; name: string } | null; seats: Seats; configured: boolean }) => {
      if (!me.user) {
        showGate('Walk your character round town', `Log in with your Kick account and you play as your own character, the one your chat messages made. ${me.seats.cap} can play at once (${me.seats.used} in now).`, { label: 'Log in with Kick', href: '/login' });
        return;
      }
      el('pl-who').textContent = me.user.name;
      connect();
    })
    .catch(() => showGate('Could not reach the town', 'The stream may be offline. Reload in a bit.', { label: 'Reload', onClick: () => location.reload() }));

  const send = (msg: object) => {
    if (socket?.readyState === WebSocket.OPEN && id) socket.send(JSON.stringify(msg));
  };

  // --- keys ---
  const typing = () => ['pl-say', 'pl-build-what', 'inspect-rework-text'].includes(document.activeElement?.id ?? '');
  const building = () => !el('pl-build-box').hidden;
  function openBuild() {
    el('pl-build-box').hidden = false;
    (el('pl-build-what') as HTMLInputElement).focus();
  }
  function closeBuild() {
    el('pl-build-box').hidden = true;
    (el('pl-build-what') as HTMLInputElement).blur();
  }
  function openSay() {
    el('pl-say-box').hidden = false;
    (el('pl-say') as HTMLInputElement).focus();
  }
  function closeSay() {
    el('pl-say-box').hidden = true;
    (el('pl-say') as HTMLInputElement).blur();
  }
  addEventListener('keydown', (e) => {
    if (building() && typing()) {
      if (e.key === 'Enter') {
        const what = (el('pl-build-what') as HTMLInputElement).value.trim();
        if (what) send({ t: 'build', what });
        (el('pl-build-what') as HTMLInputElement).value = '';
        closeBuild();
      } else if (e.key === 'Escape') closeBuild();
      return;
    }
    if (typing()) {
      if (e.key === 'Enter' && document.activeElement?.id === 'pl-say') {
        const input = el('pl-say') as HTMLInputElement;
        const text = input.value.trim();
        if (text) send({ t: 'say', text });
        input.value = '';
        closeSay();
      } else if (e.key === 'Escape') closeSay();
      return;
    }
    if (!id) return;
    const k = e.key.toLowerCase();
    if (k === 'enter') {
      openSay();
      e.preventDefault();
      return;
    }
    if (k === 'b') {
      openBuild();
      e.preventDefault();
      return;
    }
    if (k === 'r') {
      if (!knocked()) send({ t: 'ride' });
      return;
    }
    if (k === 'f') {
      if (!knocked()) send({ t: 'fix' });
      return;
    }
    if (k === 'g') {
      arms.armed = ARMS[(ARMS.indexOf(arms.armed) + 1) % ARMS.length];
      send({ t: 'arm', weapon: arms.armed ?? 'none' });
      renderArms();
      return;
    }
    if (k === 'x' || (k === ' ' && ride?.moves !== 'fly')) {
      fireNow();
      e.preventDefault();
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= POSES.length) {
      send({ t: 'emote', pose: POSES[n - 1] });
      return;
    }
    if (['w', 'a', 's', 'd', 'q', 'e', 'z', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      keys.add(k);
      e.preventDefault();
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  el('pl-say-open').onclick = () => id && openSay();
  el('pl-build-open').onclick = () => id && openBuild();

  // --- phones: a thumb stick to walk, buttons for the keys ---
  if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
    document.body.classList.add('touch');
    const base = el('pl-stick'),
      knob = el('pl-stick-knob');
    let finger: number | undefined;
    const move = (e: PointerEvent) => {
      const b = base.getBoundingClientRect();
      const reach = b.width / 2;
      let dx = (e.clientX - (b.left + reach)) / reach,
        dy = (e.clientY - (b.top + reach)) / reach;
      const len = Math.hypot(dx, dy);
      if (len > 1) [dx, dy] = [dx / len, dy / len];
      stick.r = dx;
      stick.f = -dy;
      stick.on = len > 0.12;
      knob.style.transform = `translate(${dx * reach * 0.6}px, ${dy * reach * 0.6}px)`;
    };
    const let_go = () => {
      finger = undefined;
      Object.assign(stick, { f: 0, r: 0, on: false });
      knob.style.transform = '';
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      finger = e.pointerId;
      base.setPointerCapture(e.pointerId);
      move(e);
    });
    base.addEventListener('pointermove', (e) => e.pointerId === finger && move(e));
    base.addEventListener('pointerup', (e) => e.pointerId === finger && let_go());
    base.addEventListener('pointercancel', (e) => e.pointerId === finger && let_go());
    const tap: Record<string, () => void> = {
      fire: () => fireNow(),
      arm: () => {
        arms.armed = ARMS[(ARMS.indexOf(arms.armed) + 1) % ARMS.length];
        send({ t: 'arm', weapon: arms.armed ?? 'none' });
        renderArms();
        el('pl-t-arm').textContent = arms.armed === 'blaster' ? 'Blaster' : arms.armed === 'rocket' ? 'Rocket' : 'Arm';
      },
      ride: () => !knocked() && send({ t: 'ride' }),
      fix: () => !knocked() && send({ t: 'fix' }),
      say: () => openSay(),
      build: () => openBuild(),
    };
    for (const b of el('pl-pad').querySelectorAll<HTMLButtonElement>('button[data-act]'))
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (id) tap[b.dataset.act ?? '']?.();
      });
  }

  // --- walking into things (as operator.ts) ---
  const radius = () => (ride ? Math.min(1.6, Math.max(RADIUS, ride.size / 3)) : RADIUS);
  function blocked(px: number, pz: number): boolean {
    const b = CITY_BOUNDS;
    if (px < b.minX + 0.5 || px > b.maxX - 0.5 || pz < b.minZ + 0.5 || pz > b.maxZ - 0.5) return true;
    if (ride?.moves === 'fly') return false; // over everything
    const RADIUS = radius();
    if (Math.hypot(px - SQUARE.fountain.x, pz - SQUARE.fountain.z) < SQUARE.fountain.r + RADIUS) return true;
    if (Math.abs(px - SQUARE.market.x) < SQUARE.market.w / 2 + RADIUS && Math.abs(pz - SQUARE.market.z) < SQUARE.market.d / 2 + RADIUS) return true;
    for (const o of getState()?.objects ?? []) {
      if (o.passable || o.id === ride?.id || o.destroyedAt !== undefined) continue;
      const at = o.driven?.at ?? o.position;
      if (Math.abs(px - at.x) < o.footprint.width / 2 + RADIUS && Math.abs(pz - at.z) < o.footprint.depth / 2 + RADIUS) return true;
    }
    return false;
  }

  function frame(dt: number, yaw: number) {
    let f = 0,
      r = 0;
    const out = knocked();
    if (!typing() && id && !out) {
      if (keys.has('w') || keys.has('arrowup')) f += 1;
      if (keys.has('s') || keys.has('arrowdown')) f -= 1;
      if (keys.has('d') || keys.has('arrowright')) r += 1;
      if (keys.has('a') || keys.has('arrowleft')) r -= 1;
      if (stick.on && !f && !r) [f, r] = [stick.f, stick.r];
    }
    const running = keys.has('shift') || (stick.on && Math.hypot(stick.f, stick.r) > 0.92);
    renderKo();
    const fx = -Math.sin(yaw),
      fz = -Math.cos(yaw),
      rx = Math.cos(yaw),
      rz = -Math.sin(yaw);
    moving = !!(f || r) && placed;
    if (ride?.moves === 'fly' && !typing()) {
      if (keys.has(' ')) altWant = Math.min(CEILING, altWant + CLIMB * 1.4 * dt);
      if (keys.has('z')) altWant = Math.max(0, altWant - CLIMB * 1.4 * dt);
      alt += Math.max(-CLIMB * dt, Math.min(CLIMB * dt, altWant - alt));
    }
    if (ride && placed) {
      // Aboard: steer toward where the keys point, pick up speed, go where it faces (as operator.ts).
      const want = f || r ? Math.atan2(fx * f + rx * r, fz * f + rz * r) : undefined;
      if (want !== undefined) facing = toward(facing, want, RIDE_TURN[ride.moves] * dt);
      const top = RIDE_SPEED[ride.moves] * (running ? 1.6 : 1);
      const aim = want === undefined ? 0 : top * Math.max(0.3, Math.cos(want - facing));
      speed += Math.max(-RIDE_BRAKE * dt, Math.min(RIDE_ACCEL[ride.moves] * dt, aim - speed));
      const dx = Math.sin(facing) * speed * dt,
        dz = Math.cos(facing) * speed * dt;
      if (speed > 0.01) {
        if (blocked(x, z) || !blocked(x + dx, z + dz)) {
          x += dx;
          z += dz;
        } else if (!blocked(x + dx, z)) {
          x += dx;
          speed *= 0.6;
        } else if (!blocked(x, z + dz)) {
          z += dz;
          speed *= 0.6;
        } else {
          // Into a build at a lick: it takes a knock.
          const hit = speed > 2 ? rammed(getState()?.objects, x + dx, z + dz, radius(), ride.id) : undefined;
          if (hit && performance.now() - arms.lastRam > 450) {
            arms.lastRam = performance.now();
            send({ t: 'ram', target: hit, speed });
          }
          speed = 0;
        }
      }
      moving = speed > 0.15;
    } else if (moving) {
      let dx = fx * f + rx * r,
        dz = fz * f + rz * r;
      const len = Math.hypot(dx, dz) || 1;
      // A thumb stick pushed part way walks slower.
      const step = (running ? RUN : WALK) * dt * Math.min(1, Math.max(0.35, Math.hypot(f, r)));
      dx = (dx / len) * step;
      dz = (dz / len) * step;
      facing = Math.atan2(dx, dz);
      if (blocked(x, z) || !blocked(x + dx, z + dz)) {
        x += dx;
        z += dz;
      } else if (!blocked(x + dx, z)) x += dx;
      else if (!blocked(x, z + dz)) z += dz;
    }
    const b = CITY_BOUNDS;
    x = Math.max(b.minX + 0.5, Math.min(b.maxX - 0.5, x));
    z = Math.max(b.minZ + 0.5, Math.min(b.maxZ - 0.5, z));
    const now = performance.now();
    const key = `${x.toFixed(2)},${z.toFixed(2)},${facing.toFixed(2)},${moving},${alt.toFixed(2)}`;
    if (placed && ((key !== lastMove && now - lastSent > SEND_MS) || now - lastSent > BEAT_MS)) {
      send({ t: 'move', x, z, facing, moving, running, ...(ride?.moves === 'fly' ? { alt } : {}), at: Date.now() });
      lastSent = now;
      lastMove = key;
    }
    return { x, z, facing, moving, cam: { x, z }, free: false, ...(ride ? { ride: { ...ride, altitude: ride.moves === 'fly' ? alt : ride.altitude } } : {}) };
  }

  let lastSeen = '';
  function scene(s: DudesScene, serverNow: number) {
    if (!id) return;
    const me = s.dudes.find((d) => d.id === id);
    if (!me) return;
    // Knocked out (the server's word, in case its note went astray): lie still until it says.
    if (me.ko && me.ko > serverNow && !knocked()) {
      koUntil = performance.now() + (me.ko - serverNow);
      [x, z] = [me.position.x, me.position.z];
      speed = 0;
    }
    // What they were driving was knocked down under them (or taken away): on foot again.
    if (ride && me.riding !== ride.id) {
      ride = undefined;
      speed = 0;
      renderArms();
    }
    // The server put them somewhere else (knocked flat and dragged off, a step it would not allow): go there.
    if (Math.hypot(me.position.x - x, me.position.z - z) > 6 && !moving) [x, z] = [me.position.x, me.position.z];
    const job = me.job ? `${me.job.kind === 'build' ? 'Building' : me.job.kind === 'edit' ? 'Reworking' : 'Taking down'} ${me.job.label} · ${me.job.status}${me.job.status === 'building' ? ` ${Math.round(me.job.progress * 100)}%` : ''}` : '';
    const line = [me.address, me.coins !== undefined ? `§${me.coins}` : '', job].filter(Boolean).join(' · ');
    if (line !== lastSeen) {
      lastSeen = line;
      el('pl-status').textContent = line;
    }
  }

  return {
    frame: (dt, yaw) => frame(dt, yaw),
    mayor: (_view: MayorView | undefined) => undefined,
    scene,
    pick: () => false,
    spot: () => undefined,
    panBy: () => undefined,
    turn: (dt) => (keys.has('q') ? 1 : 0) * dt * 1.6 - (keys.has('e') ? 1 : 0) * dt * 1.6,
    edit: (target, change) => send({ t: 'edit', target, change }),
    remove: (target) => send({ t: 'remove', target }),
    pickPerson: () => false,
    focusOn: () => undefined,
    self: () => id,
    canRework: (objectId) => !!id && getState()?.objects.find((o) => o.id === objectId)?.owner === id,
    fireAt: (at) => (id && (arms.armed || ride?.gun) ? (fireNow(at), true) : false),
  };
}
