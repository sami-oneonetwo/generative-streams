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

const auth = new KickAuth(config.DATA_DIR, log);
const echo = new EchoGuard();
const sender = new KickSender(auth, log, echo);
engine.kickSend = (text) => sender.send(text);

const kickSubscription: { value?: string } = {};
const server = createHttpServer({
  engine,
  auth,
  echo,
  dataDir: config.DATA_DIR,
  wsClientCount: () => hub.clientCount,
  kickSubscription,
});
const hub = new WsHub(server, world.meta.id);

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

const stopLoop = startLoop(engine, (msg) => hub.broadcast(msg));

if (auth.connected) {
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
