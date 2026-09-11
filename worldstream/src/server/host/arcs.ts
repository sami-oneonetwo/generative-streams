// Stories are chains of arc-only hooks. The engine runs one at a time per world.
import type { World } from '../../shared/state.js';

export interface Arc {
  id: string;
  world: World;
  steps: string[];
  cooldownMs: number;
  /** Said when the last step completes. */
  ending?: string;
}

export const ARCS: Arc[] = [
  { id: 'missing_cat', world: 'cyberpunk', steps: ['arc_cat_missing', 'arc_cat_name', 'arc_cat_stays', 'arc_cat_dog'], cooldownMs: 90 * 60_000, ending: 'that is enough excitement for one cat.' },
  { id: 'water_run', world: 'desert', steps: ['arc_thirst', 'arc_water_name', 'arc_camel'], cooldownMs: 90 * 60_000, ending: 'water, a name, a ride. the desert is almost a home.' },
];
