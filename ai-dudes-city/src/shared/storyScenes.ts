// Finders Keepers' scenes (docs/story-bible-2026-10-24.md §6): the same script shape as the caravan's
// (shared/scenes.ts), played by the show runtime (story/show.ts) and by the page (client/dudes/main.ts
// looks here first, then in SCENES). Their ids are their own, never one of the saved `city.scene` ids,
// so a new scene never touches the save. Zero AI.
import { PITCH_DEFAULT, YAW_DEFAULT, type Scene } from './scenes';
import { STORY_SITES } from './storyMap';

const folly = STORY_SITES.folly.at;

export const STORY_SCENES: Record<string, Scene> = {
  // A check that the runtime and the page play a story scene end to end (Story (dev) → Play: test):
  // a wide on the Folly's plot, a slow push in, back out to the usual angle, and one subtitle.
  test: {
    id: 'test',
    ms: 10_000,
    shots: [
      { at: 0, move: 2500, pose: { focus: [folly.x, 0.5, folly.z], yaw: YAW_DEFAULT, pitch: PITCH_DEFAULT, half: 18 } },
      { at: 3000, move: 3500, pose: { focus: [folly.x, 1, folly.z + 2], yaw: YAW_DEFAULT + 0.2, pitch: 0.42, half: 10 } },
      { at: 7000, move: 3000, pose: { focus: [folly.x, 0, folly.z + 6], yaw: YAW_DEFAULT, pitch: PITCH_DEFAULT, half: 24 } },
    ],
    lines: [{ at: 1500, ms: 6000, who: 'Test', text: 'The story runtime is playing.' }],
    beats: [],
  },
};
