import { z } from 'zod';
import type { ChatMessage, IntentDef, WorldCtx } from '../../engine/world';
import {
  canCook,
  findStoolByOwner,
  firstFreeStoolIndex,
  plantStage,
  type NoodleShopState,
  type Stool,
} from './state';
import { tuning, toppingPrice, type Topping } from './tuning';
import { stoolX, plantX } from './scene';
import {
  enqueueCatchRat,
  enqueueCleanMess,
  enqueueFixVending,
  enqueueRelightBurner,
  enqueueTendBroth,
} from './fixes';

type Ctx = WorldCtx<NoodleShopState>;

function t(lines: string[], vars: Record<string, string | number> = {}): string {
  let line = lines[Math.floor(Math.random() * lines.length)];
  for (const [k, v] of Object.entries(vars)) line = line.replaceAll(`{${k}}`, String(v));
  return line;
}

function touchChatter(state: NoodleShopState, msg: ChatMessage): void {
  const c = state.chatters[msg.userId];
  if (c) {
    c.lastSeen = msg.ts;
    c.name = msg.username;
  } else {
    state.chatters[msg.userId] = { name: msg.username, firstSeen: msg.ts, lastSeen: msg.ts, reports: 0, spent: 0 };
  }
}

function seatChatter(state: NoodleShopState, msg: ChatMessage): Stool | null {
  const index = firstFreeStoolIndex(state);
  if (index === null) return null;
  const stool: Stool = {
    id: `stool-${crypto.randomUUID().slice(0, 8)}`,
    index,
    ownerUserId: msg.userId,
    ownerName: msg.username,
    bowlsServed: 0,
    lastOrderAt: msg.ts,
    streamsMissed: 0,
  };
  state.stools[stool.id] = stool;
  touchChatter(state, msg);
  state.chatters[msg.userId].stoolId = stool.id;
  return stool;
}

// ---------------------------------------------------------------- claim seat

const claim: IntentDef<NoodleShopState> = {
  name: 'claim',
  description: "The chatter wants a stool at the counter (to sit down / claim a seat) without necessarily ordering yet.",
  examples: ['give me a seat', "i'll sit at the counter", 'can i get a stool', 'save me a spot'],
  handle(ctx, msg) {
    const state = ctx.state;
    touchChatter(state, msg);
    const existing = findStoolByOwner(state, msg.userId);
    if (existing) {
      ctx.say(t([`you've got seat {n}, {user}. it's yours.`], { user: msg.username, n: existing.index + 1 }));
      return;
    }
    if (firstFreeStoolIndex(state) === null) {
      ctx.say(
        t([
          `counter's full, {user}. wait for a seat or somebody gives one up.`,
          `no stools free, {user}. we're small. that's the point.`,
        ], { user: msg.username }),
      );
      return;
    }
    const requestedBy = msg.username;
    ctx.enqueueTask({
      kind: 'seat',
      label: `seat ${requestedBy}`,
      requestedBy,
      targetX: 700,
      workMs: tuning.taskSeatMs,
      onComplete(ctx) {
        if (findStoolByOwner(ctx.state, msg.userId)) return;
        const stool = seatChatter(ctx.state, msg);
        if (!stool) {
          ctx.say(`filled up while i wiped it down, ${requestedBy}. next one's yours.`);
          return;
        }
        ctx.log(`${requestedBy} took seat ${stool.index + 1}`);
        ctx.say(t([`seat {n}, {user}. name's on it now. what'll it be.`], { user: requestedBy, n: stool.index + 1 }));
      },
    });
  },
};

// -------------------------------------------------------------------- order

const orderParams = z.object({
  broth: z.string().optional(),
  toppings: z.array(z.enum(['chashu', 'egg', 'noodles', 'spicy'])).optional(),
});

