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

/** The Folly's front (+Z) edge, where its tiny door is. */
const front = folly.z + STORY_SITES.folly.size / 2 - 1;

/**
 * The Unveiling v0 (FK-025, bible §6): the Call gathers everyone (story/gather.ts callRing), then a wide
 * from behind the crowd, a slow push in, the head's line, the tarp drops (`unveil`: the page drops it,
 * dust and confetti) with the camera still, the title card and RATE IT, a pan past to the tiny door, the
 * pivot to Wren far off at her vantage (`at`: the far bank while the bridge is down, else the ring road),
 * her line, and out wide; the NOW card follows as the crowd is let go.
 */
function unveilScene(id: string, at: { x: number; z: number }): Scene {
  // Wren faces the Folly; the camera stands on the Folly's side of her, so we see her face, small.
  const toFolly = Math.atan2(folly.x - at.x, folly.z - at.z);
  return {
    id,
    ms: 34_000,
    shots: [
      // U1: wide, from behind the crowd.
      { at: 0, move: 3000, pose: { focus: [folly.x, 3, folly.z + 6], yaw: 0.15, pitch: 0.42, half: 17 } },
      // U2: a slow push in on the tarp.
      { at: 3500, move: 5000, pose: { focus: [folly.x, 4, folly.z + 4], yaw: 0.05, pitch: 0.38, half: 12 } },
      // U3: the reveal holds still (motion budget: only the tarp, the dust and the build move). U5: a slow pan past.
      { at: 13_000, move: 5000, pose: { focus: [folly.x + 1, 3.5, folly.z + 4], yaw: -0.3, pitch: 0.36, half: 11 } },
      // The tiny door.
      { at: 18_500, move: 2000, pose: { focus: [folly.x, 1, front], yaw: 0.55, pitch: 0.22, half: 3.4 } },
      // U7: Wren, far off, watching.
      { at: 22_000, move: 2500, pose: { focus: [at.x, 1, at.z], yaw: toFolly, pitch: 0.28, half: 4.5 } },
      // U9: out wide, back towards the usual angle.
      { at: 29_000, move: 4500, pose: { focus: [folly.x, 0, folly.z + 8], yaw: YAW_DEFAULT, pitch: PITCH_DEFAULT, half: 26 } },
    ],
    lines: [
      { at: 1500, ms: 2600, who: '{head}', text: 'Behold!' },
      { at: 4600, ms: 3400, who: '{head}', text: 'A hut fit for me. Only me.' },
      { at: 9000, ms: 4000, text: '{follyTitle}', title: true },
      { at: 19_000, ms: 2600, who: '{head}', text: 'Mind the door.' },
      { at: 24_000, ms: 4200, who: 'Wren', text: 'That was our fire.' },
    ],
    beats: [
      { at: 0, do: 'wren', who: 0 },
      { at: 8500, do: 'unveil', who: 0 },
      { at: 8800, do: 'crowd', who: 0, pose: 'cheer', ms: 3500 },
      { at: 23_500, do: 'wren', who: 0, pose: 'point', ms: 2500 },
    ],
    prompt: { kind: 'rate', label: 'RATE IT', at: 9500, ms: 12_000 },
    now: { word: 'BRIDGE', chip: 'type red', side: 'red' },
    lockMs: LOCK_CAPS.unveiling,
  };
}

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
  // The Unveiling (FK-025 v0): Wren across the river while the bridge is down, on the ring road once it stands.
  unveil: unveilScene('unveil', STORY_SITES.wrenVantage.far),
  'unveil-near': unveilScene('unveil-near', STORY_SITES.wrenVantage.near),
};
