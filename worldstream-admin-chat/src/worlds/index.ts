// Static world registry. The WORLD env var selects at boot; each world's
// snapshot is stored per world id, so switching never clobbers another
// world's state. This file (plus src/index.ts) is the only place outside
// src/worlds/ allowed to import a world package.

import type { WorldModule } from '../engine/world';
import { serverRoomWorld } from './server-room';
import { noodleShopWorld } from './noodle-shop';
import { blankWorld } from './blank';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const worlds: Record<string, WorldModule<any>> = {
  'server-room': serverRoomWorld,
  'noodle-shop': noodleShopWorld,
  blank: blankWorld,
};
