// The band who stay through every age (FK-014): Wren, Ash, Moss, Oak and Kit as townies with a
// `role` and a `cast-<role>` id, spawned while Story is on and spared by the caravan's wipes.
import type { TownView } from '../../../shared/dudesTypes';
import type { DudesState } from '../state';

/** The cast on the page (`cast`: their ids and the role on their tags). */
export function castView(_state: DudesState, _now: number): Partial<TownView> {
  return {};
}
