import type { Scene, SceneEntity } from '../../shared/sceneTypes';
import type { EngineView, WorldLayout } from '../../engine/world';
import {
  canCook,
  plantStage,
  reputationStars,
  shopStage,
  usedStools,
  type NoodleShopState,
} from './state';
import { tuning } from './tuning';
import { persona } from './persona';

// Placeholder geometry + the reference palette (navy night, amber interior,
// neon red, cyan vending machine). Real pixel-art swaps in via the client draw
// registry; this file only produces typed entities.
export const LAYOUT = {
  width: 1920,
  height: 1080,
  worldWidth: 1430,
  floorY: 980,
  counter: { x: 250, y: 720, w: 940, h: 40 }, // the bar the bowls sit on
  stool: { firstX: 300, pitch: 150, y: 800, size: 46 }, // stools along the near side
  kitchen: { x: 250, y: 500, w: 940, h: 150 }, // behind the counter
  pot: { x: 300, y: 560, w: 90, h: 70, pitch: 130 },
  plantShelf: { x: 1090, y: 540, w: 90, h: 110 }, // her plant, on a shelf behind Kenji
  register: { x: 1110, y: 690, w: 80, h: 50 },
  sign: { x: 470, y: 250, w: 470, h: 150 }, // neon bowl emblem + text
  lanternY: 230,
  vending: { x: 60, y: 780, w: 90, h: 190 }, // cyan, street level (left, like the ref)
  door: { x: 1230 - 40, y: 700, w: 0, h: 0 }, // customers enter from stage right (offscreen)
  crate: { x: 175, y: 900, w: 80, h: 70 },
  kenjiHomeX: 720, // behind the counter, centre
};

export const layout: WorldLayout = {
  width: LAYOUT.width,
  height: LAYOUT.height,
  worldWidth: LAYOUT.worldWidth,
  protagonistHomeX: LAYOUT.kenjiHomeX,
  walkSpeedPxPerSec: 200,
};

export function stoolX(index: number): number {
  return LAYOUT.stool.firstX + index * LAYOUT.stool.pitch;
}

export function potX(): number {
  return LAYOUT.pot.x + LAYOUT.pot.w / 2 + 40;
}

export function plantX(): number {
  return LAYOUT.plantShelf.x - 40;
}

export function registerX(): number {
  return LAYOUT.register.x - 30;
}

export function vendingX(): number {
  return LAYOUT.vending.x + LAYOUT.vending.w + 30;
}

/** Warm interior glow strengthens with reputation; a struggling shop is dimmer. */
function interiorGlow(state: NoodleShopState): string {
  const warmth = 0.4 + 0.6 * (state.reputation / 100);
  const r = Math.round(255 * warmth);
  const g = Math.round(150 * warmth);
  const b = Math.round(60 * warmth);
  return `rgba(${r}, ${g}, ${b}, 0.16)`;
}

