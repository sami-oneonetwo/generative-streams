import crypto from 'node:crypto';
import { Router } from 'express';
import { config, flags } from '../config';
import type { Engine } from '../engine/engine';
import type { AdminStatus } from '../shared/protocol';
import type { KickAuth } from '../kick/oauth';
import { resubscribe } from '../kick/subscriptions';

export interface AdminDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: Engine<any>;
  auth: KickAuth;
  wsClientCount: () => number;
  kickSubscription: () => string | undefined;
}

export function makeAdminRouter(deps: AdminDeps): Router {
  const router = Router();
  const { engine, auth } = deps;

  router.post('/chat', (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const text = String(req.body?.text ?? '').trim();
    if (!username || !text) {
      res.status(400).json({ error: 'username and text required' });
      return;
    }
    void engine.pipeline.handle({
      id: `dev:${crypto.randomUUID()}`,
      userId: `dev:${username.toLowerCase()}`,
      username,
      text,
      ts: Date.now(),
      source: 'dev',
    });
    res.json({ ok: true });
  });

  router.get('/status', (_req, res) => {
    const status: AdminStatus = {
      worldId: engine.world.meta.id,
      worldName: engine.world.meta.name,
      flags: { kickRepliesEnabled: flags.kickRepliesEnabled, devTimeScale: flags.devTimeScale },
      kick: {
        configured: auth.configured,
        connected: auth.connected,
        username: auth.tokens?.username,
        userId: auth.tokens?.user_id,
        subscription: deps.kickSubscription(),
        lastWebhookAt: engine.lastWebhookAt,
        webhookPublicUrl: config.KICK_WEBHOOK_PUBLIC_URL,
      },
      engine: {
        rev: engine.rev,
        wsClients: deps.wsClientCount(),
        queueLength: engine.tasks.pendingCount + (engine.tasks.current ? 1 : 0),
        currentTask: engine.tasks.current?.spec.label,
        classifications: engine.classifications.slice().reverse(),
      },
      adminActions: (engine.world.adminActions ?? []).map((a) => ({ id: a.id, label: a.label })),
      events: engine.world.events.map((e) => e.name),
      stateSummary: engine.world.persona.summarizeState(engine.state),
    };
    res.json(status);
  });

  router.post('/event', (req, res) => {
    const name = String(req.body?.name ?? '');
    if (!engine.triggerEvent(name)) {
      res.status(404).json({ error: `no event '${name}'` });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/flags', (req, res) => {
    if (typeof req.body?.kickRepliesEnabled === 'boolean') {
      flags.kickRepliesEnabled = req.body.kickRepliesEnabled;
      engine.log.push(`kick replies ${flags.kickRepliesEnabled ? 'ENABLED' : 'disabled'} (admin)`);
    }
    if (typeof req.body?.devTimeScale === 'number' && req.body.devTimeScale >= 1) {
      flags.devTimeScale = Math.min(10_000, req.body.devTimeScale);
      engine.log.push(`dev time scale set to x${flags.devTimeScale} (admin)`);
    }
    res.json({ ok: true, flags });
  });

  router.post('/save', (_req, res) => {
    try {
      engine.save();
      engine.log.push('state saved (admin)');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/action', (req, res) => {
    const id = String(req.body?.id ?? '');
    const action = (engine.world.adminActions ?? []).find((a) => a.id === id);
    if (!action) {
      res.status(404).json({ error: `no admin action '${id}'` });
      return;
    }
    try {
      action.run(engine.ctx);
      engine.markDirty();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  router.post('/kick/resubscribe', (_req, res) => {
    if (!auth.connected) {
      res.status(400).json({ error: 'kick not connected' });
      return;
    }
    resubscribe(auth, (line, level) => engine.log.push(line, level))
      .then(() => res.json({ ok: true }))
      .catch((e) => res.status(500).json({ error: (e as Error).message }));
  });

  return router;
}
