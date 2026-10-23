// The test harness for the ai-dudes world: a scripted agent, a minimal engine context and a clock
// the test moves. Shared by every *.test.ts here.
import type { WorldCtx } from '../src/engine/world';
import { createAiDudesWorld, type DudesOptions } from '../src/worlds/ai-dudes';
import type { AgentFn, AgentReply, AgentTurn } from '../src/worlds/ai-dudes/agent';
import { fixtureDesign } from '../src/worlds/ai-dudes/fixtures';
import type { DudesState } from '../src/worlds/ai-dudes/state';

export const flush = () => new Promise((r) => setImmediate(r));

/** A world with a scripted agent, a minimal engine context and a clock the test moves. */
export function harness(options: Partial<DudesOptions> & { reply?: (turn: AgentTurn) => AgentReply | Promise<AgentReply>; events?: boolean; idleLife?: boolean; town?: boolean } = {}) {
  const turns: AgentTurn[] = [];
  let inFlight = 0,
    peak = 0;
  const agent: AgentFn =
    options.agent ??
    (async (turn) => {
      turns.push(turn);
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await flush();
        return (await options.reply?.(turn)) ?? { actions: [] };
      } finally {
        inFlight--;
      }
    });
  const world = createAiDudesWorld({
    agent,
    design: options.design ?? fixtureDesign,
    fixture: true,
    available: true,
    agentLimit: options.agentLimit ?? 4,
    designLimit: options.designLimit ?? 3,
    allowance: options.allowance ?? 1000,
    // The rolling budget is generous unless a test is about it.
    agentPerHour: options.agentPerHour ?? 1_000_000,
    designPerHour: options.designPerHour ?? 1_000_000,
    agentModel: 'test',
    designModel: 'test',
    turnGapMs: options.turnGapMs ?? 0,
    ...(options.listener ? { listener: options.listener } : {}),
    ...(options.aide ? { aide: options.aide } : {}),
    ...(options.writeWishes ? { writeWishes: options.writeWishes } : {}),
  });
  let seed = 7;
  const h = {
    now: 1_000_000,
    state: undefined as unknown as DudesState,
    logs: [] as string[],
    /** What the Town Crier posted to chat. */
    announced: [] as string[],
    turns,
    get peak() {
      return peak;
    },
  };
  const ctx: WorldCtx<DudesState> = {
    get state() {
      return h.state;
    },
    get now() {
      return h.now;
    },
    log: (line) => void h.logs.push(line),
    say: () => {},
    announce: (text) => void h.announced.push(text),
    enqueueTask: () => ({ id: '' }),
    queue: [],
    llm: { dialogue: async () => null, moderate: async () => ({ ok: true }) },
    tuning: {},
    chatRatePerMin: 0,
    rng: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
  };
  h.state = world.createInitialState(h.now);
  // Troublemakers and idle turns are opt-in per test, so the older tests see only what they asked for.
  h.state.ai.events = options.events ?? false;
  h.state.ai.idleLife = options.idleLife ?? false;
  h.state.listener = { enabled: !!options.listener, buffer: [], wishes: [], tips: [], lastRunAt: 0, runs: 0 };
  // Residents and needs-driven outings are opt-in, so the older tests see only what they asked for.
  h.state.ai.townLife = options.town ?? false;
  world.start!(ctx);
  const say = (user: string, text: string) =>
    world.intents[0].handle(ctx, { id: `${user}:${h.now}:${text}`, userId: `dev:${user}`, username: user, text, ts: h.now, source: 'dev' }, undefined);
  const tick = async (ms: number, step = 500) => {
    for (let t = 0; t < ms; t += step) {
      h.now += step;
      world.tick(ctx, step);
      await flush();
    }
  };
  return { world, ctx, h, say, tick };
}

