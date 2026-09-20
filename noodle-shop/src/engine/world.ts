// The contract every world implements. The engine is generic over the world's
// state type S and only ever touches state through these callbacks, so the
// same engine hosts the server room, and later the apartment block, nursery,
// garden, ... without changes.

import type { z } from 'zod';
import type { ChatReceipt, Scene, SceneChatMessage, SpeechBubble, WalkSegment } from '../shared/sceneTypes';

export interface ChatMessage {
  id: string; // kick message_id or dev-generated uuid; dedupe key
  userId: string; // `kick:<user_id>` or `dev:<name>` — ownership key, stable across streams
  username: string;
  text: string;
  ts: number;
  source: 'kick' | 'dev';
}

export interface TaskSpec<S> {
  kind: string; // world-defined: 'provision' | 'patch' | ...
  label: string; // HUD queue text: "install box for dave"
  requestedBy?: string; // username shown on the HUD
  targetX: number; // protagonist walks here before working
  workMs: number;
  priority?: number; // default 0; higher runs first, FIFO within a priority
  emergency?: boolean; // runs while the world's ordinary work is suspended
  onStart?(ctx: WorldCtx<S>): void;
  onComplete(ctx: WorldCtx<S>): void; // the ONLY place task-driven mutations happen
}

export interface QueueEntryView {
  id: string;
  kind: string;
  label: string;
  requestedBy?: string;
}

export interface DialogueRequest {
  instruction: string; // what the protagonist should do ("reply to this chatter", "idle one-liner")
  userLine?: string; // the chat message being replied to, if any
  username?: string;
}

/** What the held buffer contained when a deaf world could hear again. */
export interface ChatFlood {
  held: number; // messages the buffer released
  displayed: number; // reached the display history
  acted: number; // classified and handled as intents
  overflowed: number; // arrivals lost to the buffer cap
  people: number; // distinct chatters in the flood
  deafMs: number; // how long the world could not hear
}

export interface WorldCtx<S> {
  readonly state: S; // mutate freely; the engine snapshots/broadcasts afterwards
  readonly now: number;
  checkpoint?(): void; // durable world transition; throws if saving fails
  log(line: string, level?: 'info' | 'warn' | 'alert'): void; // terminal + JSONL
  say(text: string, opts?: { toKick?: boolean }): void; // speech bubble; mirrors to Kick only if the toggle is on
  enqueueTask(task: TaskSpec<S>): { id: string };
  readonly queue: ReadonlyArray<QueueEntryView>;
  llm: {
    dialogue(req: DialogueRequest): Promise<string | null>; // AGENT_MODEL + persona; null if unavailable
    moderate(text: string, maxLen: number): Promise<{ ok: boolean; cleaned?: string }>;
  };
  readonly tuning: Readonly<Record<string, number>>;
  // Live audience volume in messages per sim-minute — a world's demand signal.
  // Already divided by DEV_TIME_SCALE, so it stays comparable to the per-minute
  // rates a scaled tick works in.
  readonly chatRatePerMin: number;
  // Set only while the engine is replaying messages held through an outage,
  // newest last. `remaining` counts how many replayed messages come after this
  // one, so a world can answer the newest and stay quiet about the rest
  // instead of talking over its own reaction to the flood.
  readonly replay?: { remaining: number };
  rng(): number;
}

export interface IntentDef<S> {
  name: string; // 'provision'
  description: string; // one line, goes verbatim into the classifier prompt
  examples: string[]; // few-shot lines for the classifier prompt
  paramsSchema?: z.ZodType<unknown>; // classifier-extracted params, validated before handle()
  handle(ctx: WorldCtx<S>, msg: ChatMessage, params: unknown): void | Promise<void>;
}

export interface WorldEventDef<S> {
  name: string;
  weight(state: S): number; // 0 disables; the engine rolls on a timer
  trigger(ctx: WorldCtx<S>): void;
}

export interface Persona<S> {
  name: string; // "Admin"
  systemPrompt: string; // the character card
  summarizeState(state: S, now?: number): string; // compact world summary injected into every dialogue call
  idleMutterMs: number; // 0 disables idle chatter
  // What the protagonist should be chewing on when they have nothing to do —
  // appended to the idle-line instruction so the world, not the engine, decides
  // what's worth muttering about right now.
  idleFocus?(state: S): string | undefined;
}

