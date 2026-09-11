import type { EngineView } from '../../engine/world';
import type { SceneScreen, SceneScreenPage } from '../../shared/sceneTypes';
import {
  deadServers,
  isRoomThrottling,
  liveServers,
  slotCount,
  totalDrawW,
  type ServerRoomState,
} from './state';
import { audible } from './outage';
import { tuning } from './tuning';
import { trafficReadout } from './display';

/**
 * Shared room bulletin data: the room's status, and what
 * any of it is for. A viewer glancing at the stream for four seconds has to be
 * able to read one of them and understand both what is happening and that they
 * are the ones who can do something about it — which is why the goal is the
 * status page's title rather than buried.
 *
 * Two, not twenty: this replaced a cycling board of work orders and per-server
 * telemetry that nobody could read in the time they looked at it.
 *
 * Each row is a stat tile, not a chart: a label and a value. The one bar in the
 * room is on the wall readout next to the chat monitor, where the numbers have
 * space to sit beside it.
 */

// Keep the compact bulletin within the original 29-character body budget.
// The whiteboard leaves a little extra room and renders the footer smaller.
// Its status page stays put; the help page remains available to other displays.
const SCREEN_COLS = 29;
const FOOTER_COLS = 38;
const LABEL_COLS = 10;
const pad = (label: string) => label.padEnd(LABEL_COLS, ' ');
const clip = (line: string, cols: number) =>
  Array.from(line).length <= cols ? line : Array.from(line).slice(0, cols - 1).join('') + '…';
const fit = (line: string) => clip(line, SCREEN_COLS);

/**
 * What Admin is doing, in words, keyed off the task rather than its label —
 * task labels are written for the log and are far too long for this row.
 *
 * Every value here must fit `SCREEN_COLS` minus the ten-character label, or it
 * truncates to an ellipsis mid-word on the one screen a viewer actually reads.
 * `servers.test.ts` pins that.
 */
export const DOING: Record<string, string> = {
  'emergency-pull': 'pulling one out',
  'emergency-exchange': 'getting a fresh one',
  'emergency-install': 'fitting a new one',
  'emergency-reset': 'restoring power',
  'emergency-boot': 'starting up',
  provision: 'putting in a server',
  restart: 'restarting a server',
  upgrade: 'upgrading a server',
  investigate: 'checking something',
  'breaker-repair': 'getting power back',
  'block-traffic': 'on the junk traffic',
  recable: 'replacing a cable',
  unpack: 'opening a delivery',
  'hinder-heat': 'setting up a heater',
};

/** How much room a value has once its label is padded out. */
export const VALUE_COLS = SCREEN_COLS - LABEL_COLS;

function adminLine(view: EngineView): string {
  const task = view.currentTask;
  if (task) return DOING[task.kind] ?? 'on something else';
  if (view.pendingTasks.length) {
    return `${view.pendingTasks.length} thing${view.pendingTasks.length === 1 ? '' : 's'} to do`;
  }
  return 'watching the room';
}

function serversLine(state: ServerRoomState): string {
  const up = liveServers(state).length;
  const off = deadServers(state).length;
  if (up === 0 && off === 0) return `none yet, ${slotCount(state)} spaces`;
  return `${up} running${off > 0 ? `, ${off} off` : ''}`;
}

/**
 * Worst first, and only things a viewer could do something about or would want
 * to know. The renderer rotates these one at a time along the bottom edge.
 */
function alerts(state: ServerRoomState): string[] {
  const out: string[] = [];
  const load = totalDrawW(state);
  if (!audible(state)) out.push('NO CHAT IS REACHING THIS ROOM');
  if (state.power.breakerTripped) out.push('THE POWER IS OFF');
  else if (load >= state.power.budgetW) out.push('WE ARE USING TOO MUCH POWER');
  if (state.roomTempC >= tuning.failTempC) out.push('THE ROOM IS DANGEROUSLY HOT');
  else if (isRoomThrottling(state)) out.push('IT IS TOO HOT — THE SERVERS ARE SLOWING DOWN');
  if (state.incidents.junkTraffic) out.push('JUNK TRAFFIC IS HAMMERING US');
  if (state.incidents.rat) out.push('SOMETHING HAS CHEWED A CABLE');
  const traffic = trafficReadout(state);
  if (traffic.status === 'LOSING MESSAGES') out.push('WE ARE LOSING CHAT MESSAGES');
  else if (traffic.status === 'AT THE LIMIT') out.push('WE COULD USE MORE SERVERS');
  const off = deadServers(state).length;
  if (off) out.push(`${off} SERVER${off > 1 ? 'S ARE' : ' IS'} OFF`);
  if (state.incidents.delivery) out.push('A DELIVERY IS WAITING');
  // The bottom line always says something: a blank strip reads as a screen that
  // has stopped working, and "nothing is wrong" is worth saying out loud.
  return out.length ? out : ['ALL SYSTEMS ARE GREEN'];
}

