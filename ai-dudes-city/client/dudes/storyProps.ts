// Finders Keepers' pieces standing in the town (Lane D), drawn by the engine with no LLM, the same in
// every age (board/design-system.md §5). So far: round every Folly the server stands up, its cordon,
// tarp, sign, plaque and beam, and the drop on the `unveil` beat (folly.ts, FK-024). Wren's site sign
// joins them here (FK-125). Nothing here draws while Story is OFF: the server sends no Folly then, so
// the layer is empty, no draw calls, and the page is today's.
//
// The Unveiling's Call widens the beam and sets it pulsing: the show's banner while it is up and
// names the Unveiling ("GATHER: THE UNVEILING", bible §6; FK-021 draws it). A Rally's Call is at
// Wren's fire, not here, so it leaves the beam alone. While a scene plays (letterbox up) the pennants
// hang still: the reveal moves only the tarp, the dust and the build (motion-budget.md).
//
// `?demo=folly` draws a fake Folly of its own on STORY_SITES.folly, with no server change, Story on
// or off: its timer climbs (the tarp grows), its Call pulses the beam, its tarp drops every 15 s, and
// the stream camera holds on it (main.ts hook). Sami sees it on 4600 after a client-only rebuild.
import * as THREE from 'three';
import { AGE_IDS, MODERN, clampAge } from '../../src/shared/ages';
import { STORY_SITES } from '../../src/shared/storyMap';
import { FollyLook, tarpBox, type Bounds, type FollyBox } from './folly';
import { partsBounds, type ObjectsHandles } from './objects';
import { buildPrimitiveMesh, newMaterialCache } from './primitives';
import type { DudesScene, Primitive, SafehouseObjectView } from './types';

/** `?demo=folly`: the fake Folly, its timer, its Call and its drop. */
export const follyDemoOn = (search: string): boolean => new URLSearchParams(search).get('demo') === 'folly';

/** The demo's round, in ms from the page opening: the timer climbs from 15% to full in 8 s, the Call from 6 s, the drop at 10 s (its confetti down by 15 s), again every 15 s. */
export const DEMO = { ms: 15_000, from: 15, climbMs: 8_000, callAt: 6_000, dropAt: 10_000, half: 12 } as const;
/** Where the demo's round is `t` ms in. */
export function demoFolly(t: number): { pct: number; wrapped: boolean; call: boolean } {
  const c = ((t % DEMO.ms) + DEMO.ms) % DEMO.ms;
  return { pct: DEMO.from + (100 - DEMO.from) * Math.min(1, c / DEMO.climbMs), wrapped: c < DEMO.dropAt, call: c >= DEMO.callAt && c < DEMO.dropAt };
}

/** The demo's Folly, revealed at each drop: a big hut with a tiny door, the band's hearth stones for a doormat and a gold knob on top (bible §3, Stone). */
export const DEMO_HUT: Primitive[] = [
  { shape: 'cylinder', position: [0, 0.2, 0], size: [13.2, 0.4, 12.4], rotation: [0, 0, 0], color: '#8B6A45' },
  { shape: 'cylinder', position: [0, 1.7, 0], size: [10.6, 2.6, 9.8], rotation: [0, 0, 0], color: '#D2BD93' },
  { shape: 'cone', position: [0, 4.6, 0], size: [12.8, 3.2, 12], rotation: [0, 0, 0], color: '#9A6B3C' },
  { shape: 'cone', position: [0, 6.3, 0], size: [3.6, 1.4, 3.4], rotation: [0, 0, 0], color: '#7A5230' },
  { shape: 'box', position: [0.35, 7.2, 0], size: [0.16, 1.3, 0.16], rotation: [0, 0, -0.35], color: '#5B3D26' },
  { shape: 'box', position: [-0.35, 7.2, 0], size: [0.16, 1.3, 0.16], rotation: [0, 0, 0.35], color: '#5B3D26' },
  { shape: 'sphere', position: [0, 7.75, 0], size: [0.5, 0.5, 0.5], rotation: [0, 0, 0], color: '#FFC633' },
  { shape: 'box', position: [0, 1.15, 4.92], size: [1.1, 1.5, 0.3], rotation: [0, 0, 0], color: '#7A5230' },
  { shape: 'box', position: [0, 0.95, 5.05], size: [0.62, 1.05, 0.2], rotation: [0, 0, 0], color: '#2B2018' },
  { shape: 'sphere', position: [-0.9, 0.42, 5.9], size: [0.8, 0.3, 0.6], rotation: [0, 0, 0], color: '#9A958A' },
  { shape: 'sphere', position: [0.85, 0.42, 6], size: [0.7, 0.3, 0.6], rotation: [0, 0, 0], color: '#8C877C' },
];

export interface StoryPropsHandles {
  root: THREE.Group;
  /** A snapshot has been applied: the Follies standing (under wraps or not), the Folly's timer, a Call, a scene. */
  sync(scene: DudesScene): void;
  /** Per frame: `now` page ms, `serverNow` the drawn server time. */
  update(now: number, serverNow: number, reduced: boolean): void;
  /** `?demo=folly`: where the stream camera holds (the fake Folly, framed); otherwise undefined. */
  readonly demoShot: { centre: THREE.Vector3; half: number } | undefined;
  /** The Folly looks on the page, by build id (`demo` for the demo's), for tests and smokes. */
  looks(): Map<string, FollyLook>;
  dispose(): void;
}

