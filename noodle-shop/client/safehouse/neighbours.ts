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
}
const headPoint = new THREE.Vector3();

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
    return { parts, track: new Track(), tag, say, sayText: '', sayUntil: 0, view };
  }
  function remove(id: string) {
    const f = figures.get(id);
    if (!f) return;
    disposeObject3D(f.parts.group);
    f.tag.remove();
    f.say.remove();
    figures.delete(id);
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
        // "Jake · project car", not "Jake · Jake's project car".
        const doing = v.job?.label.replace(new RegExp(`^${v.name}['’]s\\s+`), '');
        // What they are doing beats what they are doing it for: the theme shows while they idle.
        f.tag.textContent = doing ? `${v.name} · ${doing}` : v.theme ? `${v.name} · ${v.theme}` : v.name;
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
        const p = f.track.at(renderTime);
        const g = f.parts.group;
        if (p) {
          g.position.x = p.x;
          g.position.z = p.z;
          g.rotation.y = p.facing;
        }
        const activity = p?.tag ?? f.view.activity;
        const walking = live && !!p?.moving;
        const hammering = live && !walking && (activity === 'building' || activity === 'repairing');
        const painting = live && !walking && activity === 'painting';
        const tending = live && !walking && activity === 'tending';
        f.parts.rightArm.rotation.x = reduced
          ? -0.2
          : hammering
            ? -0.6 + Math.sin(now * 0.0075) * 0.55
            : painting
              ? -1.1 + Math.sin(now * 0.003) * 0.45
              : tending
                ? -0.9
                : -0.2;
        f.parts.leftArm.rotation.x = walking && !reduced ? Math.sin(now * 0.0065) * 0.25 : tending ? -0.9 : -0.2;
        g.rotation.x = tending && !reduced ? 0.22 : 0;
        g.position.y = 0.13 + (walking && !reduced ? Math.sin(now * 0.011) * 0.025 : 0) - (tending ? 0.06 : 0);
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
