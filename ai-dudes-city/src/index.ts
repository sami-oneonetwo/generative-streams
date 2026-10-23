import { config, flags } from './config';
import { worlds } from './worlds';
import { Engine } from './engine/engine';
import { startLoop } from './engine/loop';
import { EchoGuard } from './kick/echo';
import { KickAuth } from './kick/oauth';
import { KickSender } from './kick/send';
import { ensureChatSubscription } from './kick/subscriptions';
import { createHttpServer } from './server/http';
import { WsHub } from './server/ws';
import { mayorInput } from './worlds/ai-dudes/mayor';
import { PlaySeats, playTokenOf, verifyPlayToken } from './server/play';

const world = worlds[config.WORLD];
if (!world) {
  // eslint-disable-next-line no-console
  console.error(`Unknown world '${config.WORLD}'. Available: ${Object.keys(worlds).join(', ')}`);
  process.exit(1);
}

const engine = new Engine(world, {
  dataDir: config.DATA_DIR,
  confidenceThreshold: config.INTENT_CONFIDENCE_THRESHOLD,
  flags,
});
const log = (line: string, level?: 'info' | 'warn' | 'alert') => engine.log.push(line, level);

// The stream outlives a bug: one stray throw or rejected promise is logged as an alert and the town
// keeps running (`tsx watch` does not restart a crashed process until the next save).
const crashed = (what: string, e: unknown) => {
  const err = e instanceof Error ? e : new Error(String(e));
  try {
    log(`${what}: ${err.message}`, 'alert');
    // eslint-disable-next-line no-console
    console.error(err.stack ?? err);
  } catch {
    // logging itself failed; nothing more to do
  }
};
process.on('unhandledRejection', (e) => crashed('unhandled rejection', e));
process.on('uncaughtException', (e) => {
  // Not being able to listen at all is not survivable: exit so it is plain to see.
  const code = (e as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE' || code === 'EACCES') {
    crashed('cannot listen', e);
    process.exit(1);
  }
  crashed('uncaught exception', e);
});

const auth = new KickAuth(config.DATA_DIR, log);
const echo = new EchoGuard();
const sender = new KickSender(auth, log, echo);
engine.kickSend = (text, opts) => { if (config.KICK_DISABLED !== 'true') sender.send(text, opts); };

// The /play page: chatters logged in with Kick, walking their own characters (ten seats by default).
const players = world.players;
const play = new PlaySeats(
  config.PLAY_SEATS,
  {
    join: (userId, name) => {
      if (!players) return 'this world has no players';
      const joined = players.join(engine.ctx, userId, name);
      engine.markDirty();
      return joined;
    },
    input: (userId, msg) => {
      const out = players?.input(engine.ctx, userId, msg);
      if (!out) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (out.broadcast) hub.broadcastTransient(out.broadcast as any);
      if (out.note) play.tell(userId, out.note);
      if (out.reply) play.send(userId, out.reply);
      engine.markDirty();
    },
    leave: (userId) => {
      players?.leave(engine.ctx, userId);
      engine.markDirty();
    },
  },
  log,
  // Kicks and bans from /admin survive a restart (and every hot reload).
  `${config.DATA_DIR}/play-kicks.json`,
);

const kickSubscription: { value?: string } = {};
const server = createHttpServer({
  engine,
  auth,
  echo,
  dataDir: config.DATA_DIR,
  wsClientCount: () => hub.clientCount,
  kickSubscription,
  play,
});
const hub = new WsHub(
  server,
  world.meta.id,
  config.ADMIN_TOKEN,
  config.PLAY_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
);
// The Mayor: the operator page walks the streamer's figure; every page hears about it at once.
hub.onPlayer = (req, ws) => {
  const who = verifyPlayToken(playTokenOf(req), config.PLAY_SECRET);
  if (!who) {
    ws.send(JSON.stringify({ t: 'bye', reason: 'Log in with Kick first.' }));
    return void ws.close(4401, 'login');
  }
  play.connect(who, ws);
};
hub.onOperator = (msg) => {
  const now = Date.now();
  const input = mayorInput(engine.state, msg, now);
  if (!input) return;
  hub.broadcastTransient({ t: 'mayor', serverTime: input.at, mayor: input.view });
  engine.markDirty();
};

server.listen(config.PORT, '127.0.0.1', () => {
  log(`listening on http://localhost:${config.PORT} (renderer: /, admin: /admin)`);
  if (!config.OPENROUTER_API_KEY) log('OPENROUTER_API_KEY not set — LLM classify/dialogue disabled', 'warn');
  if (!auth.configured) log('kick app not configured — running dev-harness only');
  else if (!auth.connected) log('kick configured but not connected — connect from /admin');
});

// Between-streams simulation + Admin's stream-start recap.
const offlineFacts = engine.applyOfflineTime();
if (offlineFacts.length) {
  void engine
    .generateDialogue({
      instruction: `The stream just started. Narrate what changed while you were gone, in character, based only on these facts: ${offlineFacts.join('; ')}. 2-3 short sentences.`,
    })
    .then((line) => {
      if (line) engine.say(line);
    });
}

// Snapshots carry the /play site's address and its seats (when it is set up and the doors are open), for the stream's corner line.
const playInfo = () => {
  if (!config.PLAY_SECRET || !config.PLAY_URL) return undefined;
  const seats = play.count();
  return seats.open ? { url: config.PLAY_URL, used: seats.used, cap: seats.cap } : undefined;
};
const stopLoop = startLoop(engine, (msg) => {
  const info = msg.t === 'state' ? playInfo() : undefined;
  hub.broadcast(info && msg.t === 'state' ? { ...msg, play: info } : msg);
});

if (auth.connected && config.KICK_DISABLED !== 'true') {
  ensureChatSubscription(auth, log)
    .then((result) => {
      kickSubscription.value = result;
    })
    .catch((e) => log(`kick subscription check failed: ${(e as Error).message}`, 'warn'));
}

let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log('shutting down; saving state');
  stopLoop();
  engine.stop();
  try {
    engine.save();
  } catch (e) {
    log(`final save failed: ${(e as Error).message}`, 'alert');
  }
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
