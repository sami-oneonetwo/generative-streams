import fs from 'node:fs';
import { z } from 'zod';

// Load .env without a dotenv dependency (Node >= 21). Values already present in
// the environment win, matching node --env-file semantics.
try {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
} catch {
  // missing or unreadable .env is fine; env vars may be set externally
}

const envSchema = z.object({
  PORT: z.coerce.number().default(4500),
  WORLD: z.string().default('ai-dudes'),
  DATA_DIR: z.string().default('data'),
  ADMIN_TOKEN: z.string().min(16).optional(),
  KICK_DISABLED: z.string().default('false'),

  OPENROUTER_API_KEY: z.string().optional(),
  AGENT_MODEL: z.string().default('anthropic/claude-opus-5'),
  FAST_MODEL: z.string().default('anthropic/claude-haiku-4.5'),
  INTENT_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.6),

  // Every chatter's own agent (src/worlds/ai-dudes): the turn model, the build-geometry model,
  // how many of each may be in flight at once, and the request-count circuit breaker over both.
  DUDES_AGENT_MODEL: z.string().optional(),
  DUDES_DESIGN_MODEL: z.string().optional(),
  DUDES_LISTENER_MODEL: z.string().optional(),
  DUDES_AGENT_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(6),
  DUDES_DESIGN_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(3),
  DUDES_CALL_ALLOWANCE: z.coerce.number().int().min(0).max(1_000_000).default(500),
  DUDES_FIXTURES: z.string().optional(),

  KICK_REPLIES_ENABLED: z.string().default('false'),
  DEV_TIME_SCALE: z.coerce.number().default(1),

  KICK_CLIENT_ID: z.string().optional(),
  KICK_CLIENT_SECRET: z.string().optional(),
  KICK_REDIRECT_URI: z.string().optional(),
  KICK_WEBHOOK_PUBLIC_URL: z.string().optional(),
});

export const config = envSchema.parse(process.env);

// Runtime-mutable flags, adjustable from the admin page without a restart.
export const flags = {
  kickRepliesEnabled: config.KICK_REPLIES_ENABLED === 'true',
  devTimeScale: config.DEV_TIME_SCALE,
};
