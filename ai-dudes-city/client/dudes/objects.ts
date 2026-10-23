// Renders the server-authoritative `scene.safehouse.objects` (committed
// creations) plus the in-flight `current.preview` (the job actively being
// designed/walked/built). Reconciliation is keyed by object `id` + bumped
// on `revision` so an edit rebuilds only the one object that changed; every
// other committed mesh group is left untouched frame to frame. The ghost
// preview for an in-progress build is a separate, disposable group so the
// previous committed object (if this is an edit) stays visible until the
// edit is actually committed.
//
// Snapshots carry no geometry (see SafehouseObjectView): the parts for each
// id+revision are fetched once, in one batch per snapshot, and cached for the
// life of the page. A group exists from the first snapshot and fills in when
// its parts arrive, so the reconciliation above never waits on the network.
//
// Ages (src/shared/ages.ts): a build designed in one age and shown in another is drawn with its
// colours swapped into the town's age (`restyleColour`), deterministically, until a proper restyle of
// it exists. A new age refills every group from the cached parts; nothing is fetched again.

import * as THREE from 'three';
import { buildPrimitiveMesh, disposeObject3D, newMaterialCache } from './primitives';
import { MODERN, NO_AGE, restyleColour } from '../../src/shared/ages';
import { Track } from './motion';
import {
  partsKey,
  type PartAnimation,
  type Primitive,
  type SafehouseObject,
  type SafehouseObjectView,
} from './types';

interface Entry {
  revision: number;
  group: THREE.Group;
  filled: boolean;
  shade: number; // 0.45 rubble … 1 pristine: applied when the parts land, then per snapshot
  destroyed: boolean;
  /** A living build: how it carries itself. Where it is comes from its track (motion.ts), per frame. */
  creature?: { behaviour: string; destroyed: boolean; flying: boolean; perched: boolean };
  /** Part motion as data (PartAnimation), applied every frame to the filled group's children. */
  animations?: PartAnimation[];
  /** On a run under a viewer (`!drive`): drawn from its track like a creature, snapped back to its true spot when it stops. */
  driven?: boolean;
  /** Drawn here rather than from its track: what the operator's Mayor is riding, on the operator page. */
  local?: { x: number; z: number; facing: number; y: number; moving?: boolean };
  /** The age it was designed in, and the age its colours were last drawn for. */
  origin: number;
  drawnFor: number;
  key: string;
  /** Damage (the server's damage.ts): what is left (0..1), when it was last hit and came down (server time). */
  hp: number;
  hitAt?: number;
  fellAt?: number;
  /** How tall it stands (metres), measured when its parts land: where the smoke comes from and the bar sits. */
  top?: number;
  /** The health bar over it, made the first time it is hit; and when it last puffed smoke. */
  bar?: { sprite: THREE.Sprite; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; drawn: number };
  smokeAt?: number;
}
/** Where a part sits when nothing moves it; recorded once the geometry lands. */
interface BaseTransform {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
}
const TAU = Math.PI * 2;
/** Outer walls for model- or hand-written motion; the server clamps too, this is belt and braces. */
const MAX_SPEED = 3,
  MAX_SWAY = 0.6,
  MAX_SHIFT = 0.5,
  DEFAULT_SPEED = 0.3,
  DEFAULT_AMPLITUDE = 0.08;

function recordBases(group: THREE.Group): void {
  for (const child of group.children) {
    const base: BaseTransform = {
      px: child.position.x,
      py: child.position.y,
      pz: child.position.z,
      rx: child.rotation.x,
      ry: child.rotation.y,
      rz: child.rotation.z,
    };
    child.userData.base = base;
  }
}

/** Put every animated part back where it was authored (reduced motion, or a piece that just fell). */
function restBases(group: THREE.Group, animations: PartAnimation[]): void {
  for (const a of animations) {
    const child = group.children[a.part];
    const base = child?.userData.base as BaseTransform | undefined;
    if (!base) continue;
    child.position.set(base.px, base.py, base.pz);
    child.rotation.set(base.rx, base.ry, base.rz);
  }
}