export interface AdminAction<S> {
  id: string;
  label: string;
  /** An action that takes a value from the operator (rendered as a field beside the button): a number unless `kind` is text. */
  input?: {
    kind?: 'number' | 'text';
    label: string;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
    maxLength?: number;
  };
  run(ctx: WorldCtx<S>, value?: number | string): void;
}

// Engine-owned data the world needs to build the scene.
export interface EngineView {
  protagonist: {
    x: number;
    state: 'idle' | 'walking' | 'working';
    walk?: WalkSegment;
  };
  currentTask?: { kind: string; label: string; requestedBy?: string; progress: number };
  pendingTasks: { label: string; requestedBy?: string }[];
  speech?: SpeechBubble;
  logLines: string[];
  recentChat: SceneChatMessage[];
  chatRevision: number;
  now: number;
}

export interface WorldLayout {
  width: number;
  height: number;
  worldWidth: number;
  protagonistHomeX: number;
  walkSpeedPxPerSec: number;
  protagonistHeightPx?: number; // human-scale figure height in world px
}

export interface WorldModule<S> {
  meta: { id: string; name: string; stateVersion: number };
  stateSchema: z.ZodType<S>; // validates loaded snapshots
  createInitialState(now: number): S;
  start?(ctx: WorldCtx<S>): void | (() => void); // optional per-engine service; returns shutdown cleanup
  // Fresh state for an operator reset. Worlds use it to carry over operator
  // settings (cost controls) that a reset should not silently undo.
  reset?(previous: S, now: number): S;
  migrate(raw: unknown, fromVersion: number): S; // snapshot upgrades across stateVersion bumps
  intents: IntentDef<S>[];
  fallbackIntent: string; // 'ask' — used below the confidence threshold / on classifier failure
  chatThrottleMs?: number; // worlds with durable admission may handle their own visible cooldown
  quickClassify?(text: string): { intent: string; params?: unknown } | null; // zero-cost regex fast path
  events: WorldEventDef<S>[]; // [] for MVP; the engine's roll machinery runs regardless
  tickMs?: number; // optional finer world simulation cadence, no faster than engine loop
  tick(ctx: WorldCtx<S>, dtMs: number): void; // sim update, dt already scaled by DEV_TIME_SCALE
  // First look at every arriving message, before classification. The world may
  // react to it (the message is load, not just a request) and may ask for it to
  // be held — the server room admits new arrivals at the rate its AUTH box can
  // manage. Held messages are delayed, never dropped.
  receiveMessage?(ctx: WorldCtx<S>, msg: ChatMessage): { holdMs?: number } | void;
  // Whether the world can take chat in at all right now. While this is false
  // the engine HOLDS arrivals instead of processing them: the server room goes
  // deaf when it has no capacity left to carry anything (brief §5.7). Held
  // messages are delayed, never dropped, and land together once it clears.
  audible?(state: S): boolean;
  emergency?(state: S): boolean; // suspend ordinary work, events, and conversation
  // Called once when the world can hear again, so it can react to the flood.
  onAudible?(ctx: WorldCtx<S>, flood: ChatFlood): void;
  // Pure, transient annotation captured after admission. Never part of saved state.
  displayReceipt?(state: S, sequence: number, now: number): ChatReceipt;
  // Called once at boot. The world decides from its own state whether enough
  // offline time passed to count as a new stream, applies between-stream
  // simulation, and returns facts for the protagonist's stream-start recap.
  applyOfflineTime?(ctx: WorldCtx<S>): string[];
  buildScene(state: S, view: EngineView): Scene;
  // Geometry the scene refers to by id+revision rather than carrying in every snapshot
  // (served by POST /api/objects/parts). Return undefined for anything unknown.
  objectParts?(state: S, id: string, revision: number): unknown;
  persona: Persona<S>;
  adminActions?: AdminAction<S>[];
  tuning: Record<string, number>;
  layout: WorldLayout;
}
