// Mock chat: inject messages into the running server as any user, without Kick.
//
//   npm run chat                          REPL. "alice: !add cat" sends as alice; bare text sends as the default user.
//   npm run chat -- --as bob "!add cat"   one-shot
//   npm run chat -- --replay chat.jsonl   replay {"username","content","delayMs"?} lines, or "name: text" lines
//
// REPL commands: /as <name> sets the default user, /mod toggles the moderator badge, /quit exits.

import { readFileSync } from 'node:fs';
import readline from 'node:readline';

const BASE = process.env.WORLDSTREAM_URL ?? 'http://127.0.0.1:4400';
const args = process.argv.slice(2);

let defaultUser = 'sami';
let badges: string[] = [];

async function send(username: string, content: string): Promise<void> {
  try {
    const r = await fetch(`${BASE}/dev/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, content, badges }),
    });
    const j = (await r.json()) as { applied?: boolean; reply?: string; error?: string };
    if (j.error) console.log(`  ! ${j.error}`);
    else console.log(`  ${j.applied ? '✓' : '·'} ${j.reply ?? ''}`);
  } catch (err) {
    console.log(`  ! could not reach ${BASE}: ${String(err)}`);
  }
}

function splitLine(line: string): { user: string; text: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = /^([A-Za-z0-9_]{1,32}):\s+(.+)$/.exec(trimmed);
  if (m) return { user: m[1], text: m[2] };
  return { user: defaultUser, text: trimmed };
}

async function main(): Promise<void> {
  const asIdx = args.indexOf('--as');
  if (asIdx >= 0) {
    defaultUser = args[asIdx + 1] ?? defaultUser;
    const text = args.slice(asIdx + 2).join(' ');
    if (text) return send(defaultUser, text);
  }
  const replayIdx = args.indexOf('--replay');
  if (replayIdx >= 0) {
    const file = args[replayIdx + 1];
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      if (!raw.trim()) continue;
      let user = defaultUser, text = raw, delayMs = 400;
      if (raw.trim().startsWith('{')) {
        const j = JSON.parse(raw) as { username?: string; content: string; delayMs?: number };
        user = j.username ?? defaultUser; text = j.content; delayMs = j.delayMs ?? delayMs;
      } else {
        const s = splitLine(raw); if (!s) continue; user = s.user; text = s.text;
      }
      console.log(`${user}: ${text}`);
      await send(user, text);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return;
  }
  const oneShot = args.join(' ').trim();
  if (oneShot && !oneShot.startsWith('--')) return send(defaultUser, oneShot);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `${defaultUser}> ` });
  console.log(`mock chat → ${BASE}   ("name: text" to speak as someone else, /as, /mod, /quit)`);
  rl.prompt();
  rl.on('line', async (line) => {
    const t = line.trim();
    if (t === '/quit' || t === '/q') return rl.close();
    if (t.startsWith('/as ')) { defaultUser = t.slice(4).trim() || defaultUser; rl.setPrompt(`${defaultUser}> `); rl.prompt(); return; }
    if (t === '/mod') { badges = badges.includes('moderator') ? [] : ['moderator']; console.log(`  badges: ${badges.join(',') || 'none'}`); rl.prompt(); return; }
    const s = splitLine(t);
    if (s) await send(s.user, s.text);
    rl.prompt();
  });
  rl.on('close', () => process.exit(0));
}

main();