/** One frame of part motion. `t` is seconds. Allocation-free: only scalars change. */
function animateParts(group: THREE.Group, animations: PartAnimation[], t: number): void {
  for (const a of animations) {
    const child = group.children[a.part];
    const base = child?.userData.base as BaseTransform | undefined;
    if (!base) continue;
    const speed = Math.min(MAX_SPEED, Math.max(0, a.speed ?? DEFAULT_SPEED));
    const phase = a.phase ?? 0;
    switch (a.kind) {
      case 'sway': {
        const amp = Math.min(MAX_SWAY, Math.max(0, a.amplitude ?? DEFAULT_AMPLITUDE));
        const v = amp * Math.sin(TAU * speed * t + phase);
        const axis = a.axis ?? 'z';
        child.rotation.set(
          base.rx + (axis === 'x' ? v : 0),
          base.ry + (axis === 'y' ? v : 0),
          base.rz + (axis === 'z' ? v : 0),
        );
        break;
      }
      case 'drift': {
        const amp = Math.min(MAX_SHIFT, Math.max(0, a.amplitude ?? DEFAULT_AMPLITUDE));
        const v = amp * Math.sin(TAU * speed * t + phase);
        const axis = a.axis ?? 'x';
        child.position.set(
          base.px + (axis === 'x' ? v : 0),
          base.py + (axis === 'y' ? v : 0),
          base.pz + (axis === 'z' ? v : 0),
        );
        break;
      }
      case 'bob': {
        const amp = Math.min(MAX_SHIFT, Math.max(0, a.amplitude ?? DEFAULT_AMPLITUDE));
        child.position.y = base.py + amp * Math.sin(TAU * speed * t + phase);
        break;
      }
      case 'spin': {
        const v = TAU * speed * t + phase;
        const axis = a.axis ?? 'y';
        child.rotation.set(
          base.rx + (axis === 'x' ? v : 0),
          base.ry + (axis === 'y' ? v : 0),
          base.rz + (axis === 'z' ? v : 0),
        );
        break;
      }
    }
  }
}

/** A build in flight: Rook's current job, or a neighbour's. Keyed by whose it is. */
export interface PreviewSpec {
  key: string;
  preview: SafehouseObject;
  status: 'walking' | 'building' | 'other';
  progress: number;
}
export interface ObjectsHandles {
  root: THREE.Group;
  /** A snapshot just landed: note where every living build is at that server time. */
  sample(objects: SafehouseObjectView[], serverTime: number, skip?: Set<string>): void;
  /** One build's position between snapshots (what the Mayor is riding, many times a second). */
  sampleOne(id: string, s: { t: number; x: number; y: number; z: number; facing: number }): void;
  /** Draw this build where the page says, now (the operator's own ride), or back to its track. */
  setLocal(id: string, at: { x: number; z: number; facing: number; y: number; moving?: boolean } | undefined): void;
  /** Reconcile committed objects against the scene snapshot the drawn world has reached. */
  syncCommitted(objects: SafehouseObjectView[]): void;
  /** Reconcile the ghost previews for every job in flight (Rook's and the neighbours'). */
  syncPreviews(list: PreviewSpec[]): void;
  /** The town's age: builds from other ages are redrawn with its colours. Call before syncCommitted. */
  setAge(age: number): void;
  /** Per frame: place living builds where they are at `renderTime` (server time) and give them a gait. */
  update(now: number, reducedMotion: boolean, renderTime: number): void;
  /** A horn (`!honk`): rattle the piece for most of a second. */
  shake(objectId: string, now: number): void;
  /** Where a committed piece is drawn right now, for an overlay pop; undefined when it is not on the page. */
  positionOf(objectId: string): { x: number; y: number; z: number } | undefined;
  /** The server restarted (a new epoch): ids and revisions may name different builds now, so every build's parts are fetched again and redrawn where they changed. */
  resetGeometry(): void;
  dispose(): void;
}
const SHAKE_MS = 800;
/** What is left of a build, 0..1 (whole when the server says nothing). */
const hpOf = (o: SafehouseObjectView): number => (o.health === undefined ? 1 : Math.max(0, Math.min(1, o.health / (o.maxHealth ?? o.health ?? 1))));
/** How flat a heap of rubble is drawn: a crumbled build's pieces already lie about, so only a little. */
const rubble = (o: SafehouseObjectView): number => (o.damageRevision !== undefined ? 0.55 : 0.12);
const jitter = new Map<string, number>(); // this frame's shake offset for pieces drawn from a track

const GHOST_OPACITY = 0.38;
const MAX_CACHED_GEOMETRY = 600;

