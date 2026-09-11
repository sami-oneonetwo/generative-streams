import type { Scene, SceneChatMessage, SpeechBubble } from '../shared/sceneTypes';
import type { ClassificationRecord } from '../shared/protocol';
import { config } from '../config';
import { chatCompletion } from '../llm/openrouter';
import { DialogueService, extractSpokenLine } from '../llm/dialogue';
import { moderateText } from '../llm/moderate';
import { ChatRateMeter } from './chatRate';
import { TerminalLog } from './log';
import { ProtagonistModel } from './protagonist';
import { TaskQueue } from './tasks';
import { loadState, saveState } from './persistence';
import { IntentPipeline } from './intents';
import type { ChatMessage, DialogueRequest, EngineView, WorldCtx, WorldModule } from './world';

export interface EngineFlags {
  kickRepliesEnabled: boolean;
  devTimeScale: number;
}

export interface EngineOptions {
  dataDir: string;
  confidenceThreshold: number;
  flags: EngineFlags;
}

const RECENT_CHAT = 30;
const RECENT_SELF_LINES = 10;
const CLASSIFICATION_HISTORY = 20;

export class Engine<S> {
  readonly world: WorldModule<S>;
  state: S;
  readonly log: TerminalLog;
  readonly tasks: TaskQueue<S>;
  readonly protagonist: ProtagonistModel;
  readonly ctx: WorldCtx<S>;
  readonly pipeline: IntentPipeline<S>;
  readonly dataDir: string;
  readonly confidenceThreshold: number;
  readonly flags: EngineFlags;

  speech: SpeechBubble | null = null;
  recentChat: SceneChatMessage[] = [];
  readonly chatRate = new ChatRateMeter();
  chatRevision = 0;
  recentSelfLines: string[] = [];
  classifications: ClassificationRecord[] = [];
  rev = 0;
  renderDirty = true;
  lastWebhookAt?: number;
  nextEventRollAt = 0;
  nextMutterAt = 0;
  /** Set by the pipeline while it replays messages held through an outage. */
  replay: { remaining: number } | undefined;
  kickSend: ((text: string) => void) | null = null;

  private dialogueService: DialogueService;
  private mode = '';
  generation = 0;

  get emergencyActive(): boolean { return this.world.emergency?.(this.state) === true; }

  syncMode(): number {
    const mode = `${this.emergencyActive}:${this.world.audible?.(this.state) !== false}`;
    if (mode !== this.mode) {
      this.mode = mode;
      this.generation = (this.generation ?? 0) + 1;
    }
    if (this.emergencyActive) this.tasks.interrupt(Date.now(), this.protagonist);
    return this.generation;
  }

  constructor(world: WorldModule<S>, opts: EngineOptions) {
    this.world = world;
    this.dataDir = opts.dataDir;
    this.confidenceThreshold = opts.confidenceThreshold;
    this.flags = opts.flags;
    this.log = new TerminalLog(opts.dataDir);
    this.state = loadState(world, opts.dataDir, (line, level) => this.log.push(line, level));
    this.protagonist = new ProtagonistModel(world.layout.protagonistHomeX, world.layout.walkSpeedPxPerSec);
    this.tasks = new TaskQueue<S>();
    this.dialogueService = new DialogueService(3, () =>
      this.log.push('dialogue queue full; dropping a line', 'warn'),
    );
    this.ctx = this.makeCtx();
    this.pipeline = new IntentPipeline(this);
    this.log.push(`world '${world.meta.id}' up (${world.meta.name})`);
  }

  private makeCtx(): WorldCtx<S> {
    const engine = this;
    return {
      get state() {
        return engine.state;
      },
      get now() {
        return Date.now();
      },
      log: (line, level) => {
        engine.log.push(line, level);
        engine.markDirty();
      },
      say: (text, opts) => engine.say(text, opts),
      enqueueTask: (spec) => {
        const r = engine.tasks.enqueue(spec);
        engine.markDirty();
        return r;
      },
      get queue() {
        return engine.tasks.view();
      },
      llm: {
        dialogue: (req) => engine.generateDialogue(req),
        moderate: async (text, maxLen) => {
          const generation = engine.syncMode();
          if (engine.emergencyActive) return { ok: false };
          const result = await moderateText(text, maxLen, (m) => engine.log.push(m, 'warn'));
          return generation === engine.syncMode() ? result : { ok: false };
        },
      },
      tuning: this.world.tuning,
      get chatRatePerMin() {
        // Scaled dev time means fewer real messages per sim-minute, so the
        // measured real-time rate has to be divided by the scale to stay honest.
        return engine.chatRate.ratePerMin(Date.now()) / Math.max(1, engine.flags.devTimeScale);
      },
      get replay() {
        return engine.replay;
      },
      rng: Math.random,
    };
  }

