// "Your home through the ages" (FK-049): a returning chatter's home is spotlighted on their first line
// in a new age, and the three oldest after Moss's "Previously". Until it lands, nothing to show.
import type { TownView } from '../../../shared/dudesTypes';
import type { DudesState } from '../state';

/** The home in the spotlight right now (`spotlight`: whose, which build, its names through the ages). */
export function spotlightView(_state: DudesState, _now: number): Partial<TownView> {
  return {};
}
