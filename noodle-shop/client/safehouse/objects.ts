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

import * as THREE from 'three';
import { buildPrimitiveMesh, disposeObject3D, newMaterialCache } from './primitives';
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
  sample(objects: SafehouseObjectView[], serverTime: number): void;
  /** Reconcile committed objects against the scene snapshot the drawn world has reached. */
  syncCommitted(objects: SafehouseObjectView[]): void;
  /** Reconcile the ghost previews for every job in flight (Rook's and the neighbours'). */
  syncPreviews(list: PreviewSpec[]): void;
  /** Per frame: place living builds where they are at `renderTime` (server time) and give them a gait. */
  update(now: number, reducedMotion: boolean, renderTime: number): void;
  /** A horn (`!honk`): rattle the piece for most of a second. */
  shake(objectId: string, now: number): void;
  /** Where a committed piece is drawn right now, for an overlay pop; undefined when it is not on the page. */
  positionOf(objectId: string): { x: number; y: number; z: number } | undefined;
  dispose(): void;
}
const SHAKE_MS = 800;

const GHOST_OPACITY = 0.38;
const MAX_CACHED_GEOMETRY = 600;

function fillGroup(group: THREE.Group, parts: Primitive[], objectId: string | undefined, ghost: boolean): void {
  const cache = newMaterialCache();
  for (const part of parts) {
    const m = buildPrimitiveMesh(part, cache);
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
  const geometry = createGeometryStore((key, parts) => {
    const at = key.lastIndexOf(':');
    const entry = committed.get(key.slice(0, at));
    if (!entry || entry.revision !== Number(key.slice(at + 1)) || entry.filled) return;
    fillGroup(entry.group, parts, key.slice(0, at), false);
    shadeGroup(entry.group, entry.shade);
    recordBases(entry.group);
    entry.filled = true;
  });
  const creatureOf = (obj: SafehouseObjectView, destroyed: boolean) =>
    obj.creature
      ? {
          behaviour: obj.creature.behaviour,
          destroyed,
          flying: !!obj.creature.flying,
          perched: !!obj.creature.goal?.perched,
        }
      : undefined;

  function sample(objects: SafehouseObjectView[], serverTime: number): void {
    latestIds = new Set();
    for (const obj of objects) {
      // A living build follows its creature; a piece on a run (`!drive`) follows `driven`. Nothing else moves.
      if (!obj.creature && !obj.driven) continue;
      latestIds.add(obj.id);
      let track = tracks.get(obj.id);
      if (!track) tracks.set(obj.id, (track = new Track()));
      track.sample(
        obj.driven
          ? { t: serverTime, x: obj.driven.at.x, y: 0, z: obj.driven.at.z, facing: obj.driven.turn }
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
      const shade = destroyed ? 0.45 : 0.6 + (0.4 * (obj.health ?? 80)) / (obj.maxHealth ?? 80);
      const existing = committed.get(obj.id);
      if (existing && existing.revision === obj.revision) {
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
        existing.group.scale.y = destroyed ? 0.12 : 1;
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
      group.scale.y = destroyed ? 0.12 : 1;
      if (obj.creature) group.rotation.y = obj.creature.facing;
      root.add(group);
      if (existing) disposeObject3D(existing.group);
      const entry: Entry = {
        revision: obj.revision,
        group,
        filled: false,
        shade,
        destroyed,
        creature: creatureOf(obj, destroyed),
        driven: !!obj.driven,
        animations: obj.blueprint.animations?.length ? obj.blueprint.animations : undefined,
      };
      committed.set(obj.id, entry);
      const key = partsKey(obj.id, obj.revision);
      const known = geometry.get(key);
      if (known) {
        fillGroup(group, known, obj.id, false);
        shadeGroup(group, shade);
        recordBases(group);
        entry.filled = true;
      } else geometry.want(key);
    }
    for (const [id, entry] of committed) {
      if (!seen.has(id)) {
        disposeObject3D(entry.group);
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
        fillGroup(group, preview.blueprint.parts, undefined, true);
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
    // A honked piece rattles side to side, the jitter dying out over most of a second.
    for (const [id, s] of shakes) {
      const entry = committed.get(id);
      const age = now - s.since;
      if (!entry || age > SHAKE_MS || reducedMotion) {
        if (entry && !entry.creature) entry.group.position.x = s.baseX;
        shakes.delete(id);
        continue;
      }
      if (!entry.creature) entry.group.position.x = s.baseX + Math.sin(now * 0.06) * 0.03 * (1 - age / SHAKE_MS);
    }
    for (const [id, entry] of committed) {
      // Part motion as data: a canopy drifting, a chain swaying, a wheel turning. Rubble lies still.
      if (entry.animations && entry.filled && !entry.destroyed) {
        if (reducedMotion) restBases(entry.group, entry.animations);
        else animateParts(entry.group, entry.animations, t);
      }
      const c = entry.creature;
      // A living build follows its creature; a piece on a run (`!drive`) follows `driven`. Nothing else moves.
      if (!c && !entry.driven) continue;
      // Between the two snapshots either side of the drawn moment, facing the way it is going; a
      // flyer's height (the climb after the build, the fall when downed) rides the same slide.
      const pose = tracks.get(id)?.at(renderTime);
      if (!pose) continue;
      const g = entry.group;
      g.position.x = pose.x;
      g.position.z = pose.z;
      g.rotation.y = pose.facing;
      // A gait: animals bounce a little on the move, a car (driven or a `zoom` build) just hums
      // along, a flyer rides a slow swell. A bird sitting on a perch just sits: no swell, no bounce.
      const flying = !!c?.flying;
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
    for (const entry of committed.values()) disposeObject3D(entry.group);
    committed.clear();
    for (const entry of previews.values()) disposeObject3D(entry.group);
    previews.clear();
    parent.remove(root);
  }

  return { root, sample, syncCommitted, syncPreviews, update, shake, positionOf, dispose };
}
