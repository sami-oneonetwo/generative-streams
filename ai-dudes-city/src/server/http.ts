import http from 'node:http';
import path from 'node:path';
import { config } from '../config';
import { localOnlyGuard, operatorGuard } from './operatorGuard';
import { tunnelGuard } from './tunnelGuard';
import express from 'express';
import type { Engine } from '../engine/engine';
import type { EchoGuard } from '../kick/echo';
import type { KickAuth } from '../kick/oauth';
import { makeWebhookHandler } from '../kick/webhook';
import { ensureChatSubscription } from '../kick/subscriptions';
import { makeAdminRouter, type AdminDeps } from './admin';
import { playTokenOf, signPlayToken, verifyPlayToken, type PlaySeats } from './play';

export interface HttpDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: Engine<any>;
  auth: KickAuth;
  echo: EchoGuard;
  dataDir: string;
  wsClientCount: () => number;
  kickSubscription: { value?: string };
  play: PlaySeats;
}

export function createHttpServer(deps: HttpDeps): http.Server {
  const { engine, auth } = deps;
  const log = (line: string, level?: 'info' | 'warn' | 'alert') => engine.log.push(line, level);
  const app = express();
  // Through the tunnel, only the webhook and the play Worker's paths: everything else is this machine's.
  app.use(tunnelGuard(config.TUNNEL_KEY));

  // Webhook route needs the raw body for signature verification — registered
  // before any JSON body parsing.
  app.post(
    '/kick/webhook',
    express.raw({ type: () => true, limit: '256kb' }),
    makeWebhookHandler({
      dataDir: deps.dataDir,
      log,
      isEcho: (messageId, content) => deps.echo.isEcho(messageId, content),
      onWebhook: () => {
        engine.lastWebhookAt = Date.now();
      },
      onChatMessage: (msg) => {
        if (config.KICK_DISABLED !== 'true') void engine.pipeline.handle(msg);
      },
    }),
  );

  // Swapping the Kick account is this machine's business only: both ends refuse the public tunnel.
  app.get('/kick/login', localOnlyGuard(), (_req, res) => {
    if (!auth.configured) {
      res.status(400).send('Kick app not configured — set KICK_CLIENT_ID / KICK_CLIENT_SECRET / KICK_REDIRECT_URI in .env');
      return;
    }
    res.redirect(auth.authorizeUrl());
  });

  app.get('/kick/callback', localOnlyGuard(), (req, res) => {
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    if (!code) {
      res.status(400).type('text/plain').send(`Kick authorization failed: ${String(req.query.error ?? 'no code')}`);
      return;
    }
    auth
      .handleCallback(code, state)
      .then(() => ensureChatSubscription(auth, log))
      .then((result) => {
        deps.kickSubscription.value = result;
        res.redirect('/admin.html?connected=1');
      })
      .catch((e) => {
        log(`kick connect failed: ${(e as Error).message}`, 'alert');
        res.status(500).type('text/plain').send(`Kick connect failed: ${(e as Error).message}`);
      });
  });

  const adminDeps: AdminDeps = {
    engine,
    auth,
    wsClientCount: deps.wsClientCount,
    kickSubscription: () => deps.kickSubscription.value,
    play: deps.play,
  };
  app.use('/admin/api', operatorGuard(config.ADMIN_TOKEN), express.json({ limit: '16kb' }), makeAdminRouter(adminDeps));
  app.get('/admin', (_req, res) => res.redirect('/admin.html'));

  // Geometry by id+revision: snapshots carry everything about an object except its parts,
  // and the page asks for the ones it has not seen, in one request per snapshot. Public,
  // like the socket itself; bounded; nothing here mutates.
  app.post('/api/objects/parts', express.json({ limit: '64kb' }), (req, res) => {
    const body = req.body as { keys?: unknown } | undefined;
    const keys = Array.isArray(body?.keys) ? (body!.keys as unknown[]).slice(0, 400) : [];
    const parts: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== 'string' || key.length > 120) continue;
      const at = key.lastIndexOf(':');
      if (at <= 0) continue;
      const found = engine.world.objectParts?.(engine.state, key.slice(0, at), Number(key.slice(at + 1)));
      if (found !== undefined) parts[key] = found;
    }
    res.set('Cache-Control', 'no-store').json({ parts });
  });

  app.get('/', (_req, res) => {
    res.sendFile(path.resolve('public', 'dudes.html'));
  });
  // The operator page: the same view, with the Mayor to walk and the operator's panels.
  app.get('/mayor', (_req, res) => {
    res.sendFile(path.resolve('public', 'dudes.html'));
  });
  // The /play page: a chatter logged in with Kick walks their own character. Login happens on the
  // Cloudflare Worker in front (play-worker/), which signs the `play` cookie; this side checks it.
  app.get('/play', (_req, res) => {
    res.sendFile(path.resolve('public', 'dudes.html'));
  });
  app.get('/api/play/me', (req, res) => {
    const who = verifyPlayToken(playTokenOf(req), config.PLAY_SECRET);
    const seated = who ? deps.play.seats.has(who.userId) : false;
    res.set('Cache-Control', 'no-store').json({ user: who ? { id: who.userId, name: who.name } : null, seated, seats: deps.play.count(), configured: !!config.PLAY_SECRET });
  });
  // Trying it on this machine without Kick: /play/dev-login?name=alex (localhost or the operator token only).
  app.get('/play/dev-login', operatorGuard(config.ADMIN_TOKEN), (req, res) => {
    const name = String(req.query.name ?? '').replace(/[^\w.-]/g, '').slice(0, 40);
    if (!config.PLAY_SECRET || !name) {
      res.status(400).type('text/plain').send(config.PLAY_SECRET ? 'add ?name=someone' : 'set PLAY_SECRET in .env first');
      return;
    }
    const token = signPlayToken(`dev:${name.toLowerCase()}`, name, config.PLAY_SECRET, 12 * 3600_000);
    res.cookie('play', token, { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600_000, path: '/' });
    res.redirect('/play');
  });
  app.use(express.static('public'));

  return http.createServer(app);
}
