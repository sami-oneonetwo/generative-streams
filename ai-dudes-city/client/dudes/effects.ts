// Cartoon combat on the field, toy-like and bloodless: a tracer streak with a muzzle flash and a
// spark puff for a shot, a rock or a pie lobbed in an arc for a throw, a round black bomb with a
// fizzing fuse while one is lit, and a big yellow-orange flash, a smoke ring and tumbling debris
// cubes for the boom (plus a camera nudge the page reads back). Nothing here is ever red.
//
// Every effect is a handful of small meshes made when it starts and freed when it ends; there are
// only ever a few at once. One-shot effects (shot, throw, boom) run on page time from the moment
// the drawn clock reaches their snapshot; a bomb is drawn from the snapshot list for as long as its
// `until` is ahead of the drawn server time, so a page that opens mid-fuse still shows it.
import * as THREE from 'three';
import type { FieldEffect, GroundPoint } from './types';

const SHOT_MS = 150,
  FLASH_MS = 90,
  SPARK_MS = 280,
  THROW_MS = 600,
  PUFF_MS = 450,
  BOOM_FLASH_MS = 450,
  BOOM_RING_MS = 1000,
  DEBRIS_MS = 1300,
  SHAKE_MS = 550;
const CHEST = 1.3,
  HAND = 1.4,
  HIT = 0.9;
const YELLOW = 0xffe27a,
  ORANGE = 0xffa53a,
  SMOKE = 0xcfcac0,
  ROCK = 0x8a857c,
  PIE_CRUST = 0xd9a45c,
  PIE_CREAM = 0xf6efe0,
  BOMB = 0x222226,
  FUSE = 0xc9b48a;
const DEBRIS = [0x8a7a62, 0x9a9488, 0x6f6658, 0xb7ab92];
const BOLT = 0x8ff3ff,
  DUST = 0xb9ae98,
  SHELL = 0x3b3f36;
const SHELL_SPEED = 38; // metres a second: a rocket or a shell takes a moment to get there
/** At most this many effect meshes at once: past it, new sparks and puffs are skipped (ten players firing must not sink the stream's frame rate). */
const MAX_LIVE = 300;

interface Running {
  /** Advance to page time `now`; false when finished (its meshes are then freed). */
  step(now: number): boolean;
  meshes: THREE.Object3D[];
}
interface Bomb {
  group: THREE.Group;
  spark: THREE.Mesh;
  body: THREE.Mesh;
  at: number; // server time it was lit
  until: number;
}

export interface EffectsHandles {
  /** A new effect the drawn clock has just reached: play it once. `colour` is the build's own, for chips off it. */
  play(e: FieldEffect, now: number, reduced: boolean, colour?: number): void;
  /** Every effect in the applied snapshot: keeps the lit bombs on the ground. */
  syncBombs(effects: FieldEffect[]): void;
  /** Per frame, before the render. */
  update(now: number, serverNow: number, reduced: boolean): void;
  /** This page's own shot, drawn at once: a muzzle flash, and a blaster's bolt (the server's copy is skipped). */
  local(shot: { gun: string; from: GroundPoint; to: GroundPoint; fromHeight: number }, now: number): void;
  /** How far to nudge the camera this frame (metres), from recent booms near `focus`. */
  shake(now: number, focus: GroundPoint): { x: number; z: number };
  dispose(): void;
}