/** A build's parts as the town's age draws them: unchanged in the age it was designed in, colour-swapped in any other. */
function partsFor(parts: Primitive[], origin: number, age: number): { parts: Primitive[]; glow: Set<number> } {
  const glow = new Set<number>();
  if (origin === age || age === NO_AGE) return { parts, glow };
  return {
    parts: parts.map((p, i) => {
      const r = restyleColour(p.color, age);
      if (r.glow) glow.add(i);
      return { ...p, color: r.color };
    }),
    glow,
  };
}

function fillGroup(group: THREE.Group, raw: Primitive[], objectId: string | undefined, ghost: boolean, origin = MODERN, age = origin): void {
  const cache = newMaterialCache();
  const { parts, glow } = partsFor(raw, origin, age);
  for (const [i, part] of parts.entries()) {
    const m = buildPrimitiveMesh(part, cache);
    // An age with light strips (palette.glow): a strong bright colour glows (materials are per colour, so this is per colour too).
    if (glow.has(i)) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissive.set(part.color);
      mat.emissiveIntensity = 0.55;
    }
    if (!ghost && objectId) m.userData.objectId = objectId;
    if (ghost) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        (mat as THREE.MeshStandardMaterial).transparent = true;
        (mat as THREE.MeshStandardMaterial).opacity = GHOST_OPACITY;
      }
      m.castShadow = false;
    }
    group.add(m);
  }
}

function shadeGroup(group: THREE.Group, shade: number): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const m = child.material as THREE.MeshStandardMaterial;
      const base = child.userData.baseColor ?? (child.userData.baseColor = m.color.clone());
      m.color.copy(base).multiplyScalar(shade);
    }
  });
}

/**
 * Reveals blueprint parts in their authored order as `progress` (0..1)
 * advances, so a build reads as being assembled piece by piece rather than
 * popping in whole. Deterministic given `progress` and the part count.
 */
function applyProgress(group: THREE.Group, progress: number): void {
  const total = group.children.length;
  if (total === 0) return;
  const revealed = Math.max(1, Math.ceil(progress * total));
  group.children.forEach((child, i) => {
    child.visible = i < revealed;
  });
}

/** Geometry by id:revision, fetched in batches and kept for the page's life (bounded). */
function createGeometryStore(onArrival: (key: string, parts: Primitive[]) => void) {
  const cache = new Map<string, Primitive[]>();
  const inflight = new Set<string>();
  let wanted = new Set<string>();
  let scheduled = false;
  async function flush() {
    scheduled = false;
    const keys = [...wanted].filter((k) => !cache.has(k) && !inflight.has(k));
    wanted = new Set();
    if (!keys.length) return;
    for (const k of keys) inflight.add(k);
    try {
      const r = await fetch('/api/objects/parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      });
      if (!r.ok) throw new Error(`parts ${r.status}`);
      const body = (await r.json()) as { parts?: Record<string, Primitive[]> };
      for (const [key, parts] of Object.entries(body.parts ?? {})) {
        if (!Array.isArray(parts)) continue;
        if (cache.size >= MAX_CACHED_GEOMETRY) cache.delete(cache.keys().next().value!);
        cache.set(key, parts);
        onArrival(key, parts);
      }
      // A key the server no longer knows (a revision superseded mid-flight) simply waits for the
      // next snapshot to name the current one.
    } catch (error) {
      console.warn('object geometry fetch failed; will retry on the next snapshot', error);
    } finally {
      for (const k of keys) inflight.delete(k);
    }
  }
  return {
    get: (key: string) => cache.get(key),
    /** Forget every kept part list (handing the old ones back), so the next `want` asks the server again. */
    reset(): Map<string, Primitive[]> {
      const old = new Map(cache);
      cache.clear();
      return old;
    },
    want(key: string) {
      if (cache.has(key) || inflight.has(key)) return;
      wanted.add(key);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => void flush());
      }
    },
  };
}

