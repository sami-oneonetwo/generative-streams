import type { SceneEntity } from '../../../src/shared/sceneTypes';

import { STILL_EFFECTS, type FrameEffects } from '../chaos';

export type DrawFn = (g: CanvasRenderingContext2D, e: SceneEntity, now: number, effects: FrameEffects) => void;

// THE swap point for real art: replace or re-register draw functions per
// entity kind and nothing else in the system changes.
const registry = new Map<string, DrawFn>();

export function register(kind: string, fn: DrawFn): void {
  registry.set(kind, fn);
}

const fallback: DrawFn = (g, e) => {
  g.fillStyle = '#2a2f38';
  g.fillRect(e.x, e.y, e.w, e.h);
  g.strokeStyle = '#4a5160';
  g.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
  g.fillStyle = '#8a93a5';
  g.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(e.kind, e.x + e.w / 2, e.y + e.h / 2);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
};

export function drawEntity(g: CanvasRenderingContext2D, e: SceneEntity, now: number, effects = STILL_EFFECTS): void {
  (registry.get(e.kind) ?? fallback)(g, e, now, effects);
}
