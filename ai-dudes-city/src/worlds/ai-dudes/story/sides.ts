// Red and gold (FK-012): `red`, `gold` and `help`, only as the whole message, set `dude.side` for the
// age, log the join (`city.story.sideLog`) and start the side's job.
import type { DudeView } from '../../../shared/dudesTypes';
import { ageOf } from '../city';
import type { Dude, DudesState, Side } from '../state';

/** The side a chatter is on this age, if any: one taken in an earlier age doesn't count, as on the Folly's
 * plaque (story/folly.ts carve). The Board's tally (FK-011) counts by it. */
export function sideNow(state: DudesState, d: Dude): Side | undefined {
  if (!d.side) return undefined;
  const age = ageOf(state);
  return (d.sideAge ?? age) === age ? d.side : undefined;
}

/** A chatter's side on the page (`side`: the disc and the tag's icon). */
export function sidesView(_state: DudesState, _d: Dude, _now: number): Partial<DudeView> {
  return {};
}
