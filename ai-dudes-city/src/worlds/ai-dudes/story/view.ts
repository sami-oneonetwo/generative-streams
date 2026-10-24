// Finders Keepers on the page. One spread each into townView (city.ts), dudeView (index.ts) and
// mayorView (mayor.ts), wired once (FK-001), so no lane edits another's file for its view: each piece
// comes from its own lane's file (show and spotlight: A; cast and folly: B; board, strip and sides: E).
// None of them runs while Story is off, so Story OFF sends exactly today's view.
import type { DudeView, MayorView, TownView } from '../../../shared/dudesTypes';
import { storyOn, type Dude, type DudesState } from '../state';
import { boardView, mayorStripView } from './board';
import { castView } from './cast';
import { follyView } from './folly';
import { showView } from './show';
import { sidesView } from './sides';
import { spotlightView } from './spotlight';

/** The town's story pieces. Spread last in townView, so a story scene (showView's `scene`) overrides the caravan's. */
export function storyTownView(state: DudesState, now: number): Partial<TownView> {
  if (!storyOn(state)) return {};
  return { story: true, ...castView(state, now), ...follyView(state, now), ...boardView(state, now), ...spotlightView(state, now), ...showView(state, now) };
}

/** A chatter's story pieces: their side. */
export function storyDudeView(state: DudesState, d: Dude, now: number): Partial<DudeView> {
  if (!storyOn(state)) return {};
  return sidesView(state, d, now);
}

/** The head's story pieces: put on his mark (FK-020 sets the lock), and the show strip. */
export function storyMayorView(state: DudesState, now: number): Partial<MayorView> {
  if (!storyOn(state)) return {};
  const lock = state.mayor?.lock;
  return { ...(lock ? { lock: { at: lock.at, facing: lock.facing } } : {}), ...mayorStripView(state, now) };
}
