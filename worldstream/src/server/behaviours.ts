// Things placed in the world do things: wander, patrol, flee the character,
// visit the food, follow, and speak when the character is close. Runs once a
// second; movement is expressed as scripted motion so the renderer glides.
import type { Catalogue, SpriteDef } from '../shared/catalogue.js';
import { VIEW, type Entity, type WorldState } from '../shared/state.js';
import { pick } from './drift.js';
import type { Store } from './store.js';

const patrolDir = new Map<string, 1 | -1>();

function move(store: Store, e: Entity, def: SpriteDef | undefined, toX: number, now: number, speedPxPerS: number): void {
  const w = def?.w ?? 8;
  const target = Math.round(Math.max(0, Math.min(VIEW.worldW - w, toX)));
  const dist = Math.abs(target - e.x);
  if (dist < 2) return;
  const duration = Math.max(400, Math.round((dist / Math.max(4, speedPxPerS)) * 1000));
  store.dispatch({ type: 'set_motion', id: e.id, motion: { fromX: e.x, toX: target, startAt: now, endAt: now + duration } }, 'behaviour');
}

export function stepBehaviours(store: Store, catalogue: Catalogue, now: number, rnd: () => number = Math.random): void {
  const s: WorldState = store.state;
  const c = s.character;
  const defs = new Map(catalogue.sprites.map((d) => [d.name, d]));

  for (const e of s.entities) {
    if (e.addedBy === 'world') continue; // ambient props own their motion
    const def = defs.get(e.sprite);

    if (e.say && e.say.until <= now) store.dispatch({ type: 'entity_say', id: e.id, say: undefined }, 'behaviour');

    if (e.motion) {
      if (e.motion.endAt <= now) store.dispatch({ type: 'set_motion', id: e.id, motion: undefined, x: e.motion.toX }, 'behaviour');
      continue;
    }

    const w = def?.w ?? 8;
    const centre = e.x + w / 2;
    const gap = c.x - centre;
    const speed = def?.speed ?? 20;

    if (e.follow) {
      if (Math.abs(gap) > 26) move(store, e, def, c.x - (gap > 0 ? 18 : -18) - w / 2, now, speed * 1.5);
    } else if (def?.behaviour) {
      switch (def.behaviour) {
        case 'wander':
          if (rnd() < 0.2) move(store, e, def, e.x + (rnd() < 0.5 ? -1 : 1) * (20 + rnd() * 40), now, speed);
          break;
        case 'patrol': {
          const dir = patrolDir.get(e.id) ?? 1;
          let target = e.x + dir * 50;
          if (target < 0 || target > VIEW.worldW - w) {
            patrolDir.set(e.id, dir === 1 ? -1 : 1);
            target = e.x - dir * 50;
          } else patrolDir.set(e.id, dir === 1 ? -1 : 1);
          if (rnd() < 0.5) move(store, e, def, target, now, speed);
          break;
        }
        case 'flee':
          if (Math.abs(gap) < 30) move(store, e, def, e.x - Math.sign(gap || 1) * 45, now, speed * 2);
          else if (rnd() < 0.1) move(store, e, def, e.x + (rnd() < 0.5 ? -1 : 1) * 15, now, speed);
          break;
        case 'visit': {
          const spots = s.entities.filter((o) => o.id !== e.id && !o.motion && ['food', 'shop', 'warm', 'fire'].some((t) => defs.get(o.sprite)?.tags.includes(t)));
          if (spots.length) {
            const spot = spots.sort((a, b) => Math.abs(a.x - e.x) - Math.abs(b.x - e.x))[0];
            const spotW = defs.get(spot.sprite)?.w ?? 8;
            const side = spot.x + spotW + 4;
            if (Math.abs(e.x - side) > 10) move(store, e, def, side, now, speed);
          } else if (rnd() < 0.1) move(store, e, def, e.x + (rnd() < 0.5 ? -1 : 1) * 30, now, speed);
          break;
        }
        case 'perch':
          break;
      }
    }

    if (def?.lines?.length && !e.say && Math.abs(gap) < 30 && !c.bubble && rnd() < 0.08) {
      const text = pick(def.lines, rnd);
      if (text) store.dispatch({ type: 'entity_say', id: e.id, say: { text, until: now + 4500 } }, 'behaviour');
    }
  }
}
