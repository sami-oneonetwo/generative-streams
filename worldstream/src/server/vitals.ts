// The character's body. Needs drain with time, weather and effort, and are
// restored by things chat placed near them. At zero he collapses; if nobody
// brings the missing thing in time, he dies, the lights go out, and he walks
// back in a little worse for it. Everything here is rules; words come from banks.
import type { Catalogue, SpriteDef, SurvivalDef } from '../shared/catalogue.js';
import type { Config } from '../shared/config.js';
import { NEEDS, VIEW, type Entity, type Need, type WorldState } from '../shared/state.js';
import { pick } from './drift.js';
import { PERKS } from './host/errands.js';
import type { Store } from './store.js';

export interface VitalsHooks {
  /** critical lines (collapse, death, revive) should not be silenced by the chatter mute. */
  say: (text: string, critical?: boolean) => void;
  onSave: (userId: string, userName: string, need: Need) => void;
  onDeath: (deaths: number) => void;
  onNewDay: (days: number) => void;
}

export interface VitalsDeps extends VitalsHooks {
  store: Store;
  cfg: Config;
  catalogue: () => Catalogue;
  rnd?: () => number;
}

export const DEFAULT_SURVIVAL: SurvivalDef = {
  comfort: 'warmth',
  comfortDrain: { base: 0.02, night: 0.03, day: 0, rain: 0.03, storm: 0.06, fog: 0 },
  comfortTags: ['warm', 'fire', 'shelter'],
  foodTags: ['food'],
  restTags: ['bed', 'seat'],
  spiritTags: ['person', 'animal', 'robot', 'music'],
};

const RATE = { food: 0.042, foodWalking: 0.06, rest: 0.012, spirit: 0.015, company: 0.03, comfortRecover: 0.15, sleepRecover: 1.0 };

const LINES = {
  collapse: {
    food: ['that is it. I am down. food. anything. near me.', 'legs gone. hungry. someone, please.'],
    warmth: ['too cold. cannot feel my hands. fire. shelter. anything.', 'I am going numb. warmth, please. near me.'],
    water: ['no water. I am done. someone find water. quickly.', 'throat is sand. water. now. please.'],
    rest: ['I cannot... I need to lie down. a bench. anything.', 'eyes closing. somewhere to sleep, please.'],
    spirit: ['quiet in here. I could really use some company.', 'I will just rest here a moment. a word from anyone would help.'],
  },
  low: {
    food: ['getting hungry, chat. no rush.', 'stomach is making its own weather.'],
    warmth: ['cold. properly cold now.', 'if someone had a fire I would not say no.'],
    water: ['dry. very dry.', 'water would be a personal favour.'],
    rest: ['I could sleep standing up. I might.', 'tired in the bones.'],
    spirit: ['quiet in here.', 'say something if you like. it helps.'],
  },
  eat: ['that helps. thank you.', 'oh, that is good.', 'food. finally.', 'better. still hungry. but better.'],
  drink: ['water. real water. thank you.', 'that is the best thing that has happened today.'],
  warm: ['warmer. thank you.', 'oh, that is nice.'],
  sleep: ['...five minutes.', 'do not let me sleep too long.', 'just resting my eyes.'],
  wake: ['hm? oh. you.', 'I was not asleep.', 'right. where were we.'],
  revive: ['{user}. you saved my life. I mean that.', 'still here. because of {user}.', '{user}. I owe you one. maybe two.'],
  spiritRevive: ['... okay. okay. you are still here. so am I.', 'that helped. you have no idea.'],
  death: ['...', 'lights out.', 'see you on the other side.'],
  return: ['I remember falling. I do not remember getting up.', 'that is {deaths} now. thanks for waiting.', 'back. thank you for sticking around.'],
  newDay: ['day {days}. still here.', 'another day. {days}. keep counting.'],
  thriving: ['this is the good part.', 'you know what, this is fine. this is a good street.', 'if every night were like this I would stop wandering.'],
};

const warned = new Map<Need, number>();
const meals = new Map<string, number>();
let lastThriveAt = 0;
let lastSeekAt = 0;