/** A Folly's tarp box before its parts have landed: from its footprint, as tall as the Folly's box allows for its width. */
const roughBounds = (o: SafehouseObjectView): Bounds => {
  const w = (o.footprint?.width ?? 14) / 2,
    d = (o.footprint?.depth ?? 14) / 2;
  return { minX: -w, maxX: w, minY: 0, maxY: Math.min(11, Math.max(4, w)), minZ: -d, maxZ: d };
};

/**
 * The layer. `objects` tells it the box each Folly's parts fill (so the tarp fits it); `search` is the
 * page's query (`?demo=folly`); `clock` is page time, as the frame's `now`.
 */
export function createStoryProps(parent: THREE.Object3D, objects: Pick<ObjectsHandles, 'boundsOf'>, search = '', clock: () => number = () => performance.now()): StoryPropsHandles {
  const root = new THREE.Group();
  root.name = 'story-props';
  parent.add(root);
  const plot = STORY_SITES.folly.size;
  const looks = new Map<string, FollyLook>();
  /** The Follies whose tarp was sized from their footprint: asked again each frame until their parts land. */
  const rough = new Map<string, SafehouseObjectView>();
  let age = MODERN;
  let callUntil: number | undefined;
  let still = false;
  let pct: number | undefined;

  const demo = follyDemoOn(search);
  let demoLook: FollyLook | undefined;
  let demoBox: FollyBox | undefined;
  let demoFrom: number | undefined;
  const at = STORY_SITES.folly.at;
  if (demo) {
    const build = new THREE.Group();
    const cache = newMaterialCache();
    for (const p of DEMO_HUT) build.add(buildPrimitiveMesh(p, cache));
    demoLook = new FollyLook(root, at, plot, build);
    demoBox = tarpBox(partsBounds(DEMO_HUT), plot);
    looks.set('demo', demoLook);
    // For smokes and the verify shots: where the demo's round is, and what the drop is showing.
    if (typeof window !== 'undefined')
      (window as unknown as { __follyDemo?: () => unknown }).__follyDemo = () =>
        demoFrom === undefined ? undefined : { t: Math.round(clock() - demoFrom), ...demoFolly(clock() - demoFrom), dropping: demoLook!.dropping, dust: demoLook!.dust.visible, confetti: demoLook!.confetti.visible };
  }

  function place(o: SafehouseObjectView, look: FollyLook, now: number): void {
    const bounds = objects.boundsOf(o.id);
    if (bounds) rough.delete(o.id);
    else rough.set(o.id, o);
    // The timer is this age's Folly's; an earlier age's Folly stands unveiled.
    const current = o.folly === AGE_IDS[clampAge(age)];
    look.set({ box: tarpBox(bounds ?? roughBounds(o), plot), pct: current ? (pct ?? 100) : 100, wrapped: !!o.silhouette, age }, now);
  }

  function sync(scene: DudesScene): void {
    const town = scene.town;
    age = town?.sandbox ? MODERN : (town?.age ?? MODERN);
    const banner = town?.show?.banner;
    callUntil = banner && /unveil/i.test(banner.title) ? banner.until : undefined;
    still = !!town?.scene;
    pct = town?.folly?.pct;
    // The demo has the Folly's spot to itself: the server's Follies (if Story is on) are left to it.
    if (demo) return;
    const now = clock();
    const seen = new Set<string>();
    for (const o of scene.objects) {
      if (!o.folly) continue;
      seen.add(o.id);
      let look = looks.get(o.id);
      if (!look) looks.set(o.id, (look = new FollyLook(root, o.position, plot)));
      place(o, look, now);
    }
    for (const [id, look] of looks)
      if (!seen.has(id)) {
        look.dispose();
        looks.delete(id);
        rough.delete(id);
      }
  }

  function update(now: number, serverNow: number, reduced: boolean): void {
    for (const [id, o] of rough) if (objects.boundsOf(id)) place(o, looks.get(id)!, now);
    const call = callUntil !== undefined && serverNow < callUntil;
    for (const [id, look] of looks) if (id !== 'demo') look.update(now, call, still, reduced);
    if (demoLook) {
      demoFrom ??= now;
      const d = demoFolly(now - demoFrom);
      demoLook.set({ box: demoBox!, pct: d.pct, wrapped: d.wrapped, age }, now);
      demoLook.update(now, d.call, false, reduced);
    }
  }

  const demoShot = demo ? { centre: new THREE.Vector3(at.x, 2.5, at.z + 1.5), half: DEMO.half } : undefined;

  function dispose(): void {
    for (const look of looks.values()) look.dispose();
    looks.clear();
    rough.clear();
    root.removeFromParent();
  }

  return { root, sync, update, demoShot, looks: () => looks, dispose };
}
