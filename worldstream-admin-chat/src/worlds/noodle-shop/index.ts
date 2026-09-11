import type { WorldModule } from '../../engine/world';
import { createInitialState, noodleShopStateSchema, type NoodleShopState } from './state';
import { intents, quickClassify } from './intents';
import { tick } from './tick';
import { events } from './events';
import { applyOfflineTime } from './offline';
import { buildScene, layout } from './scene';
import { persona } from './persona';
import { tuning } from './tuning';

export const noodleShopWorld: WorldModule<NoodleShopState> = {
  meta: { id: 'noodle-shop', name: "Kenji's Noodle Bar", stateVersion: 1 },
  stateSchema: noodleShopStateSchema,
  createInitialState,
  migrate(_raw, fromVersion) {
    throw new Error(`no migration path from state version ${fromVersion}`);
  },
  intents,
  fallbackIntent: 'ask',
  quickClassify,
  events,
  tick,
  applyOfflineTime,
  buildScene,
  persona,
  adminActions: [
    {
      id: 'empty-pot',
      label: 'Empty the broth pot',
      run(ctx) {
        ctx.state.broth.servings = 0;
        ctx.log('broth pot emptied (admin)');
      },
    },
    {
      id: 'wilt-plant',
      label: 'Wilt the plant',
      run(ctx) {
        ctx.state.plant.vitality = 25;
        ctx.log('plant vitality forced low (admin)');
      },
    },
  ],
  tuning,
  layout,
};
