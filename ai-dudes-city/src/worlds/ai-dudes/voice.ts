// How the characters sound: plain natural English, never hype-streamer slang. The agent's prompt asks
// for it; this makes sure of it after the model has answered (say, persona, title, memory, a bit's
// caption or sign), and cleans what older saves already hold. Rewrites where a word has a plain
// equivalent, drops it where it was only filler, and lowercases SHOUTING.

/** Phrase → plain replacement ('' drops it). Order matters: longer phrases before their parts. */
const PHRASES: [RegExp, string][] = [
  [/\bjust (good )?vibes\b/gi, 'just fun'],
  [/\bgood vibes\b/gi, 'a good mood'],
  [/\b(chill|cozy|cosy|easygoing|relaxed|fun|laid-back|laid back) vibes?\b/gi, '$1 mood'],
  [/\bvibes?\b/gi, 'mood'],
  [/\bvibing\b/gi, 'relaxing'],
  [/\bvibey\b/gi, 'relaxed'],
  [/\bvibed\b/gi, 'got on'],
  [/\b(chaos|chaotic|unhinged) energy\b/gi, 'chaos'],
  [/\bmain character energy\b/gi, 'confidence'],
  [/\blet'?s go+\b[!.]*/gi, 'here we go'],
  [/\bsay less\b/gi, 'fair enough'],
  [/\blow-?key\b/gi, 'quietly'],
  [/\bhigh-?key\b/gi, 'really'],
  [/\bno cap\b/gi, 'honestly'],
  [/\bbesties?\b/gi, 'friend'],
  [/\babsolute unit\b/gi, 'big one'],
  [/\bunhinged\b/gi, 'wild'],
  [/\bit'?s giving\b/gi, 'it looks like'],
  [/\bslay(?=\s*([.!?]|$))/gi, 'nice'],
  // Filler interjections: gone, with the comma after them.
  [/(^|[.!?]\s*)(bruh|bro|yo|dude)\b(?!['’-])[,!.]*\s*/gi, '$1'],
  [/,\s*\b(bruh|bro|dude)\b(?=\s*([.!?]|$))/gi, ''],
  [/\bbruh\b/gi, ''],
  [/\bfr\b(?!-)/gi, ''],
  [/\bbros\b/gi, 'friends'],
  [/\bbro\b/gi, 'friend'],
  // "dude" as slang; the game's own name ("AI Dudes") stays.
  [/(?<!\bai )\bdudes\b/gi, 'people'],
  [/(?<!\bai )\bdude\b/gi, 'person'],
];

/** A shouted word: four or more capitals, or a run of two or more capitalised words. Short acronyms (AI, DJ, BBQ) stay. */
const SHOUT = /\b[A-Z][A-Z'’]{3,}\b|\b[A-Z][A-Z'’]+(?:[\s,!?.-]+[A-Z][A-Z'’]+)+\b/g;

/** Plain voice: banned slang rewritten or dropped, ALL-CAPS lowercased. Empty stays empty. */
export function plainVoice(input: string): string {
  if (!input) return input;
  let s = input.replace(SHOUT, (m) => m.toLowerCase());
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  s = s
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,;:])(?=[.!?])/g, '')
    .replace(/^[\s,;:.!?-]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // A sentence that started with a capital still does.
  if (/^[A-Z]/.test(input.trimStart()) && s) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

/** Clean what a character's record already holds (persona, title, memory), in place. True if anything changed. */
export function cleanVoiceOf(d: { persona: string; title?: string; memory: string[] }): boolean {
  let changed = false;
  const fix = (v: string) => {
    const out = plainVoice(v);
    if (out !== v) changed = true;
    return out;
  };
  d.persona = fix(d.persona);
  if (d.title) d.title = fix(d.title) || undefined;
  d.memory = d.memory.map(fix).filter(Boolean);
  return changed;
}
