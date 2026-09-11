// The host: decides when the character reaches out, watches chat for the
// answer, acts on it, thanks people by name, and runs story arcs. Rules pick
// the moment and the mechanic; the model (when budget allows) supplies words.
import { randomUUID } from 'node:crypto';
import { findSprite, type Catalogue } from '../../shared/catalogue.js';
import type { Command } from '../../shared/commands.js';
import type { Config } from '../../shared/config.js';
import { VIEW, type Entity, type World } from '../../shared/state.js';
import type { Brain } from '../brain.js';
import { ambientPrefix, makeAmbientEntity, pick } from '../drift.js';
import type { IncomingChat } from '../ingest.js';
import { beginTravel, runCommand, type InterpreterContext, type Outcome } from '../interpreter.js';
import { log } from '../log.js';
import type { Builder } from '../builder.js';
import type { Arc } from './arcs.js';
import { BAG_LIMIT, ERRANDS, pickErrand, type ErrandDef } from './errands.js';

const ERRANDS_FOR = (w: World): ErrandDef[] => ERRANDS[w] ?? [];
import { detectAnswer } from './detectors.js';
import type { Answer, Hook, HookActions, HookAsk, HookEnv } from './hooks.js';
import type { Profiles } from './profiles.js';

export interface HostDeps {
  ctx: InterpreterContext;
  cfg: Config;
  profiles: Profiles;
  brain: Brain | null;
  /** Put words in the character's mouth (bubble + optional chat echo). */
  say: (text: string) => void;
  hooks: Hook[];
  arcs: Arc[];
  /** Worlds that exist, and how to look one up. */
  worlds?: World[];
  catalogueOf?: (w: World) => Catalogue | undefined;
  builder?: Builder;
  now?: () => number;
  rnd?: () => number;
}

interface OpenAsk {
  hook: Hook;
  ask: HookAsk;
  askId: string;
  openedAt: number;
  until: number;
  answers: Map<string, Answer>;
  data: Record<string, unknown>;
}

const GREETINGS = [
  'new voice. hello {user}. welcome to the stream. tell me what to build.',
  '{user}. first time here? welcome. say what you want to see. a cat, a farm, a party. anything.',
  'welcome, {user}. sit anywhere. or tell me to build you somewhere to sit.',
];

const WELCOME_BUILD_LINES = ['{user}. built you a spot. it has your name on it. welcome.', 'there. {user}\'s corner. welcome to the stream.', 'that one is yours, {user}. welcome. glad you are here.'];

const FOLLOW_LINES = ['{user} followed. chat, make some noise. {user}, welcome.', 'welcome aboard, {user}. tell me what to build and I will build it.'];

const ARRIVAL_LINES = ['someone new just walked in. hey. say hi in chat when you are ready.', 'a new face. welcome. tell me what you want to see and I will build it.', 'hello, whoever just arrived. glad you are here. say hi if you like.'];

const HINTS_STREAMER = ['SAY HI TO THE WANDERER', 'TELL HIM WHAT TO BUILD', 'TRY: "BUILD A FARM"', 'TRY: "PUT A CAT NEXT TO HIM"', 'TRY: "GIVE HIM A TOP HAT"', 'TRY: "MAKE HIS COAT RED"', 'ASK HIM ANYTHING'];
const HINTS_FULL = ['JUST SAY WHAT YOU WANT TO SEE', 'TRY: "PUT A CAT ON THE LEFT"', 'TALK TO THE WANDERER', 'TRY: "MAKE IT RAIN"', 'TRY: "A NEON SIGN THAT SAYS HELLO"', 'TRY: "GET RID OF MY CAT"'];

export class Host {
  private paused = false;
  private open: OpenAsk | null = null;
  private lastOutreachAt: number;
  private nextOutreachAt: number;
  private lastChatAt: number;
  private lastGreetAt = 0;
  private preferUserId: string | null = null;
  private readonly cooldownUntil = new Map<string, number>();
  private readonly arcCooldownUntil = new Map<string, number>();
  private arc: { arc: Arc; step: number } | null = null;
  private worldEnteredAt: number;
  private lastWorld: World | null = null;
  private lastErrandWalkAt = 0;
  private lastErrandEndAt = 0;
  private lastWelcomeBuildAt = 0;
  private lastArrivalAt = 0;
  private pendingAsk: NodeJS.Timeout | null = null;
  private modelCalls: number[] = [];
  private hintIdx = 0;
  private lastHintAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  private readonly rnd: () => number;

