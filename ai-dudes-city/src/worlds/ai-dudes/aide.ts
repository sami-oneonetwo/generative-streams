// The Mayor's aide: the streamer types a wish on the operator page ("put me in a purple cape",
// "throw a party on the square", "make the donkey bright pink") and one model call turns it into
// a short list of changes from a closed set. Everything it can do goes through the same paths the
// operator page and /admin already use (mayorInput, the admin actions), so it can't do anything the
// streamer couldn't do by hand; it just saves the clicks. Nothing here reaches chat unless the
// aide is asked to have the Town Crier say something.
import { z } from 'zod';
import { ACCESSORIES, EMOTES, HATS, LOOK_LIMITS } from '../../shared/dudesTypes';
import { AGES } from '../../shared/ages';
import { plotAt } from '../../shared/city';
import type { AdminAction, WorldCtx } from '../../engine/world';
import { ageOf, cityOf, headName, themed } from './city';
import { mayorInput, mayorOf } from './mayor';
import { matchName } from './index';
import { crierSays } from './crier';
import { mayorLookSchema, type DudesState, type MayorLook } from './state';

export type AideFn = (input: { system: string; content: string }, signal: AbortSignal) => Promise<string>;

/** Admin actions the aide may use: town things, never moderation, the call limit or anything destructive to chatters. */
const ALLOWED = ['party', 'project-finish', 'project-shelve', 'coins', 'set-age', 'rename-town', 'caravan-on', 'caravan-off', 'caravan-skip', 'town-on', 'town-off'];

const lookSchema = mayorLookSchema;

const actionSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('look'), ...lookSchema.shape }),
  z.object({ do: z.literal('look-reset') }),
  z.object({ do: z.literal('title'), title: z.string().min(1).max(40) }),
  z.object({ do: z.literal('title-reset') }),
  z.object({ do: z.literal('say'), text: z.string().min(1).max(200) }),
  z.object({ do: z.literal('emote'), pose: z.enum(EMOTES) }),
  z.object({ do: z.literal('build'), what: z.string().min(1).max(300), for: z.string().max(40).optional() }),
  z.object({ do: z.literal('edit'), target: z.string().min(1).max(80), change: z.string().min(1).max(300) }),
  z.object({ do: z.literal('remove'), target: z.string().min(1).max(80) }),
  z.object({ do: z.literal('announce'), text: z.string().min(1).max(300) }),
  z.object({ do: z.literal('admin'), id: z.string().max(40), value: z.union([z.string().max(80), z.number()]).optional() }),
]);
type AideAction = z.infer<typeof actionSchema>;
const replySchema = z.object({ reply: z.string().max(400).default(''), actions: z.array(z.unknown()).max(8).default([]) });

export const AIDE_SYSTEM = `You are the Mayor's aide in a small cartoon town on a live stream. The Mayor is the streamer, walking about town as a character. They type to you what they want changed and you do it, using only the actions below. Answer with JSON only: {"reply": "...", "actions": [...]}.

"reply" is one or two short plain sentences back to the Mayor about what you did (or why you couldn't). No emoji, no slang.

Actions (use as few as do the job; an empty list is fine when nothing fits):
- {"do":"look", ...any of: "skin","shirt","pants","hair","hatColor","accessoryColor" as "#rrggbb"; "hat": one of ${HATS.join('|')}; "accessory": one of ${ACCESSORIES.join('|')}; "height" ${LOOK_LIMITS.height.join('–')}; "build" ${LOOK_LIMITS.build.join('–')} (shoulders); "costume": false takes off the age's costume so the colours show, true puts it back}
  Clothes: the Mayor wears the age's costume over the shirt and trousers. When asked for a shirt or trouser colour, also send "costume": false or it won't show.
- {"do":"look-reset"}: back to the age's own look
- {"do":"title","title":"..."}: what the Mayor is called on the name tag ("The Grand Duke"); {"do":"title-reset"}
- {"do":"say","text":"..."}: the Mayor says it aloud in a bubble (people nearby hear it)
- {"do":"emote","pose": one of ${EMOTES.join('|')}}
- {"do":"build","what":"a full description","for":"chatter name (optional, builds on their lot)"}: designs and builds it where the Mayor stands
- {"do":"edit","target":"a build's name or #id","change":"what to change"}: reworks any build in town
- {"do":"remove","target":"a build's name or #id"}: takes it down. Only when clearly asked.
- {"do":"announce","text":"..."}: the Town Crier posts it in the stream's chat. Only when asked to tell chat something.
- {"do":"admin","id":"...","value":"..."}: a town control, from the list you're given.

Never invent builds or people that aren't listed. If the wish is unclear, do the most likely thing and say so in the reply.`;

