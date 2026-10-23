// The operator page (/mayor): the streamer walks the Mayor round town and narrates. WASD walks
// (camera-relative), Shift runs, Q/E or a drag turns the camera, the wheel zooms, Enter says
// something aloud, 1–8 strike a pose, C switches the stream between following the operator's
// camera and framing everyone, H hides the Mayor, and F lets the camera go free of him: WASD (and
// a right-drag) then move the camera itself, and the Mayor stands where he was left. The figure moves here first and the server is told fifteen times a
// second, so walking never waits on the snapshot clock. The side panel is what a narrator wants
// to hand: who is near and what they are up to, everyone about, and what the town is doing.
import type { DudeView, DudesScene, Emote, MayorView } from './types';
import { CITY_BOUNDS, SQUARE } from './types';

const WALK = 3.4,
  RUN = 7;
const SEND_MS = 50; // twenty a second while moving
const BEAT_MS = 2000; // and a heartbeat standing still, so the stream knows the Mayor is still here
const POSES: Emote[] = ['wave', 'cheer', 'point', 'laugh', 'dance', 'think', 'bow', 'sit'];
const RADIUS = 0.35;
/** How fast the Mayor takes what he is riding (the server's MOVERS.ridden, plus plain vehicles). */
const RIDE_SPEED = { roam: 5.5, drive: 11, fly: 13, vehicle: 9 } as const;
/** Steering aboard: how fast it turns (rad/s), picks up speed and slows (m/s²). A car turns wider than a donkey. */
const RIDE_TURN = { roam: 4.5, drive: 2.6, fly: 2.2, vehicle: 3 } as const;
const RIDE_ACCEL = { roam: 9, drive: 8, fly: 6, vehicle: 8 } as const;
const RIDE_BRAKE = 16;
const toward = (a: number, b: number, max: number) => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + Math.max(-max, Math.min(max, d));
};
type Ride = NonNullable<MayorView['riding']>;

export interface OperatorHandles {
  /** Per frame: walk, and say where the Mayor is. Returns the Mayor's spot for the camera. */
  frame(dt: number, yaw: number, half: number): { x: number; z: number; facing: number; moving: boolean; cam: { x: number; z: number }; free: boolean; ride?: Ride };
  /** What the server says about the Mayor (between snapshots too): getting on or off something. */
  mayor(view: MayorView | undefined): void;
  /** A right-drag on the free camera: move it this far over the ground. */
  panBy(dx: number, dz: number): void;
  /** A click on the ground: with the build box open, that is where the build goes (true: taken). */
  pick(at: { x: number; z: number }): boolean;
  /** The spot chosen for the next build, while the build box is open. */
  spot(): { x: number; z: number } | undefined;
  /** Each applied snapshot: the panels, and where the Mayor was if this page is just opening. */
  scene(s: DudesScene, serverNow: number): void;
  /** Q/E turn the camera: how much this frame (radians). */
  turn(dt: number): number;
  /** Rework a build (clicked in the inspect panel): redesigned with this change, swapped in where it stands. */
  edit(target: string, change: string): void;
  /** Take a build down (Delete in the inspect panel). */
  remove(target: string): void;
  /** A click on a person: with "Focus on…" armed, the stream camera goes to them (true: taken). */
  pickPerson(id: string): boolean;
  /** Put the stream camera on this person. */
  focusOn(id: string): void;
  /** The figure this page walks: the Mayor, or a player's own character (player.ts) once seated. */
  self(): string | undefined;
  /** Whether this page may rework or take down that build (the Mayor: any; a player: their own). */
  canRework(objectId: string): boolean;
  /** A click on the ground while carrying a weapon (or aboard something with a gun): fire at it (true: taken). */
  fireAt(at: { x: number; z: number }): boolean;
}

/** A shot this page just fired, for the effects layer to draw at once (main.ts listens). */
export const LOCAL_SHOT = 'dudes:local-shot';
export interface LocalShot {
  gun: 'blaster' | 'rocket' | 'cannon';
  from: { x: number; z: number };
  to: { x: number; z: number };
  fromHeight: number;
}
/** What G steps through: nothing in hand, a blaster, a rocket launcher. */
export const ARMS = [undefined, 'blaster', 'rocket'] as const;
export type Arm = (typeof ARMS)[number];
/** How often the page sends a shot (the server keeps its own cooldown too). */
export const FIRE_MS = { blaster: 250, rocket: 1800, cannon: 1600 } as const;
/**
 * Fire: at a spot (a click), or straight ahead (Space/X), with whatever is in hand or the gun aboard.
 * Turns the figure to face the spot. Returns the new facing, or undefined when nothing was sent.
 */
