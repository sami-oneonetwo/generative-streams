import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { Catalogue } from '../shared/catalogue.js';
import { existsSync as exists } from 'node:fs';
import { parseCommand } from '../shared/commands.js';
import { ConfigSchema } from '../shared/config.js';
import type { ServerMessage } from '../shared/protocol.js';
import { VIEW, WORLDS, type World } from '../shared/state.js';
import type { Wardrobe } from '../shared/wardrobe.js';
import { ChatLog, handleAdmin, type AdminDeps } from './admin.js';
import { Brain } from './brain.js';
import { Builder } from './builder.js';
import { Generator } from './generator.js';
import { ARCS } from './host/arcs.js';
import { Host } from './host/engine.js';
import { buildHooks } from './host/hooks.js';
import { Profiles } from './host/profiles.js';
import type { IncomingChat } from './ingest.js';
import { characterSay, runCommand, type InterpreterContext, type Outcome } from './interpreter.js';
import { Kick } from './kick/index.js';
import { log } from './log.js';
import { Policy } from './policy.js';
import { Store } from './store.js';
import { startTick } from './tick.js';

const ROOT = process.cwd();
// Each branch-project keeps its own state dir (WORLDSTREAM_STATE_DIR, pinned in package.json).
// Kick tokens are channel-level and stay in the shared state/ root: refresh tokens rotate on
// every refresh, so split copies would invalidate each other.
const SHARED_STATE_DIR = join(ROOT, 'state');
const STATE_DIR = process.env.WORLDSTREAM_STATE_DIR ? resolve(process.env.WORLDSTREAM_STATE_DIR) : SHARED_STATE_DIR;

/** The packed atlas (pixels + font) when built, else the bare catalogue (placeholder mode). */
function loadCatalogue(world: string): Catalogue {
  const packed = join(ROOT, `dist/worlds/${world}/atlas.json`);
  if (existsSync(packed)) return JSON.parse(readFileSync(packed, 'utf8')) as Catalogue;
  log('assets', `no packed atlas for ${world}, run npm run assets; using placeholders`);
  return JSON.parse(readFileSync(join(ROOT, `assets/worlds/${world}/catalogue.json`), 'utf8')) as Catalogue;
}

const cfg = ConfigSchema.parse(JSON.parse(readFileSync(join(ROOT, 'config/world.config.json'), 'utf8')));

/** The character's wardrobe, packed by scripts/pack.ts; absent until assets are built. */
function loadWardrobe(): Wardrobe | undefined {
  const f = join(ROOT, 'dist/wardrobe.json');
  if (!existsSync(f)) {
    log('assets', 'no packed wardrobe, run npm run assets; chat cannot dress him yet');
    return undefined;
  }
  return JSON.parse(readFileSync(f, 'utf8')) as Wardrobe;
}
const wardrobe = loadWardrobe();

/** Every world with a catalogue on disk, packed or not. */
function loadWorlds(): Map<World, Catalogue> {
  const out = new Map<World, Catalogue>();
  for (const w of WORLDS) if (exists(join(ROOT, 'assets/worlds', w, 'catalogue.json'))) out.set(w, loadCatalogue(w));
  if (!out.has(cfg.world)) throw new Error(`no catalogue for the configured world ${cfg.world}`);
  return out;
}
const worlds = loadWorlds();
const store = new Store(STATE_DIR, cfg.world);
const policy = new Policy(cfg);
const ctx: InterpreterContext = {
  store,
  policy,
  cfg,
  wardrobe,
  get catalogue(): Catalogue {
    return worlds.get(store.state.world) ?? worlds.get(cfg.world)!;
  },
};
const chatLog = new ChatLog();

// -- the pipeline every chat line goes through, whatever its source ------------

