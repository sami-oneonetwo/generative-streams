import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apply, initialState, initialVitals, type Mutation, type World, type WorldState } from '../shared/state.js';
import { log } from './log.js';

const QUIET: ReadonlySet<Mutation['type']> = new Set(['set_character', 'set_camera', 'set_time', 'expire', 'set_motion', 'entity_say', 'set_hint', 'set_vitals']);

/** Holds the authoritative state, persists it per world, and emits 'change'. */
export class Store extends EventEmitter {
  state: WorldState;
  private persistTimer: NodeJS.Timeout | null = null;
  private voiceHeldUntil = 0;

  /** While the operator holds the voice, only 'operator' and 'critical' sources may set the bubble. */
  holdVoice(ms: number): void {
    this.voiceHeldUntil = Math.max(this.voiceHeldUntil, Date.now() + ms);
  }

  releaseVoice(): void {
    this.voiceHeldUntil = 0;
  }

  get voiceHeld(): boolean {
    return this.voiceHeldUntil > Date.now();
  }

  get voiceHeldForMs(): number {
    return Math.max(0, this.voiceHeldUntil - Date.now());
  }

  constructor(private readonly dir: string, world: World) {
    super();
    mkdirSync(dir, { recursive: true });
    this.state = Store.load(dir, world);
  }

  static file(dir: string, world: World): string {
    return join(dir, `${world}.json`);
  }

  static load(dir: string, world: World): WorldState {
    const f = Store.file(dir, world);
    if (existsSync(f)) {
      try {
        const parsed = JSON.parse(readFileSync(f, 'utf8')) as Partial<WorldState>;
        if (parsed && parsed.world === world && Array.isArray(parsed.entities)) {
          log('store', `loaded ${f}`, { entities: parsed.entities.length, version: parsed.version });
          const base = initialState(world);
          const now = Date.now();
          // Drop expired things and the world's own moving props; settle anyone else's mid-move things.
          const entities = parsed.entities
            .filter((e) => e.expiresAt > now && !(e.motion && e.addedBy === 'world'))
            .map((e) => (e.motion ? { ...e, x: e.motion.toX, motion: undefined, say: undefined } : e));
          return {
            ...base,
            ...parsed,
            entities,
            world,
            character: {
              ...base.character,
              ...(parsed.character ?? {}),
              vitals: { ...initialVitals(), ...(parsed.character?.vitals ?? {}), collapsed: undefined, blackout: undefined },
              targetX: undefined,
              bubble: undefined,
              sleeping: undefined,
            },
            transition: undefined,
            vote: undefined,
            host: undefined,
          } as WorldState;
        }
      } catch (err) {
        log('store', `could not read ${f}, starting fresh`, String(err));
      }
    }
    return initialState(world);
  }

  /** Apply a mutation. Returns false when it was a no-op. */
  dispatch(m: Mutation, source = 'system'): boolean {
    if (m.type === 'set_character' && m.patch.bubble && this.voiceHeld && source !== 'operator' && source !== 'critical') {
      const { bubble: _b, ...rest } = m.patch;
      if (Object.keys(rest).length === 0) return false;
      m = { type: 'set_character', patch: rest };
    }
    const next = apply(this.state, m);
    if (next === this.state) return false;
    this.state = next;
    if (!QUIET.has(m.type)) log('state', `${source}: ${m.type}`, summarise(m));
    this.emit('change', this.state, m);
    this.persistSoon();
    return true;
  }

  /** Arrive in another world: save this one, load that one, carry the character over. */
  switchWorld(to: World): void {
    if (to === this.state.world) return;
    this.persist();
    const prev = this.state;
    const next = Store.load(this.dir, to);
    this.state = {
      ...next,
      version: prev.version + 1,
      camera: { x: 0 },
      character: { ...prev.character, x: 24, targetX: 200, mode: 'walk', facing: 'r', bubble: undefined, sleeping: undefined },
      transition: undefined,
      vote: undefined,
      host: undefined,
    };
    log('state', `arrived in ${to}`, { entities: this.state.entities.length });
    this.emit('change', this.state, { type: 'end_transition' });
    this.persistSoon();
  }

  private persistSoon(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, 2000);
  }

  persist(): void {
    const f = Store.file(this.dir, this.state.world);
    const tmp = f + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, f);
  }
}

function summarise(m: Mutation): unknown {
  switch (m.type) {
    case 'add_entity':
      return { id: m.entity.id, sprite: m.entity.sprite, layer: m.entity.layer, x: m.entity.x, y: m.entity.y, by: m.entity.addedByName };
    case 'remove_entity':
      return { id: m.id };
    default: {
      const { type: _type, ...rest } = m as Record<string, unknown>;
      return rest;
    }
  }
}
