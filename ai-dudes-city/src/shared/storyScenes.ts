// Finders Keepers' scenes (docs/story-bible-2026-10-24.md §6): the same script shape as the caravan's
// (shared/scenes.ts), played by the show runtime (story/show.ts) and by the page (client/dudes/main.ts
// looks here first, then in SCENES). Their ids are their own, never one of the saved `city.scene` ids,
// so a new scene never touches the save. Zero AI.
import { LOCK_CAPS, PITCH_DEFAULT, YAW_DEFAULT, type Scene } from './scenes';
import { STORY_SITES } from './storyMap';

const folly = STORY_SITES.folly.at;
const fire = STORY_SITES.wrenFire.at;

/**
 * Wren's Rally (FK-026, story/rally.ts plays it): the Call (whistle, "WREN'S FIRE · type coming") for
 * `callMs`, while comers walk to her fire; then the letterbox on Wren and the small group, her two lines,
 * "Him or us? · type us" from `askAt` (each "us" a red pip), the NOW card from `nowAt`, and the release.
 * The page gets the scene only from `callMs` (rally.ts rallyView), so its shots and lines start there.
 */
export const RALLY = { callMs: 20_000, askAt: 30_500, nowAt: 42_000, ms: 48_000, comers: 6 } as const;
/** Where Wren stands to speak: just behind her fire, facing the group (+Z). */
export const WREN_MARK = { at: { x: fire.x, z: fire.z - 1.4 }, facing: 0 };
/** What Wren says at her fire: two of these, picked per rally (bible §6, stream 1). */
export const RALLY_LINES = [
  'He says the bridge was like that.',
  'A big hat and a plan for one.',
  "He's not wicked. He's just not serious.",
  'There are more of us than him. Remember that.',
] as const;

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
    // hook FK-017: the runtime's beats: the age's leader waves, then the next of the cast cheers (if they're in town).
    beats: [
      { at: 1000, do: 'emote', who: 0, pose: 'wave', ms: 2500 },
      { at: 6000, do: 'emote', who: 1, pose: 'cheer', ms: 2500 },
    ],
  },
  rally: {
    id: 'rally',
    ms: RALLY.ms,
    lockMs: LOCK_CAPS.rally,
    shots: [
      // R1 low and wide on the fire and whoever came; R2 Wren close; R3 over her shoulder onto the group; out a little for the NOW card.
      { at: RALLY.callMs, move: 1500, pose: { focus: [fire.x, 0.8, fire.z + 1.5], yaw: 0.25, pitch: 0.32, half: 7 } },
      { at: 23_500, move: 2500, pose: { focus: [WREN_MARK.at.x, 1, WREN_MARK.at.z + 0.2], yaw: 0.15, pitch: 0.26, half: 3.2 } },
      { at: 30_000, move: 2500, pose: { focus: [fire.x, 0.9, fire.z + 2], yaw: Math.PI - 0.35, pitch: 0.3, half: 5.5 } },
      { at: RALLY.nowAt - 500, move: 2000, pose: { focus: [fire.x, 0.8, fire.z + 1], yaw: 0.25, pitch: 0.38, half: 8 } },
    ],
    lines: [
      { at: 21_500, ms: 3800, who: 'Wren', text: '{w1}' },
      { at: 26_000, ms: 3800, who: 'Wren', text: '{w2}' },
      { at: RALLY.askAt, ms: 3000, who: 'Wren', text: 'Him or us?' },
    ],
    beats: [],
  },
};
