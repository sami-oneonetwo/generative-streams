// Minimal world proving the engine is world-agnostic (milestone M7):
// one conversational intent, an empty tick, a flat floor. If this runs, the
// engine, pipeline, HUD shell, persistence, and dialogue all work with zero
// server-room code involved.

import { z } from 'zod';
import type { WorldModule } from '../../engine/world';

const stateSchema = z.object({
  version: z.literal(1),
  greetings: z.number(),
});
type BlankState = z.infer<typeof stateSchema>;

export const blankWorld: WorldModule<BlankState> = {
  meta: { id: 'blank', name: 'Blank World', stateVersion: 1 },
  stateSchema,
  createInitialState: () => ({ version: 1, greetings: 0 }),
  migrate(_raw, fromVersion) {
    throw new Error(`no migration path from state version ${fromVersion}`);
  },
  fallbackIntent: 'ask',
  intents: [
    {
      name: 'ask',
      description: 'Anything at all — this world only talks.',
      examples: ['hello?'],
      async handle(ctx, msg) {
        ctx.state.greetings++;
        const reply = await ctx.llm.dialogue({
          instruction: 'Reply briefly to this chatter.',
          userLine: msg.text,
          username: msg.username,
        });
        ctx.say(reply ?? `heard you, ${msg.username}.`);
      },
    },
  ],
  events: [],
  tick() {},
  buildScene(state, view) {
    return {
      width: 1920,
      height: 1080,
      worldWidth: 1430,
      bg: '#101018',
      entities: [
        { id: 'floor', kind: 'floor', x: 0, y: 980, w: 1430, h: 100 },
      ],
      protagonist: { name: 'ECHO', x: view.protagonist.x, y: 980, state: view.protagonist.state, walk: view.protagonist.walk },
      speech: view.speech,
      hud: {
        title: 'BLANK WORLD',
        meters: [],
        counters: [{ id: 'greetings', label: 'MESSAGES', value: String(state.greetings) }],
        board: [],
        queue: {
          current: view.currentTask
            ? { label: view.currentTask.label, requestedBy: view.currentTask.requestedBy, progress: view.currentTask.progress }
            : undefined,
          pending: view.pendingTasks,
        },
        logLines: view.logLines,
        pinned: 'Say anything.',
      },
    };
  },
  persona: {
    name: 'Echo',
    idleMutterMs: 0,
    systemPrompt:
      'You are Echo, a placeholder character standing in an empty test world. Deadpan, brief, aware the room is embarrassingly empty. Never mention being an AI. One short sentence.',
    summarizeState: (state) => `an empty room. ${state.greetings} messages so far.`,
  },
  tuning: {},
  layout: {
    width: 1920,
    height: 1080,
    worldWidth: 1430,
    protagonistHomeX: 700,
    walkSpeedPxPerSec: 220,
  },
};
