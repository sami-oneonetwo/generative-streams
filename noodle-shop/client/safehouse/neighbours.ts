// The people next door, as the page draws them: a blocky figure each (Marge in a sun hat,
// Jake in a cap), slid between snapshots like Rook (motion.ts), a name tag pinned over the
// head, and a small speech bubble of their own for the odd line. Everything they build is
// an ordinary object and renders in objects.ts; their in-flight build is a ghost there too.
import * as THREE from 'three';
import type { NeighbourView } from '../../src/shared/safehouseTypes';
import { box, buildPersonGroup, cyl, disposeObject3D, newMaterialCache, type PersonParts } from './primitives';
import { Track } from './motion';

interface Figure {
  parts: PersonParts;
  track: Track;
  tag: HTMLElement;
  say: HTMLElement;
  sayText: string;
  sayUntil: number;
  view: NeighbourView;
  /** How far into the seated pose they are drawn (0 standing … 1 sitting), eased over ~0.4 s. */
  seated: number;
  lastNow: number;
  /** Shooting hoops: the ball, made the first time they play, and a per-figure offset so two players never sync. */
  ball?: THREE.Mesh;
  throwOffset: number;
  hash: number;
}
const headPoint = new THREE.Vector3();
const SEATED_DROP = 0.42,
  SEATED_ARM = -1.0;
// A throw every three seconds: half a second of wind-up, the ball in the air for just over a
// second to rim height, then it drops and fades. About one in three lands short or wide.
const THROW_PERIOD = 3000,
  WIND_UP = 500,
  RELEASE = 150,
  FLIGHT = 1100,
  DROP = 500,
  RIM_HEIGHT = 2.7,
  ARC = 1.2;
const hashOf = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** A stable 0..1 for throw `k` of figure `hash`: decides a miss and which way it goes. */
const roll = (hash: number, k: number, salt: number): number => ((Math.imul(k + salt, 2654435761) ^ hash) >>> 0) / 4294967296;
const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const start = new THREE.Vector3(),
  end = new THREE.Vector3(),
  dir = new THREE.Vector3(),
  side = new THREE.Vector3();

