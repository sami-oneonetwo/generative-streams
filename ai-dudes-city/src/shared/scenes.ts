// Cutscenes: short scripted moments the streamer triggers (the opening at the river) or the story
// plays on its own (the travellers crossing the mended bridge). The server holds which scene is on
// and when it started (city.scene); the page flies the camera through the shots, drops the letterbox
// and shows the lines as subtitles, all from the same script, so the stream and /mayor stay in step.
// Beats (someone steps forward, waves, sits) are the server's to play. Zero AI.
import { RIVER } from './city';
import type { GroundPoint } from './objectTypes';

/** The crossing: centre line, and the near (town) and far (camp) banks, metres. */
export const BRIDGE = { x: RIVER.x, z: 0, near: RIVER.x - RIVER.width / 2, far: RIVER.x + RIVER.width / 2 };

/** Where the stranded travellers stand on the far bank, by their place in the caravan: the leader at
 * the front, the daughter at his side, the rest behind. Everyone faces the town (west). */
export const STRANDED: GroundPoint[] = [
  { x: BRIDGE.far + 3.2, z: 0.55 },
  { x: BRIDGE.far + 3.0, z: -0.65 },
  { x: BRIDGE.far + 5.6, z: 2.3 },
  { x: BRIDGE.far + 6.2, z: -1.9 },
  { x: BRIDGE.far + 7.6, z: 0.6 },
  { x: BRIDGE.far + 8.4, z: -3.2 },
];
export const FACING_TOWN = -Math.PI / 2;
/** How far the leader steps forward to speak. */
export const STEP_FORWARD = 0.9;

/** The camera at one moment: where it looks, its turn (yaw), its tilt down (radians), its orthographic half-height. */
export interface CamPose {
  focus: [number, number, number];
  yaw: number;
  pitch: number;
  half: number;
}
/** The stream camera's usual tilt (main.ts CAM_UP over CAM_BACK) and turn. */
export const PITCH_DEFAULT = Math.atan2(36, 43);
export const YAW_DEFAULT = 0.65;

/** A shot: from `at` the camera moves to `pose` over `move` ms (eased), then holds. */
export interface Shot {
  at: number;
  move: number;
  pose: CamPose;
}
/** A line: a subtitle, said by `who` (shown before it), from `at` for `ms`. `{name}` in either is filled
 * from the scene's vars (the server's: the age, the heroes, the daughter's line …); a line that comes
 * out empty is skipped. `title` draws it as a big title card instead of a subtitle. */
export interface Line {
  at: number;
  ms: number;
  who?: string;
  text: string;
  title?: boolean;
}
/** Something the server does at a moment: the leader steps forward, someone waves or sits. */
export interface Beat {
  at: number;
  /**
   * `age`: the town turns into the next age now (the wave); `leave`: the old caravan heads back to camp; `launch`: the finale's fireworks.
   * A story scene's beats are played by the show runtime (story/show.ts SHOW_BEATS), which knows `step` and `emote` so far.
   */
  do: 'step' | 'emote' | 'age' | 'leave' | 'launch';
  /** The traveller's place in the caravan (0 the leader, 1 the daughter …); in a story scene, the age's cast in that order (story/cast.ts castIn). */
  who: number;
  pose?: 'wave' | 'sit' | 'point' | 'shrug' | 'think' | 'cheer';
  ms?: number;
}
export interface Scene {
  /** The caravan's are SceneIds; a story scene (shared/storyScenes.ts) has its own. */
  id: string;
  ms: number;
  shots: Shot[];
  lines: Line[];
  beats: Beat[];
  /** A story scene's hard lock cap (LOCK_CAPS): the longest it may hold the town, holds included. Absent: `ms` + LOCK_SLACK_MS. */
  lockMs?: number;
}
/**
 * The longest a story scene may hold the town, from its start, holds and all (bible §5). Past it the show
 * runtime cuts the scene as a panic exit (story/show.ts). The walk is the Call's gathering (FK-019).
 */
