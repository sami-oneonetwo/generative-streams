import * as THREE from 'three';
import type { CombatView, SafehouseObjectView, ZombieKind } from '../../src/shared/safehouseTypes';
import { buildPersonGroup, newMaterialCache, disposeObject3D } from './primitives';
import { Track } from './motion';

interface Actor {
  group: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  punchUntil: number;
  punchArm: 0 | 1;
  kind: ZombieKind;
  scale: number;
}
// Runners are lean and pale, brutes big and dark; walkers are the original silhouette.
const LOOKS: Record<ZombieKind, { tint?: number; scale: number; sway: number }> = {
  walker: { scale: 1, sway: 0.004 },
  runner: { tint: 0x8f957f, scale: 0.9, sway: 0.007 },
  brute: { tint: 0x47504a, scale: 1.35, sway: 0.003 },
};
/** One speck of dust or debris, flung from an impact and gone within a second. */
interface Mote {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  velocity: THREE.Vector3;
  born: number;
  life: number;
}
const PUNCH_MS = 420;
const MAX_MOTES = 160;
const moteGeometry = new THREE.BoxGeometry(1, 1, 1);
// Pale and chunky on purpose: the stream camera is 43 m away, so a realistic speck is a pixel.
const DUST = new THREE.Color(0xdcd4c0);
const ZOMBIE_HIT = new THREE.Color(0x6f7c5e);

