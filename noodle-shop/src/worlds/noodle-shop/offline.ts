// Between-streams simulation: settle rent, decay the plant and reputation
// gently, lose long-absent regulars' stools, and run the periodic health
// inspection. Returns narration facts for Kenji's stream-start recap.

import { shopStage, type NoodleShopState } from './state';
import { tuning } from './tuning';
import type { WorldCtx } from '../../engine/world';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function applyOfflineTime(ctx: WorldCtx<NoodleShopState>): string[] {
  const state = ctx.state;
  const gapMs = ctx.now - state.lastLiveAt;
  if (gapMs < tuning.offlineGapMinMs) return [];

  const days = gapMs / 86_400_000;
  const facts: string[] = [];

  // Between streams the shop resets to open: fresh pot, clean incidents, bowls cleared.
  state.broth = { servings: tuning.brothServings, simmering: false };
  state.incidents = { vendingBroken: false, burnerOut: false };
  for (const stool of Object.values(state.stools)) stool.bowl = undefined;
  state.daysOpen++;

  // The plant wilts slowly while he's away; he waters it the moment he's back in.
  const plantBefore = state.plant.vitality;
  state.plant.vitality = clamp(state.plant.vitality - tuning.offlinePlantDecayPerDay * days, 0, 100);
  const plantSurvived = state.plant.vitality > 0;
  state.plant.vitality = Math.max(state.plant.vitality, 40); // he tends it first thing
  state.plant.lastWateredAt = ctx.now;
  if (plantBefore < 40 && plantSurvived) facts.push('her plant held through the week; watered it first thing');
  else if (days >= 1) facts.push('her plant is still going');

  // Regulars who didn't order last stream drift; three misses and the seat frees.
  const lost: string[] = [];
  for (const stool of Object.values(state.stools)) {
    stool.streamsMissed++;
    if (stool.streamsMissed >= tuning.stoolLoseAfterStreams) {
      state.regularsBoard.push({ name: stool.ownerName, bowls: stool.bowlsServed, at: ctx.now });
      const chatter = state.chatters[stool.ownerUserId];
      if (chatter) chatter.stoolId = undefined;
      delete state.stools[stool.id];
      lost.push(stool.ownerName);
    }
  }
  if (lost.length) facts.push(`${lost.join(', ')} stopped coming — their seats are open again`);

  // Rent, due each stream.
  facts.push(...settleRent(state));

  // Reputation drifts toward the middle a little between streams (news fades).
  state.reputation = clamp(state.reputation + (state.reputation < 60 ? 3 : -1) * Math.min(days, 3), 0, 100);

  // Periodic health inspection.
  state.season.streams++;
  if (state.season.streams >= tuning.streamsPerInspection) {
    facts.push(...runInspection(ctx));
  }

  if (days >= 0.5) facts.unshift(`${days.toFixed(1)} days since the last service`);
  state.lastLiveAt = ctx.now;
  return facts;
}

function settleRent(state: NoodleShopState): string[] {
  const rent = tuning.rentPerStream;
  if (state.till >= rent) {
    state.till -= rent;
    const surplus = state.till;
    if (surplus >= tuning.growthSurplus) {
      return [...grow(state), `rent paid; ¥${state.till} in the till after`];
    }
    return [`rent paid (¥${rent}); ¥${state.till} left in the till`];
  }
  // Short on rent.
  state.season.rentMissed++;
  const shortfall = rent - state.till;
  state.till = 0;
  state.reputation = Math.max(0, state.reputation - 5);
  if (state.season.rentMissed >= 3) {
    return [`rent short by ¥${shortfall} — third time. the landlord is not smiling. the shop is on the edge`];
  }
  return [`couldn't make rent — short ¥${shortfall}. that can't happen again`];
}

function grow(state: NoodleShopState): string[] {
  if (state.pots < tuning.maxPots && state.stoolCount >= 8) {
    state.pots++;
    state.till -= tuning.growthSurplus;
    return [`a good run — put the surplus into a second broth pot. we can serve two styles now`];
  }
  if (state.stoolCount < tuning.maxStools) {
    state.stoolCount += 2;
    state.till -= tuning.growthSurplus;
    return [`a good run — added two more stools. we're a ${shopStage(state).toLowerCase()} now`];
  }
  return [];
}

function runInspection(ctx: WorldCtx<NoodleShopState>): string[] {
  const state = ctx.state;
  const clean = state.reputation >= 55 && !state.incidents.rat;
  state.season = { period: state.season.period + 1, streams: 0, rentMissed: state.season.rentMissed };
  if (clean) {
    state.reputation = Math.min(100, state.reputation + tuning.inspectorPassBonus);
    state.lastInspectionResult = 'pass';
    return [`the health inspector came by and left happy — reputation up`];
  }
  state.reputation = Math.max(0, state.reputation - tuning.inspectorFailPenalty);
  state.lastInspectionResult = 'fail';
  return [`the health inspector found fault — a mark on the record and a hit to reputation`];
}
