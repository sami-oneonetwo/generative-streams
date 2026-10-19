// Builds on the drawing board: while a character's design is queued or being drawn up, the spot on
// their lot where it will go is marked out like a site being surveyed. A glowing blueprint grid on
// the grass, four stakes with string between them, the whole thing breathing gently, so the
// stream can see that something is coming and where. It goes when the build starts (the ghost
// takes over, objects.ts).
import * as THREE from 'three';
import type { DudeView } from './types';

const SIZE = 7;
const STAKE = 0xe07a4a,
  STRING = 0xf2e6c8;

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(40,104,190,0.85)';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(230,240,255,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  g.strokeStyle = 'rgba(230,240,255,0.95)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 250);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface PlansHandles {
  /** From every applied snapshot: who has a design on the board, and where it goes. */
  sync(dudes: Pick<DudeView, 'id' | 'job'>[]): void;
  update(now: number, reduced: boolean): void;
}

export function createPlansLayer(parent: THREE.Object3D): PlansHandles {
  const root = new THREE.Group();
  parent.add(root);
  const tex = gridTexture();
  const matGeo = new THREE.PlaneGeometry(SIZE, SIZE);
  const stakeGeo = new THREE.BoxGeometry(0.1, 0.7, 0.1);
  const stakeMat = new THREE.MeshStandardMaterial({ color: STAKE, roughness: 0.8 });
  const stringMat = new THREE.MeshBasicMaterial({ color: STRING });
  const sites = new Map<string, { group: THREE.Group; mat: THREE.MeshBasicMaterial; born: number; size: number }>();

  function site(): { group: THREE.Group; mat: THREE.MeshBasicMaterial } {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const plane = new THREE.Mesh(matGeo, mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.04;
    plane.renderOrder = 1;
    group.add(plane);
    const h = SIZE / 2;
    for (const [x, z] of [[-h, -h], [h, -h], [h, h], [-h, h]]) {
      const stake = new THREE.Mesh(stakeGeo, stakeMat);
      stake.position.set(x, 0.35, z);
      stake.castShadow = true;
      group.add(stake);
    }
    for (const [x, z, w, d] of [[0, -h, SIZE, 0.03], [0, h, SIZE, 0.03], [-h, 0, 0.03, SIZE], [h, 0, 0.03, SIZE]]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), stringMat);
      line.position.set(x, 0.55, z);
      group.add(line);
    }
    return { group, mat };
  }

  return {
    sync(dudes) {
      const want = new Map<string, { x: number; z: number; size: number }>();
      for (const d of dudes) {
        const j = d.job;
        if (j && j.kind === 'build' && (j.status === 'queued' || j.status === 'designing') && j.at) want.set(d.id, { ...j.at, size: j.site ?? SIZE });
      }
      for (const [id, s] of sites)
        if (!want.has(id)) {
          root.remove(s.group);
          s.mat.dispose();
          s.group.traverse((o) => o instanceof THREE.Mesh && o.geometry !== matGeo && o.geometry !== stakeGeo && o.geometry.dispose());
          sites.delete(id);
        }
      for (const [id, at] of want) {
        let s = sites.get(id);
        if (!s) {
          s = { ...site(), born: performance.now(), size: at.size };
          root.add(s.group);
          sites.set(id, s);
        }
        s.size = at.size;
        s.group.position.set(at.x, 0, at.z);
      }
    },
    update(now, reduced) {
      for (const s of sites.values()) {
        // Unrolls in over half a second, then breathes.
        const k = Math.min(1, (now - s.born) / 500);
        // Marked out at the size of the space it has (stakes keep their height).
        const f = (s.size / SIZE) * (reduced ? 1 : 0.6 + 0.4 * k);
        s.group.scale.set(f, 1, f);
        s.mat.opacity = reduced ? 0.85 : (0.72 + 0.18 * Math.sin(now * 0.003)) * k;
      }
    },
  };
}
