// Local type re-exports for the dudes client. Keeps every other module importing from one place
// instead of reaching into src/shared directly.

export type { ServerMsg } from '../../src/shared/protocol';
export type {
  Blueprint,
  GroundPoint,
  PartAnimation,
  Primitive,
  SafehouseObject,
  SafehouseObjectView,
  Vec3,
} from '../../src/shared/objectTypes';
export { partsKey, shortRef } from '../../src/shared/objectTypes';
export type {
  Accessory,
  DudeActivity,
  DudeLook,
  DudeView,
  DudesScene,
  Emote,
  FeedItem,
  FieldEffect,
  ScoreRow,
  WishView,
  TownView,
  MayorView,
  Hat,
  JobKind,
  JobStatus as DudeJobStatus,
} from '../../src/shared/dudesTypes';
export { CITY_BOUNDS, SQUARE } from '../../src/shared/city';
export { TOWN_GROUND } from '../../src/shared/city'; // hook FK-078: the town's side of the river, River Bank and all