export function createObjectsLayer(parent: THREE.Object3D): ObjectsHandles {
  const root = new THREE.Group();
  parent.add(root);
  const committed = new Map<string, Entry>();
  const tracks = new Map<string, Track>();
  let latestIds = new Set<string>(); // living builds in the newest snapshot, applied or not
  // Pieces being rattled by a horn: when the shake started, and the x they stood at.
  const shakes = new Map<string, { since: number; baseX: number }>();
  const previews = new Map<string, { id: string; group: THREE.Group }>();
  let townAge = MODERN;
  /** Fill (or refill, in a new age) a committed build's group from its parts. */
  function fill(entry: Entry, id: string, parts: Primitive[]): void {
    for (const child of [...entry.group.children]) disposeObject3D(child);
    fillGroup(entry.group, parts, id, false, entry.origin, townAge);
    shadeGroup(entry.group, entry.shade);
    recordBases(entry.group);
    entry.top = parts.reduce((m, p) => Math.max(m, p.position[1] + p.size[1] / 2), 0.5) * (entry.destroyed ? 0.5 : 1);
    entry.filled = true;
    entry.drawnFor = townAge;
  }
  /** After a server restart: what each drawn build was made of, until its parts come back to compare. */
  let stale: Map<string, Primitive[]> | undefined;
  const geometry = createGeometryStore((key, parts) => {
    const at = key.lastIndexOf(':');
    const entry = committed.get(key.slice(0, at));
    if (!entry || entry.revision !== Number(key.slice(at + 1))) return;
    const was = stale?.get(key);
    if (was) {
      stale!.delete(key);
      // Drawn already and nothing changed: left alone, so a restart doesn't flicker the town.
      if (entry.filled && JSON.stringify(was) === JSON.stringify(parts)) return;
    } else if (entry.filled) return;
    fill(entry, key.slice(0, at), parts);
  });
  function resetGeometry(): void {
    stale = geometry.reset();
    for (const entry of committed.values()) geometry.want(entry.key);
  }
  function setAge(age: number): void {
    if (age === townAge) return;
    townAge = age;
    for (const [id, entry] of committed) {
      const parts = entry.filled ? geometry.get(entry.key) : undefined;
      // Rebuilt in place: the group keeps its position, scale (rubble) and turn (a mover).
      if (parts && entry.drawnFor !== age) fill(entry, id, parts);
    }
  }
  const creatureOf = (obj: SafehouseObjectView, destroyed: boolean) =>
    obj.creature
      ? {
          behaviour: obj.creature.behaviour,
          destroyed,
          flying: !!obj.creature.flying,
          perched: !!obj.creature.goal?.perched,
        }
      : undefined;

  function sample(objects: SafehouseObjectView[], serverTime: number, skip?: Set<string>): void {
    latestIds = new Set();
    for (const obj of objects) {
      // A living build follows its creature; a piece on a run (`!drive`) follows `driven`. Nothing else moves.
      if (!obj.creature && !obj.driven) continue;
      latestIds.add(obj.id);
      if (skip?.has(obj.id)) continue; // its own stream carries it (the Mayor's or a player's ride, sampleOne)
      let track = tracks.get(obj.id);
      if (!track) tracks.set(obj.id, (track = new Track()));
      track.sample(
        obj.driven
          ? { t: serverTime, x: obj.driven.at.x, y: obj.creature?.altitude ?? obj.altitude ?? 0, z: obj.driven.at.z, facing: obj.driven.turn }
          : {
              t: serverTime,
              x: obj.position.x,
              y: obj.creature!.altitude ?? 0,
              z: obj.position.z,
              facing: obj.creature!.facing,
            },
      );
    }
    // A build that is gone keeps its track until its group goes too, so it stays put until then.
    for (const id of tracks.keys()) if (!latestIds.has(id) && !committed.has(id)) tracks.delete(id);
  }

  function syncCommitted(objects: SafehouseObjectView[]): void {
    const seen = new Set<string>();
    for (const obj of objects) {
      seen.add(obj.id);
      const destroyed = obj.destroyedAt !== undefined;
      // The landmark before it is reached is a dark shape in the mist.
      const shade = obj.silhouette ? 0.1 : destroyed ? 0.7 : 0.75 + 0.25 * hpOf(obj);
      const existing = committed.get(obj.id);
      if (existing && existing.revision === obj.revision) {
        // Restyled since (a new age stamped on it), or not drawn for this age yet: refill from the cached parts.
        const origin = obj.free ? NO_AGE : (obj.age ?? MODERN);
        if (existing.origin !== origin) {
          existing.origin = origin;
          const parts = existing.filled ? geometry.get(existing.key) : undefined;
          if (parts) fill(existing, obj.id, parts);
        }
        if (obj.creature) {
          existing.creature = creatureOf(obj, destroyed);
        } else if (obj.driven) {
          // On a run: drawn from its track (update()), not snapped to its parked spot.
          existing.creature = undefined;
        } else {
          existing.creature = undefined;
          // Just parked: back to its true spot, un-turned, and forget the run's track.
          if (existing.driven) {
            existing.group.rotation.y = 0;
            tracks.delete(obj.id);
          }
          existing.group.position.set(obj.position.x, 0, obj.position.z);
        }
        existing.driven = !!obj.driven;
        existing.group.scale.y = destroyed ? rubble(obj) : 1;
        existing.hp = hpOf(obj);
        existing.hitAt = obj.hitAt;
        existing.fellAt = obj.destroyedAt;
        // A piece that has just fallen stops moving; its parts go back to rest before the flatten.
        if (destroyed && !existing.destroyed && existing.animations && existing.filled)
          restBases(existing.group, existing.animations);
        existing.destroyed = destroyed;
        existing.animations = obj.blueprint.animations?.length ? obj.blueprint.animations : undefined;
        if (existing.shade !== shade) {
          existing.shade = shade;
          if (existing.filled) shadeGroup(existing.group, shade);
        }
        continue;
      }
      const group = new THREE.Group();
      group.position.set(obj.position.x, obj.creature?.altitude ?? 0, obj.position.z);
      group.scale.y = destroyed ? rubble(obj) : 1;
      if (obj.creature) group.rotation.y = obj.creature.facing;
      root.add(group);
      if (existing) {
        disposeObject3D(existing.group);
        if (existing.bar) root.add(existing.bar.sprite); // the bar carries over to the redrawn build
      }
      const entry: Entry = {
        revision: obj.revision,
        group,
        filled: false,
        shade,
        destroyed,
        creature: creatureOf(obj, destroyed),
        driven: !!obj.driven,
        animations: obj.blueprint.animations?.length ? obj.blueprint.animations : undefined,
        origin: obj.free ? NO_AGE : (obj.age ?? MODERN),
        drawnFor: townAge,
        key: partsKey(obj.id, obj.revision),
        hp: hpOf(obj),
        hitAt: obj.hitAt,
        fellAt: obj.destroyedAt,
        bar: existing?.bar,
      };
      committed.set(obj.id, entry);
      const known = geometry.get(entry.key);
      if (known) fill(entry, obj.id, known);
      else geometry.want(entry.key);
    }
    for (const [id, entry] of committed) {
      if (!seen.has(id)) {
        disposeObject3D(entry.group);
        if (entry.bar) dropBar(entry);
        committed.delete(id);
        if (!latestIds.has(id)) tracks.delete(id);
      }
    }
  }

  function syncPreviews(list: PreviewSpec[]): void {
    const seen = new Set<string>();
    for (const spec of list) {
      seen.add(spec.key);
      const { preview } = spec;
      const id = preview.id + ':' + preview.revision;
      let entry = previews.get(spec.key);
      if (!entry || entry.id !== id) {
        if (entry) disposeObject3D(entry.group);
        const group = new THREE.Group();
        group.position.set(preview.position.x, 0, preview.position.z);
        fillGroup(group, preview.blueprint.parts, undefined, true, preview.free ? NO_AGE : (preview.age ?? MODERN), townAge);
        root.add(group);
        entry = { id, group };
        previews.set(spec.key, entry);
      }
      const { group } = entry;
      if (spec.status === 'walking')
        group.children.forEach((child) => {
          child.visible = true;
        });
      else applyProgress(group, spec.progress);
      const building = spec.status === 'building';
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        (child.material as THREE.MeshStandardMaterial).opacity = building ? 0.9 : GHOST_OPACITY;
        child.castShadow = building;
      });
    }
    for (const [key, entry] of previews)
      if (!seen.has(key)) {
        disposeObject3D(entry.group);
        previews.delete(key);
      }
  }

  function update(now: number, reducedMotion: boolean, renderTime: number): void {
    const t = now / 1000;
    // A kicked or punched piece rattles side to side, the jitter dying out over most of a second.
    // A piece drawn from its track (driven, or parked after a run) takes the jitter on top of the
    // track's spot below; a still one is jittered about where it stood.
    jitter.clear();
    for (const [id, s] of shakes) {
      const entry = committed.get(id);
      const age = now - s.since;
      const moving = !!entry && (!!entry.creature || !!entry.driven);
      if (!entry || age > SHAKE_MS || reducedMotion) {
        if (entry && !moving) entry.group.position.x = s.baseX;
        shakes.delete(id);
        continue;
      }
      const dx = Math.sin(now * 0.06) * 0.05 * (1 - age / SHAKE_MS);
      if (moving) jitter.set(id, dx);
      else entry.group.position.x = s.baseX + dx;
    }
    damage(now, renderTime, reducedMotion);
    for (const [id, entry] of committed) {
      // Part motion as data: a canopy drifting, a chain swaying, a wheel turning. Rubble lies still.
      if (entry.animations && entry.filled && !entry.destroyed) {
        if (reducedMotion) restBases(entry.group, entry.animations);
        else animateParts(entry.group, entry.animations, t);
      }
      const c = entry.creature;
      // A living build follows its creature; a piece on a run (`!drive`) follows `driven`; the
      // operator's own ride follows the Mayor. Nothing else moves.
      if (!c && !entry.driven && !entry.local) continue;
      // Between the two snapshots either side of the drawn moment, facing the way it is going; a
      // flyer's height (the climb after the build, the fall when downed) rides the same slide.
      const pose = entry.local ? { ...entry.local, moving: !!entry.local.moving } : tracks.get(id)?.at(renderTime);
      if (!pose) continue;
      const g = entry.group;
      g.position.x = pose.x + (jitter.get(id) ?? 0);
      g.position.z = pose.z;
      g.rotation.y = pose.facing;
      // A gait: animals bounce a little on the move, a car (driven or a `zoom` build) just hums
      // along, a flyer rides a slow swell. A bird sitting on a perch just sits: no swell, no bounce.
      const flying = !!c?.flying || pose.y > 0.3; // anything up in the air sways a little
      const still = reducedMotion || !!c?.destroyed || !!c?.perched;
      const hums = entry.driven || c?.behaviour === 'zoom';
      const bob = still
        ? 0
        : flying
          ? Math.sin(now * 0.0035) * 0.18
          : pose.moving
            ? hums
              ? Math.abs(Math.sin(now * 0.03)) * 0.02
              : Math.abs(Math.sin(now * (c?.behaviour === 'fight' ? 0.016 : 0.011))) * 0.08
            : 0;
      g.position.y = pose.y + bob;
      g.rotation.z = flying && !still ? Math.sin(now * 0.0025) * 0.08 : 0;
    }
  }

  // ---- damage: smoke from a battered build, flames on one nearly down, dust over rubble, the bar ----
  const puffs: { m: THREE.Mesh; born: number; life: number; x: number; y: number; z: number; size: number; drift: number }[] = [];
  const puffGeometry = new THREE.SphereGeometry(0.5, 8, 6);
  const SMOKE_DARK = 0x4a4642,
    SMOKE_LIGHT = 0xb9b2a6,
    FLAME = 0xff9a2e,
    FLAME_CORE = 0xffe066;
  function emit(x: number, y: number, z: number, colour: number, size: number, life: number, now: number, glow = false): void {
    if (puffs.length > 220) return;
    const m = new THREE.Mesh(puffGeometry, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: glow ? 0.9 : 0.55, depthWrite: false }));
    m.position.set(x, y, z);
    root.add(m);
    puffs.push({ m, born: now, life, x, y, z, size, drift: (Math.random() - 0.5) * 0.6 });
  }
  function damage(now: number, serverNow: number, reduced: boolean): void {
    for (const [, entry] of committed) {
      const g = entry.group;
      // The bar: up for a few seconds after each hit, over the top of it.
      const showBar = entry.hitAt !== undefined && serverNow - entry.hitAt < 6000 && serverNow >= entry.hitAt - 500 && entry.fellAt === undefined && entry.hp < 1;
      if (showBar) {
        const bar = entry.bar ?? makeBar(entry);
        const v = Math.round(entry.hp * 50);
        if (bar.drawn !== v) drawBar(bar, entry.hp);
        bar.sprite.visible = true;
        bar.sprite.position.set(g.position.x, g.position.y + (entry.top ?? 3) + 1.1, g.position.z);
      } else if (entry.bar) entry.bar.sprite.visible = false;
      if (reduced || !entry.filled) continue;
      const top = entry.top ?? 3;
      const fresh = entry.fellAt !== undefined && serverNow - entry.fellAt < 25_000;
      // Smoke: a wisp from a battered build, a column from one nearly down, dust and smoulder over a heap.
      const every = entry.fellAt !== undefined ? (fresh ? 160 : 1400) : entry.hp < 0.3 ? 220 : entry.hp < 0.65 ? 700 : 0;
      if (!every || now - (entry.smokeAt ?? 0) < every) continue;
      entry.smokeAt = now;
      const spread = Math.max(0.6, Math.min(4, top * 0.3));
      const x = g.position.x + (Math.random() - 0.5) * spread,
        z = g.position.z + (Math.random() - 0.5) * spread;
      if (entry.fellAt !== undefined) emit(x, 0.5, z, fresh ? SMOKE_LIGHT : SMOKE_DARK, fresh ? 2.2 : 1.1, fresh ? 2600 : 3200, now);
      else {
        emit(x, g.position.y + top * 0.85, z, SMOKE_DARK, 0.9 + (1 - entry.hp) * 1.4, 2800, now);
        if (entry.hp < 0.3) emit(x, g.position.y + top * (0.4 + Math.random() * 0.5), z, Math.random() < 0.5 ? FLAME : FLAME_CORE, 0.7, 500, now, true);
      }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      const k = (now - p.born) / p.life;
      if (k >= 1) {
        root.remove(p.m);
        (p.m.material as THREE.Material).dispose();
        puffs.splice(i, 1);
        continue;
      }
      p.m.position.set(p.x + p.drift * k * 3, p.y + k * (p.life > 1000 ? 4 : 1.2), p.z + p.drift * k * 1.5);
      p.m.scale.setScalar(p.size * (0.5 + k));
      (p.m.material as THREE.MeshBasicMaterial).opacity = (p.life > 1000 ? 0.55 : 0.9) * (1 - k);
    }
  }
  function makeBar(entry: Entry): NonNullable<Entry['bar']> {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 14;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sprite.scale.set(2.6, 0.38, 1);
    sprite.renderOrder = 5;
    root.add(sprite);
    return (entry.bar = { sprite, canvas, tex, drawn: -1 });
  }
  function drawBar(bar: NonNullable<Entry['bar']>, hp: number): void {
    const g = bar.canvas.getContext('2d')!;
    g.clearRect(0, 0, 96, 14);
    g.fillStyle = 'rgba(20,24,22,0.85)';
    g.fillRect(0, 0, 96, 14);
    g.fillStyle = hp > 0.6 ? '#7fd36a' : hp > 0.3 ? '#f2c14e' : '#f07a3a';
    g.fillRect(2, 2, Math.max(0, Math.round(92 * hp)), 10);
    bar.tex.needsUpdate = true;
    bar.drawn = Math.round(hp * 50);
  }
  function dropBar(entry: Entry): void {
    if (!entry.bar) return;
    root.remove(entry.bar.sprite);
    entry.bar.sprite.material.dispose();
    entry.bar.tex.dispose();
    entry.bar = undefined;
  }

  function shake(objectId: string, now: number): void {
    const entry = committed.get(objectId);
    if (!entry) return;
    const current = shakes.get(objectId);
    shakes.set(objectId, { since: now, baseX: current?.baseX ?? entry.group.position.x });
  }
  function positionOf(objectId: string): { x: number; y: number; z: number } | undefined {
    const entry = committed.get(objectId);
    if (!entry) return undefined;
    const p = entry.group.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  function dispose(): void {
    for (const entry of committed.values()) {
      disposeObject3D(entry.group);
      dropBar(entry);
    }
    for (const p of puffs) root.remove(p.m);
    puffs.length = 0;
    puffGeometry.dispose();
    committed.clear();
    for (const entry of previews.values()) disposeObject3D(entry.group);
    previews.clear();
    parent.remove(root);
  }

  function sampleOne(id: string, s: { t: number; x: number; y: number; z: number; facing: number }): void {
    let track = tracks.get(id);
    if (!track) tracks.set(id, (track = new Track(30)));
    track.sample(s);
  }
  function setLocal(id: string, at: { x: number; z: number; facing: number; y: number; moving?: boolean } | undefined): void {
    const entry = committed.get(id);
    if (entry) entry.local = at;
  }

  return { root, sample, sampleOne, setLocal, setAge, syncCommitted, syncPreviews, update, shake, positionOf, resetGeometry, dispose };
}
