// The show runtime (FK-017): story scenes played from `city.story.scene`, with holds and the Call.
// Until it lands this file holds the view's piece and the release every exit runs: at every boot
// (index.ts `start`), at Story OFF (FK-002) and on a panic exit (FK-017, FK-037).
import type { TownView } from '../../../shared/dudesTypes';
import type { DudesState } from '../state';

/** What the show puts on the page: the story scene playing (as `scene`), the banner, the prompt, the NOW card. */
export function showView(_state: DudesState, _now: number): Partial<TownView> {
  return {};
}

/**
 * Let everyone go: end the story scene, call off every gathering, and give the head his WASD and his
 * visibility back. Run at every boot, Story on or off, so a crash mid-scene never boots into a frozen
 * town. Returns how many things it let go, for the log.
 */
export function releaseShow(state: DudesState): number {
  let n = 0;
  const story = state.city?.story;
  if (story?.scene) {
    story.scene = undefined;
    n++;
  }
  for (const d of state.dudes)
    if (d.gather) {
      d.gather = undefined;
      n++;
    }
  const m = state.mayor;
  if (m?.lock) {
    m.lock = undefined;
    n++;
  }
  if (m?.forcedHidden) {
    m.forcedHidden = undefined;
    n++;
  }
  return n;
}
