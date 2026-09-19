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
import { partsKey, type Primitive, type SafehouseJobView, type SafehouseObject, type SafehouseObjectView } from './types';

interface Entry {
  revision: number;
  group: THREE.Group;
  filled: boolean;
  shade: number; // 0.45 rubble … 1 pristine: applied when the parts land, then per snapshot
  /** A living build: how it carries itself. Where it is comes from its track (motion.ts), per frame. */
  creature?: { behaviour: string; destroyed: boolean; flying: boolean };
}

export interface ObjectsHandles {
  root: THREE.Group;
  /** A snapshot just landed: note where every living build is at that server time. */
  sample(objects: SafehouseObjectView[], serverTime: number): void;
  /** Reconcile committed objects against the scene snapshot the drawn world has reached. */
  syncCommitted(objects: SafehouseObjectView[]): void;
  /** Reconcile the ghost preview for the currently active job, if any. */
  syncPreview(current: SafehouseJobView | undefined): void;
  /** Per frame: place living builds where they are at `renderTime` (server time) and give them a gait. */
  update(now: number, reducedMotion: boolean, renderTime: number): void;
  dispose(): void;
}

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
  let previewGroup: THREE.Group | null = null;
  let previewId: string | null = null;
  const geometry = createGeometryStore((key, parts) => {
    const at = key.lastIndexOf(':');
    const entry = committed.get(key.slice(0, at));
    if (!entry || entry.revision !== Number(key.slice(at + 1)) || entry.filled) return;
    fillGroup(entry.group, parts, key.slice(0, at), false);
    shadeGroup(entry.group, entry.shade);
    entry.filled = true;
  });

  function sample(objects: SafehouseObjectView[], serverTime: number): void {
    latestIds = new Set();
    for (const obj of objects) {
      if (!obj.creature) continue;
      latestIds.add(obj.id);
      let track = tracks.get(obj.id);
      if (!track) tracks.set(obj.id, (track = new Track()));
      track.sample({
        t: serverTime,
        x: obj.position.x,
        y: obj.creature.altitude ?? 0,
        z: obj.position.z,
        facing: obj.creature.facing,
      });
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
          existing.creature = { behaviour: obj.creature.behaviour, destroyed, flying: !!obj.creature.flying };
        } else {
          existing.creature = undefined;
          existing.group.position.set(obj.position.x, 0, obj.position.z);
        }
        existing.group.scale.y = destroyed ? 0.12 : 1;
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
        creature: obj.creature
          ? { behaviour: obj.creature.behaviour, destroyed, flying: !!obj.creature.flying }
          : undefined,
      };
      committed.set(obj.id, entry);
      const key = partsKey(obj.id, obj.revision);
      const known = geometry.get(key);
      if (known) {
        fillGroup(group, known, obj.id, false);
        shadeGroup(group, shade);
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

  function syncPreview(current: SafehouseJobView | undefined): void {
    const preview: SafehouseObject | undefined = current ? current.preview : undefined;
    if (!preview) {
      if (previewGroup) {
        disposeObject3D(previewGroup);
        previewGroup = null;
        previewId = null;
      }
      return;
    }
    const key = preview.id + ':' + preview.revision;
    if (previewId !== key) {
      if (previewGroup) disposeObject3D(previewGroup);
      previewGroup = new THREE.Group();
      previewGroup.position.set(preview.position.x, 0, preview.position.z);
      fillGroup(previewGroup, preview.blueprint.parts, undefined, true);
      root.add(previewGroup);
      previewId = key;
    }
    const progress = current ? current.progress : 0;
    if (previewGroup) {
      if (current?.status === 'walking')
        previewGroup.children.forEach((child) => {
          child.visible = true;
        });
      else applyProgress(previewGroup, progress);
      previewGroup.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const material = child.material as THREE.MeshStandardMaterial;
        const building = current?.status === 'building';
        material.opacity = building ? 0.9 : GHOST_OPACITY;
        child.castShadow = building;
      });
    }
  }

  function update(now: number, reducedMotion: boolean, renderTime: number): void {
    for (const [id, entry] of committed) {
      const c = entry.creature;
      if (!c) continue;
      // Between the two snapshots either side of the drawn moment, facing the way it is going; a
      // flyer's height (the climb after the build, the fall when downed) rides the same slide.
      const pose = tracks.get(id)?.at(renderTime);
      if (!pose) continue;
      const g = entry.group;
      g.position.x = pose.x;
      g.position.z = pose.z;
      g.rotation.y = pose.facing;
      // A gait: animals bounce a little on the move, the car just hums along, a flyer rides a slow swell.
      const bob =
        reducedMotion || c.destroyed
          ? 0
          : c.flying
            ? Math.sin(now * 0.0035) * 0.18
            : pose.moving
              ? c.behaviour === 'zoom'
                ? Math.abs(Math.sin(now * 0.03)) * 0.02
                : Math.abs(Math.sin(now * (c.behaviour === 'fight' ? 0.016 : 0.011))) * 0.08
              : 0;
      g.position.y = pose.y + bob;
      g.rotation.z = c.flying && !c.destroyed && !reducedMotion ? Math.sin(now * 0.0025) * 0.08 : 0;
    }
  }

  function dispose(): void {
    for (const entry of committed.values()) disposeObject3D(entry.group);
    committed.clear();
    if (previewGroup) disposeObject3D(previewGroup);
    previewGroup = null;
    previewId = null;
    parent.remove(root);
  }

  return { root, sample, syncCommitted, syncPreview, update, dispose };
}
