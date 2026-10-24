// Red and gold (FK-012): `red`, `gold` and `help`, only as the whole message, set `dude.side` for the
// age, log the join (`city.story.sideLog`) and start the side's job.
import type { DudeView } from '../../../shared/dudesTypes';
import type { Dude, DudesState } from '../state';

/** A chatter's side on the page (`side`: the disc and the tag's icon). */
export function sidesView(_state: DudesState, _d: Dude, _now: number): Partial<DudeView> {
  return {};
}