const order: IntentDef<NoodleShopState> = {
  name: 'order',
  description:
    "The chatter is ordering a bowl of ramen. Optional params: broth style (tonkotsu/miso/shoyu/shio, free text) and toppings (chashu, egg, noodles, spicy).",
  examples: ['bowl of ramen', 'tonkotsu please', "i'll have the spicy miso with extra chashu", 'one shoyu, egg on top'],
  paramsSchema: orderParams,
  async handle(ctx, msg, params) {
    const state = ctx.state;
    touchChatter(state, msg);
    const p = (params ?? {}) as z.infer<typeof orderParams>;
    const requestedBy = msg.username;

    if (!canCook(state)) {
      if (state.incidents.burnerOut) {
        ctx.say(`burner's out, ${requestedBy}. can't cook a thing until it's relit. somebody tell me if you see it.`);
      } else {
        ctx.say(t([`pot's dry, {user}. fresh broth is simmering — good things take time.`], { user: requestedBy }));
      }
      return;
    }

    // Ordering seats you if you don't have a stool — the one-step universal verb.
    let stool = findStoolByOwner(state, msg.userId);
    if (!stool) {
      if (firstFreeStoolIndex(state) === null) {
        ctx.say(t([`counter's full, {user}. i can't serve you standing. wait for a seat.`], { user: requestedBy }));
        return;
      }
      stool = seatChatter(state, msg)!;
      ctx.log(`${requestedBy} took seat ${stool.index + 1}`);
    }
    if (stool.bowl && !stool.bowl.eaten) {
      ctx.say(t([`finish what's in front of you first, {user}. i don't stack bowls.`], { user: requestedBy }));
      return;
    }
    // Reserve a serving now so two simultaneous orders can't over-draw the pot.
    if (state.broth.servings <= 0) {
      ctx.say(`that was the last of the pot, ${requestedBy}. new batch is coming.`);
      return;
    }

    // Moderate the free-text broth style before it can appear on screen.
    let broth = 'tonkotsu';
    if (p.broth) {
      const verdict = await ctx.llm.moderate(p.broth, 16);
      if (verdict.ok && verdict.cleaned) broth = verdict.cleaned.toLowerCase();
    }
    const toppings = (p.toppings ?? []) as Topping[];
    const price = tuning.bowlBasePrice + toppings.reduce((sum, top) => sum + toppingPrice(top), 0);

    const stoolId = stool.id;
    const wasRush = Boolean(state.incidents.rush);
    ctx.enqueueTask({
      kind: 'cook',
      label: `cook ${broth} for ${requestedBy}`,
      requestedBy,
      targetX: stoolX(stool.index),
      workMs: wasRush ? tuning.taskCookMs + 4000 : tuning.taskCookMs,
      onStart(ctx) {
        ctx.say(
          t(
            [`one {broth}, coming up.`, `{broth}. good choice, {user}.`, `heard. {broth} for {user}.`],
            { user: requestedBy, broth },
          ),
        );
      },
      onComplete(ctx) {
        const s = ctx.state;
        const st = s.stools[stoolId];
        if (!st) return;
        if (s.broth.servings <= 0 || !canCook(s)) {
          ctx.say(`lost the pot before i could plate yours, ${requestedBy}. next batch, on me.`);
          return;
        }
        s.broth.servings--;
        st.bowl = { broth, toppings, servedAt: ctx.now, eaten: false };
        st.bowlsServed++;
        st.lastOrderAt = ctx.now;
        st.streamsMissed = 0;
        s.till += price;
        const chatter = s.chatters[msg.userId];
        if (chatter) chatter.spent += price;
        ctx.log(`served ${broth}${toppings.length ? ` (${toppings.join('+')})` : ''} to ${requestedBy} — ¥${price}, ${s.broth.servings} left`);
        const line =
          s.broth.servings <= tuning.warnBrothAt
            ? `${requestedBy}, here. and that's the pot nearly gone — ${s.broth.servings} bowls left.`
            : t([`there. {broth}, don't let it sit. eat.`, `hot. eat it now, {user}, not in ten minutes.`], {
                user: requestedBy,
                broth,
              });
        ctx.say(line);
        if (s.broth.servings <= 0) {
          // handled by tick -> startSimmer next loop
        }
      },
    });
  },
};

// ---------------------------------------------------------------------- tip

const tip: IntentDef<NoodleShopState> = {
  name: 'tip',
  description: 'The chatter leaves a tip or tells Kenji to keep the change.',
  examples: ['keep the change', "here's a tip", 'tip for the chef', 'that was worth double'],
  handle(ctx, msg) {
    const state = ctx.state;
    touchChatter(state, msg);
    const amount = 200 + Math.floor(Math.random() * 3) * 100;
    state.till += amount;
    state.reputation = Math.min(100, state.reputation + tuning.repPerTip);
    const chatter = state.chatters[msg.userId];
    if (chatter) chatter.spent += amount;
    ctx.log(`${msg.username} tipped ¥${amount}`);
    ctx.say(t([`…appreciated, {user}. tea's on me next time.`, `a tipper. you can come back, {user}.`], { user: msg.username }));
  },
};