export function createNeighboursLayer(parent: THREE.Object3D, overlay: HTMLElement) {
  const figures = new Map<string, Figure>();

  function build(view: NeighbourView): Figure {
    const cache = newMaterialCache();
    const parts = buildPersonGroup(parent, cache, false, parseInt(view.tint.replace('#', ''), 16));
    if (view.hat === 'sun') {
      cyl(0.36, 0.04, 0xd9c98c, 0, 1.76, 0, parts.group, cache, 14);
      cyl(0.17, 0.12, 0xd9c98c, 0, 1.83, 0, parts.group, cache, 12);
    } else {
      box(0.36, 0.1, 0.36, 0x4f7f9a, 0, 1.78, 0, parts.group, cache);
      box(0.3, 0.03, 0.22, 0x4f7f9a, 0, 1.75, 0.27, parts.group, cache);
    }
    parts.group.position.set(view.position.x, 0.13, view.position.z);
    parts.group.rotation.y = view.facing;
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = view.name;
    overlay.append(tag);
    const say = document.createElement('div');
    say.className = 'say';
    say.hidden = true;
    overlay.append(say);
    const hash = hashOf(view.id);
    return {
      parts,
      track: new Track(),
      tag,
      say,
      sayText: '',
      sayUntil: 0,
      view,
      seated: 0,
      lastNow: 0,
      throwOffset: hash % THROW_PERIOD,
      hash,
    };
  }
  function remove(id: string) {
    const f = figures.get(id);
    if (!f) return;
    disposeObject3D(f.parts.group);
    if (f.ball) disposeObject3D(f.ball);
    f.tag.remove();
    f.say.remove();
    figures.delete(id);
  }
  /**
   * The throwing arm over one three-second cycle: raised over the wind-up, snapped forward on the
   * release, then back to rest.
   */
  function throwArm(t: number): number {
    if (t < WIND_UP) return -0.4 + (-2.4 + 0.4) * easeInOut(t / WIND_UP);
    if (t < WIND_UP + RELEASE) return -2.4 + (-0.6 + 2.4) * ((t - WIND_UP) / RELEASE);
    const rest = Math.min(1, (t - WIND_UP - RELEASE) / 600);
    return -0.6 + (-0.4 + 0.6) * rest;
  }
  /** The ball for one figure this frame: in flight from the hand to the rim, dropping, or put away. */
  function ballPose(f: Figure, playing: boolean, now: number) {
    const at = f.view.job?.at;
    if (!playing || !at) {
      if (f.ball) f.ball.visible = false;
      return;
    }
    if (!f.ball) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xc8722a, roughness: 0.9, transparent: true }),
      );
      mesh.castShadow = false;
      mesh.userData.ball = true; // the browser smoke looks for this
      parent.add(mesh);
      f.ball = mesh;
    }
    const ball = f.ball,
      material = ball.material as THREE.MeshStandardMaterial;
    const cycle = now + f.throwOffset,
      t = cycle % THROW_PERIOD,
      k = Math.floor(cycle / THROW_PERIOD);
    const since = t - WIND_UP; // ms since the release
    if (since < 0 || since >= FLIGHT + DROP) {
      ball.visible = false;
      return;
    }
    const g = f.parts.group;
    dir.set(at.x - g.position.x, 0, at.z - g.position.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    start.set(g.position.x + dir.x * 0.3, g.position.y + 1.6, g.position.z + dir.z * 0.3);
    end.set(at.x, RIM_HEIGHT, at.z);
    // Not a machine: about one throw in three lands short or wide.
    if (roll(f.hash, k, 1) < 0.34) {
      const off = 0.4 + roll(f.hash, k, 2) * 0.3;
      if (roll(f.hash, k, 3) < 0.5) end.addScaledVector(dir, -off);
      else end.addScaledVector(side.set(-dir.z, 0, dir.x), roll(f.hash, k, 4) < 0.5 ? off : -off);
    }
    ball.visible = true;
    if (since < FLIGHT) {
      const u = since / FLIGHT;
      ball.position.lerpVectors(start, end, u);
      ball.position.y += ARC * 4 * u * (1 - u);
      material.opacity = 1;
    } else {
      const v = (since - FLIGHT) / 1000;
      ball.position.copy(end);
      ball.position.y = Math.max(0.12, end.y - 4.9 * v * v);
      material.opacity = 1 - (since - FLIGHT) / DROP;
    }
  }

  return {
    /** A snapshot just landed: note where everyone is at that server time. */
    sample(list: NeighbourView[], serverTime: number) {
      for (const v of list) {
        let f = figures.get(v.id);
        if (!f) figures.set(v.id, (f = build(v)));
        f.track.sample({ t: serverTime, x: v.position.x, y: 0, z: v.position.z, facing: v.facing, tag: v.activity });
      }
    },
    /** The drawn world has reached this snapshot: who is about, what they are doing, what they said. */
    sync(list: NeighbourView[]) {
      const seen = new Set<string>();
      for (const v of list) {
        seen.add(v.id);
        let f = figures.get(v.id);
        if (!f) figures.set(v.id, (f = build(v)));
        f.view = v;
        f.tag.classList.toggle('alert', v.alert);
        // A grudge or a favourite colours the tag (grudges slice); `alert` still wins while they respond to a creature.
        f.tag.classList.toggle('cross', !!v.regard && v.regard.score > 0);
        f.tag.classList.toggle('fond', !!v.regard && v.regard.score < 0);
        // "Jake · project car", not "Jake · Jake's project car".
        const doing = v.job?.label.replace(new RegExp(`^${v.name}['’]s\\s+`), '');
        // What they are doing beats what they are doing it for; idle, who they are cross with (or a
        // fan of) beats the theme, and the theme beats the bare name.
        f.tag.textContent = doing
          ? `${v.name} · ${doing}`
          : v.regard
            ? `${v.name} · ${v.regard.phrase}`
            : v.theme
              ? `${v.name} · ${v.theme}`
              : v.name;
        const text = v.say?.text ?? '';
        if (text !== f.sayText) {
          f.sayText = text;
          f.say.textContent = text;
          f.say.hidden = !text;
        }
        f.sayUntil = v.say?.until ?? 0;
      }
      for (const id of figures.keys()) if (!seen.has(id)) remove(id);
    },
    /** Per frame, before the render: place and animate each figure at the drawn server time. */
    pose(now: number, reduced: boolean, renderTime: number, live: boolean) {
      for (const f of figures.values()) {
        const dt = f.lastNow ? Math.min((now - f.lastNow) / 1000, 0.1) : 0;
        f.lastNow = now;
        const p = f.track.at(renderTime);
        const g = f.parts.group;
        if (p) {
          g.position.x = p.x;
          g.position.z = p.z;
          g.rotation.y = p.facing;
        }
        const activity = p?.tag ?? f.view.activity;
        const walking = live && !!p?.moving;
        const still = live && !walking;
        const hammering = still && (activity === 'building' || activity === 'repairing');
        const painting = still && activity === 'painting';
        const tending = still && activity === 'tending';
        const sitting = still && activity === 'sitting';
        const waving = still && activity === 'waving';
        const playing = still && activity === 'playing';
        const dancing = still && activity === 'dancing';
        // Sitting eases in and out over ~0.4 s so nobody pops onto a bench.
        const wantSeated = sitting ? 1 : 0;
        f.seated = reduced ? wantSeated : f.seated + (wantSeated - f.seated) * (1 - Math.exp(-dt * 8));
        let right = -0.2,
          left = -0.2,
          bob = walking && !reduced ? Math.sin(now * 0.011) * 0.025 : 0,
          wobble = 0;
        if (reduced) {
          // Poses only, no motion: a raised arm for the wave, a half-raised one at the hoop, both up for a dance.
          if (waving) right = -2.7;
          else if (playing) right = -1.2;
          else if (dancing) right = left = -2.4;
          if (tending) left = -0.9;
        } else if (hammering) right = -0.6 + Math.sin(now * 0.0075) * 0.55;
        else if (painting) right = -1.1 + Math.sin(now * 0.003) * 0.45;
        else if (tending) right = left = -0.9;
        else if (waving) right = -2.7 + Math.sin(now * 0.0188) * 0.2; // ~3 Hz, like the crowd's wave
        else if (playing) right = throwArm((now + f.throwOffset) % THROW_PERIOD);
        else if (dancing) {
          // To the speakers: arms alternating at ~2 Hz, a bounce twice a second, a slow yaw wobble.
          const swing = Math.sin(now * 0.01257 + f.throwOffset) * 0.9;
          right = -1.5 + swing;
          left = -1.5 - swing;
          bob = Math.abs(Math.sin(now * 0.00628 + f.throwOffset)) * 0.06;
          wobble = Math.sin(now * 0.0025 + f.throwOffset) * 0.15;
        }
        if (walking && !reduced) left = Math.sin(now * 0.0065) * 0.25;
        if (p) g.rotation.y = p.facing + wobble;
        f.parts.rightArm.rotation.x = right + (SEATED_ARM - right) * f.seated;
        f.parts.leftArm.rotation.x = left + (SEATED_ARM - left) * f.seated;
        g.rotation.x = tending && !reduced ? 0.22 : 0;
        g.position.y = 0.13 - SEATED_DROP * f.seated + bob - (tending ? 0.06 : 0);
        ballPose(f, playing && !reduced, now);
      }
    },
    /** After the render: pin the tags and bubbles over the heads; a bubble lives as long as it would on the server. */
    overlay(camera: THREE.Camera, serverNow: number) {
      for (const f of figures.values()) {
        const g = f.parts.group;
        headPoint.set(g.position.x, g.position.y + 2.05, g.position.z).project(camera);
        // Off the edge means off: a half-clipped tag at the border reads as a glitch, not a person.
        const onScreen = headPoint.z < 1 && Math.abs(headPoint.x) < 0.98 && Math.abs(headPoint.y) < 0.98;
        const rx = ((headPoint.x + 1) / 2) * innerWidth,
          ry = ((1 - headPoint.y) / 2) * innerHeight;
        f.tag.hidden = !onScreen;
        f.tag.style.left = `${rx}px`;
        f.tag.style.top = `${ry}px`;
        if (f.sayText && f.sayUntil && serverNow > f.sayUntil) {
          f.sayText = '';
          f.say.hidden = true;
        }
        if (!f.say.hidden) {
          const w = f.say.offsetWidth,
            margin = 8;
          const left = Math.max(margin + w / 2, Math.min(innerWidth - margin - w / 2, rx));
          f.say.hidden = !onScreen;
          f.say.style.left = `${left}px`;
          f.say.style.top = `${Math.max(margin + f.say.offsetHeight, ry - f.tag.offsetHeight - 8)}px`;
        }
      }
    },
    dispose() {
      for (const id of [...figures.keys()]) remove(id);
    },
  };
}
