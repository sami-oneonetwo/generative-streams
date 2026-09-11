import type { ServerMsg } from '../shared/protocol';
import type { Engine } from './engine';
import { rollEvent, scheduleNextRoll } from './events';

const LOOP_MS = 500;
const TICK_MS = 2000;
const BROADCAST_MIN_MS = 500;
const AUTOSAVE_MS = 15_000;

export function startLoop<S>(engine: Engine<S>, broadcast: (msg: ServerMsg) => void): () => void {
  let lastTickAt = Date.now();
  let lastBroadcastAt = 0;
  let lastSaveAt = Date.now();
  let mutterInFlight = false;

  engine.nextEventRollAt = scheduleNextRoll(engine.world.tuning, Math.random);
  engine.deferMutter();

  const interval = setInterval(() => {
    const now = Date.now();

    // 1. Task state machine (walk -> work -> complete).
    engine.syncMode();
    if (engine.tasks.advance(now, engine.protagonist, engine.ctx, engine.emergencyActive)) engine.markDirty();
    if (engine.tasks.current || engine.protagonist.state !== 'idle') engine.markDirty(); // live progress

    // 2. World simulation tick, dt scaled by the dev time-scale flag.
    if (now - lastTickAt >= TICK_MS) {
      const dt = (now - lastTickAt) * engine.flags.devTimeScale;
      lastTickAt = now;
      try {
        engine.world.tick(engine.ctx, dt);
      } catch (e) {
        engine.log.push(`tick error: ${(e as Error).message}`, 'warn');
      }
      engine.markDirty();
    }

    engine.syncMode(); // An emergency raised by this tick interrupts work immediately.

    // 2b. The world can hear again: everything held during the outage lands.
    if (engine.pipeline.heldCount > 0) void engine.pipeline.release();

    // 3. Event roll (no-op while the world's event table is empty).
    if (now >= engine.nextEventRollAt) {
      engine.nextEventRollAt = scheduleNextRoll(engine.world.tuning, Math.random);
      const name = engine.emergencyActive ? undefined : rollEvent(engine.world, engine.ctx);
      if (name) engine.log.push(`event: ${name}`);
    }

    // 4. Idle mutter — keeps the protagonist from going silent for long.
    //
    // Deliberately NOT gated on being free: a person doing a job talks while
    // they do it, and gating this on `!tasks.current` meant that on a busy
    // board — which is most of the time — he went quiet for exactly as long as
    // there was something to watch him do. `deferMutter` on every spoken line
    // and `mutterInFlight` are what actually stop him talking over himself.
    const persona = engine.world.persona;
    if (!engine.emergencyActive && persona.idleMutterMs > 0 && now >= engine.nextMutterAt && !mutterInFlight) {
      engine.deferMutter();
      mutterInFlight = true;
      const focus = persona.idleFocus?.(engine.state);
      engine
        .generateDialogue({
          instruction:
            // Deliberately not "grounded in the current world state": that made
            // every unprompted line a status report. What the line should be
            // about is the world's call, via idleFocus.
            'Say one short line, unprompted — nobody has asked you anything. One or two sentences, in character.' +
            ' It does not have to be about your work.' +
            (focus ? ` ${focus}` : ''),
        })
        .then((line) => {
          if (line) engine.say(line);
        })
        .finally(() => {
          mutterInFlight = false;
        });
    }

    // 5. Speech bubble expiry.
    if (engine.speech && engine.speech.until <= now) {
      engine.speech = null;
      engine.markDirty();
    }

    // 6. Broadcast (full snapshot, throttled).
    if (engine.renderDirty && now - lastBroadcastAt >= BROADCAST_MIN_MS) {
      lastBroadcastAt = now;
      engine.renderDirty = false;
      engine.rev++;
      broadcast({ t: 'state', rev: engine.rev, serverTime: now, scene: engine.buildScene(now) });
    }

    // 7. Autosave.
    if (now - lastSaveAt >= AUTOSAVE_MS) {
      lastSaveAt = now;
      try {
        engine.save();
      } catch (e) {
        engine.log.push(`autosave failed: ${(e as Error).message}`, 'warn');
      }
    }
  }, LOOP_MS);

  return () => clearInterval(interval);
}
