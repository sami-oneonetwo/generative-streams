// Fixture mode (`DUDES_FIXTURES=1`, `npm run demo`): a deterministic agent and designer so the
// field can be run, smoke-tested and demoed without a key or a bill. It reads plain keywords; it is
// a test aid, not a stand-in for the real agent, and the page labels it.
import type { Primitive } from '../../shared/objectTypes';
import { EMOTES, HATS, type Emote } from '../../shared/dudesTypes';
import { hashOf, type AgentAction, type AgentFn, type AgentReply } from './agent';
import { validateDesign } from './blueprint';
import type { DesignFn } from './design';

const PERSONAS = [
  'I am loud, cheerful and I build first and ask questions never.',
  'I am a quiet tinkerer who likes neat little things and hates mess.',
  'I am a grumpy old sailor. Everything reminds me of boats.',
  'I am a chaos goblin. If it can be pink and taller, it should be.',
  'I am a wannabe architect with very strong opinions about roofs.',
];
const TITLES = ['the loud one', 'the tinkerer', 'the old salt', 'chaos goblin', 'roof critic'];
const HELLOS = ['hello.', 'reporting for duty', 'what are we doing today', 'right, I am here', 'hi chat'];

export const fixtureAgent: AgentFn = async (turn) => {
  const h = hashOf(turn.name.toLowerCase());
  const said = turn.messages.join(' ').trim();
  const lower = said.toLowerCase();
  const actions: AgentAction[] = [];
  const reply: AgentReply = { actions };
  if (!turn.persona) {
    reply.persona = PERSONAS[h % PERSONAS.length];
    reply.title = TITLES[h % TITLES.length];
    reply.look = { hat: HATS[1 + (h % (HATS.length - 1))] };
    reply.remember = [`${turn.name} first said: ${said.slice(0, 80)}`];
  }
  const build = /\b(?:build|make|create)\s+(?:me\s+)?(.+)$/i.exec(said);
  const edit = /\b(?:paint|make)\s+my\s+(.+?)\s+(red|blue|green|pink|yellow|purple|orange|black|white|gold)\b/i.exec(said);
  const remove = /\b(?:remove|delete|demolish)\s+my\s+(.+)$/i.exec(said);
  const go = /\b(?:walk to|hang out with|find)\s+(@?\w+)/i.exec(said);
  const pose = EMOTES.find((e) => new RegExp(`\\b${e}`).test(lower)) as Emote | undefined;
  const fight = /\b(shoot|punch|kick|bomb|throw at)\s+(?:the\s+)?(.+)$/i.exec(said);
  const ride = /\b(drive|ride)\s+(?:the\s+)?(.+?)(?:\s+to\s+(.+))?$/i.exec(said);
  // The town's natural phrasing, roughly: chat acted out by the body.
  const shove = /\b(?:shove|push)\s+@?(\w+)/i.exec(said);
  const greet = /\b(high ?five|handshake|shake hands with|hug)\s+@?(\w+)/i.exec(said);
  const follow = /\bfollow\s+@?(\w+)/i.exec(said);
  const share = /\b(?:move in with me|share (?:my|the) lot with|give (?:a )?key to)\s+@?(\w+)/i.exec(said);
  const invite = /\binvite\s+@?(\w+)(?:\s+to\s+(.+))?$/i.exec(said);
  const give = /\bgive\s+@?(\w+)\s+(\d+)/i.exec(said);
  const propose = /\b(?:the town needs|we should build|propose)\s+(?:a |an )?(.+)$/i.exec(said);
  const work = /\bwork (?:at|a shift at)\s+(.+)$/i.exec(said);
  const visitPlace = /\b(?:visit|go to|eat at)\s+(?:the\s+)?(.+)$/i.exec(said);
  if (/\b(what is (this|that)|where am i|huh|look around|explore)\b/i.test(said)) actions.push({ do: 'explore' });
  if (/\b(stop|get out|done driving|get off)\b/i.test(said)) actions.push({ do: 'stop' });
  if (/\b(badges|flex)\b/i.test(said)) actions.push({ do: 'show', what: 'badges' });
  if (/\b(lol|lmao|haha)\b/i.test(said)) actions.push({ do: 'emote', pose: 'laugh' });
  if (/\b(hungry|starving|food)\b/i.test(said)) actions.push({ do: 'visit', target: 'food' });
  if (/\b(tired|sleepy|bed)\b/i.test(said)) actions.push({ do: 'visit', target: 'rest' });
  if (/\b(bored)\b/i.test(said)) actions.push({ do: 'visit', target: 'fun' });
  if (/\b(chip in|contribute|donate)\b/i.test(said)) actions.push({ do: 'contribute', coins: Number(/\d+/.exec(said)?.[0] ?? 20) });
  if (/\bhelp (build|out|with)\b/i.test(said)) actions.push({ do: 'help' });
  if (share) actions.push({ do: 'share', target: share[1] });
  if (invite) actions.push({ do: 'invite', target: invite[1], ...(invite[2] ? { to: invite[2] } : {}) });
  if (give) actions.push({ do: 'give', target: give[1], coins: Number(give[2]) });
  if (propose) actions.push({ do: 'propose', what: propose[1] });
  if (work) actions.push({ do: 'work', target: work[1] });
  else if (visitPlace && !go) actions.push({ do: 'visit', target: visitPlace[1] });
  if (/\brent\b/i.test(said)) actions.push({ do: 'rent' });
  // Bits, roughly: a protest with a sign, a teleport, a hat for the Mayor.
  const protest = /\bprotest\s+(?:the\s+)?(.+)$/i.exec(said);
  const teleport = /\bteleport to\s+(?:the\s+)?(.+)$/i.exec(said);
  const hatFor = /\bgive the mayor a\s+(\w+)/i.exec(said);
  if (protest) actions.push({ do: 'bit', caption: `is protesting ${protest[1]}`, to: protest[1], steps: [{ pose: 'point', seconds: 3, say: 'Shame!' }, { pose: 'shrug', seconds: 3 }], prop: 'sign', sign: 'NOT IN MY TOWN', burst: 'confetti' });
  if (teleport) actions.push({ do: 'bit', caption: `teleports to ${teleport[1]}`, to: teleport[1], teleport: true, steps: [{ pose: 'cast', seconds: 2 }, { pose: 'wave', seconds: 2 }] });
  if (hatFor) actions.push({ do: 'bit', caption: 'gives the Mayor a new hat', to: 'the Mayor', giveHat: (hatFor[1].toLowerCase() === 'top' ? 'tophat' : hatFor[1].toLowerCase()) as never, steps: [{ pose: 'bow', seconds: 2 }, { pose: 'cheer', seconds: 2 }] });
  if (shove) actions.push({ do: 'attack', target: shove[1], with: 'shove' });
  if (greet) actions.push({ do: 'greet', target: greet[2], how: /hug/i.test(greet[1]) ? 'hug' : /hand/i.test(greet[1]) ? 'handshake' : 'highfive' });
  if (follow) actions.push({ do: 'follow', target: follow[1] });
  if (fight) actions.push({ do: 'attack', target: fight[2], with: fight[1].toLowerCase().startsWith('throw') ? 'throw' : (fight[1].toLowerCase() as 'shoot' | 'punch' | 'kick' | 'bomb') });
  else if (ride) {
    actions.push({ do: 'use', target: ride[2], how: ride[1].toLowerCase() as 'drive' | 'ride', ...(ride[3] ? { to: ride[3] } : {}) });
  }
  else if (edit) actions.push({ do: 'edit', target: edit[1], change: `paint it ${edit[2]}` });
  else if (remove) actions.push({ do: 'remove', target: remove[1] });
  else if (build && !propose && !actions.some((a) => a.do === 'help')) actions.push({ do: 'build', what: build[1].slice(0, 200) });
  if (go) actions.push({ do: 'move', to: go[1].replace(/^@/, '') });
  if (pose && !fight && !ride && !actions.length) actions.push({ do: 'emote', pose });
  actions.splice(3);
  reply.say = actions.length
    ? build
      ? `on it. one ${build[1].slice(0, 40)} coming up`
      : edit
        ? 'fresh coat of paint, coming up'
        : remove
          ? 'gone. it was ugly anyway'
          : 'ok!'
    : HELLOS[(h + said.length) % HELLOS.length];
  return reply;
};

