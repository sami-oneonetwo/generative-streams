import { WEATHERS, WORLDS, type Weather, type World } from './state.js';

export type Position = 'left' | 'centre' | 'right';
export type TimePreset = 'night' | 'dusk' | 'dawn' | 'day';

export type Command =
  | { kind: 'add'; sprite: string; position?: Position; text?: string }
  | { kind: 'remove'; target: 'mine' | 'last' | string }
  | { kind: 'move'; target: string; position: Position }
  | { kind: 'sign'; text?: string }
  | { kind: 'weather'; weather: Weather }
  | { kind: 'time'; preset: TimePreset }
  | { kind: 'world'; world: World }
  | { kind: 'vote' }
  | { kind: 'event'; name: string }
  | { kind: 'name'; target: string; name: string }
  | { kind: 'build'; name: string }
  | { kind: 'wear'; text: string; off?: boolean }
  | { kind: 'generate'; query: string; description?: string }
  | { kind: 'help' }
  | { kind: 'unknown'; raw: string };

export const HELP_TEXT =
  '!add <thing> [left|right] · !remove [mine|last|thing] · !sign "text" · !weather rain|clear|fog|storm · !time night|dusk|dawn|day · !name <thing> <name> · !build <thing> · !wear <hat|red coat|…> · !world <name> · !vote';

const POSITIONS: Record<string, Position> = {
  left: 'left', l: 'left',
  centre: 'centre', center: 'centre', middle: 'centre', mid: 'centre', c: 'centre',
  right: 'right', r: 'right',
};

const TIMES: Record<string, TimePreset> = {
  night: 'night', midnight: 'night', late: 'night',
  dusk: 'dusk', evening: 'dusk', sunset: 'dusk',
  dawn: 'dawn', sunrise: 'dawn', morning: 'dawn',
  day: 'day', noon: 'day', afternoon: 'day', daytime: 'day',
};

const ARTICLE = /^(the|my|a|an|some)\s+/i;

/** Returns null when the text is not a command (does not start with "!"). */
export function parseCommand(raw: string): Command | null {
  const text = raw.trim();
  if (!text.startsWith('!')) return null;
  const unknown: Command = { kind: 'unknown', raw: text };

  let quoted: string | undefined;
  const body = text.slice(1).replace(/"([^"]*)"|“([^”]*)”|'([^']*)'/, (_m, a, b, c) => {
    quoted = (a ?? b ?? c ?? '').trim();
    return ' ';
  });
  const words = body.trim().split(/\s+/).filter(Boolean);
  const verb = (words.shift() ?? '').toLowerCase();

  switch (verb) {
    case 'add':
    case 'spawn':
    case 'place':
    case 'put': {
      if (verb === 'put' && words[0]?.toLowerCase() === 'on') return { kind: 'wear', text: words.slice(1).join(' ').replace(ARTICLE, '').trim() || 'nothing' };
      let position: Position | undefined;
      const last = words[words.length - 1]?.toLowerCase();
      if (last && POSITIONS[last] && words.length > 1) {
        position = POSITIONS[last];
        words.pop();
      }
      const first = words[0]?.toLowerCase();
      if (!position && first && POSITIONS[first] && words.length > 1) {
        position = POSITIONS[first];
        words.shift();
      }
      const sprite = words.join(' ').replace(ARTICLE, '').trim();
      if (!sprite) return unknown;
      return { kind: 'add', sprite, position, text: quoted };
    }
    case 'remove':
    case 'rm':
    case 'delete':
    case 'del':
    case 'undo': {
      const t = words.join(' ').toLowerCase().trim();
      if (verb === 'undo' || t === '' || t === 'mine' || t === 'my') return { kind: 'remove', target: 'mine' };
      if (t === 'last') return { kind: 'remove', target: 'last' };
      return { kind: 'remove', target: t.replace(ARTICLE, '') };
    }
    case 'move': {
      const last = words[words.length - 1]?.toLowerCase();
      const position = last ? POSITIONS[last] : undefined;
      if (!position || words.length < 2) return unknown;
      words.pop();
      return { kind: 'move', target: words.join(' ').replace(ARTICLE, '').trim(), position };
    }
    case 'sign': {
      const t = (quoted ?? words.join(' ')).trim();
      return { kind: 'sign', text: t || undefined };
    }
    case 'weather':
    case 'rain':
    case 'fog':
    case 'storm':
    case 'clear':
    case 'snow': {
      const w = (verb === 'weather' ? words[0] : verb)?.toLowerCase();
      if (w && (WEATHERS as readonly string[]).includes(w)) return { kind: 'weather', weather: w as Weather };
      return unknown;
    }
    case 'time':
    case 'night':
    case 'dusk':
    case 'dawn':
    case 'day': {
      const t = (verb === 'time' ? words[0] : verb)?.toLowerCase();
      const preset = t ? TIMES[t] : undefined;
      return preset ? { kind: 'time', preset } : unknown;
    }
    case 'world':
    case 'travel':
    case 'go': {
      const w = words[0]?.toLowerCase();
      if (w && (WORLDS as readonly string[]).includes(w)) return { kind: 'world', world: w as World };
      return unknown;
    }
    case 'vote':
    case 'yes':
    case 'aye':
      return { kind: 'vote' };
    case 'build':
    case 'make':
    case 'construct': {
      const name = words.join(' ').replace(ARTICLE, '').replace(/^me\s+(a|an|the)?\s*/i, '').trim();
      return name ? { kind: 'build', name } : unknown;
    }
    case 'name':
    case 'call': {
      if (quoted) {
        const target = words.join(' ').replace(ARTICLE, '').trim();
        return target && quoted ? { kind: 'name', target, name: quoted } : unknown;
      }
      if (words.length < 2) return unknown;
      const name = words.pop()!;
      return { kind: 'name', target: words.join(' ').replace(ARTICLE, '').trim(), name };
    }
    case 'wear':
    case 'dress':
    case 'outfit':
    case 'equip': {
      const t = words.join(' ').replace(/^(him|the wanderer|up)\s+/i, '').replace(/^(in|with|as)\s+/i, '').replace(ARTICLE, '').trim();
      return { kind: 'wear', text: t || 'nothing' };
    }
    case 'undress':
    case 'strip':
    case 'takeoff':
    case 'unequip': {
      const t = words.join(' ').replace(ARTICLE, '').trim();
      return { kind: 'wear', text: t || 'everything', off: true };
    }
    case 'take': {
      if (words[0]?.toLowerCase() !== 'off') return unknown;
      const t = words.slice(1).join(' ').replace(ARTICLE, '').trim();
      return { kind: 'wear', text: t || 'everything', off: true };
    }
    case 'event':
    case 'trigger': {
      const name = words.join(' ').trim().toLowerCase().replace(/[\s-]+/g, '_');
      return name ? { kind: 'event', name } : unknown;
    }
    case 'help':
    case 'commands':
    case 'h':
      return { kind: 'help' };
    default:
      return unknown;
  }
}