export function aideContent(state: DudesState, wish: string, now: number, admin: AdminAction<DudesState>[]): string {
  const m = mayorOf(state, now);
  const near = state.objects
    .filter((o) => !o.destroyedAt && !o.wild)
    .map((o) => ({ o, d: Math.hypot(o.position.x - m.position.x, o.position.z - m.position.z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 25)
    .map(({ o, d }) => `#${o.id} "${o.blueprint.name}" (${o.venue ?? 'decor'}, ${o.owner ? `${state.dudes.find((x) => x.id === o.owner)?.name ?? 'someone'}'s` : o.civic ? "the town's" : "the Mayor's"}, ${Math.round(d)} m away)`);
  const look = mayorLookOf(state);
  const controls = admin.filter((a) => ALLOWED.includes(a.id)).map((a) => `- ${a.id}: ${a.label}${a.input ? ` (value: ${a.input.label})` : ''}`);
  return [
    `Town: ${cityOf(state).name}, ${themed(state) ? `in ${AGES[ageOf(state)]?.id ?? 'modern'} times` : 'a theme-free sandbox (no age)'}. The Mayor is called "${headName(state)}" and stands at ${plotAt(m.position)?.address ?? 'the street'}.`,
    `The Mayor's look right now: ${JSON.stringify(look)}${state.mayor?.look?.costume === false ? ' (costume off)' : ' (wearing the age costume)'}.`,
    `Chatters in town: ${state.dudes.slice(0, 40).map((d) => d.name).join(', ') || 'nobody yet'}.`,
    `Builds nearest the Mayor:\n${near.join('\n') || '(none)'}`,
    `Town controls for "admin":\n${controls.join('\n')}`,
    `The Mayor asks: ${wish}`,
  ].join('\n\n');
}

/** The look the Mayor is drawn with: the age's, under whatever the aide changed. */
export function mayorLookOf(state: DudesState): MayorLook {
  const { costume: _c, ...rest } = state.mayor?.look ?? {};
  return rest;
}

export function parseAide(text: string): { reply: string; actions: AideAction[]; dropped: number } {
  const raw = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text);
  const r = replySchema.parse(raw);
  const actions: AideAction[] = [];
  let dropped = 0;
  for (const a of r.actions) {
    const p = actionSchema.safeParse(a);
    if (p.success) actions.push(p.data);
    else dropped++;
  }
  return { reply: r.reply, actions, dropped };
}

const findBuild = (state: DudesState, target: string) =>
  state.objects.find((o) => o.id === target.replace(/^#/, '')) ?? matchName(target, state.objects.filter((o) => !o.destroyedAt), (o) => o.blueprint.name);

/** Does the actions; returns a note for each one that couldn't be done. */
export function applyAide(ctx: WorldCtx<DudesState>, actions: AideAction[], admin: AdminAction<DudesState>[]): string[] {
  const { state, now } = ctx;
  const m = mayorOf(state, now);
  const problems: string[] = [];
  for (const a of actions) {
    switch (a.do) {
      case 'look': {
        const { do: _d, ...look } = a;
        const next: MayorLook = { ...m.look, ...look };
        if (next.height !== undefined) next.height = Math.max(LOOK_LIMITS.height[0], Math.min(LOOK_LIMITS.height[1], next.height));
        if (next.build !== undefined) next.build = Math.max(LOOK_LIMITS.build[0], Math.min(LOOK_LIMITS.build[1], next.build));
        m.look = next;
        break;
      }
      case 'look-reset':
        m.look = undefined;
        break;
      case 'title':
        m.title = a.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40);
        break;
      case 'title-reset':
        m.title = undefined;
        break;
      case 'say':
        mayorInput(state, { t: 'say', text: a.text }, now);
        break;
      case 'emote':
        mayorInput(state, { t: 'emote', pose: a.pose }, now);
        break;
      case 'build':
        mayorInput(state, { t: 'build', what: a.what, ...(a.for ? { for: a.for } : {}) }, now);
        break;
      case 'edit':
      case 'remove': {
        const o = findBuild(state, a.target);
        if (!o) {
          problems.push(`no build called "${a.target}"`);
          break;
        }
        mayorInput(state, a.do === 'edit' ? { t: 'edit', target: o.id, change: a.change } : { t: 'remove', target: o.id }, now);
        break;
      }
      case 'announce':
        crierSays(state, a.text);
        break;
      case 'admin': {
        const act = ALLOWED.includes(a.id) ? admin.find((x) => x.id === a.id) : undefined;
        if (!act) {
          problems.push(`no town control "${a.id}"`);
          break;
        }
        if (act.input && (a.value === undefined || a.value === '')) {
          problems.push(`${a.id} needs a value`);
          break;
        }
        const why = act.run(ctx, act.input?.kind === 'text' ? String(a.value) : a.value);
        if (why) problems.push(why);
        ctx.log(`aide: ${a.id}${a.value !== undefined ? ` ${a.value}` : ''}`);
        break;
      }
    }
  }
  return problems;
}