const kick = new Kick({
  cfg,
  env: process.env,
  stateDir: SHARED_STATE_DIR,
  ingest: (msg) => void ingest(msg),
  onFollow: (name) => host.onFollow(name),
  onViewersJoined: (delta) => host.onViewersJoined(delta),
  onRedemption: (payload) => {
    // A channel-points reward whose title names a world sends the stream there.
    const p = payload as { status?: string; reward?: { title?: string }; user?: { username?: string } };
    if (p.status && p.status !== 'accepted') return;
    const title = (p.reward?.title ?? JSON.stringify(payload)).toLowerCase();
    if (title.includes('revive') && store.state.character.vitals.collapsed) {
      const who = p.user?.username ?? 'someone';
      store.dispatch({ type: 'revive', at: Date.now(), by: who }, 'reward');
      characterSay(ctx, Date.now(), `${who} paid to bring me back. I felt that.`);
      void kick.sayInChat(`${who} paid to bring me back. I felt that.`);
      return;
    }
    const target = WORLDS.find((w) => title.includes(w));
    if (!target) return;
    const op: IncomingChat = { id: `reward-${Date.now()}`, user: { id: 'kick:reward', name: p.user?.username ?? 'channel points', badges: ['broadcaster'] }, content: `!world ${target}`, at: Date.now(), source: 'kick' };
    void ingest(op);
  },
});

const brain = new Brain(ctx, undefined, { onSay: (text) => void kick.sayInChat(text), onCommand: (cmd, msg, outcome) => host.noteCommand(msg, cmd, outcome) });
const profiles = new Profiles(join(STATE_DIR, 'viewers.json'));
const builder = new Builder(ctx, (text) => {
  characterSay(ctx, Date.now(), text);
  void kick.sayInChat(text);
});
ctx.builder = builder;
const generator = new Generator({
  cfg,
  ctx,
  worlds,
  root: ROOT,
  say: (text) => {
    characterSay(ctx, Date.now(), text);
    void kick.sayInChat(text);
  },
  onSprite: (world, sprite) => setTimeout(() => broadcast({ type: 'atlas_add', world, sprite }), 0),
  onRemove: (world, name) => setTimeout(() => broadcast({ type: 'atlas_remove', world, name }), 0),
});
ctx.generator = generator;
const host = new Host({
  ctx,
  cfg,
  profiles,
  brain: cfg.nl.mode === 'off' ? null : brain,
  say: (text) => {
    characterSay(ctx, Date.now(), text);
    void kick.sayInChat(text);
  },
  hooks: buildHooks(),
  arcs: ARCS,
  worlds: [...worlds.keys()],
  catalogueOf: (w) => worlds.get(w),
  builder,
});
brain.setContext(() => host.context());

function ingest(msg: IncomingChat): Outcome {
  const cmd = parseCommand(msg.content);
  let outcome: Outcome = cmd ? runCommand(cmd, msg, ctx) : { applied: false };
  const answered = host.observe(msg, cmd, outcome);
  if (answered && !cmd) outcome = { applied: true, reply: outcome.reply ?? 'answered the wanderer' };
  else if (!cmd && !answered && (brain.wants(msg) || host.hasOpenAsk)) {
    brain.enqueue(msg);
    outcome = { applied: false, queued: true };
  }
  chatLog.push(msg, outcome);
  log('chat', `${msg.source}:${msg.user.name}: ${msg.content}`, outcome);
  if (cmd && outcome.applied && outcome.reply) void kick.sayInChat(outcome.reply);
  return outcome;
}

// -- http ---------------------------------------------------------------------

const WEB_DIR = join(ROOT, 'dist/web');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(JSON.stringify(body));
}

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function isLocal(req: IncomingMessage): boolean {
  const a = req.socket.remoteAddress ?? '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function serveStatic(pathname: string, res: ServerResponse): void {
  if (!existsSync(WEB_DIR)) return text(res, 503, 'renderer not built yet: run `npm run dev` or `npm run build`');
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR)) return text(res, 403, 'forbidden');
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(rel)) return text(res, 404, 'not found');
    file = join(WEB_DIR, 'index.html');
  }
  if (!existsSync(file)) return text(res, 404, 'not found');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(readFileSync(file));
}

