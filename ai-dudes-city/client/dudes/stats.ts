// The stats overlay (`?stats=1`): the numbers the motion budget (board/motion-budget.md) is kept in.
// Frames a second and the page's own work per frame, draw calls and triangles (the shadow pass
// included: three.js clears its count after shadows, so the page clears it itself while this is on),
// people walking in the frame, and the builds on the move, town-wide by kind and in the frame.
// A number over its budget turns into a cream chip.
//
// Off unless asked for: without `?stats=1` there is no panel, no handle and the renderer is left
// alone. The counts are taken twice a second, not every frame; the timings add up every frame.

import * as THREE from 'three';
import type { DudesHandles } from './dudes';
import type { MoverKind, ObjectsHandles } from './objects';

/** The limits from board/motion-budget.md: frame time and draw calls at 40 chatters, what a shot can hold. */
export const STATS_BUDGET = {
  frameMs: 10,
  draws: 1500,
  /** Above about a dozen people walking in a shot it clutters. */
  walkersInFrame: 12,
  /** The hard cap: ≤ 8 moving non-person things in any wide shot. */
  moversInFrame: 8,
  /** Moving at once across the whole town on their own (ridden ones excluded). */
  moving: { drive: 3, fly: 2, roam: 4 } as Record<Exclude<MoverKind, 'ridden'>, number>,
};
/** How often the panel is redrawn and the counts are taken, ms. */
export const STATS_EVERY = 500;
/** Faster than this (m/s, as drawn) is walking; the slowest stroll is 1.3. */
export const WALKING = 0.5;

export interface PersonAt {
  x: number;
  y: number;
  z: number;
  /** Ground speed as drawn, m/s. */
  speed: number;
  /** Inside a build (drawn shrunk away), or aboard one (the build is the mover). */
  hidden?: boolean;
  riding?: boolean;
}
export interface MoverAt {
  x: number;
  y: number;
  z: number;
  kind: MoverKind;
  moving: boolean;
}
export interface Tally {
  /** People on foot and moving, in the frame; and everyone drawn in the frame. */
  walking: number;
  people: number;
  /** Builds on the move town-wide, those in the frame, and town-wide by kind. */
  moving: number;
  moversInFrame: number;
  kinds: Record<MoverKind, number>;
}
export interface StatsSample extends Tally {
  fps: number;
  /** The page's own work per frame (ms): the mean and the worst over the window. CPU time in the page only:
   *  the GPU and the compositor show in fps, not here. */
  ms: number;
  worst: number;
  /** Per frame, averaged over the window. */
  draws: number;
  tris: number;
}

/** Inside the camera's view: projected into clip space and within its box. */
export function framer(camera: THREE.Camera): (x: number, y: number, z: number) => boolean {
  const v = new THREE.Vector3();
  return (x, y, z) => {
    v.set(x, y, z).project(camera);
    return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && Math.abs(v.z) <= 1;
  };
}

/** Who is walking in the frame, and which builds are on the move. */
export function tally(people: Iterable<PersonAt>, movers: Iterable<MoverAt>, inFrame: (x: number, y: number, z: number) => boolean): Tally {
  const t: Tally = { walking: 0, people: 0, moving: 0, moversInFrame: 0, kinds: { drive: 0, fly: 0, roam: 0, ridden: 0 } };
  for (const p of people) {
    if (p.hidden || !inFrame(p.x, p.y + 1, p.z)) continue;
    t.people++;
    if (!p.riding && p.speed > WALKING) t.walking++;
  }
  for (const m of movers) {
    if (!m.moving) continue;
    t.moving++;
    t.kinds[m.kind]++;
    if (inFrame(m.x, m.y + 0.5, m.z)) t.moversInFrame++;
  }
  return t;
}

/** Frames since the last sample: how many, how long the page worked on them, what they drew. */
export class FrameWindow {
  private frames = 0;
  private work = 0;
  private worst = 0;
  private draws = 0;
  private tris = 0;
  private since = NaN;

  add(now: number, workMs: number, draws: number, tris: number): void {
    // The first frame only starts the clock: a window counts the frames that ended inside it.
    if (Number.isNaN(this.since)) return void (this.since = now);
    this.frames++;
    this.work += workMs;
    this.worst = Math.max(this.worst, workMs);
    this.draws += draws;
    this.tris += tris;
  }

  /** Once `every` ms have passed: the window so far, and a fresh one from `now`. */
  take(now: number, every = STATS_EVERY): Omit<StatsSample, keyof Tally> | undefined {
    if (Number.isNaN(this.since) || now - this.since < every || !this.frames) return undefined;
    const n = this.frames;
    const out = { fps: (n * 1000) / (now - this.since), ms: this.work / n, worst: this.worst, draws: this.draws / n, tris: this.tris / n };
    this.frames = this.work = this.worst = this.draws = this.tris = 0;
    this.since = now;
    return out;
  }

  /** Drop the window; the next frame starts the clock again (a hidden tab draws nothing, so its gap is no frame rate). */
  restart(): void {
    this.frames = this.work = this.worst = this.draws = this.tris = 0;
    this.since = NaN;
  }
}

export interface StatsRow {
  label: string;
  value: string;
  note: string;
  over: boolean;
}
const thousands = (n: number) => Math.round(n).toLocaleString('en-GB');
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : thousands(n));

