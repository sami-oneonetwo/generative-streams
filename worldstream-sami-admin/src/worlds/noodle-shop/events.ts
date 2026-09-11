import type { WorldCtx, WorldEventDef } from '../../engine/world';
import { canCook, type NoodleShopState } from './state';
import { tuning } from './tuning';

type Def = WorldEventDef<NoodleShopState>;

function occupiedStools(state: NoodleShopState) {
  return Object.values(state.stools);
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

const brothBoilOver: Def = {
  name: 'broth-boil-over',
  weight(state) {
    return state.broth.servings > 0 && !state.incidents.brothBoiling && !state.broth.simmering ? 1.2 : 0;
  },
  trigger(ctx) {
    ctx.state.incidents.brothBoiling = { startedAt: ctx.now };
    ctx.log('the big pot is hissing and spitting — it\'s about to boil over', 'warn');
  },
};

const rushHour: Def = {
  name: 'rush-hour',
  weight(state) {
    return !state.incidents.rush && canCook(state) ? 0.8 : 0;
  },
  trigger(ctx) {
    ctx.state.incidents.rush = { startedAt: ctx.now, endsAt: ctx.now + tuning.rushDurationMs };
    ctx.log('a crowd just pushed in out of the rain — orders are stacking up', 'warn');
    ctx.say('rush. everyone in at once, like always. one bowl at a time — don\'t start.');
  },
};

const ratInKitchen: Def = {
  name: 'rat-in-kitchen',
  weight(state) {
    return !state.incidents.rat ? 0.7 : 0;
  },
  trigger(ctx) {
    ctx.state.incidents.rat = { startedAt: ctx.now, deadlineAt: ctx.now + tuning.ratHealthWindowMs };
    ctx.log('something moved behind the flour sacks', 'warn');
  },
};

const vendingBreak: Def = {
  name: 'vending-machine-break',
  weight(state) {
    return state.incidents.vendingBroken ? 0 : 0.6;
  },
  trigger(ctx) {
    ctx.state.incidents.vendingBroken = true;
    ctx.log('the vending machine out front is flickering and eating coins again', 'warn');
  },
};

const burnerOut: Def = {
  name: 'burner-out',
  weight(state) {
    return state.incidents.burnerOut ? 0 : 0.5;
  },
  trigger(ctx) {
    ctx.state.incidents.burnerOut = true;
    ctx.log('the front burner sputtered and died — no flame', 'warn');
  },
};

const spilledBowl: Def = {
  name: 'spilled-bowl',
  weight(state) {
    return !state.incidents.mess && occupiedStools(state).some((s) => s.bowl) ? 0.5 : 0;
  },
  trigger(ctx) {
    const withBowls = occupiedStools(ctx.state).filter((s) => s.bowl);
    const stool = pick(withBowls, ctx.rng);
    stool.bowl = undefined;
    ctx.state.incidents.mess = { stoolId: stool.id, startedAt: ctx.now };
    ctx.log(`a bowl went over at seat ${stool.index + 1} — broth everywhere`, 'warn');
  },
};

const delivery: Def = {
  name: 'delivery',
  weight(state) {
    return state.incidents.delivery ? 0 : 0.5;
  },
  trigger(ctx) {
    ctx.state.incidents.delivery = { arrivedAt: ctx.now };
    ctx.log('the noodle delivery is here — crates by the door');
    ctx.say('delivery. fresh noodles. good.');
    ctx.enqueueTask({
      kind: 'unpack',
      label: 'take in the delivery',
      targetX: 250,
      workMs: tuning.taskUnpackMs,
      onComplete(ctx) {
        const s = ctx.state;
        s.incidents.delivery = undefined;
        // A little top-up of broth if the pot has room.
        const room = tuning.brothServings - s.broth.servings;
        if (room > 0 && !s.broth.simmering) {
          const added = Math.min(room, 4);
          s.broth.servings += added;
          ctx.log(`delivery stocked — topped the pot by ${added} servings`);
          ctx.say("good stock this week. pot's topped up.");
        } else {
          ctx.log('delivery stocked to the shelf');
          ctx.say('shelved. we\'re set for the night.');
        }
      },
    });
  },
};

// A tender beat — no consequence, pure character. Rare.
const plantBeat: Def = {
  name: 'plant-beat',
  weight() {
    return 0.35;
  },
  trigger(ctx) {
    const s = ctx.state;
    if (s.plant.vitality >= 70 && ctx.rng() < 0.5) {
      s.plant.buds++;
      ctx.log('a new bud opened on the plant');
      ctx.say(pickBeat(ctx, 'good'));
    } else {
      ctx.log('the plant dropped a leaf');
      ctx.say(pickBeat(ctx, 'wist'));
    }
  },
};

function pickBeat(ctx: WorldCtx<NoodleShopState>, mood: 'good' | 'wist'): string {
  const good = [
    'new bud. huh. she\'d have liked that one.',
    'it\'s flowering again. on its own schedule, like her.',
  ];
  const wist = [
    'dropped a leaf. they do that. it\'s fine.',
    'lost a leaf. i\'ll check the water after service.',
  ];
  const arr = mood === 'good' ? good : wist;
  return arr[Math.floor(ctx.rng() * arr.length)];
}

export const events: Def[] = [
  brothBoilOver,
  rushHour,
  ratInKitchen,
  vendingBreak,
  burnerOut,
  spilledBowl,
  delivery,
  plantBeat,
];