export function stepVitals(d: VitalsDeps, now: number, elapsedMs: number): void {
  if (!d.cfg.survival.enabled) return;
  const rnd = d.rnd ?? Math.random;
  const store = d.store;
  const s: WorldState = store.state;
  const c = s.character;
  const v = c.vitals;
  if (s.transition) return;
  const cat = d.catalogue();
  const surv = cat.survival ?? DEFAULT_SURVIVAL;
  const defs = new Map(cat.sprites.map((x) => [x.name, x]));
  const centreOf = (e: Entity) => e.x + (defs.get(e.sprite)?.w ?? 8) / 2;
  const hasTag = (e: Entity, tags: string[]) => tags.some((t) => defs.get(e.sprite)?.tags.includes(t));
  const near = (tags: string[], dist: number) => s.entities.filter((e) => !e.motion && hasTag(e, tags) && Math.abs(centreOf(e) - c.x) <= dist);
  const anywhere = (tags: string[]) => s.entities.filter((e) => e.addedBy !== 'world' && hasTag(e, tags)).sort((a, b) => Math.abs(centreOf(a) - c.x) - Math.abs(centreOf(b) - c.x));
  const walkTo = (x: number) => store.dispatch({ type: 'set_character', patch: { targetX: Math.round(Math.max(8, Math.min(VIEW.worldW - 8, x))), facing: x < c.x ? 'l' : 'r', mode: 'walk' } }, 'vitals');
  const comfortWord = surv.comfort;
  const dt = (elapsedMs / 1000) * d.cfg.survival.decayScale; // drains
  const real = elapsedMs / 1000; // recovery

  if (v.blackout) {
    if (now >= v.blackout.until) {
      store.dispatch({ type: 'set_vitals', patch: { blackout: undefined } }, 'vitals');
      d.say(fillLine(pick(LINES.return, rnd)!, { deaths: String(v.deaths) }), true);
    }
    return;
  }

  // -- collapsed: waiting for rescue --------------------------------------------
  if (v.collapsed) {
    const need = v.collapsed.need;
    const rescuer = need === 'food' ? near(surv.foodTags, 28)[0] : need === 'comfort' ? near(surv.comfortTags, 44)[0] : need === 'rest' ? near(surv.restTags, 28)[0] : undefined;
    if (rescuer) {
      const byName = rescuer.addedBy === 'world' ? undefined : rescuer.addedByName;
      if (need === 'food') eat(store, rescuer, defs, now);
      store.dispatch({ type: 'revive', at: now, by: byName }, 'vitals');
      d.say(byName ? fillLine(pick(LINES.revive, rnd)!, { user: byName }) : 'still here. somehow.', true);
      if (byName && rescuer.addedBy !== 'operator') d.onSave(rescuer.addedBy, byName, need);
      return;
    }
    if (need === 'spirit' && v.spirit >= 20) {
      store.dispatch({ type: 'revive', at: now }, 'vitals');
      d.say(pick(LINES.spiritRevive, rnd)!, true);
      return;
    }
    if (now >= v.collapsed.until) {
      d.say(pick(LINES.death, rnd)!, true);
      store.dispatch({ type: 'death', at: now, blackoutMs: d.cfg.survival.blackoutMs, respawnX: s.camera.x + 16 }, 'vitals');
      d.onDeath(v.deaths + 1);
    }
    return;
  }

  // -- sleeping ------------------------------------------------------------------
  let { food, comfort, rest, spirit } = v;
  if (c.sleeping) {
    rest += RATE.sleepRecover * real;
    food -= RATE.food * 0.5 * dt;
    if (now >= c.sleeping.until || rest >= 95) {
      store.dispatch({ type: 'wake' }, 'vitals');
      d.say(pick(LINES.wake, rnd)!);
    }
    store.dispatch({ type: 'set_vitals', patch: { food, rest } }, 'vitals');
    return;
  }

  // -- drains and passive recovery --------------------------------------------------
  const night = s.time >= 20 || s.time < 6;
  const day = s.time >= 9 && s.time < 17;
  const dr = surv.comfortDrain;
  const comfortDrain = dr.base + (night ? dr.night : 0) + (day ? dr.day : 0) + (s.weather === 'rain' ? dr.rain : 0) + (s.weather === 'storm' ? dr.storm : 0) + (s.weather === 'fog' ? dr.fog : 0);
  const bag = c.inventory ?? [];
  const perk = (n: Need) => bag.reduce((m, item) => m * (PERKS[item]?.[n] ?? 1), 1);
  const comfortSources = near(surv.comfortTags, 44);
  comfort += comfortSources.length ? RATE.comfortRecover * real : -comfortDrain * perk('comfort') * dt;
  food -= (c.mode === 'walk' ? RATE.foodWalking : RATE.food) * perk('food') * dt;
  rest -= RATE.rest * perk('rest') * dt;
  spirit += near(surv.spiritTags, 60).length ? RATE.company * real : -RATE.spirit * perk('spirit') * dt;

  // -- eating from what is at hand -----------------------------------------------------
  if (food < 60) {
    const edible = (e: Entity) => {
      const last = meals.get(e.id);
      return Boolean(defs.get(e.sprite)?.consumable) || last === undefined || now - last > 60_000;
    };
    const f = near(surv.foodTags, 24).find(edible);
    if (f) {
      const def = defs.get(f.sprite);
      meals.set(f.id, now);
      eat(store, f, defs, now);
      food += def?.consumable ? 35 : 25;
      d.say(pick(LINES.eat, rnd)!);
    }
  }
  if (comfortSources.length && comfort < 50 && rnd() < 0.05) d.say(pick(comfortWord === 'water' ? LINES.drink : LINES.warm, rnd)!);

  // -- day count ------------------------------------------------------------------------
  let { dayProgress, days } = v;
  dayProgress += elapsedMs / (24 * d.cfg.drift.minutesPerWorldHour * 60_000);
  if (dayProgress >= 1) {
    dayProgress -= 1;
    days += 1;
    d.say(fillLine(pick(LINES.newDay, rnd)!, { days: String(days) }), true);
    d.onNewDay(days);
  }

  store.dispatch({ type: 'set_vitals', patch: { food, comfort, rest, spirit, dayProgress, days } }, 'vitals');
  const after = store.state.character.vitals;

  // -- collapse -----------------------------------------------------------------------------
  for (const need of NEEDS) {
    if (after[need] <= 0) {
      store.dispatch({ type: 'collapse', need, at: now, windowMs: d.cfg.survival.collapseWindowMs }, 'vitals');
      const bank = need === 'comfort' ? LINES.collapse[comfortWord] : LINES.collapse[need];
      d.say(pick(bank, rnd)!, true);
      return;
    }
  }

  // -- looking after himself: seek food, warmth, a bed --------------------------------------
  if (c.targetX === undefined && now - lastSeekAt > 8_000 && rnd() < 0.5) {
    lastSeekAt = now;
    const want: Array<[Need, number, string[]]> = [
      ['food', 45, surv.foodTags],
      ['comfort', 40, surv.comfortTags],
      ['rest', 25, surv.restTags],
    ];
    for (const [need, threshold, tags] of want) {
      if (after[need] >= threshold) continue;
      const target = anywhere(tags)[0];
      if (!target) continue;
      const cx = centreOf(target);
      if (need === 'rest' && Math.abs(cx - c.x) <= 24) {
        store.dispatch({ type: 'sleep', until: now + d.cfg.survival.sleepMs }, 'vitals');
        d.say(pick(LINES.sleep, rnd)!);
      } else if (Math.abs(cx - c.x) > 16) walkTo(cx + (cx < c.x ? 12 : -12));
      break;
    }
  }

  // -- groans when low, joy when high -------------------------------------------------------
  for (const need of NEEDS) {
    if (after[need] < 25 && now - (warned.get(need) ?? 0) > 180_000) {
      warned.set(need, now);
      const bank = need === 'comfort' ? LINES.low[comfortWord] : LINES.low[need];
      if (!c.bubble) d.say(pick(bank, rnd)!);
      break;
    }
  }
  if (NEEDS.every((n) => after[n] >= 75) && now - lastThriveAt > 150_000 && !c.bubble) {
    lastThriveAt = now;
    d.say(pick(LINES.thriving, rnd)!);
    const fun = anywhere(['music', 'fun'])[0];
    if (fun && c.targetX === undefined) walkTo(centreOf(fun) - 12);
  }
}

function eat(store: Store, f: Entity, defs: Map<string, SpriteDef>, now: number): void {
  const def = defs.get(f.sprite);
  if (def?.consumable) store.dispatch({ type: 'remove_entity', id: f.id }, 'vitals');
  else store.dispatch({ type: 'touch_entity', id: f.id, at: now, ttlMs: 20 * 60_000 }, 'vitals');
}

function fillLine(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? `{${k}}`);
}

/** Test hook: clear per-process memory. */
export function resetVitalsMemory(): void {
  warned.clear();
  meals.clear();
  lastThriveAt = 0;
  lastSeekAt = 0;
}