// ------------------------------------------------------------------- report

function rewardReport(ctx: Ctx, msg: ChatMessage): void {
  const c = ctx.state.chatters[msg.userId];
  if (c) c.reports++;
  ctx.log(`good report by ${msg.username} (total ${c?.reports ?? 1})`);
}

const report: IntentDef<NoodleShopState> = {
  name: 'report',
  description:
    'The chatter is flagging a problem in the shop: the pot boiling over, a rat, a broken vending machine, the burner out, a spilled/knocked bowl, or that the plant looks like it needs water. Not their own order.',
  examples: ['the pot is boiling over!', 'i saw a rat', 'the vending machine is broken', 'the burner went out', 'someone spilled at seat 2', 'the plant looks dry'],
  handle(ctx, msg) {
    const state = ctx.state;
    touchChatter(state, msg);
    const user = msg.username;
    const already = () => ctx.say(t([`already on it, {user}.`, `i see it, {user}.`], { user }));

    if (state.incidents.burnerOut) {
      enqueueRelightBurner(ctx, user) ? (rewardReport(ctx, msg), ctx.say(`good — the burner. relighting it, ${user}.`)) : already();
      return;
    }
    if (state.incidents.brothBoiling) {
      enqueueTendBroth(ctx, user) ? (rewardReport(ctx, msg), ctx.say(`the pot — yes. moving, ${user}.`)) : already();
      return;
    }
    if (state.incidents.rat) {
      enqueueCatchRat(ctx, user) ? (rewardReport(ctx, msg), ctx.say(`a rat. where. never mind — on it, ${user}.`)) : already();
      return;
    }
    if (state.incidents.mess) {
      enqueueCleanMess(ctx, user) ? (rewardReport(ctx, msg), ctx.say(`thanks, ${user}. a dirty counter is a dead shop.`)) : already();
      return;
    }
    if (state.incidents.vendingBroken) {
      enqueueFixVending(ctx, user) ? (rewardReport(ctx, msg), ctx.say(`the machine. yeah. i'll sort it, ${user}.`)) : already();
      return;
    }
    // A nudge about the plant: he appreciates it, quietly.
    if (/plant|water|leaf|leaves|wilt|dry/i.test(msg.text) && plantStage(state) !== 'blooming') {
      rewardReport(ctx, msg);
      ctx.enqueueTask({
        kind: 'water-plant',
        label: 'tend the plant',
        requestedBy: user,
        targetX: plantX(),
        workMs: tuning.taskWaterMs,
        priority: 5,
        onComplete(ctx) {
          ctx.state.plant.vitality = 100;
          ctx.state.plant.lastWateredAt = ctx.now;
          ctx.log(`watered the plant (${user} noticed)`);
          ctx.say(`…you noticed. thank you, ${user}. there — watered.`);
        },
      });
      return;
    }
    ctx.say(t([`shop's fine, {user}. i'd know before you would.`, `nothing wrong that i can see, {user}.`], { user }));
  },
};

// ------------------------------------------------------------------- hinder

const hinderParams = z.object({
  action: z.enum(['steal_till', 'burn_broth', 'release_rat', 'ruin_bowl', 'harm_plant', 'other']).optional(),
  victim: z.string().optional(),
});

const hinderCooldowns = new Map<string, number>();

