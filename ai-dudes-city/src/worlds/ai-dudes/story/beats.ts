// The show's beat queue (FK-037: `city.story.cue`, locked / armed / firing / done) and the operator
// page's show keys. Everything /mayor sends as `{t:'show', k, …}` lands here untouched (mayor.ts only
// passes it on), so FK-035's holds and cue lines and FK-037's GO, cancel and panic add their kinds
// here, never in mayor.ts.
import { storyOn, type DudesState } from '../state';

/** A show key from the operator page: `k` says which (`tab`, `cue`, `go`, `cancel`, `panic` …); the rest belongs to that key. */
export interface ShowInput {
  t: 'show';
  k: string;
  /** `tab`: held down, or let go. */
  down?: boolean;
  /** `cue`: which line, 1 to 3. */
  n?: number;
}

/** Act on a show key. False when there was nothing to do (Story off, a kind not built yet): nothing is broadcast. */
export function onShowInput(state: DudesState, input: ShowInput, _now: number): boolean {
  if (!storyOn(state)) return false;
  switch (input.k) {
    // FK-035: `tab`, `cue`. FK-037: `go`, `cancel`, `panic`.
    default:
      return false;
  }
}
