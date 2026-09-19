// The event table (brief §5.8). Each event leaves a CUE in the terminal log for
// chat to spot and report — Admin mostly doesn't announce them himself, because
// chat being the alarm is the point. Weights lean toward whatever the room is
// currently weak at.

import type { WorldEventDef } from '../../engine/world';
import { type ServerRoomState } from './state';
import { tuning } from './tuning';

type Def = WorldEventDef<ServerRoomState>;

function runningServers(state: ServerRoomState) {
  return Object.values(state.servers).filter((s) => s.health > 0);
}

function pick<T>(items: T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

const junkTraffic: Def = {
  name: 'junk-traffic',
  weight(state) {
    return runningServers(state).length && !state.incidents.junkTraffic ? 0.7 : 0;
  },
  trigger(ctx) {
    ctx.state.incidents.junkTraffic = {
      startedAt: ctx.now,
      endsAt: ctx.now + tuning.junkTrafficDurationMs,
    };
    ctx.log('junk traffic is hammering the room. every fan just spun up', 'warn');
  },
};

const powerFlicker: Def = {
  name: 'power-flicker',
  weight(state) {
    return runningServers(state).length ? 0.5 : 0;
  },
  trigger(ctx) {
    const servers = runningServers(ctx.state);
    for (const s of servers) s.health = Math.max(0, s.health - tuning.flickerHealthHit);
    const victim = pick(servers, ctx.rng);
    victim.health = Math.max(0, victim.health - tuning.flickerVictimHealthHit);
    ctx.log(
      `the lights dipped — every server restarted, and ${victim.ownerName}'s "${victim.name}" came back unhappy`,
      'alert',
    );
    ctx.say('power flicker. nothing in this room has a battery, so we all felt that.');
  },
};

const ratInCableTray: Def = {
  name: 'rat-in-cable-tray',
  weight(state) {
    return runningServers(state).length && !state.incidents.rat ? 0.8 : 0;
  },
  trigger(ctx) {
    const server = pick(runningServers(ctx.state), ctx.rng);
    ctx.state.incidents.rat = { serverId: server.id, startedAt: ctx.now };
    ctx.log(`scratching in the cable tray. a cable above slot ${server.slot + 1} keeps jiggling`, 'warn');
  },
};

/**
 * A server just stops. This is the one thing that reliably teaches a viewer
 * that their server is theirs: it goes dark, the room carries less, and only
 * they can say "restart mine". Weighted toward servers already struggling, so
 * an ignored server is the one that dies.
 */
const serverDied: Def = {
  name: 'server-died',
  weight(state) {
    const running = runningServers(state);
    if (!running.length) return 0;
    const struggling = running.filter((s) => s.health < 70).length;
    return 0.5 + struggling * 1.5;
  },
  trigger(ctx) {
    const running = runningServers(ctx.state);
    // The sickest one goes first; a room of healthy servers loses a random one.
    const server = running.sort((a, b) => a.health - b.health)[0];
    server.health = 0;
    server.darkSince = ctx.now;
    ctx.log(
      `${server.ownerName}'s "${server.name}" in slot ${server.slot + 1} stopped. the fans spun down and that was that`,
      'alert',
    );
    ctx.say(
      `${server.ownerName}'s server just died. ${server.ownerName}, say "restart mine" and i'll go and bring it back.`,
    );
  },
};

const delivery: Def = {
  name: 'delivery',
  weight(state) {
    return state.incidents.delivery ? 0 : 0.6;
  },
  // The crate itself is the whole event: the sweep puts it on the board and the
  // board hands Admin the unpacking.
  trigger(ctx) {
    ctx.state.incidents.delivery = { arrivedAt: ctx.now };
    ctx.log('a delivery crate appeared beside the desk');
    ctx.say('delivery. hang on.');
  },
};

const legacyNoise: Def = {
  name: 'legacy-noise',
  weight() {
    return 0.4;
  },
  trigger(ctx) {
    const s = ctx.state;
    s.legacy.lastNoiseAt = ctx.now;
    ctx.log('LEGACY-01 clicked twice and resumed humming', 'warn');
    if (ctx.rng() < 0.25 && s.legacy.clues < CLUES.length) {
      ctx.log(CLUES[s.legacy.clues], 'warn');
      s.legacy.clues++;
    }
    ctx.say(
      pick(
        [
          'it does that sometimes. nobody move.',
          "LEGACY-01's awake. i mean — it's always awake. it's fine. we're fine.",
          'if that one ever stops humming, i want you all to know it was an honour.',
        ],
        ctx.rng,
      ),
    );
  },
};

// Oblique breadcrumbs, surfaced very rarely. Never resolved quickly (brief §5.2).
const CLUES = [
  "LEGACY-01's screen showed a date from 1997 for exactly one second",
  'the label under the dust on LEGACY-01 might say "DO NOT" and then something scratched out',
  "LEGACY-01's little green light blinked in a pattern. it looked deliberate",
];

export const events: Def[] = [
  junkTraffic,
  powerFlicker,
  ratInCableTray,
  serverDied,
  delivery,
  legacyNoise,
];
