import { z } from 'zod';
import type { ChatMessage, IntentDef, WorldCtx } from '../../engine/world';
import {
  computeDrawW,
  findServerByOwner,
  firstFreeSlot,
  serverStatus,
  slotCount,
  totalDrawW,
  usedSlots,
  type Server,
  type ServerRoomState,
} from './state';
import { tuning } from './tuning';
import { deskX, powerServiceX, rackCenterX, slotPos } from './scene';
import { boardOrder, closeTicket, OPEN_STATES, openTickets, raiseTicket } from './tickets';

type Ctx = WorldCtx<ServerRoomState>;

/** Pick a random template line and fill {slot} vars. */
function t(lines: string[], vars: Record<string, string | number> = {}): string {
  let line = lines[Math.floor(Math.random() * lines.length)];
  for (const [k, v] of Object.entries(vars)) line = line.replaceAll(`{${k}}`, String(v));
  return line;
}

function touchChatter(state: ServerRoomState, msg: ChatMessage): void {
  const existing = state.chatters[msg.userId];
  if (existing) {
    existing.lastSeen = msg.ts;
    existing.name = msg.username;
  } else {
    state.chatters[msg.userId] = {
      name: msg.username,
      firstSeen: msg.ts,
      lastSeen: msg.ts,
      reports: 0,
    };
  }
}

/** Where Admin stands to work on a server. */
function atServer(server: Server): number {
  const pos = slotPos(server.slot);
  return pos.x + pos.w / 2 + 70;
}

// ---------------------------------------------------------------- provision

const provisionParams = z.object({
  name: z.string().optional(),
  purpose: z.string().optional(),
});

const provision: IntentDef<ServerRoomState> = {
  name: 'provision',
  description:
    'The chatter wants their own server put in the rack. Every server does the same thing: it carries chat messages.',
  examples: [
    'give me a server',
    'spin me up a server',
    'I want one',
    'can I get a server called doom-machine',
    'give me a box',
  ],
  paramsSchema: provisionParams,
  async handle(ctx, msg, params) {
    const state = ctx.state;
    touchChatter(state, msg);
    const p = (params ?? {}) as z.infer<typeof provisionParams>;

    const existing = findServerByOwner(state, msg.userId);
    if (existing) {
      ctx.say(
        t(
          [
            `you already have a server, {user}. slot {slot}. go and look at it.`,
            `one each, {user}. yours is in slot {slot}.`,
          ],
          { user: msg.username, slot: existing.slot + 1 },
        ),
      );
      return;
    }
    const pendingProvisions = ctx.queue.filter((q) => q.kind === 'provision');
    if (pendingProvisions.some((q) => q.requestedBy === msg.username)) {
      ctx.say(t([`yours is already on my list, {user}. patience.`], { user: msg.username }));
      return;
    }
    if (usedSlots(state) + pendingProvisions.length >= slotCount(state)) {
      ctx.say(
        t(
          [
            `rack's full, {user}. somebody's server has to come out before yours goes in. take it up with chat.`,
            `no space left, {user}. we either take a dead one out or somebody buys me another rack.`,
          ],
          { user: msg.username },
        ),
      );
      ctx.log(`no new server for ${msg.username}: the rack is full`);
      return;
    }
    if (totalDrawW(state) + tuning.baseDrawW > state.power.budgetW) {
      ctx.say(
        t(
          [
            `can't, {user}. another server puts us over what this room is allowed to pull and the power goes off.`,
          ],
          { user: msg.username },
        ),
      );
      ctx.log(`no new server for ${msg.username}: not enough power`);
      return;
    }

    // Moderate the free text before it can ever appear on screen.
    let serverName = msg.username.toLowerCase();
    if (p.name) {
      const verdict = await ctx.llm.moderate(p.name, 24);
      if (verdict.ok && verdict.cleaned) serverName = verdict.cleaned;
      else ctx.say(t([`i'm not writing that on a label, {user}.`], { user: msg.username }));
    }
    let purpose: string | undefined;
    if (p.purpose) {
      const verdict = await ctx.llm.moderate(p.purpose, 40);
      if (verdict.ok && verdict.cleaned) purpose = verdict.cleaned;
    }

    const requestedBy = msg.username;
    ctx.enqueueTask({
      kind: 'provision',
      label: `put in a server for ${requestedBy}`,
      requestedBy,
      targetX: rackCenterX(),
      workMs: tuning.taskProvisionMs,
      onStart(ctx) {
        ctx.say(
          t(
            [
              `alright {user}, one server coming up.`,
              `fine. {user} gets a server. don't make me regret this.`,
              `racking one for {user}. give me a minute.`,
            ],
            { user: requestedBy },
          ),
        );
      },
      onComplete(ctx) {
        const s = ctx.state;
        // Re-check everything: another task may have taken the space or the
        // power between the request and now.
        if (findServerByOwner(s, msg.userId)) return;
        const slot = firstFreeSlot(s);
        if (slot === null) {
          ctx.say(`huh. the rack filled up while i was walking over. sorry, ${requestedBy}.`);
          return;
        }
        if (totalDrawW(s) + tuning.baseDrawW > s.power.budgetW) {
          ctx.say(`we ran out of power while i was walking over. no server for ${requestedBy} today.`);
          return;
        }
        const server: Server = {
          id: `server-${crypto.randomUUID().slice(0, 8)}`,
          slot,
          ownerUserId: msg.userId,
          ownerName: requestedBy,
          name: serverName,
          purpose,
          health: 100,
          temperature: 22,
          powerDrawW: tuning.baseDrawW,
          level: 0,
          uptimeDays: 0,
          delivered: 0,
          createdAt: ctx.now,
          darkStreams: 0,
        };
        s.servers[server.id] = server;
        touchChatter(s, msg);
        s.chatters[msg.userId].serverId = server.id;
        ctx.log(`put in "${serverName}" for ${requestedBy} (slot ${slot + 1})`);
        // The install is the tutorial: say what it does and what they can do.
        ctx.say(
          t(
            [
              `there. slot {slot}, "{server}". it's carrying chat now, {user} — that's real, every message you see goes through this room. say "upgrade mine" when we need it to carry more.`,
              `"{server}" is running in slot {slot}. it carries chat messages, {user}. keep an eye on it — if it dies, say "restart mine".`,
            ],
            { user: requestedBy, server: serverName, slot: slot + 1 },
          ),
        );
      },
    });
  },
};

