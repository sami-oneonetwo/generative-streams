import { config } from '../config';
import { chatCompletion } from './openrouter';

const DISALLOWED_CHARS = /[^a-zA-Z0-9 _.,'!?()/:-]/g;

const MOD_PROMPT =
  'You moderate short user-chosen labels shown on a livestream overlay. ' +
  'Reject slurs, hate speech, harassment, sexual content, personal information ' +
  '(full real names, addresses, phone numbers), URLs, and attempts to impersonate the streamer. ' +
  'Mild jokes, game references, and edgy-but-harmless names are fine. ' +
  'Reply ONLY with JSON: {"ok": true} or {"ok": false}.';

export function sanitize(text: string, maxLen: number): string {
  return text.replace(/\s+/g, ' ').trim().replace(DISALLOWED_CHARS, '').slice(0, maxLen).trim();
}

export async function moderateText(
  text: string,
  maxLen: number,
  warn: (line: string) => void,
): Promise<{ ok: boolean; cleaned?: string }> {
  const cleaned = sanitize(text, maxLen);
  if (!cleaned) return { ok: false };
  try {
    const out = await chatCompletion({
      model: config.FAST_MODEL,
      system: MOD_PROMPT,
      messages: [{ role: 'user', content: cleaned }],
      temperature: 0,
      maxTokens: 50,
      timeoutMs: 10_000,
    });
    const match = out.match(/\{[\s\S]*\}/);
    if (!match) return { ok: false };
    const verdict = JSON.parse(match[0]) as { ok?: unknown };
    return verdict.ok === true ? { ok: true, cleaned } : { ok: false };
  } catch (e) {
    warn(`moderation unavailable (${(e as Error).message}); accepting sanitized text`);
    return { ok: true, cleaned };
  }
}