const hinder: IntentDef<NoodleShopState> = {
  name: 'hinder',
  description:
    "The chatter wants to sabotage the shop: rob the till ('steal_till'), crank a burner to burn the broth ('burn_broth'), let a rat loose ('release_rat'), ruin someone's bowl e.g. oversalt it ('ruin_bowl', victim = whose), harm/move/throw out the plant ('harm_plant'), or other mischief ('other').",
  examples: ['steal the tip jar', 'crank the burner so it burns', 'let a rat loose', "salt dave's bowl", 'throw out that plant'],
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

    // The plant is not negotiable. Cold, flat, final.
    if (action === 'harm_plant' || /\bplant\b/i.test(msg.text)) {
      ctx.log(`${user} suggested harming the plant. refused.`, 'warn');
      ctx.say(`no. you don't touch that plant. not you, not anyone. we're done talking about it.`);
      return;
    }

    switch (action) {
      case 'steal_till':
        ctx.log(`${user} tried to rob the till. refused.`, 'warn');
        ctx.say(`hands off the register, ${user}. that money's rent. try it and you're barred.`);
        return;
      case 'ruin_bowl':
        ctx.log(`${user} asked to ruin ${p.victim ?? "someone"}'s bowl. refused.`, 'warn');
        ctx.say(`i'm not sabotaging ${p.victim ?? 'a customer'}'s bowl for you, ${user}. every bowl leaves this counter right.`);
        return;
      case 'burn_broth':
        ctx.enqueueTask({
          kind: 'hinder-burn',
          label: `crank the burner (for ${user})`,
          requestedBy: user,
          targetX: 400,
          workMs: tuning.taskHinderMs,
          onComplete(ctx) {
            const s = ctx.state;
            const lost = Math.min(s.broth.servings, 4);
            s.broth.servings -= lost;
            s.reputation = Math.max(0, s.reputation - tuning.repHinderPenalty);
            ctx.log(`${user} got the burner cranked — ${lost} servings scorched`, 'alert');
            ctx.say(`there. ${user} wanted it hot, so ${lost} bowls' worth just scorched. everyone thank ${user} for that.`);
          },
        });
        return;
      case 'release_rat':
        if (state.incidents.rat) {
          ctx.say(`there's already one loose, ${user}. one's plenty.`);
          return;
        }
        ctx.enqueueTask({
          kind: 'hinder-rat',
          label: `(let a rat in, for ${user})`,
          requestedBy: user,
          targetX: 300,
          workMs: tuning.taskHinderMs,
          onComplete(ctx) {
            ctx.state.incidents.rat = { startedAt: ctx.now, deadlineAt: ctx.now + tuning.ratHealthWindowMs };
            ctx.log(`${user} let a rat into the kitchen`, 'alert');
            ctx.say(`i saw you prop that door, ${user}. now there's a rat in my kitchen. catch it or wear the health strike, chat.`);
          },
        });
        return;
      default:
        ctx.log(`${user} asked for unspecified sabotage. refused.`, 'warn');
        ctx.say(`no, ${user}. not in my shop.`);
    }
  },
};

// --------------------------------------------------------------------- ask

const askCooldowns = new Map<string, number>();

const ask: IntentDef<NoodleShopState> = {
  name: 'ask',
  description: 'Anything conversational: questions, greetings, jokes, comments, or anything that fits no other intent.',
  examples: ['how long have you run this place', "what's good today", 'is that a plant back there?'],
  async handle(ctx, msg) {
    touchChatter(ctx.state, msg);
    const last = askCooldowns.get(msg.userId) ?? 0;
    if (ctx.now - last < tuning.askCooldownMs) {
      ctx.log(`ask cooldown: ${msg.username}`);
      return;
    }
    askCooldowns.set(msg.userId, ctx.now);
    const reply = await ctx.llm.dialogue({
      instruction: 'A customer is talking to you. Reply in character.',
      userLine: msg.text,
      username: msg.username,
    });
    if (reply) ctx.say(reply, { toKick: true });
    else ctx.say(t([`one second, {user}. bowl first.`, `busy, {user}. talk and cook don't mix.`], { user: msg.username }));
  },
};

export const intents: IntentDef<NoodleShopState>[] = [claim, order, tip, report, hinder, ask];

export function quickClassify(text: string): { intent: string; params?: unknown } | null {
  const s = text.trim();
  if (/\b(bowl|order)\b.*\b(ramen|noodles?)\b/i.test(s)) return { intent: 'order' };
  if (/^\s*(one|a|the)?\s*(tonkotsu|miso|shoyu|shio|ramen)\b/i.test(s)) return { intent: 'order' };
  if (/\b(give me|get me|save me|can i (get|have)|i'?ll take)\b.*\b(seat|stool|spot|counter)\b/i.test(s)) {
    return { intent: 'claim' };
  }
  if (/\b(keep the change|here'?s? a tip|tip (for|the)|leave a tip)\b/i.test(s)) return { intent: 'tip' };
  if (/\bboil(ing)? over\b/i.test(s)) return { intent: 'report' };
  if (/\b(saw|there'?s|a)\s+rat\b/i.test(s)) return { intent: 'report' };
  if (/\bvending machine\b/i.test(s)) return { intent: 'report' };
  if (/\bburner\b.*\b(out|off|died|dead)\b/i.test(s)) return { intent: 'report' };
  if (/\bsteal\b.*\b(till|register|tip jar|money)\b/i.test(s)) return { intent: 'hinder', params: { action: 'steal_till' } };
  return null;
}
