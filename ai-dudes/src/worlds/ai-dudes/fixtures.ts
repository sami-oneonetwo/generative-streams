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
  const go = /\b(?:go to|visit|walk to|hang out with|find)\s+(@?\w+)/i.exec(said);
  const pose = EMOTES.find((e) => new RegExp(`\\b${e}`).test(lower)) as Emote | undefined;
  const fight = /\b(shoot|punch|kick|bomb|throw at)\s+(?:the\s+)?(.+)$/i.exec(said);
  const ride = /\b(drive|ride)\s+(?:the\s+)?(.+?)(?:\s+to\s+(.+))?$/i.exec(said);
  if (fight) actions.push({ do: 'attack', target: fight[2], with: fight[1].toLowerCase().startsWith('throw') ? 'throw' : (fight[1].toLowerCase() as 'shoot' | 'punch' | 'kick' | 'bomb') });
  else if (ride) actions.push({ do: 'use', target: ride[2], how: ride[1].toLowerCase() as 'drive' | 'ride', ...(ride[3] ? { to: ride[3] } : {}) });
  else if (edit) actions.push({ do: 'edit', target: edit[1], change: `paint it ${edit[2]}` });
  else if (remove) actions.push({ do: 'remove', target: remove[1] });
  else if (build) actions.push({ do: 'build', what: build[1].slice(0, 200), near: 'me' });
  if (go) actions.push({ do: 'move', to: go[1].replace(/^@/, '') });
  if (pose && !fight && !ride) actions.push({ do: 'emote', pose });
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
  else if (/house|hut|shack|home/.test(words))
    parts = [
      part('box', [0, 1.1, 0], [3, 2.2, 3], colour),
      part('cone', [0, 2.9, 0], [3.6, 1.4, 3.6], '#7a4b2a'),
      part('box', [0, 0.7, 1.52], [0.8, 1.4, 0.06], '#3a2a1a'),
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
