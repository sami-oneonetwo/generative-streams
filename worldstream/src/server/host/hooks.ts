// The character's conversation moves: each hook says something, declares what
// counts as an answer, and says what happens when someone answers or nobody does.
// Templates take {user}, {name}, {thing}, {value}. Lines are lowercase and short.
import type { BuildDef, Catalogue, SpriteDef } from '../../shared/catalogue.js';
import type { Command } from '../../shared/commands.js';
import type { Entity, Weather, World, WorldState } from '../../shared/state.js';
import { fill, pick } from '../drift.js';
import type { IncomingChat } from '../ingest.js';
import type { AnswerSpec } from './detectors.js';
import type { ErrandDef } from './errands.js';
import type { Profiles, ViewerProfile } from './profiles.js';
import type { Wardrobe } from '../../shared/wardrobe.js';

export interface HookEnv {
  state: WorldState;
  catalogue: Catalogue;
  profiles: Profiles;
  now: number;
  /** Milliseconds since anyone chatted. */
  quietMs: number;
  /** Regulars who spoke recently, most recent first. */
  regulars: ViewerProfile[];
  /** The viewer who last answered something, if the host wants to follow up. */
  preferUser?: ViewerProfile;
  isNight: boolean;
  rnd: () => number;
  /** Worlds that exist, for travel talk. */
  worlds: World[];
  /** How long he has been in this world. */
  inWorldMs: number;
  /** An errand he could go on from here, if any. */
  errandCandidate?: ErrandDef;
  /** His hands: whether he is mid-build and when he last finished one. */
  builder?: { busy: boolean; lastFinishedAt: number; showcases(): BuildDef[]; request(plan: { def: BuildDef; announce?: () => string | undefined }): { ok: boolean } };
  mode: 'streamer' | 'full';
  /** What chat can dress him in, when assets are packed. */
  wardrobe?: Wardrobe;
}

export interface HookAsk {
  text: string;
  hint?: string;
  answer: AnswerSpec;
  timeoutMs?: number;
  /** Gather answers until the timeout, then resolve all at once. */
  collect?: boolean;
  /** Ask the model to write the line from this brief instead of using `text`. */
  brief?: string;
  /** Say and open the question only after this long (e.g. once a build is finished). */
  delayMs?: number;
  data?: Record<string, unknown>;
}

export interface HookActions {
  say(text: string): void;
  walkTo(x: number): void;
  walkToEntity(id: string): void;
  spawn(ambientName: string): void;
  label(id: string, name: string): void;
  follow(id: string, on: boolean): void;
  setWeather(w: Weather): void;
  openVote(world: World): void;
  addForViewer(cmd: Command, msg: IncomingChat): boolean;
  /** Leave for another world now (no vote). */
  travel(world: World): void;
  /** Begin an errand: leave for its world and start looking. */
  startErrand(def: ErrandDef): void;
  /** Ask the model to choose the best of several free-text answers. */
  judge(question: string, candidates: Array<{ msg: IncomingChat; value: string }>): Promise<{ msg: IncomingChat; value: string } | null>;
  entityByViewer(userId: string, sprite?: string): Entity | undefined;
}

export interface Answer {
  msg: IncomingChat;
  value: string;
  cmd?: Command;
}

export interface HookResult {
  /** The hook is finished; nothing more expected. */
  done: boolean;
  say?: string;
}

export interface Hook {
  id: string;
  weight: number;
  cooldownMs: number;
  /** When positive, this hook outranks the scheduled ones; the highest wins. */
  urgency?(env: HookEnv): number;
  /** Which host modes use this hook; both when omitted. */
  modes?: Array<'streamer' | 'full'>;
  worlds?: World[];
  /** Only reachable as part of an arc. */
  arcOnly?: boolean;
  when?(env: HookEnv): boolean;
  ask(env: HookEnv): HookAsk | null;
  onAnswer?(env: HookEnv, act: HookActions, a: Answer, data: Record<string, unknown>): HookResult | Promise<HookResult>;
  onResolve?(env: HookEnv, act: HookActions, answers: Answer[], data: Record<string, unknown>): string | undefined | Promise<string | undefined>;
  onTimeout?(env: HookEnv, act: HookActions, data: Record<string, unknown>): string | undefined;
}

// -- helpers ------------------------------------------------------------------

const near = (state: WorldState, e: Entity, dist = 90) => Math.abs(e.x - state.character.x) <= dist;
const withTag = (cat: Catalogue, e: Entity, tags: string[]) => {
  const def = cat.sprites.find((s) => s.name === e.sprite);
  return Boolean(def && tags.some((t) => def.tags.includes(t)));
};
const chatCanAdd = (cat: Catalogue, tags: string[]): SpriteDef | undefined => cat.sprites.find((s) => !s.ambientOnly && !s.procedural && tags.some((t) => s.tags.includes(t)));
const pretty = (s: string) => s.replace(/_/g, ' ');
const article = (s: string) => (/^[aeiou]/i.test(s) ? 'an' : 'a');
const say = (arr: string[], vars: Record<string, string>, rnd: () => number) => fill(pick(arr, rnd) ?? arr[0], vars);

