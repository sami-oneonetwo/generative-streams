// Static world registry. The WORLD env var selects at boot; each world's
// snapshot is stored per world id. This file (plus src/index.ts) is the only
// place outside src/worlds/ allowed to import a world package.

import type { WorldModule } from '../engine/world';
import { aiDudesWorld } from './ai-dudes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const worlds: Record<string, WorldModule<any>> = {
  'ai-dudes': aiDudesWorld,
};
