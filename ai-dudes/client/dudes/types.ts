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
  Hat,
  JobKind,
  JobStatus as DudeJobStatus,
} from '../../src/shared/dudesTypes';
export { FIELD } from '../../src/shared/layout';