  constructor(private readonly deps: HostDeps) {
    this.now = deps.now ?? Date.now;
    this.rnd = deps.rnd ?? Math.random;
    const t = this.now();
    this.lastOutreachAt = t;
    this.lastChatAt = t;
    this.worldEnteredAt = t;
    this.nextOutreachAt = t + 20_000; // first outreach soon after boot
  }

  // -- lifecycle --------------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.pendingAsk) clearTimeout(this.pendingAsk);
    this.pendingAsk = null;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.nextOutreachAt = this.now() + 10_000;
  }

  status(): Record<string, unknown> {
    const now = this.now();
    return {
      enabled: this.deps.cfg.host.enabled,
      paused: this.paused,
      ask: this.open ? { hook: this.open.hook.id, text: this.open.ask.text, secondsLeft: Math.max(0, Math.ceil((this.open.until - now) / 1000)), answers: this.open.answers.size } : null,
      nextOutreachInS: this.open ? null : Math.max(0, Math.ceil((this.nextOutreachAt - now) / 1000)),
      quietForS: Math.round((now - this.lastChatAt) / 1000),
      modelCallsThisHour: this.modelCalls.filter((t) => now - t < 3_600_000).length,
      modelBudget: this.deps.cfg.host.maxModelCallsPerHour,
      viewersKnown: this.deps.profiles.count,
      arc: this.arc ? { id: this.arc.arc.id, step: this.arc.step + 1, of: this.arc.arc.steps.length } : null,
      mode: this.deps.cfg.host.mode,
      building: this.deps.builder?.busy ?? false,
      errand: this.deps.ctx.store.state.character.errand ?? null,
      bag: this.deps.ctx.store.state.character.inventory ?? [],
    };
  }

  // -- chat intake --------------------------------------------------------------

  get hasOpenAsk(): boolean {
    return this.open !== null;
  }

  /** What the model should know about the open question, for its prompt. */
  context(): string | undefined {
    if (!this.open) return undefined;
    const spec = this.open.ask.answer;
    const expecting =
      spec.type === 'command' && spec.kind === 'add'
        ? `someone to add ${spec.sprites ? spec.sprites.join(' or ') : `something tagged ${(spec.tags ?? []).join(' or ')}`}; if a viewer offers, describes or asks for such a thing, add it for them with add_entity`
        : spec.type === 'command' && spec.kind === 'sign'
          ? 'someone to give words for a sign; if a viewer offers words, add a text sprite with them'
          : spec.type === 'choice'
            ? `a choice: ${spec.options.join(' / ')}`
            : spec.type === 'yesno'
              ? 'yes or no'
              : spec.type === 'name'
                ? 'a name'
                : 'a reply';
    return `Open question from you to chat: "${this.open.ask.text}". You are waiting for ${expecting}. Do not repeat the question; act on answers.`;
  }

  /** A command the model ran on a viewer's behalf. Returns true when it answered the open question. */
  noteCommand(msg: IncomingChat, cmd: Command, outcome: Outcome): boolean {
    const sprite = cmd.kind === 'add' ? findSprite(this.deps.ctx.catalogue, cmd.sprite)?.name : cmd.kind === 'sign' ? 'sign' : undefined;
    this.deps.profiles.recordCommand(msg.user.id, cmd, outcome.applied, sprite);
    return this.match(msg, cmd, outcome);
  }

  /** Called for every chat line after commands ran. Returns true when the line was consumed as an answer. */
  observe(msg: IncomingChat, cmd: Command | null, outcome: Outcome | null): boolean {
    const now = this.now();
    this.lastChatAt = now;
    const { profile, isNew } = this.deps.profiles.touch(msg.user, now);
    if (cmd) {
      const sprite = cmd.kind === 'add' ? findSprite(this.deps.ctx.catalogue, cmd.sprite)?.name : cmd.kind === 'sign' ? 'sign' : undefined;
      this.deps.profiles.recordCommand(msg.user.id, cmd, Boolean(outcome?.applied), sprite);
      if (cmd.kind === 'name' && outcome?.applied) this.deps.profiles.recordName(msg.user.id, cmd.name);
    }

    if (this.deps.cfg.host.enabled && !this.paused && isNew && this.deps.cfg.host.greetNewcomers && !cmd && now - this.lastGreetAt > 20_000) {
      this.lastGreetAt = now;
      this.deps.profiles.markGreeted(msg.user.id);
      if (!this.welcomeBuild(msg.user, now)) this.deps.say(fill(pick(GREETINGS, this.rnd)!, { user: profile.name }));
    }

    return this.match(msg, cmd, outcome) && !cmd;
  }

  private match(msg: IncomingChat, cmd: Command | null, outcome: Outcome | null): boolean {
    // Every message lifts his spirits a little; a mention lifts them more and wakes him.
    const state = this.deps.ctx.store.state;
    const mentions = msg.content.toLowerCase().includes(this.deps.cfg.character.name.toLowerCase());
    const v = state.character.vitals;
    if (this.deps.cfg.survival.enabled && !v.blackout) {
      this.deps.ctx.store.dispatch({ type: 'set_vitals', patch: { spirit: v.spirit + (mentions ? 3 : 1), ...(v.collapsed?.need === 'spirit' ? { lastSavedBy: msg.user.name } : {}) } }, 'chat');
      if (state.character.sleeping && mentions) {
        this.deps.ctx.store.dispatch({ type: 'wake' }, 'chat');
        this.deps.say(`${msg.user.name}? I am up. thank you.`);
      }
    }

    if (!this.open) return false;
    const det = detectAnswer(this.open.ask.answer, msg, cmd, outcome, this.deps.ctx.catalogue);
    if (!det.matched) return false;
    const answer: Answer = { msg, value: det.value, cmd: cmd ?? undefined };
    if (this.open.ask.collect) {
      if (!this.open.answers.has(msg.user.id)) this.open.answers.set(msg.user.id, answer);
      return true;
    }
    void this.resolveWithAnswer(answer);
    return true;
  }

  /** A Kick follow: a warm word, and a spot with their name if hands are free. */
  onFollow(name: string, userId = `kick-follow:${name.toLowerCase()}`): void {
    if (!this.deps.cfg.host.enabled || this.paused) return;
    const now = this.now();
    if (now - this.lastGreetAt < 20_000) return;
    this.lastGreetAt = now;
    this.deps.say(fill(pick(FOLLOW_LINES, this.rnd)!, { user: name }));
    this.welcomeBuild({ id: userId, name, badges: [] }, now, true);
  }

  /** The viewer count went up: greet whoever arrived, without knowing their name yet. */
  onViewersJoined(delta: number): void {
    if (!this.deps.cfg.host.enabled || this.paused || delta <= 0) return;
    const now = this.now();
    if (now - this.lastArrivalAt < 120_000 || now - this.lastGreetAt < 20_000) return;
    this.lastArrivalAt = now;
    this.lastGreetAt = now;
    this.deps.say(pick(ARRIVAL_LINES, this.rnd)!);
  }

  /** Build a small spot with the viewer's name on it. Returns false when it could not (someone else's turn, hands full). */
  private welcomeBuild(user: IncomingChat['user'], now: number, quiet = false): boolean {
    const b = this.deps.builder;
    if (!b || !this.deps.cfg.host.welcomeBuilds || now - this.lastWelcomeBuildAt < 90_000 || b.busy) return false;
    const def = b.welcomeBuild();
    if (!def) return false;
    const v = b.request({ def, forUser: { ...user, badges: [...user.badges, 'moderator'] }, announce: (plan) => fill(pick(WELCOME_BUILD_LINES, this.rnd)!, { user: plan.forUser?.name ?? user.name }) });
    if (!v.ok) return false;
    this.lastWelcomeBuildAt = now;
    if (!quiet) this.deps.say(fill(pick(['{user}. welcome. hold on, building you something.', 'new voice. {user}. give me a second, I have an idea.'], this.rnd)!, { user: user.name }));
    return true;
  }

  // -- the loop -----------------------------------------------------------------

  async tick(): Promise<void> {
    const now = this.now();
    const cfg = this.deps.cfg.host;
    if (!cfg.enabled || this.paused) return;
    const s = this.deps.ctx.store.state;
    if (this.lastWorld !== s.world) {
      this.lastWorld = s.world;
      this.worldEnteredAt = now;
    }
    if (s.transition || s.character.vitals.blackout || s.character.vitals.collapsed) return;
    this.stepErrand(now);

    if (this.open) {
      if (now >= this.open.until) await this.resolveOpen();
      return;
    }

    const hints = cfg.mode === 'streamer' ? HINTS_STREAMER : HINTS_FULL;
    if (now - this.lastHintAt >= cfg.hintEveryMs) {
      this.lastHintAt = now;
      this.hintIdx = (this.hintIdx + 1) % hints.length;
      this.deps.ctx.store.dispatch({ type: 'set_hint', hint: hints[this.hintIdx] }, 'host');
    }

    if (now < this.nextOutreachAt) return;
    if (this.deps.ctx.store.voiceHeld) return;
    if (this.deps.builder?.busy || this.pendingAsk) return;
    if (this.deps.builder && now - this.deps.builder.lastFinishedAt < 15_000) return;
    await this.outreach();
  }

  /** Force the next outreach now (admin). */
  async forceAsk(): Promise<void> {
    if (this.open) await this.resolveOpen();
    await this.outreach();
  }

  /** Drop the open ask without resolving it (admin). */
  skip(): void {
    if (!this.open) return;
    this.open = null;
    this.deps.ctx.store.dispatch({ type: 'set_ask', ask: undefined }, 'host');
    this.scheduleNext(false);
  }

  private env(): HookEnv {
    const now = this.now();
    const state = this.deps.ctx.store.state;
    return {
      state,
      catalogue: this.deps.ctx.catalogue,
      profiles: this.deps.profiles,
      now,
      quietMs: now - this.lastChatAt,
      regulars: this.deps.profiles.regulars(now, 10 * 60_000),
      preferUser: this.preferUserId ? this.deps.profiles.get(this.preferUserId) : undefined,
      isNight: state.time >= 20 || state.time < 6,
      rnd: this.rnd,
      worlds: this.deps.worlds ?? [state.world],
      inWorldMs: now - this.worldEnteredAt,
      builder: this.deps.builder,
      mode: this.deps.cfg.host.mode,
      wardrobe: this.deps.ctx.wardrobe,
      errandCandidate:
        state.character.errand || now - this.lastErrandEndAt < 30 * 60_000
          ? undefined
          : pickErrand(state.world, this.deps.worlds ?? [state.world], this.deps.catalogueOf ?? (() => undefined), state.character.inventory ?? [], this.rnd) ?? undefined,
    };
  }

  /** The errand state machine: travel out, search (with chat's help), collect, come home. */
  private stepErrand(now: number): void {
    const store = this.deps.ctx.store;
    const s = store.state;
    const c = s.character;
    const e = c.errand;
    if (!e) return;
    const catalogue = this.deps.ctx.catalogue;
    const patch = (p: Partial<typeof e>) => store.dispatch({ type: 'set_character', patch: { errand: { ...e, ...p } } }, 'errand');
    const defs = ERRANDS_FOR(e.home).find((d) => d.item === e.item && d.world === e.target) ?? null;
    switch (e.stage) {
      case 'travelling':
        if (s.world === e.target) {
          patch({ stage: 'searching', since: now });
          this.deps.say(defs?.arrive ?? `here. now, a ${e.item.replace(/_/g, ' ')}.`);
        }
        return;
      case 'searching': {
        if (s.world !== e.target) return;
        const def = catalogue.sprites.find((d) => d.name === e.item);
        const item = s.entities.find((x) => x.sprite === e.item && !x.motion);
        if (item) {
          const cx = item.x + (def?.w ?? 8) / 2;
          if (Math.abs(cx - c.x) <= 22) {
            store.dispatch({ type: 'remove_entity', id: item.id }, 'errand');
            const bag = [...(c.inventory ?? []), e.item].slice(-BAG_LIMIT);
            store.dispatch({ type: 'set_character', patch: { inventory: bag, errand: { ...e, stage: 'found', since: now } } }, 'errand');
            this.deps.say(defs?.found ?? `got it. a ${e.item.replace(/_/g, ' ')}.`);
            log('host', `errand: collected ${e.item} in ${s.world}`);
          } else if (c.targetX === undefined && now - this.lastErrandWalkAt > 5_000) {
            this.lastErrandWalkAt = now;
            const targetX = Math.round(Math.max(8, Math.min(VIEW.worldW - 8, cx + (cx < c.x ? 12 : -12))));
            store.dispatch({ type: 'set_character', patch: { targetX, facing: targetX < c.x ? 'l' : 'r', mode: 'walk' } }, 'errand');
          }
        } else if (!e.spawned && now - e.since > 4 * 60_000 && def) {
          const x = Math.round(Math.max(0, Math.min(VIEW.worldW - def.w, s.camera.x + 300 + this.rnd() * 120)));
          store.dispatch({ type: 'add_entity', entity: { id: `errand-${now.toString(36)}`, sprite: def.name, layer: def.layers[0], x, y: def.layers[0] === 'stage' ? VIEW.groundY - def.h : 160, addedBy: 'world', addedByName: 'the world', addedAt: now, touchedAt: now, expiresAt: now + 20 * 60_000 } }, 'errand');
          patch({ spawned: true });
          this.deps.say(pick(['there. behind that. I knew it.', 'found one. nobody tell chat I did it myself.', 'and there it is. half buried. typical.'], this.rnd)!);
        }
        return;
      }
      case 'found':
        if (now - e.since > 90_000 && !s.transition && !s.vote) {
          this.deps.say(pick([`home, then. the ${e.home} will have missed me.`, 'right. back the way we came.', 'that is the errand done. let us go home.'], this.rnd)!);
          beginTravel(this.deps.ctx, e.home, now);
          patch({ stage: 'returning', since: now });
        }
        return;
      case 'returning':
        if (s.world === e.home) {
          store.dispatch({ type: 'set_character', patch: { errand: undefined } }, 'errand');
          this.lastErrandEndAt = now;
          this.deps.say(pick([`back. with a ${e.item.replace(/_/g, ' ')}. worth it.`, 'home. the bag is heavier. the world is bigger.', `I brought a ${e.item.replace(/_/g, ' ')}. you are welcome.`], this.rnd)!);
          log('host', `errand complete: ${e.item}`);
        }
        return;
    }
  }

  private chooseHook(env: HookEnv): Hook | null {
    const world = env.state.world;
    // A body in trouble outranks everything else.
    const inMode = (h: Hook) => !h.modes || h.modes.includes(this.deps.cfg.host.mode);
    const urgent = this.deps.hooks
      .filter((h) => inMode(h) && h.urgency && (!h.worlds || h.worlds.includes(world)) && (this.cooldownUntil.get(h.id) ?? 0) <= env.now && (!h.when || h.when(env)))
      .map((h) => ({ h, u: h.urgency!(env) }))
      .filter((x) => x.u > 0)
      .sort((a, b) => b.u - a.u);
    if (urgent.length) return urgent[0].h;
    // An active arc takes the floor when its next step is ready (full mode only).
    if (this.deps.cfg.host.mode !== 'full') this.arc = null;
    else if (this.arc) {
      const stepId = this.arc.arc.steps[this.arc.step];
      const hook = this.deps.hooks.find((h) => h.id === stepId);
      if (hook && (!hook.when || hook.when(env))) return hook;
    } else {
      const candidates = this.deps.arcs.filter((a) => a.world === world && (this.arcCooldownUntil.get(a.id) ?? 0) <= env.now);
      const arc = pick(candidates, this.rnd);
      if (arc && this.rnd() < 0.5) {
        this.arc = { arc, step: 0 };
        const hook = this.deps.hooks.find((h) => h.id === arc.steps[0]);
        if (hook && (!hook.when || hook.when(env))) return hook;
      }
    }
    const pool = this.deps.hooks.filter((h) => inMode(h) && !h.arcOnly && h.weight > 0 && (!h.worlds || h.worlds.includes(world)) && (this.cooldownUntil.get(h.id) ?? 0) <= env.now && (!h.when || h.when(env)));
    if (!pool.length) return null;
    const total = pool.reduce((a, h) => a + h.weight, 0);
    let r = this.rnd() * total;
    for (const h of pool) {
      r -= h.weight;
      if (r <= 0) return h;
    }
    return pool[pool.length - 1];
  }

  private async outreach(): Promise<void> {
    const env = this.env();
    const hook = this.chooseHook(env);
    if (!hook) {
      this.scheduleNext(false);
      return;
    }
    const ask = hook.ask(env);
    if (!ask) {
      this.scheduleNext(false);
      return;
    }
    let text = ask.text;
    if (ask.brief && this.deps.brain && this.canUseModel()) {
      try {
        this.modelCalls.push(this.now());
        const voiced = await this.deps.brain.voice(ask.brief);
        if (voiced) text = voiced;
      } catch (err) {
        log('host', 'voice failed, using the line bank', String(err));
      }
    }
    this.cooldownUntil.set(hook.id, this.now() + hook.cooldownMs);
    if (ask.delayMs && ask.delayMs > 0) {
      this.pendingAsk = setTimeout(() => {
        this.pendingAsk = null;
        this.openAsk(hook, { ...ask, text });
      }, ask.delayMs);
      return;
    }
    this.openAsk(hook, { ...ask, text });
  }

  private async openAsk(hook: Hook, ask: HookAsk): Promise<void> {
    const text = ask.text;
    const now = this.now();
    const timeoutMs = ask.timeoutMs ?? this.deps.cfg.host.askTimeoutMs;
    this.open = { hook, ask, askId: randomUUID().slice(0, 8), openedAt: now, until: now + timeoutMs, answers: new Map(), data: { ...(ask.data ?? {}) } };
    this.lastOutreachAt = now;
    this.preferUserId = null;
    log('host', `ask ${hook.id}`, { text, answer: ask.answer.type, collect: Boolean(ask.collect) });
    this.deps.say(text);
    if (ask.answer.type !== 'none') {
      this.deps.ctx.store.dispatch({ type: 'set_ask', ask: { id: this.open.askId, text, hint: ask.hint, until: this.open.until, totalMs: timeoutMs } }, 'host');
      if (ask.hint) this.deps.ctx.store.dispatch({ type: 'set_hint', hint: ask.hint }, 'host');
    }
    if (timeoutMs <= 1) await this.resolveOpen();
  }

  private async resolveWithAnswer(a: Answer): Promise<void> {
    const open = this.open;
    if (!open || !open.hook.onAnswer) return;
    this.open = null;
    this.deps.ctx.store.dispatch({ type: 'set_ask', ask: undefined }, 'host');
    try {
      const result = await open.hook.onAnswer(this.env(), this.actions(), a, open.data);
      if (result.say) this.deps.say(result.say);
      log('host', `answered ${open.hook.id} by ${a.msg.user.name}`, { value: a.value });
      this.preferUserId = a.msg.user.id;
      if (result.done) this.advanceArc(open.hook);
    } catch (err) {
      log('host', `onAnswer failed for ${open.hook.id}`, String(err));
    }
    this.scheduleNext(true);
  }

  private async resolveOpen(): Promise<void> {
    const open = this.open;
    if (!open) return;
    this.open = null;
    this.deps.ctx.store.dispatch({ type: 'set_ask', ask: undefined }, 'host');
    const env = this.env();
    const act = this.actions();
    try {
      if (open.ask.collect && open.answers.size && open.hook.onResolve) {
        const answers = [...open.answers.values()];
        const line = await open.hook.onResolve(env, act, answers, open.data);
        if (line) this.deps.say(line);
        for (const a of answers) this.deps.profiles.touch(a.msg.user, env.now);
        this.preferUserId = answers[answers.length - 1].msg.user.id;
        log('host', `resolved ${open.hook.id}`, { answers: answers.length });
        this.advanceArc(open.hook);
        this.scheduleNext(true);
        return;
      }
      const line = open.ask.collect && open.hook.onResolve ? await open.hook.onResolve(env, act, [], open.data) : open.hook.onTimeout?.(env, act, open.data);
      if (line) this.deps.say(line);
      log('host', `timed out ${open.hook.id}`);
      if (open.ask.answer.type === 'none') this.advanceArc(open.hook);
      else if (this.arc && this.arc.arc.steps[this.arc.step] === open.hook.id) this.arc.step = Math.max(0, this.arc.step); // stay on the step, try again later
    } catch (err) {
      log('host', `resolve failed for ${open.hook.id}`, String(err));
    }
    this.scheduleNext(false);
  }

  private advanceArc(hook: Hook): void {
    if (!this.arc) return;
    if (this.arc.arc.steps[this.arc.step] !== hook.id) return;
    this.arc.step++;
    if (this.arc.step >= this.arc.arc.steps.length) {
      if (this.arc.arc.ending) setTimeout(() => this.deps.say(this.arc?.arc.ending ?? ''), 8000);
      this.arcCooldownUntil.set(this.arc.arc.id, this.now() + this.arc.arc.cooldownMs);
      log('host', `arc ${this.arc.arc.id} complete`);
      this.arc = null;
    }
  }

  private scheduleNext(afterAnswer: boolean): void {
    const now = this.now();
    const cfg = this.deps.cfg.host;
    const quiet = now - this.lastChatAt > cfg.quietAfterMs;
    const base = afterAnswer ? cfg.followUpCadenceMs : quiet ? Math.min(cfg.quietCadenceMs, cfg.buildEveryMs * 0.6) : Math.min(cfg.busyCadenceMs, cfg.buildEveryMs);
    this.nextOutreachAt = now + base * (0.8 + this.rnd() * 0.4);
  }

  private canUseModel(): boolean {
    const now = this.now();
    this.modelCalls = this.modelCalls.filter((t) => now - t < 3_600_000);
    return this.modelCalls.length < this.deps.cfg.host.maxModelCallsPerHour;
  }

  private actions(): HookActions {
    const { ctx } = this.deps;
    const store = ctx.store;
    const walkTo = (x: number): void => {
      const c = store.state.character;
      const targetX = Math.round(Math.max(8, Math.min(VIEW.worldW - 8, x)));
      store.dispatch({ type: 'set_character', patch: { targetX, facing: targetX < c.x ? 'l' : 'r', mode: c.mode === 'travel' ? 'travel' : 'walk' } }, 'host');
    };
    return {
      say: (text) => this.deps.say(text),
      walkTo,
      walkToEntity: (id) => {
        const e = store.state.entities.find((x) => x.id === id);
        if (!e) return;
        const def = ctx.catalogue.sprites.find((s) => s.name === e.sprite);
        const centre = e.x + (def?.w ?? 8) / 2;
        walkTo(centre + (centre < store.state.character.x ? 14 : -14));
      },
      spawn: (name) => {
        const def = (ctx.catalogue.ambient ?? []).find((a) => a.name === name);
        if (!def || store.state.entities.some((e) => e.id.startsWith(ambientPrefix(def.name)))) return;
        store.dispatch({ type: 'add_entity', entity: makeAmbientEntity(def, this.now()) }, 'host');
      },
      label: (id, name) => store.dispatch({ type: 'label_entity', id, label: name }, 'host'),
      follow: (id, on) => store.dispatch({ type: 'set_follow', id, follow: on }, 'host'),
      setWeather: (w) => store.dispatch({ type: 'set_weather', weather: w }, 'host'),
      openVote: (world: World) => {
        if (store.state.vote || store.state.transition || world === store.state.world) return;
        ctx.votes = new Set();
        store.dispatch({ type: 'set_vote', vote: { to: world, count: 0, needed: ctx.cfg.votes.worldChangeVoters, until: this.now() + ctx.cfg.votes.windowMs } }, 'host');
      },
      travel: (world: World) => {
        if (store.state.transition || world === store.state.world) return;
        beginTravel(ctx, world, this.now());
      },
      startErrand: (def: ErrandDef) => {
        if (store.state.transition || store.state.character.errand) return;
        const now = this.now();
        store.dispatch({ type: 'set_character', patch: { errand: { item: def.item, target: def.world, home: store.state.world, stage: 'travelling', since: now } } }, 'errand');
        beginTravel(ctx, def.world, now);
        log('host', `errand: leaving ${store.state.world} for ${def.world} to fetch ${def.item}`);
      },
      addForViewer: (cmd, msg) => runCommand(cmd, { ...msg, user: { ...msg.user, badges: [...msg.user.badges, 'moderator'] }, at: this.now() }, { ...ctx, silent: true }).applied,
      judge: async (question, candidates) => {
        if (!this.deps.brain || !this.canUseModel() || candidates.length < 2) return candidates[0] ?? null;
        try {
          this.modelCalls.push(this.now());
          const picked = await this.deps.brain.pick(question, candidates.map((c) => ({ userId: c.msg.user.id, name: c.msg.user.name, text: c.value })));
          if (!picked) return candidates[0];
          return candidates.find((c) => c.msg.user.id === picked.userId) ?? candidates[0];
        } catch (err) {
          log('host', 'judge failed, taking the first answer', String(err));
          return candidates[0];
        }
      },
      entityByViewer: (userId, sprite) => {
        const mine = store.state.entities.filter((e) => e.addedBy === userId && (!sprite || e.sprite === sprite));
        return mine[mine.length - 1] as Entity | undefined;
      },
    };
  }
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? `{${k}}`);
}
