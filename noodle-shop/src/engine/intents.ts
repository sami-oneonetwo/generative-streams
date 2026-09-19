import { classifyMessage } from '../llm/classify';
import type { Engine } from './engine';
import type { ChatFlood, ChatMessage, IntentDef } from './world';

const DEDUPE_CAP = 1000;
const PER_USER_MIN_MS = 3000;
// A deaf world holds arrivals rather than processing them. The buffer is bounded
// so an outage during a raid can't grow without limit, and everything that comes
// out of it is displayed — only the newest few are worth acting on, because by
// then the room has moved on and the burst would otherwise be one classifier
// call per held message (brief §5.7, and the replay decision in §5.17).
const HELD_CAP = 200;
const ACT_CAP = 8;

export class IntentPipeline<S> {
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private lastAccepted = new Map<string, number>();
  private held: ChatMessage[] = [];
  private alreadyDisplayed = new Set<string>();
  private overflowed = 0;
  private heldSince: number | undefined;
  private releasing = false;

  constructor(private engine: Engine<S>) {}

  /** How many arrivals are waiting for the world to be able to hear again. */
  get heldCount(): number {
    return this.held.length;
  }

  async handle(msg: ChatMessage): Promise<void> {
    if (this.seen.has(msg.id)) return;
    this.seen.add(msg.id);
    this.seenOrder.push(msg.id);
    if (this.seenOrder.length > DEDUPE_CAP) this.seen.delete(this.seenOrder.shift()!);

    const now = Date.now();
    const last = this.lastAccepted.get(msg.userId) ?? 0;
    if (now - last < (this.engine.world.chatThrottleMs ?? PER_USER_MIN_MS)) return;
    this.lastAccepted.delete(msg.userId);
    this.lastAccepted.set(msg.userId, now);
    if (this.lastAccepted.size > DEDUPE_CAP) this.lastAccepted.delete(this.lastAccepted.keys().next().value!);

    const engine = this.engine;
    const world = engine.world;

    // Demand is measured on arrival: a message is load whether or not it has
    // been admitted yet, and whatever happens to it after this.
    engine.chatRate.record(now);

    // Nothing in this room can hear it yet. Hold it — the monitor is static,
    // the protagonist is talking to a dead screen, and this lands when the
    // room comes back.
    if (world.audible?.(engine.state) === false || engine.emergencyActive) {
      this.hold(msg, now);
      return;
    }

    await this.process(msg);
  }

  private hold(msg: ChatMessage, now: number): void {
    const engine = this.engine;
    if (this.heldSince === undefined) {
      this.heldSince = now;
      engine.log.push('chat is not reaching the room; holding arrivals until it can hear again', 'alert');
    }
    this.held.push(msg);
    while (this.held.length > HELD_CAP) {
      const dropped = this.held.shift()!;
      this.alreadyDisplayed.delete(dropped.id);
      this.overflowed++;
    }
  }

  /**
   * The room can hear again, so everything held lands at once. Every message is
   * displayed, in arrival order; only the newest few are classified and run as
   * intents. Called from the loop, never awaited by an ingest path.
   */
  async release(): Promise<void> {
    const engine = this.engine;
    const world = engine.world;
    if (this.releasing || !this.held.length) return;
    if (world.audible?.(engine.state) === false || engine.emergencyActive) return;

    this.releasing = true;
    try {
      const batch = this.held.splice(0);
      const overflowed = this.overflowed;
      const deafMs = this.heldSince === undefined ? 0 : Math.max(0, Date.now() - this.heldSince);
      this.overflowed = 0;
      this.heldSince = undefined;

      const acting = batch.slice(-ACT_CAP);
      // The whole flood hits the screen in one go — that is the moment. The
      // newest few are then answered below, without being displayed twice.
      for (const msg of batch) {
        if (!this.alreadyDisplayed.delete(msg.id)) engine.recordChat(msg);
      }

      // The flood is the thing to react to, so that reaction goes first: each
      // replayed message can cost a model round trip, and a reaction to the
      // flood arriving after all of them is a reaction to nothing.
      const flood: ChatFlood = {
        held: batch.length,
        displayed: batch.length,
        acted: acting.length,
        overflowed,
        people: new Set(batch.map((m) => m.userId)).size,
        deafMs,
      };
      engine.log.push(
        `chat came back: ${flood.held} held message${flood.held === 1 ? '' : 's'} from ${flood.people} ` +
          `landed at once${overflowed ? `, ${overflowed} lost while deaf` : ''}`,
      );
      try {
        world.onAudible?.(engine.ctx, flood);
      } catch (e) {
        engine.log.push(`onAudible failed: ${(e as Error).message}`, 'warn');
      }
      engine.markDirty();

      // Sequential, so the newest few are answered in the order they arrived
      // rather than as a burst of parallel classifier calls. The world is told
      // how much of the flood is still behind each one.
      try {
        for (let i = 0; i < acting.length; i++) {
          engine.replay = { remaining: acting.length - 1 - i };
          await this.process(acting[i], { replay: true, displayed: true });
        }
      } finally {
        engine.replay = undefined;
      }
    } finally {
      this.releasing = false;
    }
  }

