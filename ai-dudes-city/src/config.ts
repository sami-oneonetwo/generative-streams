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
  // Where the server listens: this machine only by default. 0.0.0.0 opens the port to the network,
  // for the addresses the cloud firewall lets through; only TRUSTED_IPS get the operator's pages.
  HOST: z.string().default('127.0.0.1'),
  // The operator's own addresses (comma-separated), treated like this machine: /admin, /mayor and
  // the operator socket without a token. Nothing forwarded through a tunnel ever counts.
  TRUSTED_IPS: z.string().default(''),
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
  // The rolling AI budget (worlds/ai-dudes/budget.ts): calls per hour, agent turns (with the aide and
  // the Listener) and designs counted apart; /admin can change both live. And what one call of each
  // costs, roughly, in US dollars: only for the spend estimate on /admin.
  DUDES_AGENT_CALLS_PER_HOUR: z.coerce.number().int().min(0).max(1_000_000).default(1200),
  DUDES_DESIGN_CALLS_PER_HOUR: z.coerce.number().int().min(0).max(1_000_000).default(90),
  DUDES_AGENT_CALL_USD: z.coerce.number().min(0).default(0.008),
  DUDES_DESIGN_CALL_USD: z.coerce.number().min(0).default(0.1),
  DUDES_FIXTURES: z.string().optional(),

  KICK_REPLIES_ENABLED: z.string().default('false'),
  CRIER_ENABLED: z.string().default('true'),
  DEV_TIME_SCALE: z.coerce.number().default(1),

  KICK_CLIENT_ID: z.string().optional(),
  KICK_CLIENT_SECRET: z.string().optional(),
  KICK_REDIRECT_URI: z.string().optional(),
  KICK_WEBHOOK_PUBLIC_URL: z.string().optional(),

  // The /play page (logged-in chatters walking their own character): the secret shared with the
  // Cloudflare Worker that signs their login (play-worker/), and how many may play at once.
  PLAY_SECRET: z.string().min(32).optional(),
  PLAY_SEATS: z.coerce.number().int().min(0).max(100).default(10),
  // Where chatters go to walk their own character: shown on stream and in the crier's !play.
  PLAY_URL: z.string().default('stream-play.kick-product.com'),
  // Chat bots that never get a character (comma-separated usernames, any case), on top of the known ones.
  KICK_IGNORE_BOTS: z.string().default(''),
  // Pages allowed to open a player socket (/ws/player), comma-separated, besides the town's own
  // origin (localhost, or the tunnel itself): the play site the Worker serves.
  PLAY_ORIGINS: z.string().default('https://stream-play.kick-product.com'),
  // The key the play Worker sends with everything it passes on (x-town-key), so the tunnel URL on its
  // own cannot reach the play paths. `npm run tunnel` gives ngrok the same rule. `openssl rand -hex 32`.
  TUNNEL_KEY: z.string().min(32).regex(/^[\w-]+$/).optional(),
});

export const config = envSchema.parse(process.env);

// Runtime-mutable flags, adjustable from the admin page without a restart.
export const flags = {
  kickRepliesEnabled: config.KICK_REPLIES_ENABLED === 'true',
  crierEnabled: config.CRIER_ENABLED === 'true',
  devTimeScale: config.DEV_TIME_SCALE,
};
