// Local type re-exports for the safehouse client. Keeps every other module
// importing from one place instead of reaching into src/shared directly.

export type { ServerMsg } from '../../src/shared/protocol';
export type { Scene, SpeechBubble } from '../../src/shared/sceneTypes';
export type {
  Blueprint,
  CombatView,
  CrowdView,
  GroundPoint,
  HoopsRow,
  VerbView,
  VerbPose,
  WorldEffect,
  JobStatus,
  PartAnimation,
  Primitive,
  SafehouseJobView,
  SafehouseObject,
  SafehouseObjectView,
  SafehouseScene,
  Vec3,
} from '../../src/shared/safehouseTypes';
export { partsKey } from '../../src/shared/safehouseTypes';