function thanks(env: HookEnv, a: Answer, thing: string): string {
  return say(['{user}. thank you.', 'that works, {user}. thank you', '{user}, you read my mind', 'a {thing}. {user}, cheers.', 'there it is. thanks {user}'], { user: a.msg.user.name, thing }, env.rnd);
}

// -- the library --------------------------------------------------------------

export function buildHooks(): Hook[] {
  return [
    {
      id: 'pick_direction',
      modes: ['full'],
      weight: 3,
      cooldownMs: 8 * 60_000,
      when: (env) => env.state.character.targetX === undefined,
      ask: (env) => ({
        text: say(['left or right? first answer decides where I go', 'I cannot decide. left or right?', 'which way, left or right? you choose'], {}, env.rnd),
        hint: 'JUST SAY LEFT OR RIGHT',
        answer: { type: 'choice', options: ['left', 'right'] },
        timeoutMs: 45_000,
      }),
      onAnswer: (env, act, a) => {
        const cam = env.state.camera.x;
        act.walkTo(a.value === 'left' ? cam + 40 + env.rnd() * 80 : cam + 360 + env.rnd() * 80);
        return { done: true, say: say(['{value} it is. {user} said so.', '{user} says {value}. fine by me.'], { user: a.msg.user.name, value: a.value }, env.rnd) };
      },
      onTimeout: (env) => say(['no takers. I will pick.', 'okay, I will decide this one.'], {}, env.rnd),
    },

    {
      id: 'need_light',
      weight: 4,
      cooldownMs: 12 * 60_000,
      when: (env) => env.isNight && Boolean(chatCanAdd(env.catalogue, ['light'])) && !env.state.entities.some((e) => withTag(env.catalogue, e, ['light']) && near(env.state, e)),
      ask: (env) => {
        const def = chatCanAdd(env.catalogue, ['light'])!;
        return {
          text: say(['too dark down here. someone bring me {a} {thing}', 'I cannot see my own hands. {a} {thing} would help. anyone?', 'some light, please. {a} {thing}, a fire, anything'], { thing: pretty(def.name), a: article(pretty(def.name)) }, env.rnd),
          hint: `SAY "BRING A ${pretty(def.name).toUpperCase()}"`,
          answer: { type: 'command', kind: 'add', tags: ['light'] },
        };
      },
      onAnswer: (env, act, a) => {
        const e = act.entityByViewer(a.msg.user.id, a.value);
        if (e) act.walkToEntity(e.id);
        return { done: true, say: thanks(env, a, pretty(a.value)) };
      },
      onTimeout: (env) => say(['dark it is, then. I do not mind.', 'no worries. my eyes will adjust.'], {}, env.rnd),
    },

    {
      id: 'need_shelter',
      weight: 4,
      cooldownMs: 15 * 60_000,
      when: (env) => (env.state.weather === 'rain' || env.state.weather === 'storm') && Boolean(chatCanAdd(env.catalogue, ['shelter', 'awning', 'tent'])) && !env.state.entities.some((e) => withTag(env.catalogue, e, ['shelter', 'awning', 'tent']) && near(env.state, e, 60)),
      ask: (env) => {
        const def = chatCanAdd(env.catalogue, ['shelter', 'awning', 'tent'])!;
        return {
          text: say(['I am getting soaked. somewhere dry would be kind. {a} {thing}, maybe', 'anyone got {a} {thing}? I am not built for rain'], { thing: pretty(def.name), a: article(pretty(def.name)) }, env.rnd),
          hint: `SAY "PUT UP A ${pretty(def.name).toUpperCase()}"`,
          answer: { type: 'command', kind: 'add', tags: ['shelter', 'awning', 'tent'] },
        };
      },
      onAnswer: (env, act, a) => {
        const e = act.entityByViewer(a.msg.user.id, a.value);
        if (e) act.walkToEntity(e.id);
        return { done: true, say: say(['dry. {user}, you are a saint.', 'better. thanks {user}.'], { user: a.msg.user.name }, env.rnd) };
      },
      onTimeout: () => 'wet, then. no harm done.',
    },

    {
      id: 'need_food',
      weight: 3,
      cooldownMs: 5 * 60_000,
      urgency: (env) => Math.max(0, 40 - env.state.character.vitals.food),
      when: (env) => Boolean(chatCanAdd(env.catalogue, ['food'])) && !env.state.entities.some((e) => withTag(env.catalogue, e, ['food']) && near(env.state, e, 120)),
      ask: (env) => {
        const def = chatCanAdd(env.catalogue, ['food'])!;
        const v = env.state.character.vitals.food;
        return {
          text:
            v < 15
              ? say(['I am going to fall over. {a} {thing}, if anyone can. please.', 'I really do need food. anyone? please.'], { thing: pretty(def.name), a: article(pretty(def.name)) }, env.rnd)
              : say(['I have not eaten since the last world. anyone got {a} {thing}?', 'hungry. if anyone has {a} {thing} spare I would be grateful', '{a} {thing} would fix most of this'], { thing: pretty(def.name), a: article(pretty(def.name)) }, env.rnd),
          hint: `SAY "GET HIM A ${pretty(def.name).toUpperCase()}"`,
          answer: { type: 'command', kind: 'add', tags: ['food'] },
        };
      },
      onAnswer: (env, act, a) => {
        const e = act.entityByViewer(a.msg.user.id, a.value);
        if (e) act.walkToEntity(e.id);
        return { done: true, say: say(['finally. {user} feeds the wanderer.', 'oh that smells right. {user}, I owe you.'], { user: a.msg.user.name }, env.rnd) };
      },
      onTimeout: () => 'no food. that is okay. I will manage.',
    },

    {
      id: 'need_comfort',
      weight: 0,
      cooldownMs: 4 * 60_000,
      urgency: (env) => Math.max(0, 40 - env.state.character.vitals.comfort) + 1,
      when: (env) => env.state.character.vitals.comfort < 40 && Boolean(chatCanAdd(env.catalogue, (env.catalogue.survival?.comfortTags ?? ['warm', 'fire', 'shelter']))),
      ask: (env) => {
        const tags = env.catalogue.survival?.comfortTags ?? ['warm', 'fire', 'shelter'];
        const water = env.catalogue.survival?.comfort === 'water';
        const def = chatCanAdd(env.catalogue, tags)!;
        return {
          text: water
            ? say(['I am drying out. {a} {thing} near me would save the day', 'water. shade. anything. {a} {thing}, someone?'], { thing: pretty(def.name), a: article(pretty(def.name)) }, env.rnd)
            : say(['I am freezing. {a} {thing} near me, please', 'cold to the bone. someone bring {a} {thing} close'], { thing: pretty(def.name), a: article(pretty(def.name)) }, env.rnd),
          hint: `SAY "PUT A ${pretty(def.name).toUpperCase()} NEXT TO HIM"`,
          answer: { type: 'command', kind: 'add', tags },
        };
      },
      onAnswer: (env, act, a) => {
        const e = act.entityByViewer(a.msg.user.id, a.value);
        if (e) act.walkToEntity(e.id);
        return { done: true, say: say(['{user}. that might have saved me.', 'closer. yes. thank you {user}.'], { user: a.msg.user.name }, env.rnd) };
      },
      onTimeout: () => 'no worries. I will manage.',
    },

    {
      id: 'need_rest',
      weight: 0,
      cooldownMs: 6 * 60_000,
      urgency: (env) => Math.max(0, 30 - env.state.character.vitals.rest),
      when: (env) => env.state.character.vitals.rest < 30 && Boolean(chatCanAdd(env.catalogue, env.catalogue.survival?.restTags ?? ['bed', 'seat'])) && !env.state.entities.some((e) => withTag(env.catalogue, e, env.catalogue.survival?.restTags ?? ['bed', 'seat'])),
      ask: (env) => {
        const tags = env.catalogue.survival?.restTags ?? ['bed', 'seat'];
        const def = chatCanAdd(env.catalogue, tags)!;
        return {
          text: say(['I need to lie down. {a} {thing} would do', 'somewhere to sleep, anyone? {a} {thing}'], { thing: pretty(def.name), a: article(pretty(def.name)) }, env.rnd),
          hint: `SAY "GIVE HIM A ${pretty(def.name).toUpperCase()}"`,
          answer: { type: 'command', kind: 'add', tags },
        };
      },
      onAnswer: (env, act, a) => {
        const e = act.entityByViewer(a.msg.user.id, a.value);
        if (e) act.walkToEntity(e.id);
        return { done: true, say: say(['{user}, thank you. really.', 'a place to lie down. {user}, thank you.'], { user: a.msg.user.name }, env.rnd) };
      },
      onTimeout: () => 'standing it is. I have slept standing before. it is fine.',
    },

    {
      id: 'need_spirit',
      weight: 0,
      cooldownMs: 5 * 60_000,
      urgency: (env) => Math.max(0, 35 - env.state.character.vitals.spirit),
      when: (env) => env.state.character.vitals.spirit < 35,
      ask: (env) => ({
        text: say(['talk to me, chat. anything at all.', 'is anybody out there? say hi. it would help.', 'I am running on empty. a word from anyone would help.'], {}, env.rnd),
        hint: 'JUST SAY SOMETHING TO HIM',
        answer: { type: 'text', minLen: 2 },
        collect: true,
        timeoutMs: 45_000,
      }),
      onResolve: (env, act, answers) => {
        if (!answers.length) return 'that is okay. I will talk to myself for a bit.';
        const names = [...new Set(answers.map((a) => a.msg.user.name))];
        return names.length === 1 ? `${names[0]}. that helped more than you know.` : `${names.slice(0, 3).join(', ')}. okay. I can keep going.`;
      },
    },

    {
      id: 'dress_me',
      weight: 5,
      cooldownMs: 9 * 60_000,
      when: (env) => Boolean(env.wardrobe?.items.length),
      ask: (env) => {
        const items = env.wardrobe!.items;
        const a = items[Math.floor(env.rnd() * items.length)];
        const b = items[Math.floor(env.rnd() * items.length)];
        return {
          text: say(['chat, dress me. a hat, a colour for my coat, anything you like', 'I have worn this coat for years. someone pick me something new', 'style me, chat. {a}? {b}? a colour? your call'], { a: pretty(a.name), b: pretty(b.name) }, env.rnd),
          hint: 'TRY: "GIVE HIM A TOP HAT"',
          answer: { type: 'command', kind: 'wear' },
          timeoutMs: 75_000,
        };
      },
      onAnswer: () => ({ done: true }),
      onTimeout: () => 'no takers. this coat has seen worse.',
    },
    {
      id: 'name_this',
      weight: 5,
      cooldownMs: 6 * 60_000,
      when: (env) => env.state.entities.some((e) => !e.label && !e.motion && e.addedBy !== 'world' && withTag(env.catalogue, e, ['animal', 'person', 'robot'])),
      ask: (env) => {
        const e = env.state.entities.filter((x) => !x.label && !x.motion && x.addedBy !== 'world' && withTag(env.catalogue, x, ['animal', 'person', 'robot'])).sort((a, b) => Math.abs(a.x - env.state.character.x) - Math.abs(b.x - env.state.character.x))[0];
        return {
          text: say(['this {thing} needs a name. best one in the next minute wins', 'what do we call the {thing}? just type a name'], { thing: pretty(e.sprite) }, env.rnd),
          hint: 'JUST TYPE A NAME',
          answer: { type: 'name' },
          timeoutMs: 60_000,
          data: { entityId: e.id, thing: pretty(e.sprite) },
        };
      },
      onAnswer: (env, act, a, data) => {
        const id = String(data.entityId);
        if (!env.state.entities.some((e) => e.id === id)) return { done: true, say: 'and it is gone. never mind the name.' };
        act.label(id, a.value);
        env.profiles.recordName(a.msg.user.id, a.value);
        act.walkToEntity(id);
        return { done: true, say: say(['{name}. suits it. thank you {user}.', '{name} it is. good choice, {user}.', 'welcome, {name}. {user} chose well.'], { name: a.value, user: a.msg.user.name }, env.rnd) };
      },
      onTimeout: (env, act, data) => `no name, then. the ${String(data.thing)} stays a mystery.`,
    },

    {
      id: 'blank_sign',
      modes: ['full'],
      weight: 3,
      cooldownMs: 12 * 60_000,
      when: (env) => env.catalogue.sprites.some((s) => s.acceptsText && !s.ambientOnly),
      ask: (env) => ({
        text: say(['this street needs words. tell me what to put on a sign. keep it short', 'someone give me words for a sign. a few letters, that is all'], {}, env.rnd),
        hint: 'SAY "PUT OPEN LATE ON A SIGN"',
        answer: { type: 'command', kind: 'sign' },
      }),
      onAnswer: (env, act, a) => {
        const e = act.entityByViewer(a.msg.user.id);
        if (e) act.walkToEntity(e.id);
        return { done: true, say: say(['"{value}". I can live with that. {user}.', '{user} wrote "{value}". the city agrees.'], { value: a.value, user: a.msg.user.name }, env.rnd) };
      },
      onTimeout: () => 'blank it stays for now. that is fine.',
    },

    {
      id: 'bet_train',
      modes: ['full'],
      weight: 3,
      cooldownMs: 20 * 60_000,
      worlds: ['cyberpunk'],
      when: (env) => !env.state.entities.some((e) => e.sprite === 'train') && !env.state.transition,
      ask: (env) => ({
        text: say(['the train is late again. bet on it: does it show in the next minute? yes or no', 'train in the next sixty seconds. yes or no. place your bets.'], {}, env.rnd),
        hint: 'SAY YES OR NO',
        answer: { type: 'yesno' },
        collect: true,
        timeoutMs: 60_000,
      }),
      onResolve: (env, act, answers) => {
        if (!answers.length) return 'no takers. no harm done.';
        const comes = env.rnd() < 0.5;
        if (comes) act.spawn('train');
        const winners = answers.filter((a) => a.value === (comes ? 'yes' : 'no'));
        for (const a of answers) env.profiles.recordBet(a.msg.user.id, a.value === (comes ? 'yes' : 'no'));
        const names = [...new Set(winners.map((a) => a.msg.user.name))].slice(0, 4).join(', ');
        return comes ? `there it is. ${names || 'nobody'} called it.` : `no train. ${names || 'nobody'} had it right.`;
      },
    },

    {
      id: 'garden_dare',
      modes: ['full'],
      weight: 2,
      cooldownMs: 30 * 60_000,
      when: (env) => Boolean(chatCanAdd(env.catalogue, ['plant', 'nature', 'green'])),
      ask: (env) => ({
        text: say(['if three of you bring plants, I will start a garden here', 'dare: three plants from three people and this corner turns green'], {}, env.rnd),
        hint: 'SAY "ADD A PLANT"',
        answer: { type: 'command', kind: 'add', tags: ['plant', 'nature', 'green'] },
        collect: true,
        timeoutMs: 120_000,
      }),
      onResolve: (env, act, answers) => {
        const people = new Set(answers.map((a) => a.msg.user.id));
        if (people.size >= 3) return `a garden. look at that. ${[...new Set(answers.map((a) => a.msg.user.name))].slice(0, 3).join(', ')} did that.`;
        if (people.size > 0) return `${people.size} of three. close. the garden waits.`;
        return 'no gardeners tonight. maybe tomorrow.';
      },
    },

    {
      id: 'weather_vote',
      modes: ['full'],
      weight: 2,
      cooldownMs: 25 * 60_000,
      ask: (env) => ({
        text: say(['sky vote. rain, clear, fog or storm? most votes wins in a minute', 'change the weather. say rain, clear, fog or storm.'], {}, env.rnd),
        hint: 'JUST SAY RAIN, CLEAR, FOG OR STORM',
        answer: { type: 'choice', options: ['rain', 'clear', 'fog', 'storm'] },
        collect: true,
        timeoutMs: 60_000,
      }),
      onResolve: (env, act, answers) => {
        if (!answers.length) return 'no votes. the sky does what it wants.';
        const tally = new Map<string, number>();
        for (const a of answers) tally.set(a.value, (tally.get(a.value) ?? 0) + 1);
        const [w] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
        act.setWeather(w as Weather);
        return `${w}, by ${tally.get(w)} vote${tally.get(w) === 1 ? '' : 's'}.`;
      },
    },

    {
      id: 'ask_regular',
      weight: 4,
      cooldownMs: 6 * 60_000,
      when: (env) => Boolean(env.preferUser ?? env.regulars[0]),
      ask: (env) => {
        const p = env.preferUser ?? env.regulars[0];
        const thing = p.recentAdds[p.recentAdds.length - 1];
        return {
          text: thing
            ? say(['{user}, that {thing} of yours. still happy with it?', '{user}. the {thing}. was that for me?', 'chat, {user} put that {thing} there. {user}, defend it.'], { user: p.name, thing: pretty(thing) }, env.rnd)
            : say(['{user}, you are still here. what should I build next?', '{user}. what is this place missing? I will build it.'], { user: p.name }, env.rnd),
          hint: `${p.name.toUpperCase()}, JUST REPLY`,
          answer: { type: 'text', from: p.id },
          timeoutMs: 60_000,
          brief: `Ask ${p.name} a short, specific question about ${thing ? `the ${pretty(thing)} they added` : 'what they would add to this place'}. One line, lowercase, dry and kind. Address them by name.`,
          data: { userId: p.id, name: p.name, thing },
        };
      },
      onAnswer: (env, act, a) => ({ done: true, say: say(['{user}, fair. I will think about that.', 'noted, {user}. thank you.', 'good answer, {user}. thank you.'], { user: a.msg.user.name }, env.rnd) }),
      onTimeout: (env, act, data) => `${String(data.name)} is busy. no problem.`,
    },

    {
      id: 'story_prompt',
      modes: ['full'],
      weight: 2,
      cooldownMs: 30 * 60_000,
      when: (env) => env.catalogue.sprites.some((s) => s.acceptsText && !s.ambientOnly),
      ask: (env) => ({
        text: say(['if the train stopped here, where would you go? best answer ends up on a sign', 'tell me one thing this place needs. the best one goes on a sign.'], {}, env.rnd),
        hint: 'JUST TYPE AN ANSWER',
        answer: { type: 'text', minLen: 3 },
        collect: true,
        timeoutMs: 75_000,
        data: { question: 'the best short answer to put on a sign' },
      }),
      onResolve: async (env, act, answers, data) => {
        if (!answers.length) return 'no answers this time. that is okay.';
        const best = (await act.judge(String(data.question), answers)) ?? answers[0];
        const text = best.value.replace(/[^A-Za-z0-9 !?'.,-]/g, '').trim().slice(0, 16).trim();
        const signDef = env.catalogue.sprites.find((s) => s.acceptsText && !s.ambientOnly);
        if (signDef && text) act.addForViewer({ kind: 'add', sprite: signDef.name, text }, best.msg);
        return `"${text || best.value.slice(0, 16)}". ${best.msg.user.name} wins the sign.`;
      },
    },

    {
      id: 'lull_event',
      modes: ['full'],
      weight: 3,
      cooldownMs: 10 * 60_000,
      when: (env) => env.quietMs > 3 * 60_000 && (env.catalogue.ambient ?? []).length > 0,
      ask: (env) => {
        const a = pick((env.catalogue.ambient ?? []).filter((x) => !x.departure), env.rnd) ?? env.catalogue.ambient![0];
        return {
          text: say(['quiet in here. too quiet. something is coming. good or bad? say good or bad', 'nobody talking, so the city will. good sign or bad sign? say good or bad'], {}, env.rnd),
          hint: 'SAY GOOD OR BAD',
          answer: { type: 'choice', options: ['good', 'bad'] },
          timeoutMs: 40_000,
          data: { ambient: a.name },
        };
      },
      onAnswer: (env, act, a, data) => {
        act.spawn(String(data.ambient));
        return { done: true, say: say(['{user} says {value}. we will see.', 'a {value} sign, says {user}. here it comes.'], { user: a.msg.user.name, value: a.value }, env.rnd) };
      },
      onTimeout: (env, act, data) => {
        act.spawn(String(data.ambient));
        return 'nobody bet. it came anyway.';
      },
    },

    {
      id: 'travel_tease',
      modes: ['full'],
      weight: 1,
      cooldownMs: 40 * 60_000,
      when: (env) => !env.state.vote && !env.state.transition && env.state.entities.filter((e) => e.addedBy !== 'world').length >= 6,
      ask: (env) => {
        const worlds = env.worlds.filter((w) => w !== env.state.world);
        const to = pick(worlds, env.rnd) ?? worlds[0];
        return {
          text: say(['I keep thinking about the {to}. should we go? yes or no', 'itchy feet. the {to} is calling. yes or no?'], { to }, env.rnd),
          hint: 'SAY YES OR NO',
          answer: { type: 'yesno' },
          collect: true,
          timeoutMs: 60_000,
          data: { to },
        };
      },
      onResolve: (env, act, answers, data) => {
        const yes = answers.filter((a) => a.value === 'yes').length;
        const no = answers.length - yes;
        if (yes > no && yes > 0) {
          act.openVote(String(data.to) as World);
          return `${yes} to ${no}. the vote is open. !vote if you mean it.`;
        }
        return answers.length ? `${yes} to ${no}. we stay. for now.` : 'no answer. we stay.';
      },
    },

    {
      id: 'build_showcase',
      weight: 6,
      cooldownMs: 60_000,
      when: (env) => Boolean(env.builder) && !env.builder!.busy && env.builder!.showcases().length > 0 && env.now - env.builder!.lastFinishedAt > 60_000 && env.state.character.targetX === undefined,
      ask: (env) => {
        const b = env.builder!;
        const def = pick(b.showcases(), env.rnd)!;
        const v = b.request({ def });
        if (!v.ok) return null;
        const name = pretty(def.name);
        return {
          text: say(['check this out chat. I built a {name}. be honest.', 'chat. chat. look. a {name}. thoughts?', 'okay so I made a {name}. rate it.', 'new build: a {name}. is it good or is it a {name}?'], { name }, env.rnd),
          hint: 'TELL HIM WHAT YOU THINK',
          answer: { type: 'text', minLen: 2 },
          collect: true,
          timeoutMs: 40_000,
          delayMs: 2500 + def.items.length * 1200 + 800,
          data: { name },
        };
      },
      onResolve: (env, act, answers, data) => {
        const name = String(data.name);
        if (!answers.length) return say(['quiet room. I will take that as a yes.', 'no thoughts? that is okay. I like the {name}.', 'the {name} stays. thanks for watching, chat.'], { name }, env.rnd);
        const a = answers[answers.length - 1];
        const first = answers[0];
        if (answers.length === 1) return say(['{user}: "{value}". noted. thank you.', 'thanks {user}. "{value}". I can work with that.', '"{value}". appreciated, {user}.'], { user: a.msg.user.name, value: a.value.slice(0, 40) }, env.rnd);
        return say(['{user} and {other} both weighed in. thank you both.', '{user}: "{value}". {other} too. thanks, chat.'], { user: first.msg.user.name, other: a.msg.user.name, value: first.value.slice(0, 40), name }, env.rnd);
      },
    },

    {
      id: 'errand_start',
      weight: 2,
      cooldownMs: 20 * 60_000,
      when: (env) => Boolean(env.errandCandidate) && !env.state.character.errand && !env.state.vote && !env.state.transition && env.inWorldMs > (env.mode === 'streamer' ? 25 : 10) * 60_000 && (['food', 'comfort', 'rest', 'spirit'] as const).every((n) => env.state.character.vitals[n] > 35),
      ask: (env) => {
        const def = env.errandCandidate!;
        return {
          text: `${def.why} I am going. say stay if you want me here.`,
          hint: 'SAY STAY OR GO',
          answer: { type: 'choice', options: ['stay', 'go'] },
          collect: true,
          timeoutMs: 25_000,
          data: { def },
        };
      },
      onResolve: (env, act, answers, data) => {
        const def = data.def as ErrandDef;
        const stay = answers.filter((a) => a.value === 'stay').length;
        const go = answers.length - stay;
        if (stay > go) return say(['okay. I stay. thank you for wanting me here.', 'you win. I stay. the {thing} can wait.'], { thing: pretty(def.item) }, env.rnd);
        act.startErrand(def);
        return say(['right. back soon. probably.', 'off I go. keep the place standing.', 'wish me luck. or do not. I am going anyway.'], {}, env.rnd);
      },
    },

    {
      id: 'errand_find',
      weight: 0,
      cooldownMs: 90_000,
      urgency: (env) => (env.state.character.errand?.stage === 'searching' && env.state.world === env.state.character.errand.target ? 5 + Math.min(20, (env.now - env.state.character.errand.since) / 30_000) : 0),
      when: (env) => env.state.character.errand?.stage === 'searching' && env.state.world === env.state.character.errand.target && !env.state.entities.some((e) => e.sprite === env.state.character.errand!.item),
      ask: (env) => {
        const item = env.state.character.errand!.item;
        return {
          text: say(['I came all this way for a {thing}. anyone seen one?', 'help me find a {thing}. it is around here somewhere.', 'a {thing}. that is all I need. then we go home.'], { thing: pretty(item) }, env.rnd),
          hint: `SAY "HERE IS A ${pretty(item).toUpperCase()}"`,
          answer: { type: 'command', kind: 'add', sprites: [item] },
        };
      },
      onAnswer: (env, act, a) => {
        const e = act.entityByViewer(a.msg.user.id, a.value);
        if (e) act.walkToEntity(e.id);
        return { done: true, say: say(['{user}. that is the one.', 'there. {user} found it.'], { user: a.msg.user.name }, env.rnd) };
      },
      onTimeout: () => 'I will keep looking.',
    },

    // -- arc: the missing cat (cyberpunk) ------------------------------------
    {
      id: 'arc_cat_missing',
      weight: 0,
      cooldownMs: 0,
      arcOnly: true,
      worlds: ['cyberpunk'],
      when: (env) => !env.state.entities.some((e) => e.sprite === 'cat'),
      ask: () => ({
        text: 'my cat is gone. grey, small, likes ramen. if you see her, tell me and I will come look',
        hint: 'SAY "I FOUND YOUR CAT"',
        answer: { type: 'command', kind: 'add', sprites: ['cat'] },
        timeoutMs: 120_000,
      }),
      onAnswer: (env, act, a) => {
        const e = act.entityByViewer(a.msg.user.id, 'cat');
        if (e) act.walkToEntity(e.id);
        return { done: true, say: `that is her. ${a.msg.user.name}, you found her.` };
      },
      onTimeout: () => 'no sign of her. I will keep looking.',
    },
    {
      id: 'arc_cat_name',
      weight: 0,
      cooldownMs: 0,
      arcOnly: true,
      worlds: ['cyberpunk'],
      when: (env) => env.state.entities.some((e) => e.sprite === 'cat' && !e.label),
      ask: (env) => {
        const cat = env.state.entities.find((e) => e.sprite === 'cat' && !e.label)!;
        return { text: 'she never told me her name. what do we call her? just type it', hint: 'JUST TYPE A NAME', answer: { type: 'name' }, timeoutMs: 60_000, data: { entityId: cat.id } };
      },
      onAnswer: (env, act, a, data) => {
        const id = String(data.entityId);
        if (!env.state.entities.some((e) => e.id === id)) return { done: true, say: 'she ran off again. typical.' };
        act.label(id, a.value);
        env.profiles.recordName(a.msg.user.id, a.value);
        return { done: true, say: `${a.value}. she likes it. ${a.msg.user.name} named her.` };
      },
      onTimeout: () => 'no name. she will answer to "cat" like the rest of us.',
    },
    {
      id: 'arc_cat_stays',
      weight: 0,
      cooldownMs: 0,
      arcOnly: true,
      worlds: ['cyberpunk'],
      when: (env) => env.state.entities.some((e) => e.sprite === 'cat'),
      ask: (env) => {
        const cat = env.state.entities.find((e) => e.sprite === 'cat')!;
        return { text: `${cat.label ?? 'the cat'} is staying with me. she can follow. try not to add any dogs.`, answer: { type: 'none' }, timeoutMs: 1, data: { entityId: cat.id } };
      },
      onTimeout: (env, act, data) => {
        act.follow(String(data.entityId), true);
        return undefined;
      },
    },
    {
      id: 'arc_cat_dog',
      weight: 0,
      cooldownMs: 0,
      arcOnly: true,
      worlds: ['cyberpunk'],
      when: (env) => env.state.entities.some((e) => e.sprite === 'cat' && e.follow) && env.state.entities.some((e) => e.sprite === 'dog'),
      ask: (env) => {
        const cat = env.state.entities.find((e) => e.sprite === 'cat' && e.follow)!;
        return { text: `a dog. of course. do I keep ${cat.label ?? 'her'} close, or let them meet? say close or meet`, hint: 'SAY CLOSE OR MEET', answer: { type: 'choice', options: ['close', 'meet'] }, timeoutMs: 60_000, data: { catId: cat.id } };
      },
      onAnswer: (env, act, a, data) => {
        if (a.value === 'meet') {
          act.follow(String(data.catId), false);
          return { done: true, say: `${a.msg.user.name} says meet. brave. fine. they can sort it out.` };
        }
        return { done: true, say: `close it is. ${a.msg.user.name} is sensible.` };
      },
      onTimeout: () => 'nobody decided. she decided for you. she is under the bench.',
    },

    // -- arc: water run (desert) ----------------------------------------------
    {
      id: 'arc_thirst',
      weight: 0,
      cooldownMs: 0,
      arcOnly: true,
      worlds: ['desert'],
      ask: () => ({
        text: 'we are out of water. an oasis or a well, anyone? find me one',
        hint: 'SAY "THERE IS AN OASIS"',
        answer: { type: 'command', kind: 'add', tags: ['water'] },
        timeoutMs: 120_000,
      }),
      onAnswer: (env, act, a) => {
        const e = act.entityByViewer(a.msg.user.id, a.value);
        if (e) act.walkToEntity(e.id);
        return { done: true, say: `water. ${a.msg.user.name}, you just saved a life. mine.` };
      },
      onTimeout: () => 'no water. I will lick a cactus. do not try this at home.',
    },
    {
      id: 'arc_water_name',
      weight: 0,
      cooldownMs: 0,
      arcOnly: true,
      worlds: ['desert'],
      when: (env) => env.state.entities.some((e) => withTag(env.catalogue, e, ['water']) && !e.label),
      ask: (env) => {
        const w = env.state.entities.find((e) => withTag(env.catalogue, e, ['water']) && !e.label)!;
        return { text: 'this spot needs a name for the map. what do we call it?', hint: 'JUST TYPE A NAME', answer: { type: 'name' }, timeoutMs: 60_000, data: { entityId: w.id } };
      },
      onAnswer: (env, act, a, data) => {
        act.label(String(data.entityId), a.value);
        env.profiles.recordName(a.msg.user.id, a.value);
        return { done: true, say: `${a.value}. on the map. ${a.msg.user.name} gets the credit.` };
      },
      onTimeout: () => 'unnamed water. every desert has some.',
    },
    {
      id: 'arc_camel',
      weight: 0,
      cooldownMs: 0,
      arcOnly: true,
      worlds: ['desert'],
      when: (env) => env.catalogue.sprites.some((s) => s.name === 'camel'),
      ask: () => ({
        text: 'a camel would carry the rest of the way. anyone know one?',
        hint: 'SAY "HERE IS A CAMEL"',
        answer: { type: 'command', kind: 'add', sprites: ['camel'] },
        timeoutMs: 120_000,
      }),
      onAnswer: (env, act, a) => {
        const e = act.entityByViewer(a.msg.user.id, 'camel');
        if (e) {
          act.walkToEntity(e.id);
          act.follow(e.id, true);
        }
        return { done: true, say: `we are friends now. ${a.msg.user.name}, meet my ride.` };
      },
      onTimeout: () => 'no camel. walking it is. again.',
    },
  ];
}