// ------------------------------------------------------------------- restart

/**
 * The one repair a viewer does themselves. Servers wear down and sometimes just
 * stop, and only the owner can bring theirs back — that is what makes it feel
 * like theirs. It costs Admin's time to walk over, and the server carried
 * nothing while it was off, so a full recovery is fair.
 */
const restart: IntentDef<ServerRoomState> = {
  name: 'restart',
  description:
    "The chatter wants their OWN server turned back on or restarted, usually because it has died or is struggling. Requests aimed at someone else's server are still 'restart' (Admin will refuse).",
  examples: ['restart mine', 'reboot my server', 'turn my server back on', 'my server is dead', 'fix my server'],
  handle(ctx, msg) {
    const state = ctx.state;
    touchChatter(state, msg);
    const user = msg.username;

    const server = findServerByOwner(state, msg.userId);
    if (!server) {
      ctx.say(
        t(
          [
            `you don't have a server, {user}. say "give me a server" and we'll fix that.`,
            `nothing in this rack is yours, {user}. i only take orders from owners.`,
          ],
          { user },
        ),
      );
      return;
    }
    if (state.power.breakerTripped) {
      ctx.say(`the power's off, ${user}. nothing to restart until i get that back on.`);
      return;
    }
    if (serverStatus(server, state) === 'green') {
      ctx.say(
        t([`"{server}" is running fine, {user}. leave it alone.`], { user, server: server.name }),
      );
      return;
    }

    const serverId = server.id;
    ctx.enqueueTask({
      kind: 'restart',
      label: `restart ${user}'s server`,
      requestedBy: user,
      targetX: atServer(server),
      workMs: tuning.taskRestartMs,
      onComplete(ctx) {
        const s = ctx.state.servers[serverId];
        if (!s) {
          ctx.say(`that server isn't in the rack anymore. awkward.`);
          return;
        }
        const wasOff = s.health <= 0;
        s.health = 100;
        s.darkSince = undefined;
        ctx.log(`restarted ${s.ownerName}'s "${s.name}"`);
        ctx.say(
          wasOff
            ? t([`it lives. "{server}" is back and carrying chat again, {user}.`], {
                user,
                server: s.name,
              })
            : t([`restarted "{server}". it made the good beep. good as new, {user}.`], {
                user,
                server: s.name,
              }),
        );
      },
    });
  },
};