async function readBody(req: IncomingMessage, limit = 16_384): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Local-only injection point used by scripts/mock-chat.ts. Same pipeline as Kick. */
async function handleDevChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = JSON.parse(await readBody(req)) as { username?: string; userId?: string; content?: string; badges?: string[] };
    const username = (body.username ?? 'someone').trim().slice(0, 32) || 'someone';
    const content = (body.content ?? '').toString().slice(0, 500);
    if (!content.trim()) return json(res, { error: 'content required' }, 400);
    const msg: IncomingChat = {
      id: randomUUID(),
      user: { id: body.userId ?? `mock:${username.toLowerCase()}`, name: username, badges: body.badges ?? [] },
      content,
      at: Date.now(),
      source: 'mock',
    };
    return json(res, ingest(msg));
  } catch (err) {
    return json(res, { error: String(err) }, 400);
  }
}

const tick = startTick(store, cfg, () => ctx.catalogue, {
  say: (text) => void kick.sayInChat(text),
  onSave: (userId, name, need) => {
    profiles.recordSave(userId);
    log('vitals', `${name} saved him (${need})`);
  },
  onDeath: (deaths) => log('vitals', `death ${deaths}`),
  onNewDay: (days) => log('vitals', `day ${days} survived`),
});

const adminDeps: AdminDeps = {
  ctx,
  chatLog,
  tick,
  htmlPath: join(ROOT, 'assets/admin.html'),
  kickStatus: () => kick.getStatus(),
  brainPending: () => brain.pending,
  worlds: [...worlds.keys()],
  host,
  generator,
  speak: (text) => void kick.sayInChat(text, true),
  setKickChat: (on) => kick.setBotReplies(on),
};

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (await kick.route(req, res, url)) return;
    if (url.pathname === '/dev/chat' || url.pathname.startsWith('/admin')) {
      if (!isLocal(req)) return text(res, 403, 'local only');
      if (req.method === 'POST' && url.pathname === '/dev/chat') return await handleDevChat(req, res);
      if (await handleAdmin(req, res, url, adminDeps)) return;
    }
    if (url.pathname === '/api/state') return json(res, store.state);
    if (url.pathname === '/api/catalogue') return json(res, ctx.catalogue);
    if (url.pathname === '/healthz') return text(res, 200, 'ok');
    return serveStatic(url.pathname, res);
  } catch (err) {
    log('http', `error on ${url.pathname}`, String(err));
    if (!res.headersSent) text(res, 500, 'error');
  }
}

const server = createServer((req, res) => void handle(req, res));

// -- websocket to renderers ---------------------------------------------------

const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws: WebSocket, m: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

function broadcast(m: ServerMessage): void {
  for (const ws of wss.clients) send(ws, m);
}

wss.on('connection', (ws) => {
  send(ws, { type: 'hello', worlds: Object.fromEntries(worlds) as Partial<Record<World, Catalogue>>, world: store.state.world, character: { name: cfg.character.name }, view: VIEW, ui: { meters: cfg.survival.showMeters }, wardrobe });
  send(ws, { type: 'state', state: store.state, now: Date.now() });
  log('ws', `renderer connected (${wss.clients.size})`);
  ws.on('close', () => log('ws', `renderer disconnected (${wss.clients.size})`));
});

let flushTimer: NodeJS.Timeout | null = null;
store.on('change', () => {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const m: ServerMessage = { type: 'state', state: store.state, now: Date.now() };
    for (const ws of wss.clients) send(ws, m);
  }, 100);
});

// -- boot ---------------------------------------------------------------------

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') log('http', `port ${cfg.port} is already in use: another worldstream is running (stop it, or change port in config/world.config.json)`);
  else log('http', 'server error', String(err));
  process.exit(1);
});

server.listen(cfg.port, '127.0.0.1', () => {
  log('http', `worldstream on http://127.0.0.1:${cfg.port}/  admin at /admin  world=${store.state.world}  worlds=${[...worlds.keys()].join(',')}  entities=${store.state.entities.length}  nl=${cfg.nl.mode}`);
  void kick.bootstrap();
  host.start();
  builder.start();
});

function shutdown(signal: string): void {
  log('http', `${signal}, persisting and exiting`);
  tick.stop();
  host.stop();
  builder.stop();
  profiles.save();
  store.persist();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