export function createEffectsLayer(parent: THREE.Object3D): EffectsHandles {
  const root = new THREE.Group();
  parent.add(root);
  const unit = new THREE.SphereGeometry(0.5, 12, 8);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const ringGeometry = new THREE.TorusGeometry(1, 0.18, 8, 28);
  const running: Running[] = [];
  const bombs = new Map<number, Bomb>();
  const quakes: { at: number; x: number; z: number; radius: number }[] = [];

  /** An unlit, fading material of its own (effects fade independently). */
  const glow = (color: number, opacity = 1) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const lit = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true });
  function add(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(geometry, material);
    root.add(m);
    return m;
  }
  function free(meshes: THREE.Object3D[]) {
    for (const o of meshes) {
      root.remove(o);
      o.traverse((c) => {
        if (c instanceof THREE.Sprite) {
          (c.material as THREE.SpriteMaterial).map?.dispose();
          c.material.dispose();
        }
        if (c instanceof THREE.Mesh) {
          // Shared unit geometries stay; per-effect ones (the tracer) go.
          if (c.geometry !== unit && c.geometry !== cube && c.geometry !== ringGeometry) c.geometry.dispose();
          (c.material as THREE.Material).dispose();
        }
      });
    }
  }
  const v3 = (p: GroundPoint, y: number) => new THREE.Vector3(p.x, y, p.z);
  const full = () => root.children.length >= MAX_LIVE;
  const nothing: Running = { meshes: [], step: () => false };

  /** A little burst of sparks (bright cubes flung out and fading) at `at`. */
  function sparks(at: THREE.Vector3, now: number, count: number, colour: number, speed: number): Running {
    if (full()) return nothing;
    // One material for the whole burst: they fade together.
    const material = glow(colour);
    const bits = Array.from({ length: count }, (_, i) => {
      const m = add(cube, material);
      m.scale.setScalar(0.05);
      m.position.copy(at);
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const up = 0.3 + Math.random() * 0.8;
      return { m, v: new THREE.Vector3(Math.cos(a), up, Math.sin(a)).multiplyScalar(speed) };
    });
    const start = now;
    return {
      meshes: bits.map((b) => b.m),
      step(t) {
        const u = (t - start) / SPARK_MS;
        if (u >= 1) return false;
        const s = ((t - start) / 1000) * 1;
        for (const b of bits) {
          b.m.position.copy(at).addScaledVector(b.v, s);
          b.m.position.y -= 4.9 * s * s;
        }
        material.opacity = 1 - u;
        return true;
      },
    };
  }
  /** A soft grey puff of smoke: a few spheres swelling and fading. */
  function puff(at: THREE.Vector3, now: number, size: number, ms = PUFF_MS): Running {
    if (full()) return nothing;
    const material = glow(SMOKE, 0.8);
    const balls = Array.from({ length: 4 }, (_, i) => {
      const m = add(unit, material);
      const a = (i / 4) * Math.PI * 2;
      return { m, dx: Math.cos(a) * size * 0.35, dz: Math.sin(a) * size * 0.35 };
    });
    const start = now;
    return {
      meshes: balls.map((b) => b.m),
      step(t) {
        const u = (t - start) / ms;
        if (u >= 1) return false;
        for (const b of balls) {
          b.m.position.set(at.x + b.dx * (0.5 + u), at.y + u * size * 0.6, at.z + b.dz * (0.5 + u));
          b.m.scale.setScalar(size * (0.4 + 0.8 * u));
        }
        material.opacity = 0.8 * (1 - u);
        return true;
      },
    };
  }

  function shot(e: FieldEffect, now: number) {
    if (!e.from || !e.to) return;
    const a = v3(e.from, e.fromHeight ?? CHEST),
      b = v3(e.to, e.height ?? CHEST);
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 0.05) return;
    dir.normalize();
    // The streak: a thin bright box a metre and a bit long, flying the whole way in 0.15 s.
    const streakLen = Math.min(1.4, len);
    const blaster = e.label === 'blaster';
    const tracer = add(new THREE.BoxGeometry(blaster ? 0.09 : 0.05, blaster ? 0.09 : 0.05, streakLen), glow(blaster ? BOLT : YELLOW));
    tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const flash = add(unit, glow(ORANGE));
    flash.position.copy(a).addScaledVector(dir, 0.3);
    const start = now;
    let landed = false;
    running.push({
      meshes: [tracer, flash],
      step(t) {
        const ms = t - start;
        const f = Math.min(1, ms / FLASH_MS);
        flash.scale.setScalar(0.35 * (1 - f) + 0.05);
        (flash.material as THREE.MeshBasicMaterial).opacity = 1 - f;
        const u = Math.min(1, ms / SHOT_MS);
        const head = a.clone().addScaledVector(dir, len * u);
        tracer.position.copy(head).addScaledVector(dir, -streakLen / 2);
        tracer.visible = u < 1;
        if (u >= 1 && !landed) {
          landed = true;
          running.push(sparks(b, t, 7, YELLOW, 2.2));
        }
        return ms < Math.max(SHOT_MS, FLASH_MS);
      },
    });
  }

  function lob(e: FieldEffect, now: number) {
    if (!e.from || !e.to) return;
    const a = v3(e.from, HAND),
      b = v3(e.to, HIT);
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const arc = 0.8 + dist * 0.18;
    // A rock most of the time, a cream pie now and then (by id, so every page agrees).
    const pie = e.id % 3 === 0;
    const thing = new THREE.Group();
    if (pie) {
      const crust = new THREE.Mesh(unit, lit(PIE_CRUST));
      crust.scale.set(0.3, 0.1, 0.3);
      const cream = new THREE.Mesh(unit, lit(PIE_CREAM));
      cream.scale.set(0.24, 0.1, 0.24);
      cream.position.y = 0.05;
      thing.add(crust, cream);
    } else {
      const rock = new THREE.Mesh(unit, lit(ROCK));
      rock.scale.set(0.18, 0.15, 0.17);
      thing.add(rock);
    }
    for (const c of thing.children) c.castShadow = true;
    root.add(thing);
    const start = now;
    let landed = false;
    running.push({
      meshes: [thing],
      step(t) {
        const u = Math.min(1, (t - start) / THROW_MS);
        thing.position.lerpVectors(a, b, u);
        thing.position.y += arc * 4 * u * (1 - u);
        thing.rotation.set(u * 9, u * 4, 0);
        if (u >= 1 && !landed) {
          landed = true;
          running.push(puff(b, t, 0.5));
          if (pie) running.push(sparks(b, t, 6, PIE_CREAM, 1.6));
        }
        return u < 1;
      },
    });
  }

  function boom(e: FieldEffect, now: number) {
    if (!e.from) return;
    const radius = Math.max(1, Math.min(12, e.radius ?? 3));
    const at = v3(e.from, 0.3);
    quakes.push({ at: now, x: e.from.x, z: e.from.z, radius });
    const flash = add(unit, glow(YELLOW));
    const core = add(unit, glow(ORANGE));
    const ring = add(ringGeometry, glow(SMOKE, 0.7));
    ring.rotation.x = Math.PI / 2;
    // One material a colour for the debris (they fade together).
    const chips = DEBRIS.map((c) => lit(c));
    const debris = Array.from({ length: 10 }, (_, i) => {
      const m = add(cube, chips[i % chips.length]);
      m.castShadow = true;
      m.scale.setScalar(0.12 + Math.random() * 0.12);
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
      const sp = radius * (0.9 + Math.random() * 0.8);
      return {
        m,
        v: new THREE.Vector3(Math.cos(a) * sp, 4 + Math.random() * 3, Math.sin(a) * sp),
        spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
      };
    });
    const start = now;
    running.push({
      meshes: [flash, core, ring, ...debris.map((d) => d.m)],
      step(t) {
        const ms = t - start;
        // The fireball: swells fast to the blast radius, then fades; a hotter core inside it.
        const f = Math.min(1, ms / BOOM_FLASH_MS);
        const swell = 1 - Math.pow(1 - Math.min(1, ms / 180), 3);
        flash.position.copy(at);
        flash.scale.setScalar(radius * 2 * swell);
        (flash.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - f);
        core.position.copy(at);
        core.scale.setScalar(radius * 1.2 * swell * (1 - 0.5 * f));
        (core.material as THREE.MeshBasicMaterial).opacity = 1 - f;
        flash.visible = core.visible = f < 1;
        // The smoke ring rolls out along the ground past the radius.
        const r = Math.min(1, ms / BOOM_RING_MS);
        ring.position.set(at.x, 0.25 + r * 0.4, at.z);
        ring.scale.set(radius * (0.4 + 0.9 * r), radius * (0.4 + 0.9 * r), 1 + r);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - r);
        ring.visible = r < 1;
        // Debris cubes: thrown out and up, tumbling, coming to rest on the grass, then fading.
        const s = ms / 1000;
        const d = Math.min(1, ms / DEBRIS_MS);
        for (const b of debris) {
          b.m.position.set(at.x + b.v.x * s * 0.6, Math.max(0.06, 0.3 + b.v.y * s - 9.8 * s * s), at.z + b.v.z * s * 0.6);
          if (b.m.position.y > 0.07) b.m.rotation.set(b.spin.x * s, b.spin.y * s, b.spin.z * s);
        }
        for (const c of chips) c.opacity = d < 0.7 ? 1 : 1 - (d - 0.7) / 0.3;
        return ms < Math.max(BOOM_RING_MS, DEBRIS_MS);
      },
    });
    running.push(puff(at.clone().setY(0.8), now, radius * 0.9, 1100));
  }

  /** A rocket or a cannon shell: a dark slug with a smoke trail, flying a shallow arc, going off where it lands. */
  function shell(e: FieldEffect, now: number) {
    if (!e.from || !e.to) return;
    const a = v3(e.from, e.fromHeight ?? HAND),
      b = v3(e.to, 0.6);
    const dist = a.distanceTo(b);
    const ms = Math.max(120, (dist / SHELL_SPEED) * 1000);
    const arc = 0.3 + dist * 0.05;
    const slug = add(unit, lit(SHELL));
    slug.scale.set(0.22, 0.22, 0.5);
    const flash = add(unit, glow(ORANGE));
    flash.position.copy(a);
    const start = now;
    let trailAt = now,
      landed = false;
    const prev = a.clone();
    running.push({
      meshes: [slug, flash],
      step(t) {
        const u = Math.min(1, (t - start) / ms);
        const f = Math.min(1, (t - start) / 140);
        flash.scale.setScalar(0.6 * (1 - f) + 0.05);
        (flash.material as THREE.MeshBasicMaterial).opacity = 1 - f;
        slug.position.lerpVectors(a, b, u);
        slug.position.y += arc * 4 * u * (1 - u);
        slug.lookAt(prev);
        prev.copy(slug.position);
        if (t - trailAt > 35 && u < 1) {
          trailAt = t;
          running.push(puff(slug.position.clone(), t, 0.35, 500));
        }
        if (u >= 1 && !landed) {
          landed = true;
          boom({ ...e, from: e.to, radius: e.radius ?? 3 }, t);
        }
        slug.visible = u < 1;
        return u < 1 || t - start < 160;
      },
    });
  }
  /** A build taking a hit: chips of it and a puff of dust where it landed. */
  function hit(e: FieldEffect, now: number, colour: number) {
    if (!e.to) return;
    const at = v3(e.to, e.height ?? 1.2);
    running.push(sparks(at, now, 8, colour, 2.4), sparks(at, now, 4, DUST, 1.6), puff(at, now, 0.6));
  }
  /** A build coming down: a great cloud of dust rolling out from its foot, chunks thrown about, and a shudder. */
  function collapse(e: FieldEffect, now: number, colour: number) {
    if (!e.from) return;
    const r = Math.max(1.5, Math.min(14, e.radius ?? 4));
    quakes.push({ at: now, x: e.from.x, z: e.from.z, radius: r * 0.9 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      running.push(puff(new THREE.Vector3(e.from.x + Math.cos(a) * r * 0.6, 0.6 + (i % 2) * r * 0.3, e.from.z + Math.sin(a) * r * 0.6), now, r * 0.9, 1800 + i * 120));
    }
    running.push(puff(v3(e.from, r * 0.5), now, r * 1.3, 2200));
    const at = v3(e.from, r * 0.4);
    running.push(sparks(at, now, 14, colour, r * 0.9), sparks(at, now, 10, DUST, r * 0.7), sparks(at, now, 8, DEBRIS[1], r));
  }

  function newBomb(e: FieldEffect): Bomb {
    const group = new THREE.Group();
    const body = new THREE.Mesh(unit, lit(BOMB));
    body.scale.setScalar(0.44);
    body.position.y = 0.22;
    body.castShadow = true;
    const cap = new THREE.Mesh(cube, lit(0x55555c));
    cap.scale.set(0.1, 0.06, 0.1);
    cap.position.y = 0.45;
    const fuse = new THREE.Mesh(cube, lit(FUSE));
    fuse.scale.set(0.03, 0.14, 0.03);
    fuse.position.set(0.02, 0.53, 0);
    fuse.rotation.z = -0.3;
    const spark = new THREE.Mesh(unit, glow(YELLOW));
    spark.position.set(0.05, 0.62, 0);
    group.add(body, cap, fuse, spark);
    group.position.set(e.from!.x, 0, e.from!.z);
    root.add(group);
    return { group, spark, body, at: e.at, until: e.until! };
  }

  /** Money changing hands: "+§5" floating up over the place and fading. */
  function coins(e: FieldEffect, now: number) {
    if (!e.to || !e.amount) return;
    // Spent (a fine, a fee, a new hat): down in red; earned: up in gold.
    if (e.amount < 0) floatText(e.to, `-§${-e.amount}`, '#ff8a6a', now);
    else floatText(e.to, `+§${e.amount}`, '#ffd34d', now);
  }
  /** Someone doing a build's thing: its shout ("SWISH") floating up over them. */
  function pop(e: FieldEffect, now: number) {
    if (!e.to || !e.label) return;
    floatText(e.to, e.label, '#ffffff', now, 3.4);
  }
  function floatText(to: { x: number; z: number }, text: string, colour: string, now: number, rise = 3) {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 80;
    const g = canvas.getContext('2d')!;
    g.font = "800 54px 'Trebuchet MS', sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(28,39,36,0.9)';
    let size = 54;
    while (g.measureText(text).width > 176 && size > 20) {
      size -= 4;
      g.font = `800 ${size}px 'Trebuchet MS', sans-serif`;
    }
    g.strokeText(text, 96, 42);
    g.fillStyle = colour;
    g.fillText(text, 96, 42);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sprite.scale.set(2.2, 0.92, 1);
    sprite.renderOrder = 6;
    const x = to.x + (Math.random() - 0.5) * 1.2,
      z = to.z + (Math.random() - 0.5) * 1.2;
    sprite.position.set(x, rise, z);
    root.add(sprite);
    const LIFE = 1700;
    running.push({
      meshes: [sprite],
      step(t) {
        const k = (t - now) / LIFE;
        if (k >= 1) return false;
        sprite.position.y = rise + k * 2.2;
        sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        return true;
      },
    });
  }

  /** A muzzle flash: a quick orange pop and a few sparks where the shot leaves. */
  function muzzle(from: GroundPoint, to: GroundPoint, height: number, now: number, big: boolean) {
    const a = v3(from, height);
    const dir = v3(to, height).sub(a).normalize();
    const flash = add(unit, glow(ORANGE));
    flash.position.copy(a).addScaledVector(dir, 0.3);
    const start = now;
    running.push(
      {
        meshes: [flash],
        step(t) {
          const f = Math.min(1, (t - start) / (big ? 160 : FLASH_MS));
          flash.scale.setScalar((big ? 0.7 : 0.35) * (1 - f) + 0.05);
          (flash.material as THREE.MeshBasicMaterial).opacity = 1 - f;
          return f < 1;
        },
      },
      sparks(a.clone().addScaledVector(dir, 0.35), now, big ? 6 : 3, YELLOW, 1.4),
    );
  }

  return {
    local(s, now) {
      if (full()) return;
      if (s.gun === 'blaster') shot({ id: -1, kind: 'shot', at: 0, from: s.from, to: s.to, fromHeight: s.fromHeight, height: 1.2, label: 'blaster' }, now);
      else muzzle(s.from, s.to, s.fromHeight, now, true);
    },
    play(e, now, _reduced, colour) {
      // Too much going on at once: the newest small things are skipped rather than the frame rate.
      if (full() && e.kind !== 'collapse' && e.kind !== 'coins') return;
      if (e.kind === 'coins') coins(e, now);
      else if (e.kind === 'shell') shell(e, now);
      else if (e.kind === 'hit') hit(e, now, colour ?? DEBRIS[0]);
      else if (e.kind === 'collapse') collapse(e, now, colour ?? DEBRIS[0]);
      else if (e.kind === 'pop') pop(e, now);
      else if (e.kind === 'burst' && e.to) {
        // A bit's flourish: a puff of smoke (a teleport), sparkles, confetti, hearts.
        const at = v3(e.to, 1);
        if (e.label === 'smoke') running.push(puff(at, now, 1.4), puff(v3(e.to, 0.4), now, 1));
        else if (e.label === 'confetti') for (const c of [0xe0523f, 0xe9c23c, 0x57d64a, 0x5fb3e8, 0xb07ad9]) running.push(sparks(at, now, 6, c, 3.2));
        else if (e.label === 'hearts') running.push(sparks(v3(e.to, 1.6), now, 12, 0xe07aa8, 1.6), sparks(v3(e.to, 1.6), now, 6, 0xff3f6c, 1.2));
        else running.push(sparks(v3(e.to, 1.4), now, 16, 0xfff1a0, 2.4), sparks(v3(e.to, 1.4), now, 8, 0xffffff, 1.8));
      }
      else if (e.kind === 'shot') shot(e, now);
      else if (e.kind === 'throw') lob(e, now);
      else if (e.kind === 'boom') boom(e, now);
      else if (e.kind === 'splash' && e.from) {
        // White water: a spray of droplets and a little foam.
        const at = v3(e.from, 0.1);
        running.push(sparks(at, now, 14, 0xd8eeff, 2.6), sparks(at, now, 8, 0x5fb3e8, 1.8), puff(at, now, 0.7));
      } else if (e.kind === 'slam' && e.from) {
        // A heavy blow on the ground: dust and a shudder.
        const r = Math.max(1, Math.min(8, e.radius ?? 4));
        quakes.push({ at: now, x: e.from.x, z: e.from.z, radius: r * 0.6 });
        const at = v3(e.from, 0.2);
        running.push(puff(at, now, r * 0.6), sparks(at, now, 12, 0x9a8a6a, r * 0.7));
      }
      // 'bomb' is drawn from the snapshot (syncBombs); 'ko' is the figure's own (dudes.ts, from `ko`);
      // 'shake' is the objects layer's.
    },
    syncBombs(effects) {
      const seen = new Set<number>();
      for (const e of effects) {
        if (e.kind !== 'bomb' || !e.from || e.until === undefined) continue;
        seen.add(e.id);
        if (!bombs.has(e.id)) bombs.set(e.id, newBomb(e));
      }
      // A bomb that has left the list has gone off (its boom is its own effect) or was defused.
      for (const [id, b] of bombs)
        if (!seen.has(id)) {
          free([b.group]);
          bombs.delete(id);
        }
    },
    update(now, serverNow, reduced) {
      for (let i = running.length - 1; i >= 0; i--) {
        const r = running[i];
        if (!r.step(now)) {
          free(r.meshes);
          running.splice(i, 1);
        }
      }
      for (const [id, b] of bombs) {
        const left = b.until - serverNow;
        if (left <= 0) {
          free([b.group]);
          bombs.delete(id);
          continue;
        }
        // The fuse fizzes, and the bomb pulses faster as it runs down.
        const span = Math.max(500, b.until - b.at);
        const urgency = 1 - Math.min(1, left / span);
        const rate = 0.006 + urgency * 0.03;
        const pulse = reduced ? 1 : 1 + Math.abs(Math.sin(now * rate)) * (0.06 + 0.1 * urgency);
        b.body.scale.setScalar(0.44 * pulse);
        b.spark.scale.setScalar(reduced ? 0.1 : 0.07 + Math.random() * 0.08);
        (b.spark.material as THREE.MeshBasicMaterial).color.setHex(Math.random() < 0.5 || reduced ? YELLOW : ORANGE);
      }
    },
    shake(now, focus) {
      let x = 0,
        z = 0;
      for (let i = quakes.length - 1; i >= 0; i--) {
        const q = quakes[i];
        const age = now - q.at;
        if (age > SHAKE_MS) {
          quakes.splice(i, 1);
          continue;
        }
        // Stronger for a bigger blast nearer the middle of the view, dying out over half a second.
        const near = Math.max(0, 1 - Math.hypot(q.x - focus.x, q.z - focus.z) / (q.radius * 8 + 20));
        const amp = 0.06 * q.radius * near * (1 - age / SHAKE_MS);
        x += Math.sin(now * 0.09 + i) * amp;
        z += Math.cos(now * 0.11 + i * 2) * amp;
      }
      return { x, z };
    },
    dispose() {
      for (const r of running) free(r.meshes);
      running.length = 0;
      for (const b of bombs.values()) free([b.group]);
      bombs.clear();
      unit.dispose();
      cube.dispose();
      ringGeometry.dispose();
      parent.remove(root);
    },
  };
}