// ------------------------------------------------------------------ upgrade

/**
 * The other half of what a viewer can do: make their server bigger so the room
 * can carry more chat. One axis, one word — no components, no parts list. The
 * cost is real and visible: more power drawn, and the room has a limit.
 */
const upgrade: IntentDef<ServerRoomState> = {
  name: 'upgrade',
  description:
    'The chatter wants their own server upgraded so it can carry more chat. There are no separate parts — an upgrade is just one step bigger.',
  examples: ['upgrade mine', 'upgrade my server', 'make my server bigger', 'can mine carry more'],
  handle(ctx, msg) {
    const state = ctx.state;
    touchChatter(state, msg);
    const user = msg.username;

    const server = findServerByOwner(state, msg.userId);
    if (!server) {
      ctx.say(t([`you'd need a server first, {user}. say "give me a server".`], { user }));
      return;
    }
    if (server.level >= tuning.upgradeMaxLevel) {
      ctx.say(
        t([`"{server}" is as big as it gets, {user}. it's carrying everything it can.`], {
          user,
          server: server.name,
        }),
      );
      return;
    }
    const projected = totalDrawW(state) + tuning.upgradeDrawW;
    if (projected > state.power.budgetW) {
      ctx.say(
        `that would put the room at ${projected}W and we're only allowed ${state.power.budgetW}W, ${user}. the power would go off. no.`,
      );
      ctx.log(`no upgrade for ${user}: would pull ${projected}W of ${state.power.budgetW}W`);
      return;
    }

    const serverId = server.id;
    ctx.enqueueTask({
      kind: 'upgrade',
      label: `upgrade ${user}'s server`,
      requestedBy: user,
      targetX: atServer(server),
      workMs: tuning.taskUpgradeMs,
      onComplete(ctx) {
        const s = ctx.state;
        const server = s.servers[serverId];
        if (!server) return;
        if (server.level >= tuning.upgradeMaxLevel) return;
        if (totalDrawW(s) + tuning.upgradeDrawW > s.power.budgetW) {
          ctx.say(`we ran out of power while i was walking over. no upgrade for ${user} right now.`);
          return;
        }
        server.level++;
        server.powerDrawW = computeDrawW(server);
        const draw = totalDrawW(s);
        ctx.log(
          `upgraded ${server.ownerName}'s "${server.name}" to size ${server.level} (room pulling ${draw}W of ${s.power.budgetW}W)`,
        );
        if (draw >= s.power.budgetW * tuning.warnBudgetPct) {
          ctx.say(
            `done, ${user}. "${server.name}" carries more now. we're pulling ${draw}W of ${s.power.budgetW}W though. it's getting tight in here.`,
          );
        } else {
          ctx.say(
            t(
              [
                `done, {user}. "{server}" can carry a lot more chat now.`,
                `"{server}" is a size bigger, {user}. that's more of chat through this room.`,
              ],
              { user, server: server.name },
            ),
          );
        }
      },
    });
  },
};

// --------------------------------------------------------------------- ask

/**
 * Per-person, and short: a conversation is somebody answering you within a few
 * seconds, so a long cooldown here silently drops exactly the messages that
 * make one. Total model spend is bounded by `DialogueService` (one call in
 * flight, three queued, the rest dropped), not by this — so this knob is about
 * fairness between chatters, not cost.
 */
const askCooldowns = new Map<string, number>();

