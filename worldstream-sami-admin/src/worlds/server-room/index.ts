import type { WorldModule } from '../../engine/world';
import {
  createInitialState,
  migrateState,
  serverRoomStateSchema,
  type ServerRoomState,
} from './state';
import { intents, quickClassify } from './intents';
import { tick, tripBreaker } from './tick';
import { startWave } from './traffic';
import { audible, onAudible } from './outage';
import { displayReceipt } from './display';
import { events } from './events';
import { applyOfflineTime } from './offline';
import { buildScene, layout } from './scene';
import { persona } from './persona';
import { tuning } from './tuning';

export const serverRoomWorld: WorldModule<ServerRoomState> = {
  meta: { id: 'server-room', name: 'The Server Room', stateVersion: 6 },
  stateSchema: serverRoomStateSchema,
  createInitialState,
  migrate: migrateState,
  intents,
  fallbackIntent: 'ask',
  quickClassify,
  events,
  tick,
  audible,
  emergency: state => !!state.emergency,
  onAudible,
  displayReceipt,
  applyOfflineTime,
  buildScene,
  persona,
  adminActions: [
    {
      id: 'trip-breaker',
      label: 'Cut the power',
      run(ctx) {
        tripBreaker(ctx, 'somebody pulled it on purpose');
      },
    },
    {
      id: 'wave-ripple',
      label: `Chat wave: small (+${tuning.waveRippleExtraPerMin} a minute)`,
      run(ctx) {
        startWave(ctx, 'the room next door', tuning.waveRippleExtraPerMin);
      },
    },
    {
      id: 'wave-peak',
      label: `Chat wave: big (+${tuning.wavePeakExtraPerMin} a minute)`,
      run(ctx) {
        startWave(ctx, 'the room next door', tuning.wavePeakExtraPerMin);
      },
    },
  ],
  tuning,
  layout,
};