export function buildScene(state: NoodleShopState, view: EngineView): Scene {
  const entities: SceneEntity[] = [];

  // --- scenery: the tower silhouette rises behind the shopfront ---
  entities.push({ id: 'tower', kind: 'tower', x: 360, y: 0, w: 700, h: 470 });
  entities.push({ id: 'skyline', kind: 'skyline', x: 0, y: 0, w: LAYOUT.worldWidth, h: LAYOUT.floorY });

  // neon sign + lanterns
  entities.push({
    id: 'sign',
    kind: 'neonSign',
    x: LAYOUT.sign.x,
    y: LAYOUT.sign.y,
    w: LAYOUT.sign.w,
    h: LAYOUT.sign.h,
    props: { open: true },
  });
  for (let i = 0; i < 4; i++) {
    entities.push({
      id: `lantern-${i}`,
      kind: 'lantern',
      x: 300 + i * 220,
      y: LAYOUT.lanternY,
      w: 34,
      h: 48,
    });
  }

  // warm interior backing
  entities.push({
    id: 'interior',
    kind: 'interior',
    x: 230,
    y: 440,
    w: 980,
    h: 540,
    props: { glow: interiorGlow(state) },
  });

  // vending machine (cyan; can be broken)
  entities.push({
    id: 'vending',
    kind: 'vending',
    x: LAYOUT.vending.x,
    y: LAYOUT.vending.y,
    w: LAYOUT.vending.w,
    h: LAYOUT.vending.h,
    props: { broken: state.incidents.vendingBroken },
  });

  // kitchen + pots
  entities.push({
    id: 'kitchen',
    kind: 'kitchen',
    x: LAYOUT.kitchen.x,
    y: LAYOUT.kitchen.y,
    w: LAYOUT.kitchen.w,
    h: LAYOUT.kitchen.h,
  });
  for (let i = 0; i < state.pots; i++) {
    entities.push({
      id: `pot-${i}`,
      kind: 'pot',
      x: LAYOUT.pot.x + i * LAYOUT.pot.pitch,
      y: LAYOUT.pot.y,
      w: LAYOUT.pot.w,
      h: LAYOUT.pot.h,
      props: {
        servings: i === 0 ? state.broth.servings : 0,
        max: tuning.brothServings,
        boiling: Boolean(state.incidents.brothBoiling),
        simmering: state.broth.simmering,
        burnerOut: state.incidents.burnerOut,
      },
    });
  }

  // her plant
  entities.push({
    id: 'plant',
    kind: 'plant',
    x: LAYOUT.plantShelf.x,
    y: LAYOUT.plantShelf.y,
    w: LAYOUT.plantShelf.w,
    h: LAYOUT.plantShelf.h,
    props: { stage: plantStage(state), vitality: Math.round(state.plant.vitality), buds: state.plant.buds },
  });

  entities.push({
    id: 'register',
    kind: 'register',
    x: LAYOUT.register.x,
    y: LAYOUT.register.y,
    w: LAYOUT.register.w,
    h: LAYOUT.register.h,
    props: { till: state.till },
  });

  // the counter
  entities.push({
    id: 'counter',
    kind: 'counter',
    x: LAYOUT.counter.x,
    y: LAYOUT.counter.y,
    w: LAYOUT.counter.w,
    h: LAYOUT.counter.h,
  });

  // stools (occupied + empty), with bowls and seated avatars
  for (let i = 0; i < state.stoolCount; i++) {
    const occupant = Object.values(state.stools).find((s) => s.index === i);
    entities.push({
      id: `stool-${i}`,
      kind: 'stool',
      x: stoolX(i),
      y: LAYOUT.stool.y,
      w: LAYOUT.stool.size,
      h: LAYOUT.stool.size,
      props: occupant
        ? {
            owner: occupant.ownerName,
            hasBowl: Boolean(occupant.bowl),
            eaten: occupant.bowl?.eaten ?? false,
            broth: occupant.bowl?.broth,
            mess: state.incidents.mess?.stoolId === occupant.id,
          }
        : { empty: true },
    });
  }

  const stars = reputationStars(state);
  const rentDue = tuning.rentPerStream;

  return {
    width: LAYOUT.width,
    height: LAYOUT.height,
    worldWidth: LAYOUT.worldWidth,
    bg: '#0a0e1a',
    entities,
    protagonist: {
      name: persona.name.toUpperCase(),
      x: view.protagonist.x,
      y: LAYOUT.floorY,
      state: view.protagonist.state,
      walk: view.protagonist.walk,
    },
    speech: view.speech,
    hud: {
      title: `${persona.name.toUpperCase()}'S NOODLE BAR`,
      meters: [
        {
          id: 'broth',
          label: state.broth.simmering ? 'BROTH (simmering…)' : 'BROTH',
          value: state.broth.servings,
          max: tuning.brothServings * state.pots,
          unit: ' bowls',
          warnAt: tuning.warnBrothAt,
        },
        { id: 'rep', label: 'REPUTATION', value: state.reputation, max: 100, unit: '', warnAt: 40 },
      ],
      counters: [
        { id: 'till', label: `TILL (rent ¥${rentDue})`, value: `¥${state.till}` },
        { id: 'stars', label: 'STARS', value: '★'.repeat(Math.floor(stars)) + (stars % 1 ? '½' : '') || '—' },
        { id: 'stage', label: 'STAGE', value: shopStage(state) },
        { id: 'days', label: 'DAYS OPEN', value: String(state.daysOpen) },
        { id: 'seats', label: 'SEATS', value: `${usedStools(state)}/${state.stoolCount}` },
        { id: 'plant', label: 'HER PLANT', value: plantStage(state) },
      ],
      board: Object.values(state.stools)
        .sort((a, b) => a.index - b.index)
        .map((s) => ({
          label: `seat ${s.index + 1} · ${s.ownerName}`,
          detail: s.bowl ? (s.bowl.eaten ? 'finished' : `eating ${s.bowl.broth}`) : `${s.bowlsServed} bowls`,
          color: s.bowl ? (s.bowl.eaten ? '#8a7a50' : '#ffb347') : '#3d4654',
        })),
      queue: {
        current: view.currentTask
          ? {
              label: view.currentTask.label,
              requestedBy: view.currentTask.requestedBy,
              progress: view.currentTask.progress,
            }
          : undefined,
        pending: view.pendingTasks,
      },
      logLines: view.logLines,
      pinned: canCook(state)
        ? "Type 'bowl of ramen' to order · 'give me a seat' to claim a stool."
        : state.incidents.burnerOut
          ? 'The burner is out — tell Kenji!'
          : 'Broth pot is empty — a fresh batch is simmering.',
    },
  };
}