export function createCombatView(parent: THREE.Group) {
  const actors = new Map<string, Actor>();
  // Where each zombie has been, sampled as snapshots land (motion.ts); actors are drawn between the samples.
  const tracks = new Map<string, Track>();
  let latestIds = new Set<string>();
  const beams: { mesh: THREE.Line; until: number }[] = [];
  const motes: Mote[] = [];
  // Damage is inferred from snapshots: a bumped damageRevision means a hit landed since the last one.
  const wear = new Map<string, { damage: number; destroyed: boolean }>();
  let lastShot: number | undefined;
  let primed = false; // the first snapshot only records existing wear; old damage does not puff
  let reducedMotion = false;

  function puff(at: THREE.Vector3, outward: THREE.Vector3, tint: THREE.Color, count: number, now: number) {
    if (reducedMotion || motes.length >= MAX_MOTES) return;
    const color = tint.clone().lerp(DUST, 0.65);
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
      const mesh = new THREE.Mesh(moteGeometry, material);
      mesh.scale.setScalar(0.16 + Math.random() * 0.22);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      mesh.position.copy(at);
      mesh.position.x += (Math.random() - 0.5) * 0.4;
      mesh.position.y += Math.random() * 0.4;
      mesh.position.z += (Math.random() - 0.5) * 0.4;
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.6);
      velocity.addScaledVector(outward, 0.7 + Math.random() * 0.9);
      parent.add(mesh);
      motes.push({ mesh, material, velocity, born: now, life: 750 + Math.random() * 450 });
    }
  }

  return {
    /** A snapshot just landed: note where every zombie is at that server time. */
    sample(state: CombatView | undefined, serverTime: number) {
      if (!state) return;
      latestIds = new Set(state.zombies.map((z) => z.id));
      for (const z of state.zombies) {
        let track = tracks.get(z.id);
        if (!track) tracks.set(z.id, (track = new Track()));
        track.sample({ t: serverTime, x: z.position.x, y: 0, z: z.position.z, facing: z.facing });
      }
      // One that is gone keeps its track until its actor goes too, so it stands where it fell until then.
      for (const id of tracks.keys()) if (!latestIds.has(id) && !actors.has(id)) tracks.delete(id);
    },
    sync(state: CombatView | undefined, objects: SafehouseObjectView[] = []) {
      if (!state) return;
      const now = performance.now();
      const ids = new Set(state.zombies.map((z) => z.id));
      for (const [id, actor] of actors)
        if (!ids.has(id)) {
          disposeObject3D(actor.group);
          actors.delete(id);
          if (!latestIds.has(id)) tracks.delete(id);
        }
      for (const z of state.zombies) {
        if (actors.has(z.id)) continue;
        const kind = z.kind ?? 'walker',
          look = LOOKS[kind];
        const p = buildPersonGroup(parent, newMaterialCache(), true, look.tint, look.scale);
        p.group.position.set(z.position.x, 0.13, z.position.z);
        p.group.rotation.y = z.facing;
        actors.set(z.id, {
          group: p.group,
          leftArm: p.leftArm,
          rightArm: p.rightArm,
          punchUntil: 0,
          punchArm: 1,
          kind,
          scale: look.scale,
        });
      }
      // Hits since the last snapshot: dust flies off the struck face and the attacker throws a punch.
      const present = new Set<string>();
      for (const o of objects) {
        present.add(o.id);
        const before = wear.get(o.id);
        const current = { damage: o.damageRevision ?? 0, destroyed: o.destroyedAt !== undefined };
        wear.set(o.id, current);
        if (!primed || !before || current.damage <= before.damage) continue;
        const collapsed = current.destroyed && !before.destroyed;
        const tint = new THREE.Color(o.blueprint.color || '#b3ab98');
        const centre = new THREE.Vector3(o.position.x, 0.9, o.position.z);
        // Only zombies actually at the piece swing; the rest with the same target are still walking up.
        const half = { x: o.footprint.width / 2, z: o.footprint.depth / 2 };
        const attackers = state.zombies.filter((z) => {
          if (z.targetId !== o.id) return false;
          const dx = Math.max(o.position.x - half.x - z.position.x, 0, z.position.x - o.position.x - half.x);
          const dz = Math.max(o.position.z - half.z - z.position.z, 0, z.position.z - o.position.z - half.z);
          return Math.hypot(dx, dz) <= 1.3;
        });
        if (!attackers.length) {
          puff(centre, new THREE.Vector3(0, 0, 1), tint, collapsed ? 22 : 8, now);
          continue;
        }
        for (const z of attackers) {
          const from = new THREE.Vector3(z.position.x, 0.9, z.position.z);
          const outward = from.clone().sub(centre).setY(0);
          if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
          outward.normalize();
          const impact = from.clone().addScaledVector(outward, -0.5);
          puff(impact, outward, tint, collapsed ? 22 : z.kind === 'brute' ? 14 : 9, now);
          const actor = actors.get(z.id);
          if (actor) {
            actor.punchUntil = now + PUNCH_MS;
            actor.punchArm = actor.punchArm ? 0 : 1;
          }
        }
      }
      for (const id of wear.keys()) if (!present.has(id)) wear.delete(id);
      primed = true;
      // First snapshot, or a world reset (sequence went backwards): don't replay old shots.
      if (lastShot === undefined || state.sequence < lastShot) {
        lastShot = state.sequence;
        return;
      }
      for (const shot of state.shots) {
        if (shot.id <= lastShot) continue;
        const hitY = shot.toY ?? 1.1; // a flyer is hit where it flies
        const geometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(shot.from.x, 1.3, shot.from.z),
          new THREE.Vector3(shot.to.x, hitY, shot.to.z),
        ]);
        const mesh = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xf4cf79 }));
        parent.add(mesh);
        beams.push({ mesh, until: now + 180 });
        // A turret round landing kicks a little off the mark too.
        const to = new THREE.Vector3(shot.to.x, hitY, shot.to.z);
        const along = to.clone().sub(new THREE.Vector3(shot.from.x, 1.3, shot.from.z)).setY(0).normalize();
        puff(to, along, ZOMBIE_HIT, 4, now);
        lastShot = Math.max(lastShot, shot.id);
      }
    },
    /** Per frame. `renderTime` is the server time being drawn (see Timeline in motion.ts). */
    update(now: number, dt: number, reduced: boolean, paused: boolean, renderTime: number) {
      reducedMotion = reduced;
      for (const [id, a] of actors) {
        const pose = tracks.get(id)?.at(renderTime);
        if (pose) {
          a.group.position.x = pose.x;
          a.group.position.z = pose.z;
          a.group.rotation.y = pose.facing;
        }
        const idle = !reduced && !paused ? Math.sin(now * LOOKS[a.kind].sway) * 0.12 : 0;
        // A punch: the striking arm swings forward and back over PUNCH_MS with a small lunge.
        const t = !reduced && now < a.punchUntil ? 1 - (a.punchUntil - now) / PUNCH_MS : 0;
        const jab = t ? Math.sin(t * Math.PI) * 0.75 : 0;
        a.rightArm.rotation.x = -1.1 + idle - (a.punchArm === 1 ? jab : 0);
        a.leftArm.rotation.x = -1.1 + idle - (a.punchArm === 0 ? jab : 0);
        // Scaled models keep their boots on the ground (the boots sit 0.085 m up inside the group).
        a.group.position.y = 0.13 - (a.scale - 1) * 0.085 + (jab ? jab * 0.06 : 0);
      }
      for (let i = beams.length - 1; i >= 0; i--)
        if (now > beams[i].until) {
          const b = beams.splice(i, 1)[0];
          parent.remove(b.mesh);
          b.mesh.geometry.dispose();
          (b.mesh.material as THREE.Material).dispose();
        }
      for (let i = motes.length - 1; i >= 0; i--) {
        const m = motes[i],
          age = now - m.born;
        if (age > m.life || reduced) {
          motes.splice(i, 1);
          parent.remove(m.mesh);
          m.material.dispose();
          continue;
        }
        m.velocity.y -= 2.4 * dt;
        m.mesh.position.addScaledVector(m.velocity, dt);
        if (m.mesh.position.y < 0.04) {
          m.mesh.position.y = 0.04;
          m.velocity.set(m.velocity.x * 0.5, 0, m.velocity.z * 0.5);
        }
        const k = 1 - age / m.life;
        m.material.opacity = 0.95 * k;
        m.mesh.scale.multiplyScalar(1 + dt * 1.1); // dust spreads as it fades
      }
    },
  };
}
