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
  PORT: z.coerce.number().default(4400),
  WORLD: z.string().default('server-room'),
  DATA_DIR: z.string().default('data'),

  OPENROUTER_API_KEY: z.string().optional(),
  AGENT_MODEL: z.string().default('anthropic/claude-opus-5'),
  FAST_MODEL: z.string().default('anthropic/claude-haiku-4.5'),
  INTENT_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.6),

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