const ask: IntentDef<ServerRoomState> = {
  name: 'ask',
  description:
    'Anything conversational: questions, jokes, greetings, comments about the room, or messages that fit no other intent.',
  examples: ['what do you actually do all day', 'hows it going', 'what is LEGACY-01?'],
  async handle(ctx, msg) {
    touchChatter(ctx.state, msg);
    // A flood coming out of an outage is answered once, at the newest message.
    // He has already said something about the size of it; eight more replies on
    // top of that is him talking over himself.
    if (ctx.replay && ctx.replay.remaining > 0) {
      ctx.log(`waiting message seen but not answered: ${msg.username}`);
      return;
    }
    const last = askCooldowns.get(msg.userId) ?? 0;
    if (ctx.now - last < tuning.askCooldownMs) {
      ctx.log(`ask cooldown: ${msg.username}`);
      return;
    }
    askCooldowns.set(msg.userId, ctx.now);

    const reply = await ctx.llm.dialogue({
      instruction:
        'A chatter is talking to you. Reply like a person in a conversation, not like a status report.' +
        ' If what they said has nothing to do with the room, do not steer it back to the room.' +
        ' If they are picking up something from earlier in the chat above, pick it up with them.' +
        ' A question back to them is often the better line — but not every time.' +
        ' Sometimes the funnier move is just the remark, landed flat, with nothing hung off it.',
      userLine: msg.text,
      username: msg.username,
    });
    if (reply) {
      ctx.say(reply, { toKick: true });
    } else {
      ctx.say(
        t(
          [
            `hang on, {user}. hands are full.`,
            `one second, {user}. machines first, chat second. barely.`,
            `give me a minute, {user}, i'm elbow-deep in something.`,
          ],
          { user: msg.username },
        ),
      );
    }
  },
};

// ------------------------------------------------------------------- report

const reportParams = z.object({ about: z.string().optional() });

/** Credit a correct report — recognition is the reward until the economy lands. */
function rewardReport(ctx: Ctx, msg: ChatMessage): void {
  const chatter = ctx.state.chatters[msg.userId];
  if (chatter) chatter.reports++;
  ctx.log(`good spot by ${msg.username} (${chatter?.reports ?? 1} so far)`);
}

/**
 * Saying something is wrong puts it on the board, and your name stays on it.
 * The sweep has usually already spotted anything genuinely wrong, so a correct
 * report is credited and claimed rather than duplicated — one problem, one job,
 * every spotter's name on it.
 */
const report: IntentDef<ServerRoomState> = {
  name: 'report',
  description:
    'The chatter is saying something is wrong in the room: a server that looks bad, beeping, heat, strange noises, chat lagging. Not a request about their own server.',
  examples: [
    'slot 3 looks bad',
    "something's beeping",
    "it's getting hot in here",
    'a cable looks damaged',
    'scratching noises??',
    'chat is lagging',
  ],
  paramsSchema: reportParams,
  handle(ctx, msg) {
    const state = ctx.state;
    touchChatter(state, msg);
    const user = msg.username;

    // The board already knows what's wrong; the spotter gets the credit and
    // goes on the job. Worst first, so a report lands on what matters most.
    const open = openTickets(state).sort(boardOrder);
    const worst = open[0];
    if (worst) {
      rewardReport(ctx, msg);
      const fresh = !worst.claimedBy.includes(user);
      if (fresh) worst.claimedBy.push(user);
      ctx.log(`${user} spotted it too: ${worst.title}`);
      ctx.say(
        fresh
          ? t(
              [
                `yeah — ${worst.title}. good eyes, {user}. you're on it with me.`,
                `already on the board, {user}: ${worst.title}. your name's on it now.`,
              ],
              { user },
            )
          : t([`i know, {user}. ${worst.title}. it's on the board and it's mine.`], { user }),
      );
      return;
    }

    // Nothing on the board and nothing wrong: Admin still walks over and looks,
    // because his time is the scarce resource — and the board records who sent
    // him. That receipt is the whole social cost of a false alarm.
    const { ticket } = raiseTicket(ctx, {
      kind: 'nofault',
      subject: user,
      source: 'chat',
      raisedBy: user,
      title: `${user} said something was wrong`,
      severity: 3,
    });
    const ticketId = ticket.id;
    ctx.enqueueTask({
      kind: 'investigate',
      label: `check what ${user} saw`,
      requestedBy: user,
      targetX: deskX(),
      workMs: tuning.taskInvestigateMs,
      onComplete(ctx) {
        const raised = ctx.state.tickets.find((t) => t.id === ticketId);
        if (raised) closeTicket(ctx, raised, 'nofault', `nothing wrong — ${user} sent me over`);
        ctx.say(
          t(
            [
              `everything's fine, {user}. i walked all the way over here.`,
              `checked. it's fine, {user}. probably the rat. or you.`,
            ],
            { user },
          ),
        );
      },
    });
  },
};