export function shoot(state: { armed: Arm; ride?: { gun?: boolean }; lastShot: number; x: number; z: number; facing: number }, send: (m: object) => void, at?: { x: number; z: number }): number | undefined {
  const gun = state.ride?.gun ? 'cannon' : state.armed;
  if (!gun) return undefined;
  const now = performance.now();
  if (now - state.lastShot < FIRE_MS[gun]) return undefined;
  state.lastShot = now;
  const facing = at && Math.hypot(at.x - state.x, at.z - state.z) > 0.6 && !state.ride ? Math.atan2(at.x - state.x, at.z - state.z) : state.facing;
  send({ t: 'fire', ...(at ? { aim: at } : {}) });
  // Drawn here at once (a muzzle flash, and a blaster's bolt), not half a second later off the snapshot.
  const range = gun === 'blaster' ? 16 : gun === 'rocket' ? 22 : 26;
  const d = at ? Math.hypot(at.x - state.x, at.z - state.z) : 0;
  const aim = at && d > 0.6 ? Math.atan2(at.x - state.x, at.z - state.z) : facing;
  const reach = gun === 'blaster' || !at ? range : Math.min(range, d);
  const ahead = (m: number) => ({ x: state.x + Math.sin(aim) * m, z: state.z + Math.cos(aim) * m });
  const detail: LocalShot = { gun, from: ahead(0.4), to: ahead(reach), fromHeight: state.ride ? 1.4 : 1.3 };
  dispatchEvent(new CustomEvent<LocalShot>(LOCAL_SHOT, { detail }));
  return facing;
}
/** Aboard something and pushing into a build: tell the server what it ran into, and how hard. */
export function rammed(objects: DudesScene['objects'] | undefined, px: number, pz: number, radius: number, rideId: string): string | undefined {
  for (const o of objects ?? []) {
    if (o.passable || o.id === rideId || o.destroyedAt !== undefined) continue;
    const at = o.driven?.at ?? o.position;
    if (Math.abs(px - at.x) < o.footprint.width / 2 + radius && Math.abs(pz - at.z) < o.footprint.depth / 2 + radius) return o.id;
  }
  return undefined;
}

