// Where Finders Keepers happens: the Folly's plot and the band's old camp, the head's mark, the crowd's
// ring, Wren's fire and her vantage points, and the red site sign. The same on the server and the page,
// and the only place any lane reads story coordinates from: if Sami picks a new layout
// (board/layout-options.md), only these numbers move. Zero AI.
//
// M1's sites are provisional (layout-options.md §1): the corner blocks are parks with no lots
// (shared/city.ts `isPark`), so the SE park by the river takes the Folly without touching anyone's lot.
// Metres; x is east, z is south. Facings are radians as everywhere else, atan2(dx, dz): 0 faces +Z.
import type { Rect } from './layout';

const FOLLY = { x: 54, z: 40, size: 16 };
const CROWD = { x: 54, z: 50, inner: 8, outer: 14 };

export const STORY_SITES = {
  /** The Folly's plot, 16 m square, its front facing +Z: the old camp's plot until the cordon goes up. */
  folly: {
    at: { x: FOLLY.x, z: FOLLY.z },
    facing: 0,
    size: FOLLY.size,
    rect: { minX: FOLLY.x - FOLLY.size / 2, maxX: FOLLY.x + FOLLY.size / 2, minZ: FOLLY.z - FOLLY.size / 2, maxZ: FOLLY.z + FOLLY.size / 2 } satisfies Rect,
  },
  /** The band's old camp, on the same plot: the hearth at the plot's front edge. */
  camp: { at: { x: FOLLY.x, z: FOLLY.z + FOLLY.size / 2 } },
  /** Where the head stands at an Unveiling, between the tarp and the crowd, facing the tarp. */
  headMark: { at: { x: 54, z: 50.5 }, facing: Math.PI },
  /**
   * The gathering ring for an Unveiling: slots `inner` to `outer` metres from `at`, on the side the
   * bearing `side` points to (+Z), everyone facing `at`. Gold in front, red at the back (story/gather.ts).
   */
  crowd: {
    at: { x: CROWD.x, z: CROWD.z },
    inner: CROWD.inner,
    outer: CROWD.outer,
    side: 0,
    rect: { minX: CROWD.x - CROWD.outer, maxX: CROWD.x + CROWD.outer, minZ: CROWD.z, maxZ: CROWD.z + CROWD.outer } satisfies Rect,
  },
  /** Wren's rally fire after the band crosses, in the NE corner park: far enough that the head is 30+ m away. */
  wrenFire: { at: { x: 52, z: -40 } },
  /** Wren's pivot spot: on the far bank before the bridge is mended (~44 m from the Folly), then on the ring road. */
  wrenVantage: { far: { x: 97, z: 30 }, near: { x: 69, z: 20 } },
  /** Oak under the floating "BRIDGE 3/8" pennant, at the town end of the bridge. */
  redSign: { at: { x: 67, z: 6 } },
};

/** Ground no build may take while the story runs (FK-023 adds these to sim.ts `reserved()`): the Folly's plot and the crowd's ring. */
export const STORY_RECTS: Rect[] = [STORY_SITES.folly.rect, STORY_SITES.crowd.rect];
