// The end of the path: something nobody has seen, out of sight until the streamer says otherwise.
// "Getting close" puts a dark shape far down the trail in the mist (designed from the streamer's
// description, or a default) and the challenges stop; "You've made it" brings the group up to it,
// lifts the mist and gives everyone there a star; "Set off again" starts the next leg. The operator
// decides every step; no agent can trigger any of it.
import type { Blueprint, GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import type { HappeningView } from '../../shared/dudesTypes';
import { trailX } from '../../shared/trail';
import { measureBlueprint } from './blueprint';
import { award, challengeOf } from './challenge';
import { journeyOf } from './journey';
import { nudge } from './events';
import { awake } from './sim';
import { pushFeed, type Dude, type DudesState } from './state';

export const LANDMARK = {
  /** How far down the trail it stands when it first shows. */
  ahead: 100,
  /** Where the group stops in front of it. */
  stopShort: 24,
  /** When the operator says they made it and it is further than this, it comes to meet them. */
  nearEnough: 60,
  defaultDescription: 'an enormous ancient stone gateway covered in moss and glowing blue runes, with a beam of light rising from its top',
};

export const LANDMARK_ID = 'landmark';
export const landmarkOf = (state: DudesState) => state.objects.find((o) => o.id === LANDMARK_ID);

/** Until the design comes back (or if it never does): a tall ruined tower with a light on top. */
export function fallbackLandmark(): Blueprint {
  const stone = '#8d8a80',
    dark = '#6d6a62',
    glow = '#9fe3ff';
  const parts: Blueprint['parts'] = [];
  for (let i = 0; i < 6; i++)
    parts.push({ shape: 'cylinder', position: [0, 2 + i * 4, 0], size: [9 - i * 0.9, 4, 9 - i * 0.9], rotation: [0, i * 0.4, 0], color: i % 2 ? stone : dark });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    parts.push({ shape: 'box', position: [Math.cos(a) * 6, 1.5, Math.sin(a) * 6], size: [1.6, 3, 1.6], rotation: [0, a, 0.15], color: dark });
  }
  parts.push({ shape: 'sphere', position: [0, 25, 0], size: [3.2, 3.2, 3.2], rotation: [0, 0, 0], color: glow });
  parts.push({ shape: 'cylinder', position: [0, 27.5, 0], size: [0.8, 2, 0.8], rotation: [0, 0, 0], color: glow });
  return { name: 'The Old Tower', description: 'A ruined tower older than the forest, with a light that never goes out.', parts };
}

/**
 * Operator: "Getting close". The challenges stop, and a shape appears far down the path. `design`
 * is the streamer's description; the world asks the designer for it and swaps it in when it comes.
 */
export function gettingClose(state: DudesState, now: number, description: string): string | undefined {
  const j = journeyOf(state);
  if (j.phase === 'approach' || j.phase === 'arrived') return 'already there or nearly';
  if (challengeOf(state)) return 'finish the challenge first';
  // Whatever challenge was coming is off: nothing more stands between them and it.
  if (j.next?.kind === 'river') j.features = (j.features ?? []).filter((f) => f.z !== j.next!.z);
  j.next = undefined;
  j.phase = 'approach';
  j.landmark = { description: description.slice(0, 300), status: 'designing' };
  const z = j.campZ - LANDMARK.ahead;
  place(state, fallbackLandmark(), { x: trailX(j.seed, z), z }, now);
  pushFeed(state, now, 'Something is up ahead');
  for (const d of state.dudes.filter((x) => awake(x, now) && !x.muted))
    nudge(state, d, 'Far ahead down the path, a huge shape has appeared in the mist. Nobody can tell what it is yet. The group is getting close to the end of this stretch of the journey.', now);
  return undefined;
}

/** Put the landmark (or its new design) on the trail, centred on the path. */
export function place(state: DudesState, blueprint: Blueprint, at: GroundPoint, now: number): void {
  const size = measureBlueprint(blueprint);
  const existing = landmarkOf(state);
  const object: SafehouseObject = {
    id: LANDMARK_ID,
    revision: (existing?.revision ?? 0) + 1,
    blueprint,
    position: existing?.position ?? at,
    footprint: size,
    createdBy: 'the forest',
    editedBy: 'the forest',
    createdAt: existing?.createdAt ?? now,
    silhouette: journeyOf(state).phase !== 'arrived',
  };
  state.objects = [...state.objects.filter((o) => o.id !== LANDMARK_ID), object];
  state.worldRevision++;
}

