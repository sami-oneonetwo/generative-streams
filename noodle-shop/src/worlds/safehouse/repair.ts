// What Rook fixes on his own when nobody is asking for anything. Pure
// selection; the job machinery in index.ts does the walking and hammering.
import type { GroundPoint, SafehouseObject } from '../../shared/safehouseTypes';
import { HOUSE_ID } from '../../shared/safehouseLayout';
import { intact, isHostile } from './combat';

export type RepairOperation = 'repair' | 'rebuild';
export interface RepairPick {
  object: SafehouseObject;
  operation: RepairOperation;
  /** Health to restore; drives how long the hammering takes. */
  missing: number;
}
/** Rebuilding an archived piece adds an object; leave headroom under the schema cap of 300. */
export const MAX_REBUILD_OBJECTS = 290;
/** Repair time grows with the damage: a fence takes seconds, the house from rubble a minute and a half. */
export const repairMs = (missing: number): number => Math.min(90000, Math.max(4000, missing * 40));

const maxHealth = (o: SafehouseObject) => o.maxHealth ?? 80;
export const missingHealth = (o: SafehouseObject): number =>
  intact(o) ? maxHealth(o) - (o.health ?? maxHealth(o)) : maxHealth(o);
/**
 * Scratches are left alone; his own house gets attention sooner than anything else.
 * A rampaging creature is the one thing he will not patch up or bring back, and he
 * does not chase flyers with a hammer: a downed one can be rebuilt on request.
 */
export const needsRepair = (o: SafehouseObject): boolean =>
  !o.passable &&
  !isHostile(o) &&
  !o.creature?.flying &&
  (!intact(o) || (o.health ?? maxHealth(o)) < maxHealth(o) * (o.id === HOUSE_ID ? 0.9 : 0.7));
// His house → community defenses → the fence → other community creations → the rest of the neighborhood.
const tier = (o: SafehouseObject): number =>
  o.id === HOUSE_ID
    ? 0
    : !o.fixed && (o.role === 'turret' || o.role === 'barrier')
      ? 1
      : o.id.startsWith('fence-')
        ? 2
        : !o.fixed
          ? 3
          : 4;

export function pickRepairTarget(
  objects: SafehouseObject[],
  archive: SafehouseObject[],
  from: GroundPoint,
  skip: (id: string) => boolean = () => false,
): RepairPick | undefined {
  const canRebuild = objects.length < MAX_REBUILD_OBJECTS;
  const candidates = [
    ...objects.filter(needsRepair),
    ...(canRebuild ? archive.filter((o) => !o.passable && !isHostile(o) && !o.creature?.flying) : []),
  ].filter((o) => !skip(o.id));
  const distance = (o: SafehouseObject) => Math.hypot(o.position.x - from.x, o.position.z - from.z);
  candidates.sort(
    (a, b) =>
      tier(a) - tier(b) ||
      Number(intact(a)) - Number(intact(b)) || // knocked-down pieces before scuffed ones
      distance(a) - distance(b),
  );
  const object = candidates[0];
  if (!object) return undefined;
  return { object, operation: intact(object) ? 'repair' : 'rebuild', missing: missingHealth(object) };
}