export function createOperator(el: (id: string) => HTMLElement, getState: () => DudesScene | undefined): OperatorHandles {
  document.body.classList.add('operator');
  const keys = new Set<string>();
  let x = 0,
    z = 9,
    facing = Math.PI,
    moving = false,
    placed = false,
    lastSent = 0,
    lastMove = '';
  let ride: Ride | undefined;
  let speed = 0; // aboard: how fast it is going now
  const arms = { armed: undefined as Arm, lastShot: 0, lastRam: 0 };
  function fireNow(at?: { x: number; z: number }): boolean {
    const turned = shoot({ ...arms, ride, x, z, facing }, send, at);
    if (turned === undefined) return false;
    arms.lastShot = performance.now();
    facing = turned;
    lastSent = 0; // the new facing goes out straight away
    return true;
  }
  // Flying: how high it is, and how high the keys want it (Space up, Z down). It takes off by itself.
  let alt = 0,
    altWant = 0;
  const CRUISE = 6,
    CEILING = 30,
    CLIMB = 5;
  const sound = { music: 0.5, sfx: 0.8 };
  // The stream camera's mode: "mayor" (follow), "everyone" (frame them all) or "person" (focus).
  let focusId: string | undefined,
    choosing = false;
  let follow = true,
    visible = true,
    free = false,
    cx = 0,
    cz = 9;

  // --- the socket to the server: the Mayor's moves, words and poses ---
  let socket: WebSocket | undefined;
  const token = new URLSearchParams(location.search).get('token');
  function connect() {
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/mayor${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    socket.onopen = () => {
      el('op-link').textContent = 'connected';
      el('op-link').className = 'ok';
      lastSent = 0;
    };
    socket.onclose = () => {
      el('op-link').textContent = 'not connected (localhost, or ?token=…) · retrying';
      el('op-link').className = 'bad';
      setTimeout(connect, 2000);
    };
  }
  connect();
  const send = (msg: object) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  };

  // --- keys ---
  const typing = () => ['op-say', 'op-aide', 'op-build-what', 'op-build-for', 'inspect-rework-text'].includes(document.activeElement?.id ?? '');
  // --- the aide: a wish in words, answered by the server on a model call of its own (aide.ts) ---
  const asking = () => !el('op-aide-box').hidden;
  function openAide() {
    el('op-aide-box').hidden = false;
    (el('op-aide') as HTMLInputElement).focus();
  }
  function closeAide() {
    el('op-aide-box').hidden = true;
    (el('op-aide') as HTMLInputElement).blur();
  }
  let aideShown = '';
  let aideHideAt = 0;
  function renderAide(aide: MayorView['aide']) {
    const box = el('op-aide-reply');
    if (!aide) return;
    const key = `${aide.at}:${aide.thinking}:${aide.reply}`;
    if (key !== aideShown) {
      aideShown = key;
      el('op-aide-text').textContent = aide.thinking ? `On it: “${aide.asked}”…` : aide.reply || 'Done.';
      box.classList.toggle('bad', !aide.thinking && !aide.ok);
      box.hidden = false;
      aideHideAt = aide.thinking ? Infinity : Date.now() + 9000 + aide.reply.length * 40;
    }
    if (Date.now() > aideHideAt) box.hidden = true;
  }
  setInterval(() => renderAide(getState()?.mayor?.aide), 400);
  // --- the build box: what, for whom (their lot), and where (a click on the ground) ---
  let buildAt: { x: number; z: number } | undefined;
  const building = () => !el('op-build-box').hidden;
  function openBuild() {
    buildAt = undefined;
    el('op-build-box').hidden = false;
    (el('op-build-what') as HTMLInputElement).focus();
    renderWhere();
  }
  function closeBuild() {
    el('op-build-box').hidden = true;
    (el('op-build-what') as HTMLInputElement).blur();
    (el('op-build-for') as HTMLInputElement).blur();
    buildAt = undefined;
  }
  function renderWhere() {
    const who = (el('op-build-for') as HTMLInputElement).value.trim();
    el('op-build-where').textContent = who ? `on ${who.replace(/^@/, '')}'s lot (as a gift)` : buildAt ? 'where you clicked' : 'where you are standing (click the ground to choose)';
  }
  el('op-build-for').addEventListener('input', renderWhere);
  function submitBuild() {
    const what = (el('op-build-what') as HTMLInputElement).value.trim();
    const who = (el('op-build-for') as HTMLInputElement).value.trim();
    if (what) send({ t: 'build', what, ...(who ? { for: who } : {}), ...(buildAt ? { at: buildAt } : {}) });
    (el('op-build-what') as HTMLInputElement).value = '';
    (el('op-build-for') as HTMLInputElement).value = '';
    closeBuild();
  }
  addEventListener('keydown', (e) => {
    if (asking() && typing()) {
      if (e.key === 'Enter') {
        const text = (el('op-aide') as HTMLInputElement).value.trim();
        if (text) send({ t: 'ask', text });
        (el('op-aide') as HTMLInputElement).value = '';
        closeAide();
      } else if (e.key === 'Escape') closeAide();
      return;
    }
    if (building() && typing()) {
      if (e.key === 'Enter') submitBuild();
      else if (e.key === 'Escape') closeBuild();
      return;
    }
    if (typing()) {
      if (e.key === 'Enter') {
        const input = el('op-say') as HTMLInputElement;
        const text = input.value.trim();
        if (text) send({ t: 'say', text });
        input.value = '';
        input.blur();
        el('op-say-box').hidden = true;
      } else if (e.key === 'Escape') {
        (el('op-say') as HTMLInputElement).blur();
        el('op-say-box').hidden = true;
      }
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'enter' && visible) {
      el('op-say-box').hidden = false;
      (el('op-say') as HTMLInputElement).focus();
      e.preventDefault();
      return;
    }
    if (k === 'c') {
      follow = !follow;
      focusId = undefined;
      send({ t: 'follow', on: follow });
      renderFollow();
      return;
    }
    if (k === 'b') {
      openBuild();
      e.preventDefault();
      return;
    }
    if (k === 'i') {
      openAide();
      e.preventDefault();
      return;
    }
    // The stream's sound: M music on/off, N effects on/off, - and = music quieter/louder.
    if (k === 'm' || k === 'n' || k === '-' || k === '=') {
      if (k === 'm') sound.music = sound.music > 0 ? 0 : 0.5;
      if (k === 'n') sound.sfx = sound.sfx > 0 ? 0 : 0.8;
      if (k === '-') sound.music = Math.max(0, Math.round((sound.music - 0.1) * 10) / 10);
      if (k === '=') sound.music = Math.min(1, Math.round((sound.music + 0.1) * 10) / 10);
      send({ t: 'audio', ...sound });
      renderFollow();
      return;
    }
    if (k === 't') {
      // Have a go at whatever is nearest: hoops, a swim, the stage (again to stop).
      send({ t: 'play' });
      return;
    }
    if (k === 'r') {
      // On or off whatever is nearest (the server decides what that is, and says so).
      send({ t: 'ride' });
      return;
    }
    if (k === 'g') {
      // Pick up a weapon, swap it, put it away.
      arms.armed = ARMS[(ARMS.indexOf(arms.armed) + 1) % ARMS.length];
      send({ t: 'arm', weapon: arms.armed ?? 'none' });
      renderFollow();
      return;
    }
    if (k === 'x' || (k === ' ' && ride?.moves !== 'fly')) {
      fireNow();
      e.preventDefault();
      return;
    }
    if (k === 'f') {
      free = !free;
      if (free) [cx, cz] = [x, z];
      renderFollow();
      return;
    }
    if (k === 'h') {
      visible = !visible;
      send({ t: 'visible', on: visible });
      renderFollow();
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
  function setMode(mode: 'mayor' | 'everyone' | 'person', target?: string) {
    choosing = false;
    if (mode === 'person' && !target) {
      // Arm it: the next click on a person picks them.
      choosing = true;
      renderFollow();
      return;
    }
    follow = mode === 'mayor';
    focusId = mode === 'person' ? target : undefined;
    send({ t: 'camera', mode, ...(target ? { target } : {}) });
    renderFollow();
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#op-cam-modes button')) b.onclick = () => setMode(b.dataset.mode as 'mayor' | 'everyone' | 'person');
  function renderFollow() {
    const who = focusId ? (getState()?.dudes.find((d) => d.id === focusId)?.name ?? 'someone') : '';
    el('op-follow').textContent = choosing ? 'click someone to focus on' : focusId ? `on ${who}` : follow ? 'following the Mayor' : 'framing everyone';
    el('op-follow').className = choosing ? 'warn' : 'ok';
    const mode = focusId ? 'person' : follow ? 'mayor' : 'everyone';
    for (const b of document.querySelectorAll<HTMLButtonElement>('#op-cam-modes button')) b.classList.toggle('on', choosing ? b.dataset.mode === 'person' : b.dataset.mode === mode);
    el('op-visible').textContent = visible ? 'visible' : 'hidden';
    el('op-visible').className = visible ? 'ok' : 'warn';
    el('op-ride').textContent = ride ? `aboard ${getState()?.objects.find((o) => o.id === ride!.id)?.blueprint.name ?? 'something'} (R to get off)` : 'on foot (R near something to ride it)';
    el('op-ride').className = ride ? 'warn' : 'ok';
    el('op-arms').textContent = ride?.gun ? 'its gun (click or X to fire)' : arms.armed ? `${arms.armed === 'rocket' ? 'rocket launcher' : 'blaster'} (click or X to fire · G to swap)` : 'nothing (G for a weapon)';
    el('op-arms').className = arms.armed || ride?.gun ? 'warn' : 'ok';
    el('op-cam').textContent = free ? 'free (WASD moves the camera)' : 'on the Mayor';
    el('op-sound').textContent = `music ${Math.round(sound.music * 100)}% · effects ${sound.sfx > 0 ? 'on' : 'off'}`;
    el('op-sound').className = sound.music > 0 || sound.sfx > 0 ? 'ok' : 'warn';
    el('op-cam').className = free ? 'warn' : 'ok';
  }
  renderFollow();

  // --- walking into things: builds, the fountain, the market stall, the edge of town ---
  function blocked(px: number, pz: number): boolean {
    const b = CITY_BOUNDS;
    if (px < b.minX + 0.5 || px > b.maxX - 0.5 || pz < b.minZ + 0.5 || pz > b.maxZ - 0.5) return true;
    if (ride?.moves === 'fly') return false; // over everything
    // Aboard something, the something has to fit through too (roughly: half its length round him).
    const radius = ride ? Math.min(1.6, Math.max(RADIUS, ride.size / 3)) : RADIUS;
    if (Math.hypot(px - SQUARE.fountain.x, pz - SQUARE.fountain.z) < SQUARE.fountain.r + radius) return true;
    if (Math.abs(px - SQUARE.market.x) < SQUARE.market.w / 2 + radius && Math.abs(pz - SQUARE.market.z) < SQUARE.market.d / 2 + radius) return true;
    for (const o of getState()?.objects ?? []) {
      if (o.passable || o.id === ride?.id || o.destroyedAt !== undefined) continue;
      const at = o.driven?.at ?? o.position;
      if (Math.abs(px - at.x) < o.footprint.width / 2 + radius && Math.abs(pz - at.z) < o.footprint.depth / 2 + radius) return true;
    }
    return false;
  }
  const insideNow = () => blocked(x, z);

  function frame(dt: number, yaw: number, half: number) {
    let f = 0,
      r = 0;
    if (!typing()) {
      if (keys.has('w') || keys.has('arrowup')) f += 1;
      if (keys.has('s') || keys.has('arrowdown')) f -= 1;
      if (keys.has('d') || keys.has('arrowright')) r += 1;
      if (keys.has('a') || keys.has('arrowleft')) r -= 1;
    }
    // Camera-relative: forward is away from the camera, along the ground.
    const fx = -Math.sin(yaw),
      fz = -Math.cos(yaw),
      rx = Math.cos(yaw),
      rz = -Math.sin(yaw);
    if (free) {
      // The keys fly the camera; the further out it is, the faster it goes.
      moving = false;
      if ((f || r) && placed) {
        const len = Math.hypot(fx * f + rx * r, fz * f + rz * r) || 1;
        const speed = Math.max(8, half * 1.3) * (keys.has('shift') ? 2.5 : 1) * dt;
        cx += ((fx * f + rx * r) / len) * speed;
        cz += ((fz * f + rz * r) / len) * speed;
        clampCam();
      }
    } else moving = !!(f || r);
    if (ride?.moves === 'fly' && !typing()) {
      // Up and down: Space climbs, Z comes down; it eases there at a climb rate.
      if (keys.has(' ')) altWant = Math.min(CEILING, altWant + CLIMB * 1.4 * dt);
      if (keys.has('z')) altWant = Math.max(0, altWant - CLIMB * 1.4 * dt);
      alt += Math.max(-CLIMB * dt, Math.min(CLIMB * dt, altWant - alt));
    }
    if (ride && placed && !free) {
      // Aboard: steer toward where the keys point, pick up speed when roughly facing that way, slow
      // down when the keys let go, and go where it is facing. Smooth turns, no sliding sideways.
      const want = f || r ? Math.atan2(fx * f + rx * r, fz * f + rz * r) : undefined;
      if (want !== undefined) facing = toward(facing, want, RIDE_TURN[ride.moves] * dt);
      const top = RIDE_SPEED[ride.moves] * (keys.has('shift') ? 1.6 : 1);
      const aim = want === undefined ? 0 : top * Math.max(0.3, Math.cos(want - facing));
      speed += Math.max(-RIDE_BRAKE * dt, Math.min(RIDE_ACCEL[ride.moves] * dt, aim - speed));
      const dx = Math.sin(facing) * speed * dt,
        dz = Math.cos(facing) * speed * dt;
      if (speed > 0.01) {
        if (insideNow() || !blocked(x + dx, z + dz)) {
          x += dx;
          z += dz;
        } else if (!blocked(x + dx, z)) {
          x += dx;
          speed *= 0.6;
        } else if (!blocked(x, z + dz)) {
          z += dz;
          speed *= 0.6;
        } else {
          // Into a wall: stopped, and if it was going at a lick, the wall takes a knock.
          const hit = speed > 2 ? rammed(getState()?.objects, x + dx, z + dz, Math.min(1.6, Math.max(RADIUS, ride.size / 3)), ride.id) : undefined;
          if (hit && performance.now() - arms.lastRam > 450) {
            arms.lastRam = performance.now();
            send({ t: 'ram', target: hit, speed });
          }
          speed = 0;
        }
      }
      const b = CITY_BOUNDS;
      x = Math.max(b.minX + 0.5, Math.min(b.maxX - 0.5, x));
      z = Math.max(b.minZ + 0.5, Math.min(b.maxZ - 0.5, z));
      moving = speed > 0.15;
    } else if (moving && placed) {
      let dx = fx * f + rx * r,
        dz = fz * f + rz * r;
      const len = Math.hypot(dx, dz) || 1;
      const step = (ride ? RIDE_SPEED[ride.moves] * (keys.has('shift') ? 1.6 : 1) : keys.has('shift') ? RUN : WALK) * dt;
      dx = (dx / len) * step;
      dz = (dz / len) * step;
      facing = Math.atan2(dx, dz);
      // Slide along whatever is in the way; standing inside something (it went up round us) never traps.
      // Hidden, he is only a camera: straight through anything, still inside the town.
      const stuck = insideNow() || !visible;
      if (stuck || !blocked(x + dx, z + dz)) {
        x += dx;
        z += dz;
      } else if (!blocked(x + dx, z)) x += dx;
      else if (!blocked(x, z + dz)) z += dz;
      const b = CITY_BOUNDS;
      x = Math.max(b.minX + 0.5, Math.min(b.maxX - 0.5, x));
      z = Math.max(b.minZ + 0.5, Math.min(b.maxZ - 0.5, z));
    }
    if (!free) [cx, cz] = [x, z];
    const now = performance.now();
    const key = `${x.toFixed(2)},${z.toFixed(2)},${facing.toFixed(2)},${moving},${yaw.toFixed(2)},${half.toFixed(1)},${cx.toFixed(2)},${cz.toFixed(2)},${alt.toFixed(2)}`;
    if (placed && ((key !== lastMove && now - lastSent > SEND_MS) || now - lastSent > BEAT_MS)) {
      send({ t: 'move', x, z, facing, moving, running: keys.has('shift'), yaw, half, cx, cz, ...(ride?.moves === 'fly' ? { alt } : {}), at: Date.now() });
      lastSent = now;
      lastMove = key;
    }
    return { x, z, facing, moving, cam: { x: cx, z: cz }, free, ...(ride ? { ride: { ...ride, altitude: ride.moves === 'fly' ? alt : ride.altitude } } : {}) };
  }
  let moved = -1;
  function mayor(view: MayorView | undefined) {
    renderAide(view?.aide);
    // The server put him somewhere (onto the court): this page jumps there too.
    if (view && (view.moved ?? 0) !== moved) {
      if (moved >= 0) [x, z, facing] = [view.position.x, view.position.z, view.facing];
      moved = view.moved ?? 0;
    }
    const next = view?.riding;
    if (next?.id === ride?.id) {
      if (next) ride = next; // a flyer's height, as it climbs
      return;
    }
    // On, or off: the server put him in the seat (facing the way it faces), or beside it.
    if (view) [x, z, facing] = [view.position.x, view.position.z, view.facing];
    ride = next;
    speed = 0;
    // Into something that flies: from wherever it is now, up to cruising height unless told otherwise.
    alt = next?.altitude ?? 0;
    altWant = next?.moves === 'fly' ? Math.max(alt, CRUISE) : 0;
    if (!free) [cx, cz] = [x, z];
    lastSent = 0;
    renderFollow();
  }
  function clampCam() {
    const b = CITY_BOUNDS;
    cx = Math.max(b.minX - 20, Math.min(b.maxX + 20, cx));
    cz = Math.max(b.minZ - 20, Math.min(b.maxZ + 20, cz));
  }

  // --- the panels ---
  function goTo(d: DudeView) {
    // Beside them, on the camera's side.
    x = d.position.x + 1.6;
    z = d.position.z + 1.6;
    if (blocked(x, z)) [x, z] = [d.position.x - 1.6, d.position.z - 1.6];
    facing = Math.atan2(d.position.x - x, d.position.z - z);
    if (free) [cx, cz] = [x, z];
    lastSent = 0;
  }
  const doing = (d: DudeView, serverNow: number) => {
    if (d.say && d.say.until > serverNow) return `“${d.say.text}”`;
    if (d.job) return `${d.job.kind === 'build' ? 'building' : d.job.kind} ${d.job.label} (${d.job.status})`;
    if (d.use) return `${d.use.how}…`;
    if (d.hidden) return 'inside somewhere';
    if (d.emote && d.emote.until > serverNow) return d.emote.pose;
    if (d.away) return 'away';
    return d.activity;
  };
  let listKey = '';
  function scene(s: DudesScene, serverNow: number) {
    const m: MayorView | undefined = s.mayor;
    if (!placed) {
      if (m) {
        x = m.position.x;
        z = m.position.z;
        facing = m.facing;
        follow = m.follow;
        focusId = m.focus;
        visible = !m.hidden;
        ride = m.riding;
        alt = altWant = m.riding?.altitude ?? 0;
        if (m.audio) Object.assign(sound, m.audio);
        renderFollow();
      }
      placed = true;
    }
    const chatters = s.dudes.filter((d) => !d.npc && !d.resident && !d.mayor);
    const near = chatters
      .map((d) => ({ d, m: Math.hypot(d.position.x - x, d.position.z - z) }))
      .filter((n) => n.m < 30)
      .sort((a, b) => a.m - b.m)
      .slice(0, 6);
    const about = chatters.filter((d) => !d.away).sort((a, b) => (b.heardAt ?? 0) - (a.heardAt ?? 0)).slice(0, 14);
    const key = JSON.stringify([near.map((n) => [n.d.id, Math.round(n.m), doing(n.d, serverNow)]), about.map((d) => [d.id, d.heardAt]), s.town?.project, s.town?.wants, s.town?.hot]);
    if (key === listKey) return;
    listKey = key;
    const row = (d: DudeView, note: string) => {
      const line = document.createElement('button');
      line.className = 'op-row';
      const name = document.createElement('b');
      name.textContent = d.name;
      const what = document.createElement('span');
      what.textContent = note;
      line.append(name, what);
      line.onclick = () => goTo(d);
      return line;
    };
    el('op-near').replaceChildren(...(near.length ? near.map((n) => row(n.d, `${Math.round(n.m)} m · ${doing(n.d, serverNow)}`)) : [Object.assign(document.createElement('em'), { textContent: 'nobody close by' })]));
    el('op-about').replaceChildren(...about.map((d) => row(d, `${d.address ?? ''}${d.coins !== undefined ? ` · §${d.coins}` : ''}`)));
    const lines: string[] = [];
    const p = s.town?.project;
    if (p) lines.push(`Project: ${p.name} · §${p.coins}/${p.coinsNeed} · ${Math.round((p.work / p.workNeed) * 100)}% built`);
    if (s.town?.party) lines.push(s.town.party.title);
    const names = new Map(s.objects.map((o) => [o.id, o]));
    const hot = (s.town?.hot ?? []).map((id) => names.get(id)).filter(Boolean).map((o) => `${o!.blueprint.name} (${o!.createdBy})`);
    if (hot.length) lines.push(`Busy: ${hot.join(', ')}`);
    if (s.town?.wants.length) lines.push(`Town wants: ${s.town.wants.join(', ')}`);
    for (const dist of s.town?.districts ?? []) lines.push(`District: ${dist.name}`);
    el('op-town').replaceChildren(...lines.map((t) => Object.assign(document.createElement('div'), { textContent: t })));
  }

  return {
    frame,
    mayor,
    scene,
    pick(at) {
      if (!building()) return false;
      buildAt = at;
      renderWhere();
      (el('op-build-what') as HTMLInputElement).focus();
      return true;
    },
    spot: () => (building() ? (buildAt ?? { x, z }) : undefined),
    panBy(dx, dz) {
      if (!free) return;
      cx += dx;
      cz += dz;
      clampCam();
    },
    turn: (dt) => (keys.has('q') ? 1 : 0) * dt * 1.6 - (keys.has('e') ? 1 : 0) * dt * 1.6,
    edit: (target, change) => send({ t: 'edit', target, change }),
    remove: (target) => send({ t: 'remove', target }),
    pickPerson(id) {
      if (!choosing) return false;
      setMode('person', id);
      return true;
    },
    focusOn: (id) => setMode('person', id),
    self: () => 'mayor',
    canRework: () => true,
    fireAt: (at) => (arms.armed || ride?.gun ? (fireNow(at), true) : false),
  };
}