/** The panel's rows: label, the number, a note in small type, and whether the number is over budget. */
export function statsRows(s: StatsSample, budget = STATS_BUDGET): StatsRow[] {
  const kinds = (['drive', 'fly', 'roam'] as const).map((k) => `${k} ${s.kinds[k]}`);
  if (s.kinds.ridden) kinds.push(`ridden ${s.kinds.ridden}`);
  const overKind = (['drive', 'fly', 'roam'] as const).some((k) => s.kinds[k] > budget.moving[k]);
  return [
    { label: 'fps', value: s.fps < 10 ? s.fps.toFixed(1) : String(Math.round(s.fps)), note: `page ${s.ms.toFixed(1)} ms · worst ${Math.round(s.worst)}`, over: s.ms > budget.frameMs },
    { label: 'draws', value: thousands(s.draws), note: `of ${thousands(budget.draws)}`, over: s.draws > budget.draws },
    { label: 'tris', value: short(s.tris), note: '', over: false },
    { label: 'walking', value: String(s.walking), note: `of ${s.people} in frame`, over: s.walking > budget.walkersInFrame },
    { label: 'movers', value: String(s.moving), note: `${s.moversInFrame} in frame`, over: s.moversInFrame > budget.moversInFrame || overKind },
    { label: '', value: '', note: kinds.join(' · '), over: false },
  ];
}

const CSS = `
#fk-stats{position:fixed;left:28px;top:50%;transform:translateY(-50%);z-index:30;pointer-events:none;
  font:800 calc(12px*var(--ui-scale,1))/1.25 Nunito,'Segoe UI',system-ui,sans-serif;font-variant-numeric:tabular-nums;
  color:#FFF6E0;background:#1E1914eb;border:.14em solid #FFF6E0;border-radius:.9em;box-shadow:0 .3em 0 #0006;
  padding:.6em .85em .7em;display:grid;grid-template-columns:auto auto auto;gap:.2em .6em;align-items:baseline}
#fk-stats b{grid-column:1/-1;font-size:.75em;letter-spacing:.16em;color:#8C8577}
#fk-stats span{color:#8C8577;font-size:.8em;letter-spacing:.04em}
#fk-stats strong{text-align:right;font-size:1.15em;padding:0 .3em;border-radius:.5em}
#fk-stats strong.over{background:#FFF6E0;color:#1E1914}
#fk-stats em{font-style:normal;color:#8C8577;font-size:.8em;white-space:nowrap}
body.operator #fk-stats{left:auto;right:16px}`;

export interface StatsHandle {
  /** At the top of a frame, before anything is drawn. */
  begin(): void;
  /** At the end of a frame, after the render and the overlay. */
  end(now: number): void;
  /** The last sample (also on `window.__stats` for smokes and the budget's baseline). */
  read(): StatsSample | undefined;
}

/** The overlay, if the page asked for it (`?stats=1`); otherwise nothing at all. */
export function createStats(
  params: URLSearchParams,
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  dudes: Pick<DudesHandles, 'each'>,
  objects: Pick<ObjectsHandles, 'movers'>,
): StatsHandle | undefined {
  if (params.get('stats') !== '1') return undefined;
  // Counted across the whole frame, the shadow pass too (render() clears the count after shadows).
  renderer.info.autoReset = false;
  const style = document.createElement('style');
  style.textContent = CSS;
  const panel = document.createElement('div');
  panel.id = 'fk-stats';
  panel.setAttribute('aria-hidden', 'true');
  const title = document.createElement('b');
  title.textContent = 'STATS';
  panel.append(title);
  const cells: { label: HTMLElement; value: HTMLElement; note: HTMLElement }[] = [];
  document.head.append(style);
  document.body.append(panel);

  const frames = new FrameWindow();
  // main.ts skips frames while the tab is hidden: start afresh either side, not one slow sample on return.
  document.addEventListener('visibilitychange', () => frames.restart());
  const inFrame = framer(camera);
  let started = 0,
    last: StatsSample | undefined;
  const people: PersonAt[] = [],
    movers: MoverAt[] = [];
  function draw(s: StatsSample) {
    const rows = statsRows(s);
    rows.forEach((r, i) => {
      let c = cells[i];
      if (!c) {
        c = { label: document.createElement('span'), value: document.createElement('strong'), note: document.createElement('em') };
        panel.append(c.label, c.value, c.note);
        cells.push(c);
      }
      if (c.label.textContent !== r.label) c.label.textContent = r.label;
      if (c.value.textContent !== r.value) c.value.textContent = r.value;
      if (c.note.textContent !== r.note) c.note.textContent = r.note;
      if (c.value.classList.contains('over') !== r.over) c.value.classList.toggle('over', r.over);
    });
  }
  const handle: StatsHandle = {
    begin() {
      started = performance.now();
      renderer.info.reset();
    },
    end(now) {
      frames.add(now, performance.now() - started, renderer.info.render.calls, renderer.info.render.triangles);
      const timing = frames.take(now);
      if (!timing) return;
      people.length = movers.length = 0;
      dudes.each((x, z, v, speed) => people.push({ x, y: v.y ?? 0, z, speed, hidden: v.hidden, riding: !!v.riding }));
      objects.movers((x, y, z, kind, moving) => movers.push({ x, y, z, kind, moving }));
      last = { ...timing, ...tally(people, movers, inFrame) };
      draw(last);
    },
    read: () => last,
  };
  (window as unknown as { __stats?: unknown }).__stats = { read: handle.read };
  return handle;
}
