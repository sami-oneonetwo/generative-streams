// The Unveiling v0 (FK-025): Story (dev) → Play: Unveiling. The Bell (story/gather.ts callRing) gathers
// everyone at the Folly under "GATHER: THE UNVEILING" with the head on his mark (mayor.ts prepareHead);
// once they are in, the `unveil` scene (shared/storyScenes.ts) plays through the show runtime: the tarp
// drops on its `unveil` beat (story/folly.ts unveilFolly; the page drops it, FK-024), the title card,
// RATE IT from chat's 1–10s (gather mode's tally), Wren far off with her line, and the NOW card as the
// crowd is let go (show.ts endShow). No cordon yet: it goes up first, so there is always something
// under the tarp (the Big Hut, or its stand-in); already unveiled: back under wraps, so it replays.
import type { WorldCtx } from '../../../engine/world';
import type { Beat } from '../../../shared/scenes';
import { STORY_SITES } from '../../../shared/storyMap';
import { bridgeProgress } from '../caravan';
import { ageOf, cityOf, headName } from '../city';
import { prepareHead } from '../mayor';
import type { DudesState } from '../state';
import { castTownie } from './cast';
import { FOLLIES, follyOf, raiseFolly, retarpFolly } from './folly';
import { callRing } from './gather';

/** Wren watches from the far bank while the bridge is down, else from the ring road (STORY_SITES.wrenVantage). */
export const wrenVantage = (state: DudesState) => (bridgeProgress(state) !== undefined ? STORY_SITES.wrenVantage.far : STORY_SITES.wrenVantage.near);
/** The scene that films her there. */
export const unveilSceneId = (state: DudesState) => (bridgeProgress(state) !== undefined ? 'unveil' : 'unveil-near');

/** "BRIDGE 3/8" while the bridge is down, from the caravan's ask; plain "BRIDGE" else. */
function bridgeWord(state: DudesState): string {
  const ask = cityOf(state).caravan?.asks.find((a) => a.kind === 'bridge');
  return bridgeProgress(state) !== undefined && ask ? `BRIDGE ${Math.min(ask.have, ask.need)}/${ask.need}` : 'BRIDGE';
}

/** The scene's `{name}`s: the head, the title card ("The Chief's Big Hut"), the NOW card's word. */
export function unveilVars(state: DudesState): Record<string, string> {
  const head = headName(state);
  const folly = (FOLLIES[ageOf(state)] ?? FOLLIES[0]).name.replace(/^the\s+/i, '');
  return { head, follyTitle: `${head}'s ${folly}`, bridge: bridgeWord(state) };
}

/** The `wren` beat: Wren onto her vantage, facing the Folly, standing there a while; a pose if the beat has one. Not in town: nothing. */
export function wrenBeat(state: DudesState, now: number, pose?: Beat['pose'], ms = 2500): void {
  const w = castTownie(state, 'wren');
  if (!w) return;
  const at = wrenVantage(state);
  const folly = STORY_SITES.folly.at;
  Object.assign(w, { position: { ...at }, path: [], hidden: undefined, doing: 'stroll', placeId: undefined, until: now + 40_000 });
  w.facing = Math.atan2(folly.x - at.x, folly.z - at.z);
  if (pose) w.emote = { pose, until: now + ms };
}

/** Story (dev) → Play: Unveiling. Says why not, and changes nothing, over another scene or a gathering. */
export function playUnveil(ctx: WorldCtx<DudesState>): string | undefined {
  const s = ctx.state;
  const city = cityOf(s);
  if (city.scene) return `Today's ${city.scene.id} scene is playing: let it finish first`;
  if (city.story?.scene) return `The ${city.story.scene.id} scene is playing: Stop it first`;
  if (s.dudes.some((d) => d.gather)) return 'Everyone is gathered already: Stop it first';
  const up = follyOf(s);
  const why = !up ? raiseFolly(s, ctx.now) : !up.silhouette ? retarpFolly(s) : undefined;
  if (why) return why;
  const called = callRing(s, ctx.now, {
    scene: unveilSceneId(s),
    vars: unveilVars(s),
    banner: { title: 'GATHER: THE UNVEILING', premise: `${headName(s)}'s secret build` },
  });
  if (typeof called === 'string') return called;
  prepareHead(s, STORY_SITES.headMark.at, STORY_SITES.headMark.facing, ctx.now);
  ctx.log(`story: the Unveiling (admin, Story (dev)): ${called.called} called to the Folly; ${follyOf(s)!.blueprint.name} under wraps until the scene`);
  return undefined;
}
