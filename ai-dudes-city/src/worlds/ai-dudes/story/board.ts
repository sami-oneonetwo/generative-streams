// The Board across the top of the stream (FK-011; the page draws it in FK-010): the head's Folly in
// gold, Wren's ask in red, the tug line's tally and the ticker. And the operator page's show strip
// (FK-038): the next beat, its lamp, the cue cards. Until those land, nothing to show.
import type { MayorView, TownView } from '../../../shared/dudesTypes';
import type { DudesState } from '../state';

/** The Board (`board`). */
export function boardView(_state: DudesState, _now: number): Partial<TownView> {
  return {};
}

/** The show strip on the operator page (`show`). */
export function mayorStripView(_state: DudesState, _now: number): Partial<MayorView> {
  return {};
}
