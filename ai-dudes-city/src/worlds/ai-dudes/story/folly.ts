// The head's Folly (FK-023): one per age on STORY_SITES.folly, under wraps behind its cordon, filling
// on a timer (`city.story.folly`) with the gold side's names on its plaque until the Unveiling.
import type { TownView } from '../../../shared/dudesTypes';
import type { DudesState } from '../state';

/** The Folly on the page (`folly`: how far, the plaque). */
export function follyView(_state: DudesState, _now: number): Partial<TownView> {
  return {};
}