// -------------------------------------------------------------------- claim

const claimParams = z.object({ about: z.string().optional() });

/**
 * Claiming isn't doing the work — Admin does the work. It means you're the one
 * who told him to, the credit or the blame is yours, and the claim count is how
 * the board sorts itself. Claims are the vote (brief §5.9).
 */
const claim: IntentDef<ServerRoomState> = {
  name: 'claim',
  description:
    "The chatter is putting their name on something already on the board, by what it is. Set 'about' to whatever they referred to, e.g. 'the cable'.",
  examples: ["I'll take it", 'put me on the cable one', "I'll handle the delivery", 'that one is mine'],
  paramsSchema: claimParams,
  handle(ctx, msg, params) {
    const state = ctx.state;
    touchChatter(state, msg);
    const user = msg.username;
    const wanted = (params as z.infer<typeof claimParams> | undefined)?.about?.trim();

    const open = openTickets(state).sort(boardOrder);
    if (!open.length) {
      ctx.say(t([`board's clear, {user}. nothing to take. enjoy it while it lasts.`], { user }));
      return;
    }

    let ticket = undefined as (typeof open)[number] | undefined;
    if (wanted) {
      const needle = wanted.toLowerCase();
      ticket = open.find(
        (t) => t.title.toLowerCase().includes(needle) || t.kind.includes(needle),
      );
    }
    if (!ticket) ticket = open[0]; // "I'll take it" means the worst thing up there
    if (!OPEN_STATES.includes(ticket.state)) {
      ctx.say(`that one's already done, ${user}. ${ticket.resolution ?? ''}`.trim());
      return;
    }
    if (ticket.claimedBy.includes(user)) {
      ctx.say(t([`you've already got your name on that one, {user}.`], { user }));
      return;
    }

    ticket.claimedBy.push(user);
    ctx.log(`${user} put their name on: ${ticket.title} (${ticket.claimedBy.length} total)`);
    const others = ticket.claimedBy.length - 1;
    ctx.say(
      others > 0
        ? `yours too, ${user} — that's ${ticket.claimedBy.length} of you on ${ticket.title}. it moves up.`
        : t(
            [
              `${ticket.title} — that's yours, {user}. if it goes badly we both know whose idea it was.`,
              `noted. ${ticket.title}, {user}'s call. i'll get to it.`,
            ],
            { user },
          ),
    );
  },
};

// ------------------------------------------------------------------- hinder

const hinderParams = z.object({
  action: z.enum(['unplug_server', 'heat', 'other']).optional(),
  victim: z.string().optional(),
});

const hinderCooldowns = new Map<string, number>();