function footer(state: ServerRoomState): string {
  const off = deadServers(state);
  if (off.length) {
    const names = off.slice(0, 2).map((s) => s.ownerName).join(', ');
    return clip(`${names}: say "restart mine"`, FOOTER_COLS);
  }
  if (liveServers(state).length === 0) return 'say "give me a server" to run one';
  return 'say "give me a server" to help out';
}

/**
 * The second page exists because nothing else on screen says what any of this
 * is FOR. A viewer arriving cold can read the status page perfectly and still
 * have no idea it is their typing that makes the work, or that they are meant
 * to do something about it. So the goal is stated flat out, in the plainest
 * words that fit, and it alternates with the status rather than competing for
 * room on the same page.
 */
function goalPage(state: ServerRoomState): SceneScreenPage {
  const up = liveServers(state).length;
  return {
    id: 'goal',
    title: 'HOW YOU HELP',
    // Five rows is the hard ceiling on this monitor, so this is the whole
    // explanation and there is no room for a sixth line.
    lines: [
      'Help admin keep the chat',
      'alive by building servers.',
      'The more you type, the more',
      'work he has to do, and the',
      'more servers we need.',
    ],
    // Both of these have to fit FOOTER_COLS, and the longer phrasings did not:
    // the server count already has a row of its own on the status page, so the
    // footer spends its width on the words a viewer has to type.
    footer: clip(
      up === 0 ? 'say "give me a server" to be the first' : 'say "give me a server" to join in',
      FOOTER_COLS,
    ),
  };
}

export function statusScreen(state: ServerRoomState, view: EngineView): SceneScreen {
  if (state.emergency) {
    const e = state.emergency;
    const total = Math.max(1, e.serverIds.length);
    return {
      label: 'THE SERVER ROOM', dwellMs: 9000, alerts: ['ALL NORMAL WORK IS ON HOLD'],
      pages: [{ id: 'emergency', title: e.stage === 'boot' ? 'STARTING UP' : 'ON BACKUP POWER',
        lines: ['CHAT      nothing getting in', 'CITY      power is out',
          `REPLACED  ${Math.min(e.index, total)} of ${total} servers`,
          'ADMIN     ' + DOING[`emergency-${e.stage}`], 'POWER     emergency batteries'],
        footer: 'chat returns when the repairs are done',
      }],
    };
  }
  const traffic = trafficReadout(state);
  return {
    label: 'THE SERVER ROOM',
    dwellMs: 9_000,
    alerts: alerts(state),
    pages: [
      {
        id: 'status',
        // The goal, on the page a viewer is most likely to be looking at.
        title: 'GOAL: KEEP CHAT ALIVE',
        lines: [
          // Real numbers, not a word: this is the row that moves when somebody
          // types, which is the causality the whole room is trying to show.
          // "N of 0 a min" reads as a broken gauge, so a dead room says it plainly.
          fit(
            `${pad('CHAT')}${
              traffic.capacity > 0
                ? `${Math.round(traffic.demand)} of ${Math.round(traffic.capacity)} a min`
                : `${Math.round(traffic.demand)} in, 0 carried`
            }`,
          ),
          fit(`${pad('SERVERS')}${serversLine(state)}`),
          fit(`${pad('POWER')}${totalDrawW(state)} of ${state.power.budgetW}W`),
          fit(
            `${pad('ROOM')}${Math.round(state.roomTempC)}°C`,
          ),
          fit(`${pad('ADMIN')}${adminLine(view)}`),
        ],
        footer: footer(state),
      },
      goalPage(state),
    ],
  };
}