  say(text: string, opts?: { toKick?: boolean }): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const ttl = Math.max(4000, Math.min(12_000, 2500 + trimmed.length * 60));
    this.speech = { text: trimmed, until: Date.now() + ttl };
    this.log.push(`[${this.world.persona.name.toLowerCase()}] ${trimmed}`);
    this.recentSelfLines.push(trimmed);
    if (this.recentSelfLines.length > RECENT_SELF_LINES) this.recentSelfLines.shift();
    this.deferMutter();
    if (opts?.toKick && this.flags.kickRepliesEnabled && this.kickSend) {
      this.kickSend(trimmed);
    }
    this.markDirty();
  }

  deferMutter(): void {
    const idle = this.world.persona.idleMutterMs;
    // Jitter proportional to the interval, not a flat 30s: at a 30s cadence a
    // flat half-minute of slop was doubling the gap it was meant to soften.
    if (idle > 0) this.nextMutterAt = Date.now() + idle + Math.random() * (idle / 2);
  }

  async generateDialogue(req: DialogueRequest): Promise<string | null> {
    const generation = this.syncMode();
    if (this.emergencyActive) return null; // Recovery uses short, deterministic world lines.
    const persona = this.world.persona;
    // While the world can't hear, nothing new is in this history — it is all
    // from before the screen died, and saying so keeps him from answering it
    // as though it just arrived.
    const chatHeading =
      this.world.audible?.(this.state) === false ? 'Chat from before the monitor went dead' : 'Recent chat';
    const content = [
      `Current world state:\n${persona.summarizeState(this.state, Date.now())}`,
      this.recentChat.length
        ? `${chatHeading}:\n${this.recentChat
            .slice(-20)
            .map((m) => `${m.username}: ${m.text}`)
            .join('\n')}`
        : '',
      this.recentSelfLines.length ? `Your recent lines:\n${this.recentSelfLines.join('\n')}` : '',
      req.instruction,
      req.userLine ? `Message from ${req.username ?? 'a chatter'}: ${JSON.stringify(req.userLine)}` : '',
      'Output exactly one line, prefixed with `SAY:`, containing only the words you speak aloud.' +
        ' No quotes, no stage directions, and no planning or commentary before it.',
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const out = await this.dialogueService.run(() =>
        chatCompletion({
          model: config.AGENT_MODEL,
          system: persona.systemPrompt,
          messages: [{ role: 'user', content }],
          temperature: 0.9,
          maxTokens: 200,
          timeoutMs: 30_000,
        }),
      );
      if (!out || generation !== this.syncMode()) return null;
      const line = extractSpokenLine(out);
      if (!line) {
        this.log.push(`dialogue produced no speakable line; raw: ${JSON.stringify(out.slice(0, 120))}`, 'warn');
        return null;
      }
      // Loud on purpose: a leak that reaches say() also reaches the Kick chat.
      if (line !== out.trim()) {
        this.log.push(`stripped non-spoken text from dialogue; raw: ${JSON.stringify(out.slice(0, 160))}`, 'warn');
      }
      return line;
    } catch (e) {
      this.log.push(`dialogue error: ${(e as Error).message}`, 'warn');
      return null;
    }
  }

  /**
   * A message reaching the room's display history. The rate meter is fed on
   * arrival instead (see IntentPipeline), because a held message is already
   * load even though chat can't see it yet.
   */
  recordChat(msg: ChatMessage): void {
    this.chatRevision++;
    const receipt = this.world?.displayReceipt?.(this.state, this.chatRevision, Date.now());
    this.recentChat.push({ username: msg.username, text: msg.text, ...(receipt ? { receipt } : {}) });
    if (this.recentChat.length > RECENT_CHAT) this.recentChat.shift();
    this.markDirty();
  }

  recordClassification(rec: ClassificationRecord): void {
    this.classifications.push(rec);
    if (this.classifications.length > CLASSIFICATION_HISTORY) this.classifications.shift();
  }

  markDirty(): void {
    this.renderDirty = true;
  }

  buildView(now: number): EngineView {
    const current = this.tasks.current;
    return {
      protagonist: {
        x: this.protagonist.currentX(now),
        state: this.protagonist.state,
        walk: this.protagonist.walk,
      },
      currentTask: current
        ? {
            kind: current.spec.kind,
            label: current.spec.label,
            requestedBy: current.spec.requestedBy,
            progress: this.tasks.progress(now),
          }
        : undefined,
      pendingTasks: this.tasks.pendingView(),
      speech: this.speech ?? undefined,
      logLines: this.log.tail(8),
      recentChat: this.recentChat.map(({ username, text, receipt }) => ({ username, text, ...(receipt ? { receipt: { ...receipt } } : {}) })),
      chatRevision: this.chatRevision,
      now,
    };
  }

  buildScene(now: number): Scene {
    return this.world.buildScene(this.state, this.buildView(now));
  }

  save(): void {
    saveState(this.world, this.dataDir, this.state);
  }

  /** Between-stream simulation at boot; returns facts for the recap narration. */
  applyOfflineTime(): string[] {
    if (!this.world.applyOfflineTime) return [];
    try {
      const facts = this.world.applyOfflineTime(this.ctx);
      for (const fact of facts) this.log.push(fact);
      if (facts.length) this.save();
      return facts;
    } catch (e) {
      this.log.push(`offline-time processing failed: ${(e as Error).message}`, 'alert');
      return [];
    }
  }

  /** Force a specific world event by name (admin/dev). */
  triggerEvent(name: string): boolean {
    if (this.emergencyActive) return false;
    const def = this.world.events.find((d) => d.name === name);
    if (!def) return false;
    try {
      def.trigger(this.ctx);
      this.log.push(`event forced: ${name} (admin)`);
    } catch (e) {
      this.log.push(`event '${name}' failed: ${(e as Error).message}`, 'warn');
    }
    this.markDirty();
    return true;
  }
}
