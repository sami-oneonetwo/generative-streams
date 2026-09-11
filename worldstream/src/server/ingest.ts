// The one shape chat takes once it is inside the system, whatever the source.

export interface ChatUser {
  id: string;
  name: string;
  /** Kick badge types, e.g. "moderator", "subscriber", "broadcaster". */
  badges: string[];
}

export interface IncomingChat {
  id: string;
  user: ChatUser;
  content: string;
  at: number;
  source: 'kick' | 'mock';
}

export function isPrivileged(user: ChatUser): boolean {
  return user.badges.includes('moderator') || user.badges.includes('broadcaster');
}
