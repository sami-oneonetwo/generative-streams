import { config } from '../config';

// Chat bots (moderation, loyalty points, timers) post in chat too; they never get a character.
// KICK_IGNORE_BOTS adds more, comma-separated, any case.
const KNOWN = ['botrix', 'kickbot', 'kicklet', 'sery_bot', 'nightbot', 'streamelements', 'streamlabs', 'fossabot', 'moobot', 'wizebot', 'kickstatsbot'];

const ignored = new Set(
  [...KNOWN, ...config.KICK_IGNORE_BOTS.split(',')]
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean),
);

export const isChatBot = (username: string) => ignored.has(username.trim().toLowerCase());