const COLOURS: Record<string, string> = {
  red: '#c4402f', blue: '#3f6fb0', green: '#4f8a4b', pink: '#e07aa8', yellow: '#e2c14a', purple: '#7d4fa3',
  orange: '#e07a4a', black: '#2a2a2a', white: '#eeeae0', gold: '#d9a23a',
};
const part = (shape: Primitive['shape'], position: Primitive['position'], size: Primitive['size'], color: string): Primitive => ({
  shape, position, size, rotation: [0, 0, 0], color,
});

export const fixtureDesign: DesignFn = async (input) => {
  // DUDES_FIXTURE_DESIGN_MS: take as long as a real design does (demoing the drafting on the lot).
  const wait = Number(process.env.DUDES_FIXTURE_DESIGN_MS ?? 0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const words = input.request.toLowerCase();
  const colour = Object.entries(COLOURS).find(([w]) => words.includes(w))?.[1] ?? '#8f8a82';
  const editing = !!input.target;
  if (editing && input.target) {
    const parts = input.target.parts.map((p, i) => (i % 2 === 0 ? { ...p, color: colour } : p));
    return validateDesign({ action: 'edit', reply: 'repainted', blueprint: { ...input.target, parts } }, true);
  }
  const name = input.request.replace(/^(a|an|the)\s+/i, '').split(/[,.]/)[0].slice(0, 40) || 'thing';
  let parts: Primitive[];
  if (/tower|lighthouse|castle/.test(words))
    parts = [
      part('cylinder', [0, 2, 0], [1.8, 4, 1.8], colour),
      part('cone', [0, 4.8, 0], [2.2, 1.6, 2.2], '#7a4b2a'),
      part('box', [0, 0.6, 0.95], [0.6, 1.2, 0.1], '#3a2a1a'),
    ];
  else if (/caf[eé]|coffee|bakery|shop|store|bar|pub|restaurant|diner|club/.test(words))
    parts = [
      part('box', [0, 1.6, 0], [6, 3.2, 5], colour),
      part('box', [0, 3.4, 0], [6.4, 0.4, 5.4], '#5a3a2a'),
      part('box', [0, 2.6, 2.6], [4, 0.8, 0.12], '#f2e6c8'),
      part('box', [0, 1, 2.52], [1.1, 2, 0.06], '#3a2a1a'),
      part('cylinder', [-2, 0.4, 3.6], [0.9, 0.8, 0.9], '#eeeae0'),
      part('cylinder', [2, 0.4, 3.6], [0.9, 0.8, 0.9], '#eeeae0'),
    ];
  else if (/house|hut|shack|home|cottage|apartment|flat/.test(words))
    parts = [
      part('box', [0, 1.5, 0], [5, 3, 5], colour),
      part('cone', [0, 3.9, 0], [6, 1.8, 6], '#7a4b2a'),
      part('box', [0, 1, 2.52], [1, 2, 0.06], '#3a2a1a'),
      part('box', [1.6, 4.2, -1], [0.6, 1.4, 0.6], '#8a5a3a'),
    ];
  else if (/tree|plant|flower/.test(words))
    parts = [part('cylinder', [0, 1, 0], [0.3, 2, 0.3], '#6b4b2a'), part('sphere', [0, 2.5, 0], [1.8, 1.6, 1.8], colour === '#8f8a82' ? '#4f8a4b' : colour)];
  else if (/car|truck|kart/.test(words))
    parts = [
      part('box', [0, 0.7, 0], [1.6, 0.7, 3.2], colour),
      part('box', [0, 1.25, -0.2], [1.4, 0.5, 1.6], '#9ab4c8'),
      ...[-0.8, 0.8].flatMap((x) => [-1, 1].map((z) => part('cylinder', [x, 0.35, z], [0.25, 0.7, 0.7], '#222222'))),
    ];
  else parts = [part('box', [0, 0.5, 0], [1.4, 1, 1.4], '#6a6a6a'), part('sphere', [0, 1.6, 0], [1.2, 1.2, 1.2], colour)];
  return validateDesign(
    { action: 'build', reply: 'done-ish', blueprint: { name: name[0].toUpperCase() + name.slice(1), description: `Fixture: ${input.request.slice(0, 120)}`, parts } },
    false,
  );
};