export const LOCK_CAPS = { walk: 25_000, rally: 60_000, unveiling: 120_000, lastLight: 150_000, rising: 240_000 } as const;
/** A story scene that names no cap may run this much past its own length (only holds can make it). */
export const LOCK_SLACK_MS = 15_000;
/** The caravan's scenes. Saved in `city.scene`, so this list never gains or loses one: story scenes have their own ids and save. */
export type SceneId = 'opening' | 'crossing' | 'ageTurn' | 'arrival' | 'finale';
export const SCENE_IDS: SceneId[] = ['opening', 'crossing', 'ageTurn', 'arrival', 'finale'];

const lead = STRANDED[0];
/** Between the leader (once stepped forward) and the daughter, at chest height. */
const pair: [number, number, number] = [(lead.x - STEP_FORWARD + STRANDED[1].x) / 2, 0.95, (lead.z + STRANDED[1].z) / 2];

/**
 * The names are the age's caravan's; the page fills them in from the caravan board (`{leader}`).
 * Looked up by any id the town view carries: one that isn't here (a story scene's) comes out undefined.
 */
export const SCENES: Record<SceneId, Scene> & { readonly [id: string]: Scene | undefined } = {
  opening: {
    id: 'opening',
    ms: 34_000,
    shots: [
      // Wide, from the town's side of the usual angle: the river, the broken bridge, and the band huddled beyond it.
      { at: 0, move: 4500, pose: { focus: [BRIDGE.x + 7, 0.5, 1.5], yaw: YAW_DEFAULT, pitch: PITCH_DEFAULT, half: 15 } },
      { at: 4500, move: 2500, pose: { focus: [BRIDGE.x + 8.5, 0.6, 1], yaw: YAW_DEFAULT - 0.12, pitch: PITCH_DEFAULT - 0.05, half: 13 } },
      // In close, swinging round to their faces as they look at the bridge.
      { at: 7000, move: 4000, pose: { focus: pair, yaw: -1.3, pitch: 0.3, half: 2.9 } },
      { at: 11_000, move: 9000, pose: { focus: [pair[0] - 0.1, 0.95, pair[2]], yaw: -1.4, pitch: 0.28, half: 2.6 } },
      // The problem: the bridge, with its gap.
      { at: 20_000, move: 3000, pose: { focus: [BRIDGE.x, 0.4, 0], yaw: 0.3, pitch: 0.5, half: 7 } },
      { at: 23_000, move: 4000, pose: { focus: [BRIDGE.x - 0.5, 0.4, 0], yaw: 0.4, pitch: 0.52, half: 6.4 } },
      // Back out to the usual angle: the town up to the square, with the broken bridge at the right edge of the frame.
      { at: 27_000, move: 5000, pose: { focus: [RIVER.x / 2, 0, 26], yaw: YAW_DEFAULT, pitch: PITCH_DEFAULT, half: 50 } },
    ],
    lines: [
      { at: 11_600, ms: 2400, who: '{leader}', text: 'Hello.' },
      { at: 14_300, ms: 2900, who: '{leader}', text: "We've been travelling." },
      { at: 17_500, ms: 2900, who: '{leader}', text: 'We need your help.' },
      { at: 21_500, ms: 4800, who: '{leader}', text: "The bridge is gone. We can't cross." },
    ],
    beats: [
      { at: 1000, do: 'emote', who: 2, pose: 'sit', ms: 30_000 },
      { at: 2500, do: 'emote', who: 3, pose: 'shrug', ms: 2500 },
      { at: 3200, do: 'emote', who: 1, pose: 'point', ms: 3000 },
      { at: 5200, do: 'emote', who: 4, pose: 'think', ms: 4000 },
      { at: 10_400, do: 'step', who: 0 },
      { at: 15_000, do: 'emote', who: 1, pose: 'wave', ms: 2600 },
      { at: 21_000, do: 'emote', who: 0, pose: 'point', ms: 3500 },
    ],
  },
  crossing: {
    id: 'crossing',
    ms: 15_000,
    shots: [
      { at: 0, move: 3000, pose: { focus: [BRIDGE.x + 2, 0.5, 0], yaw: 0.35, pitch: 0.48, half: 9 } },
      { at: 3000, move: 11_000, pose: { focus: [BRIDGE.x - 5, 0.5, 0], yaw: 0.5, pitch: 0.55, half: 10 } },
    ],
    lines: [{ at: 1500, ms: 3500, who: '{leader}', text: 'Thank you. We’re coming over.' }],
    beats: [{ at: 600, do: 'emote', who: 1, pose: 'cheer', ms: 2500 }],
  },
  // The Wonder is finished: the head opens it, the town turns into the next age, the title card, the
  // age's heroes, and the caravan says goodbye and heads back to camp. A breather follows (caravan.ts)
  // before the next age's caravan walks in.
  ageTurn: {
    id: 'ageTurn',
    ms: 30_000,
    shots: [
      { at: 0, move: 3000, pose: { focus: [0, 5, 0], yaw: YAW_DEFAULT, pitch: 0.42, half: 13 } },
      { at: 3000, move: 3200, pose: { focus: [0, 6, 0], yaw: YAW_DEFAULT + 0.25, pitch: 0.36, half: 11 } },
      // Out wide as the town turns, so the whole of it changes on screen.
      { at: 6200, move: 3500, pose: { focus: [0, 0, 6], yaw: YAW_DEFAULT, pitch: PITCH_DEFAULT, half: 46 } },
      { at: 12_000, move: 9000, pose: { focus: [0, 0, 6], yaw: YAW_DEFAULT - 0.35, pitch: PITCH_DEFAULT, half: 40 } },
      // The caravan saying goodbye on the square.
      { at: 21_000, move: 3000, pose: { focus: [4, 1, 3], yaw: YAW_DEFAULT, pitch: 0.5, half: 12 } },
      { at: 26_500, move: 3500, pose: { focus: [0, 0, 8], yaw: YAW_DEFAULT, pitch: PITCH_DEFAULT, half: 44 } },
    ],
    lines: [
      { at: 1000, ms: 3600, who: '{head}', text: 'I declare {wonder} open!' },
      { at: 5000, ms: 2400, who: '{leader}', text: 'Look. Look at it.' },
      { at: 8200, ms: 4600, text: '{age}', title: true },
      { at: 13_200, ms: 5200, who: 'Heroes of {was}', text: '{heroes}' },
      { at: 21_800, ms: 4200, who: '{leader}', text: '{farewell}' },
    ],
    beats: [
      { at: 1600, do: 'emote', who: 0, pose: 'cheer', ms: 3000 },
      { at: 1900, do: 'emote', who: 1, pose: 'cheer', ms: 3000 },
      { at: 2300, do: 'emote', who: 2, pose: 'cheer', ms: 2600 },
      { at: 7200, do: 'age', who: 0 },
      { at: 22_000, do: 'emote', who: 1, pose: 'wave', ms: 3000 },
      { at: 25_500, do: 'leave', who: 0 },
    ],
  },
  // A later age's caravan arrives: from the camp, over the bridge, into town. The daughter has a line.
  arrival: {
    id: 'arrival',
    ms: 14_000,
    shots: [
      { at: 0, move: 3000, pose: { focus: [BRIDGE.x + 8, 0.6, 0], yaw: 0.3, pitch: 0.42, half: 10 } },
      { at: 3000, move: 10_000, pose: { focus: [BRIDGE.x - 6, 0.6, 0], yaw: 0.5, pitch: 0.52, half: 11 } },
    ],
    lines: [
      { at: 1200, ms: 4600, who: '{leader}', text: '{greeting}' },
      { at: 6400, ms: 5200, who: '{daughter}', text: '{daughterLine}' },
    ],
    beats: [
      { at: 800, do: 'emote', who: 0, pose: 'wave', ms: 2500 },
      { at: 6600, do: 'emote', who: 1, pose: 'wave', ms: 2500 },
    ],
  },
  // The last Wonder: lift-off, the heroes of every age read out, and the daughter's last line.
  finale: {
    id: 'finale',
    ms: 44_000,
    shots: [
      { at: 0, move: 3000, pose: { focus: [0, 4, 0], yaw: YAW_DEFAULT, pitch: 0.3, half: 12 } },
      { at: 4000, move: 6000, pose: { focus: [0, 18, 0], yaw: YAW_DEFAULT + 0.3, pitch: 0.12, half: 20 } },
      { at: 11_000, move: 12_000, pose: { focus: [0, 0, 6], yaw: YAW_DEFAULT - 0.4, pitch: PITCH_DEFAULT, half: 44 } },
      { at: 34_000, move: 3000, pose: { focus: [4, 1, 3], yaw: YAW_DEFAULT, pitch: 0.5, half: 12 } },
      { at: 40_000, move: 3500, pose: { focus: [0, 0, 8], yaw: YAW_DEFAULT, pitch: PITCH_DEFAULT, half: 46 } },
    ],
    lines: [
      { at: 1000, ms: 3000, who: '{head}', text: 'Light it.' },
      { at: 4600, ms: 3800, text: '{wonder} is away', title: true },
      { at: 10_000, ms: 3800, who: '{roll0Who}', text: '{roll0}' },
      { at: 13_900, ms: 3800, who: '{roll1Who}', text: '{roll1}' },
      { at: 17_800, ms: 3800, who: '{roll2Who}', text: '{roll2}' },
      { at: 21_700, ms: 3800, who: '{roll3Who}', text: '{roll3}' },
      { at: 25_600, ms: 3800, who: '{roll4Who}', text: '{roll4}' },
      { at: 29_500, ms: 3800, who: '{roll5Who}', text: '{roll5}' },
      { at: 34_600, ms: 5000, who: '{daughter}', text: '{daughterLine}' },
      { at: 40_000, ms: 4000, text: 'The journey is complete', title: true },
    ],
    beats: [
      { at: 3000, do: 'launch', who: 0 },
      { at: 3400, do: 'emote', who: 0, pose: 'cheer', ms: 4000 },
      { at: 3600, do: 'emote', who: 1, pose: 'cheer', ms: 4000 },
      { at: 6500, do: 'launch', who: 0 },
      { at: 9500, do: 'launch', who: 0 },
      { at: 35_000, do: 'emote', who: 1, pose: 'wave', ms: 3000 },
    ],
  },
};
/** `{name}` in a line filled from the scene's vars (unknown names come out empty). */
export const fillLine = (text: string | undefined, vars: Record<string, string | undefined>): string => (text ?? '').replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '').trim();

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const angle = (a: number, b: number, k: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};
/** Where the camera is `t` ms into a scene, starting from wherever it was (`from`). */
export function scenePose(scene: Scene, t: number, from: CamPose): CamPose {
  let prev = from;
  for (let i = 0; i < scene.shots.length; i++) {
    const s = scene.shots[i];
    const next = scene.shots[i + 1];
    if (next && t >= next.at) {
      prev = s.pose;
      continue;
    }
    const k = ease((t - s.at) / Math.max(1, s.move));
    const lerp = (a: number, b: number) => a + (b - a) * k;
    return {
      focus: [lerp(prev.focus[0], s.pose.focus[0]), lerp(prev.focus[1], s.pose.focus[1]), lerp(prev.focus[2], s.pose.focus[2])],
      yaw: angle(prev.yaw, s.pose.yaw, k),
      pitch: lerp(prev.pitch, s.pose.pitch),
      // Zoom in even steps (a log scale), so a big pull-out doesn't rush its start.
      half: Math.exp(lerp(Math.log(prev.half), Math.log(s.pose.half))),
    };
  }
  return from;
}
/** The line on screen `t` ms into a scene (with vars, only one that has something to say). */
export const sceneLine = (scene: Scene, t: number, vars?: Record<string, string | undefined>): Line | undefined =>
  scene.lines.find((l) => t >= l.at && t < l.at + l.ms && (!vars || fillLine(l.text, vars) !== ''));
