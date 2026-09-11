import { z } from 'zod';
import { WORLDS } from './state.js';

export const ConfigSchema = z.object({
  port: z.number().int(),
  world: z.enum(WORLDS),
  character: z.object({
    name: z.string(),
    persona: z.string(),
  }),
  limits: z.object({
    maxEntities: z.number().int(),
    maxPerLayer: z.record(z.string(), z.number().int()),
    addCooldownMs: z.number().int(),
    entityTtlMs: z.number().int(),
    signMaxChars: z.number().int(),
  }),
  votes: z.object({
    worldChangeVoters: z.number().int(),
    windowMs: z.number().int(),
  }),
  drift: z.object({
    minutesPerWorldHour: z.number(),
    weatherMinMs: z.number().int(),
    weatherMaxMs: z.number().int(),
    bubbleMs: z.number().int(),
    /** Whether the character speaks unprompted (ambient, weather, event and arrival lines). */
    chatter: z.boolean().default(true),
    /** Multiplies the gaps between ambient events and idle lines; 2 halves the traffic. */
    ambientScale: z.number().default(2),
  }),
  nl: z.object({
    mode: z.enum(['all', 'mention', 'off']),
    model: z.string().default('claude-opus-5'),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
    batchMs: z.number().int().default(3000),
    maxQueue: z.number().int().default(30),
    maxTokens: z.number().int().default(1500),
  }),
  kick: z.object({
    botRepliesEnabled: z.boolean(),
    /** Post as the app's bot identity or as the connected user. */
    chatAs: z.enum(['bot', 'user']).default('bot'),
    /** When a bot post fails, try once more as the user. */
    fallbackToUser: z.boolean().default(true),
  }),
  generate: z
    .object({
      /** Draw new sprites with the model when chat asks for something the world lacks. */
      enabled: z.boolean().default(true),
      model: z.string().default('claude-opus-5'),
      maxPerHour: z.number().int().default(12),
      perUserCooldownMs: z.number().int().default(180_000),
      /** Drawing effort; medium gives better silhouettes, low answers in roughly half the time. */
      effort: z.enum(['low', 'medium', 'high']).default('medium'),
      maxWidth: z.number().int().default(40),
      maxHeight: z.number().int().default(32),
    })
    .prefault({}),
  survival: z
    .object({
      enabled: z.boolean().default(true),
      collapseWindowMs: z.number().int().default(90_000),
      blackoutMs: z.number().int().default(25_000),
      sleepMs: z.number().int().default(45_000),
      /** Multiplies every drain; 1 is tuned for a small attentive chat. */
      decayScale: z.number().default(1),
      /** Draw the four need meters on the stream. */
      showMeters: z.boolean().default(false),
    })
    .prefault({}),
  host: z
    .object({
      enabled: z.boolean().default(true),
      /** No chat for this long counts as quiet. */
      quietAfterMs: z.number().int().default(120_000),
      quietCadenceMs: z.number().int().default(90_000),
      busyCadenceMs: z.number().int().default(240_000),
      followUpCadenceMs: z.number().int().default(40_000),
      askTimeoutMs: z.number().int().default(75_000),
      maxModelCallsPerHour: z.number().int().default(60),
      greetNewcomers: z.boolean().default(true),
      hintEveryMs: z.number().int().default(30_000),
      /** How long the operator keeps the character's voice after typing a line. */
      operatorHoldMs: z.number().int().default(45_000),
      /** streamer: builds, welcomes, personal questions and survival only. full: every hook, arcs and votes. */
      mode: z.enum(['streamer', 'full']).default('streamer'),
      /** Gap between showcase builds when chat is busy; quiet rooms get builds sooner. */
      buildEveryMs: z.number().int().default(240_000),
      welcomeBuilds: z.boolean().default(true),
    })
    .prefault({}),
  denylist: z.array(z.string()),
});

export type Config = z.infer<typeof ConfigSchema>;