  /** Admission, display, classification, intent. The whole path for one message. */
  private async process(msg: ChatMessage, opts?: { replay?: boolean; displayed?: boolean }): Promise<void> {
    const engine = this.engine;
    const world = engine.world;
    const now = Date.now();

    if (world.audible?.(engine.state) === false || engine.emergencyActive) {
      if (opts?.displayed) this.alreadyDisplayed.add(msg.id);
      this.hold(msg, now);
      return;
    }
    const generation = engine.syncMode();

    // The world gets first look and may hold the message — a new arrival
    // waiting to be let in. Nothing awaits handle(), so a hold blocks nobody.
    let holdMs = 0;
    try {
      holdMs = world.receiveMessage?.(engine.ctx, msg)?.holdMs ?? 0;
    } catch (e) {
      engine.log.push(`receiveMessage failed: ${(e as Error).message}`, 'warn');
    }
    // A replayed message already waited out the whole outage at the door.
    if (holdMs > 0 && !opts?.replay) await new Promise((resolve) => setTimeout(resolve, holdMs));

    if (generation !== engine.syncMode()) {
      if (opts?.displayed) this.alreadyDisplayed.add(msg.id);
      this.hold(msg, now);
      return;
    }
    if (!opts?.displayed) engine.recordChat(msg);

    let intentName = world.fallbackIntent;
    let params: unknown;
    let confidence = 0;
    let source: 'regex' | 'llm' | 'fallback' = 'fallback';

    const quick = world.quickClassify?.(msg.text);
    if (quick && world.intents.some((i) => i.name === quick.intent)) {
      intentName = quick.intent;
      params = quick.params;
      confidence = 1;
      source = 'regex';
    } else {
      try {
        const result = await classifyMessage(world, msg);
        if (result) {
          confidence = result.confidence;
          const known = world.intents.some((i) => i.name === result.intent);
          if (known && result.confidence >= engine.confidenceThreshold) {
            intentName = result.intent;
            params = result.params;
            source = 'llm';
          }
        }
      } catch (e) {
        engine.log.push(`classifier error: ${(e as Error).message}`, 'warn');
      }
    }

    if (generation !== engine.syncMode()) {
      this.alreadyDisplayed.add(msg.id);
      this.hold(msg, now);
      return;
    }

    const def: IntentDef<S> | undefined =
      world.intents.find((i) => i.name === intentName) ??
      world.intents.find((i) => i.name === world.fallbackIntent);
    if (!def) {
      engine.log.push(`no handler for intent '${intentName}' and no fallback`, 'warn');
      return;
    }

    if (def.paramsSchema && params !== undefined) {
      const parsed = def.paramsSchema.safeParse(params);
      params = parsed.success ? parsed.data : undefined;
    }

    engine.recordClassification({
      ts: now,
      username: msg.username,
      text: msg.text,
      intent: def.name,
      confidence,
      source,
    });

    try {
      // A handler may await moderation/dialogue before it mutates or speaks.
      // Give that continuation a generation-bound context, not a stale live one.
      const ctx = engine.ctx;
      const current = () => generation === engine.syncMode();
      const guarded = Object.create(ctx) as typeof ctx;
      guarded.say = (text, options) => { if (current()) ctx.say(text, options); };
      guarded.enqueueTask = spec => current() ? ctx.enqueueTask(spec) : { id: 'interrupted' };
      guarded.llm = {
        dialogue: async req => { const line = await ctx.llm.dialogue(req); return current() ? line : null; },
        moderate: async (text, maxLen) => { const result = await ctx.llm.moderate(text, maxLen); return current() ? result : { ok: false }; },
      };
      await def.handle(guarded, msg, params);
    } catch (e) {
      engine.log.push(`intent '${def.name}' failed: ${(e as Error).message}`, 'warn');
    }
    engine.markDirty();
  }
}