const hinder: IntentDef<ServerRoomState> = {
  name: 'hinder',
  description:
    "The chatter wants to sabotage or endanger something: unplug or damage someone's server ('unplug_server', victim = whose), heat the room e.g. a space heater ('heat'), or other mischief ('other').",
  examples: [
    "unplug dave's server",
    'plug in a space heater',
    'shut down LEGACY-01',
  ],
  paramsSchema: hinderParams,
  handle(ctx, msg, params) {
    const state = ctx.state;
    touchChatter(state, msg);
    const user = msg.username;
    const last = hinderCooldowns.get(msg.userId) ?? 0;
    if (ctx.now - last < tuning.hinderCooldownMs) {
      ctx.log(`hinder cooldown: ${user}`);
      return;
    }
    hinderCooldowns.set(msg.userId, ctx.now);

    const p = (params ?? {}) as z.infer<typeof hinderParams>;
    const action = p.action ?? 'other';

    // Admin defends LEGACY-01 over anything and anyone (brief §5.2).
    if (/legacy/i.test(msg.text)) {
      ctx.log(`${user} asked me to mess with LEGACY-01. no.`, 'warn');
      ctx.say(
        `${user} wants me to touch LEGACY-01. no. that one was humming before you were born and it'll hum after. we do not touch it.`,
      );
      return;
    }

    switch (action) {
      case 'unplug_server': {
        ctx.log(`${user} asked me to unplug ${p.victim ?? 'someone'}'s server. no.`, 'warn');
        ctx.say(
          `${user} wants me to unplug ${p.victim ?? 'someone'}'s server. no. we don't kill machines here — not even for content.`,
        );
        return;
      }
      case 'heat': {
        ctx.enqueueTask({
          kind: 'hinder-heat',
          label: `plug in a space heater (for ${user})`,
          requestedBy: user,
          targetX: powerServiceX(),
          workMs: tuning.taskHinderMs,
          onComplete(ctx) {
            ctx.state.roomTempC = Math.min(tuning.maxTempC, ctx.state.roomTempC + 4);
            ctx.log(`a space heater appeared because ${user} asked (+4°C)`, 'alert');
            ctx.say(
              `there. a space heater, in a server room, because ${user} made a case. we're at ${Math.round(ctx.state.roomTempC)}°C. i hate it here.`,
            );
          },
        });
        return;
      }
      default: {
        ctx.log(`${user} asked for some unspecified sabotage. no.`, 'warn');
        ctx.say(`no, ${user}. whatever it was — no.`);
      }
    }
  },
};

export const intents: IntentDef<ServerRoomState>[] = [
  provision,
  restart,
  upgrade,
  report,
  claim,
  hinder,
  ask,
].map(def => ({
  ...def,
  handle(ctx, msg, params) {
    if (ctx.state.emergency) return; // Also guard direct/debug calls outside chat admission.
    return def.handle(ctx, msg, params);
  },
}));

// Zero-cost fast path for the highest-volume exact phrasings; anything it
// misses falls through to the LLM classifier.
export function quickClassify(text: string): { intent: string; params?: unknown } | null {
  const s = text.trim();

  if (/\b(give|get|spin|hook|set)\s+(me|us)\s+(up\s+)?(with\s+)?(a\s+)?(server|box)\b/i.test(s)) {
    return { intent: 'provision' };
  }
  if (/^i want (a|one)( server| box)?[.!]?$/i.test(s)) return { intent: 'provision' };
  if (/\b(can i get|i'?d like)\b.*\b(server|box)\b/i.test(s)) return { intent: 'provision' };

  if (/\b(restart|reboot)\s+(my|mine)\b/i.test(s)) return { intent: 'restart' };
  if (/\b(restart|reboot)\s+my\s+(server|box)\b/i.test(s)) return { intent: 'restart' };
  if (/\bturn\s+(my|mine)\b.*\b(back on|on again)\b/i.test(s)) return { intent: 'restart' };
  if (/\bmy\s+(server|box)\s+(is\s+)?(dead|off|down)\b/i.test(s)) return { intent: 'restart' };

  if (/\bupgrade\s+(my|mine)\b/i.test(s)) return { intent: 'upgrade' };
  if (/\bmake\s+(my\s+(server|box)|mine)\s+bigger\b/i.test(s)) return { intent: 'upgrade' };

  if (/\bslot\s+\d+\s+(is|looks)\s+(bad|red|dark|down|dead|off)\b/i.test(s)) {
    return { intent: 'report' };
  }
  if (/\b(something('|)s (beeping|wrong)|scratching|it'?s getting hot)\b/i.test(s)) {
    return { intent: 'report' };
  }
  if (/\bunplug\b.*\b(server|box)\b/i.test(s)) {
    return { intent: 'hinder', params: { action: 'unplug_server' } };
  }
  return null;
}