/** The designer's answer for the streamer's description, when it comes back. */
export function landmarkDesigned(state: DudesState, blueprint: Blueprint | undefined, now: number): void {
  const j = journeyOf(state);
  if (!j.landmark || !landmarkOf(state)) return;
  j.landmark.status = blueprint ? 'ready' : 'failed';
  try {
    if (blueprint) place(state, blueprint, landmarkOf(state)!.position, now);
  } catch {
    j.landmark.status = 'failed'; // the stand-in tower stays
  }
}

/** Operator: "You've made it". It comes into view if it is still far off, the mist lifts, stars all round. */
export function madeIt(state: DudesState, now: number): string | undefined {
  const j = journeyOf(state);
  if (j.phase === 'arrived') return 'already there';
  if (challengeOf(state)) return 'finish the challenge first';
  if (!landmarkOf(state)) {
    const err = gettingClose(state, now, LANDMARK.defaultDescription);
    if (err) return err;
  }
  const o = landmarkOf(state)!;
  // Too far to walk to in a moment: it is just round the next bend.
  if (j.campZ - o.position.z > LANDMARK.nearEnough) {
    const z = j.campZ - 45;
    o.position = { x: trailX(j.seed, z), z };
  }
  o.silhouette = false;
  o.revision++;
  j.phase = 'arrived';
  j.arriving = true;
  state.worldRevision++;
  const kind = `arrived:${j.leg}`;
  const name = `a star for reaching ${o.blueprint.name}`;
  for (const d of state.dudes.filter((x) => awake(x, now) && !x.muted)) {
    award(state, d, kind, name, now);
    d.emote = { pose: 'cheer', until: now + 6000 };
    nudge(state, d, `The group has made it to ${o.blueprint.name}: ${o.blueprint.description} Everyone here earned a star.`, now);
  }
  pushFeed(state, now, `The group made it to ${o.blueprint.name}`);
  return undefined;
}

/** Operator: "Set off again". The next leg starts; the landmark stays behind like everything else. */
export function setOffAgain(state: DudesState, now: number): string | undefined {
  const j = journeyOf(state);
  if (j.phase !== 'arrived') return 'the group has not arrived anywhere yet';
  j.phase = 'travel';
  j.arriving = false;
  j.leg++;
  j.landmark = undefined;
  const o = landmarkOf(state);
  if (o) o.id = `landmark-leg-${j.leg - 1}`; // just a build now, left behind as they walk on
  state.worldRevision++;
  pushFeed(state, now, 'The group sets off again');
  return undefined;
}

/** Arrived: the group walks on (journey.ts, `arriving`) until it stands in front of it, then stays. */
export function tickLandmark(state: DudesState): void {
  const j = journeyOf(state);
  const o = landmarkOf(state);
  if (j.phase !== 'arrived' || !j.arriving) return;
  const stop = o ? o.position.z + o.footprint.depth / 2 + LANDMARK.stopShort : j.campZ;
  if (j.campZ <= stop) {
    j.campZ = Math.max(j.campZ, stop);
    j.arriving = false;
  }
}

export function landmarkView(state: DudesState): HappeningView | undefined {
  const j = journeyOf(state);
  const o = landmarkOf(state);
  if (j.phase === 'approach') return { kind: 'landmark', title: 'SOMETHING IS UP AHEAD', text: 'A huge shape in the mist, far down the path. Keep walking.' };
  if (j.phase === 'arrived' && o) {
    const name = o.blueprint.name.length > 36 ? `${o.blueprint.name.slice(0, 35).trim()}…` : o.blueprint.name;
    return { kind: 'landmark', title: `YOU MADE IT: ${name.toUpperCase()}`, text: o.blueprint.description };
  }
  return undefined;
}

export function landmarkLine(state: DudesState, dude: Dude): string | undefined {
  const j = journeyOf(state);
  const o = landmarkOf(state);
  if (j.phase === 'approach') return 'Far ahead, a huge dark shape has appeared in the mist at the end of this stretch of path. Nobody knows what it is; people are curious, nervous, guessing.';
  if (j.phase === 'arrived' && o) return `The group has reached the end of this stretch: ${o.blueprint.name}, ${o.blueprint.description} It is right in front of ${dude.name}. Everyone is taking it in, celebrating, exploring it.`;
  return undefined;
}
