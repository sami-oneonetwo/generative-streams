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
    if (!username || !text || username.length > 40 || text.length > 1000) {
      res.status(400).json({ error: 'username (1–40 characters) and text (1–1000 characters) required' });
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
        disabled: config.KICK_DISABLED === 'true',
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
      adminActions: (engine.world.adminActions ?? []).map((a) => ({ id: a.id, label: a.label, input: a.input })),
      events: engine.world.events.map((e) => e.name),
      stateSummary: engine.world.persona.summarizeState(engine.state),
      // Operator-only detail the world chooses to show (the dudes, their agents, the call budget).
      // Read off state rather than the scene: the snapshot goes to every viewer twice a second.
      dudes: engine.world.adminStatus?.(engine.state, Date.now()) as AdminStatus['dudes'],
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

  // Destructive: the client must send the literal confirmation, not just click.
  router.post('/reset', (req, res) => {
    if (req.body?.confirm !== 'RESET') {
      res.status(400).json({ error: 'Send {"confirm":"RESET"} to reset the world' });
      return;
    }
    try {
      const { backup } = engine.reset();
      res.json({ ok: true, backup });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
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
    // An action with an input takes what it declares: text (non-empty, within maxLength) or a
    // number within its bounds.
    let value: number | string | undefined;
    if (action.input?.kind === 'text') {
      const text = String(req.body?.value ?? '').trim();
      const max = action.input.maxLength ?? 200;
      if (!text || text.length > max) {
        res.status(400).json({ error: `'${action.label}' needs text of 1–${max} characters` });
        return;
      }
      value = text;
    } else if (action.input) {
      const n = Number(req.body?.value);
      const { min = -Infinity, max = Infinity } = action.input;
      if (!Number.isFinite(n) || n < min || n > max) {
        res.status(400).json({ error: `'${action.label}' needs a number between ${min} and ${max}` });
        return;
      }
      value = n;
    }
    try {
      action.run(engine.ctx, value);
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
