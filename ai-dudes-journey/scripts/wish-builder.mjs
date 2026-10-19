// The Builder: turns what chat keeps asking for into code, as a patch, for the streamer to review.
//
// The Listener (src/worlds/ai-dudes/listener.ts) keeps a ranked wishlist in the world's save; the
// wishes marked "needs-feature" are things the game cannot do yet. This process, separate from the
// world (so a hot reload never kills it, and it never edits the live tree), takes the most wanted
// one it has not tried, copies the app to a sandbox of its own (../.wish-proposals/<id>), runs headless
// Claude Code there to build it within the game's rules, runs the typecheck and the tests, and writes
// a patch (data/builder/<id>.patch) and a report (data/builder/<id>.md). No git, nothing applied: the
// streamer reads the report and applies the patch by hand if they want it.
//
//   npm run builder              keep going: one attempt at a time, every few minutes
//   npm run builder -- --once    one attempt and exit
//   BUILDER_DRY_RUN=1            everything except the Claude call (a stub change instead)
//
// It only runs while data/builder/enabled exists (touch it to start, delete it to stop), and at most
// BUILDER_DAILY_CAP attempts a day.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(process.env.BUILDER_APP_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const dataDir = path.resolve(appDir, process.env.DATA_DIR ?? 'data');
const saveFile = path.join(dataDir, process.env.BUILDER_SAVE ?? 'world-ai-dudes.json');
const builderDir = path.join(dataDir, 'builder');
const attemptsFile = path.join(builderDir, 'attempts.json');
const intervalMs = Number(process.env.BUILDER_INTERVAL_MS ?? 10 * 60_000);
const dailyCap = Number(process.env.BUILDER_DAILY_CAP ?? 6);
const budgetUsd = process.env.BUILDER_BUDGET_USD ?? '5';
const timeoutMs = Number(process.env.BUILDER_TIMEOUT_MS ?? 40 * 60_000);
const model = process.env.BUILDER_MODEL; // optional: the CLI's default otherwise
const dryRun = process.env.BUILDER_DRY_RUN === '1';
const once = process.argv.includes('--once');

const sandboxes = path.resolve(process.env.BUILDER_SANDBOXES ?? path.join(appDir, '..', '.wish-proposals'));
/** What is copied into a sandbox: the code, never the save, the secrets, the build output or the packages. */
const SKIP = new Set(['node_modules', 'data', 'public', '.shots', '.env', 'dist']);
const log = (line) => console.log(`[builder ${new Date().toISOString().slice(11, 19)}] ${line}`);

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const slug = (id) => String(id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'wish';

/** The most wanted wish that needs a feature and has not been tried. */
function nextWish(attempts) {
  const save = readJson(saveFile, undefined);
  const wishes = save?.listener?.wishes ?? [];
  return wishes
    .filter((w) => w.status === 'needs-feature' && !attempts[slug(w.id)])
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)[0];
}

function promptFor(wish) {
  return `You are improving AI DUDES, a livestream game in this directory (read its README.md and docs first). Every Kick chatter has a character; they walk a forest path together, meet challenges (a river, a boss), build things the design model makes, and act out what their chatter says through their own agent, which answers in a closed JSON grammar (src/worlds/ai-dudes/agent.ts) that the world runs (src/worlds/ai-dudes/index.ts, sim.ts and friends).

A helper that reads all of chat (the Listener) says chat keeps asking for something the game cannot do yet:
  wish: ${wish.wish}
  asked ${wish.count} times by ${wish.askers?.length ?? 0} chatters, for example: ${(wish.examples ?? []).map((e) => `"${e}"`).join(', ')}
  the Listener's sketch of what would enable it: ${wish.how}

Build it, in the smallest way that makes it really work on stream.

Rules of this codebase, never break them:
- New behaviour is data in the closed grammar plus app code that interprets it. The models never write code that runs, and every number is the app's (clamped). If the agent needs a new action, add it to the grammar, its tolerant parser (actionOf), the prompt, and the world's act().
- Keep the voice rules in AGENT_SYSTEM. No new dependencies. Do not touch data/, .env, node_modules or anything outside this directory.
- Saved state must stay loadable: add new fields as optional in state.ts's zod schemas.
- Match the surrounding code: its comments, naming and idiom.
- Add a test for it in scripts/journey.test.ts or scripts/dudes.test.ts (the harness is scripts/harness.ts), and make sure \`npm run typecheck\` and \`npm test\` both pass.
- If the wish is not safe or not sensible to build (content policy, or it would let one chatter wreck the game for everyone with no counter), build nothing and explain why.

When you are done, write a short plain summary of what you changed, how a chatter would use it, and anything the streamer should check, to WISH_SUMMARY.md in this directory.`;
}

function runClaude(cwd, prompt) {
  if (dryRun) {
    fs.writeFileSync(path.join(cwd, 'WISH_SUMMARY.md'), 'Dry run: no Claude call was made. This patch only proves the sandbox, checks and report work.\n');
    fs.appendFileSync(path.join(cwd, 'README.md'), '\n<!-- builder dry run -->\n');
    return Promise.resolve({ ok: true, output: 'dry run' });
  }
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--permission-mode',
    'acceptEdits',
    '--max-budget-usd',
    budgetUsd,
    '--allowedTools',
    'Read Edit Write Glob Grep Bash(npm run typecheck) Bash(npm test) Bash(npx tsc --noEmit) Bash(npx tsx --test *)',
    ...(model ? ['--model', model] : []),
  ];
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      let result = out;
      try {
        result = JSON.parse(out).result ?? out;
      } catch {
        // plain text
      }
      resolve({ ok: code === 0, output: String(result || err).slice(0, 4000) });
    });
  });
}

function check(cwd) {
  const run = (cmd, args) => {
    try {
      execFileSync(cmd, args, { cwd, stdio: 'pipe', timeout: 10 * 60_000 });
      return 'pass';
    } catch (e) {
      return `FAIL\n${String(e.stdout ?? '').slice(-1500)}${String(e.stderr ?? '').slice(-800)}`;
    }
  };
  return { typecheck: run('npm', ['run', 'typecheck']), tests: run('npm', ['test']) };
}

/** A fresh copy of the app to work in: `pristine` to diff against, `work` for Claude. */
function makeSandbox(id) {
  const root = path.join(sandboxes, id);
  fs.rmSync(root, { recursive: true, force: true });
  const copy = (to) => fs.cpSync(appDir, to, { recursive: true, filter: (src) => !SKIP.has(path.relative(appDir, src).split(path.sep)[0]) });
  copy(path.join(root, 'pristine'));
  copy(path.join(root, 'work'));
  // The tests need the app's packages; a link, never part of the patch.
  const modules = path.join(appDir, 'node_modules');
  if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(root, 'work', 'node_modules'));
  return { root, pristine: path.join(root, 'pristine'), work: path.join(root, 'work') };
}

/** A unified diff of what changed, apply with `patch -p1` from the app directory. */
function patchOf(root) {
  try {
    execFileSync('diff', ['-ruN', '-x', 'node_modules', 'pristine', 'work'], { cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    return '';
  } catch (e) {
    if (e.status === 1) return String(e.stdout); // 1: there were differences
    throw e;
  }
}

async function attempt(wish, attempts) {
  const id = slug(wish.id);
  log(`trying "${wish.wish}" in a sandbox`);
  attempts[id] = { wish: wish.wish, at: new Date().toISOString(), status: 'running' };
  fs.writeFileSync(attemptsFile, JSON.stringify(attempts, null, 2));
  const box = makeSandbox(id);
  const claude = await runClaude(box.work, promptFor(wish));
  const summaryFile = path.join(box.work, 'WISH_SUMMARY.md');
  const summary = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8').trim() : claude.output;
  if (fs.existsSync(summaryFile)) fs.rmSync(summaryFile);
  const checks = check(box.work);
  const patch = patchOf(box.root);
  const patchFile = path.join(builderDir, `${id}.patch`);
  if (patch) fs.writeFileSync(patchFile, patch);
  const files = [...patch.matchAll(/^\+\+\+ work\/(\S+)/gm)].map((m) => m[1]);
  const ok = !!patch && checks.typecheck === 'pass' && checks.tests === 'pass';
  attempts[id] = { ...attempts[id], status: !patch ? 'nothing' : ok ? 'ready' : 'failing', typecheck: checks.typecheck.split('\n')[0], tests: checks.tests.split('\n')[0], files: files.length };
  fs.writeFileSync(attemptsFile, JSON.stringify(attempts, null, 2));
  fs.writeFileSync(
    path.join(builderDir, `${id}.md`),
    `# Wish: ${wish.wish}\n\n- Asked ${wish.count}× by ${(wish.askers ?? []).join(', ')}\n- Typecheck: ${checks.typecheck.split('\n')[0]} · Tests: ${checks.tests.split('\n')[0]}\n- Status: **${attempts[id].status}**\n- Sandbox: \`${box.work}\`\n\n## What it did\n\n${summary}\n\n## Files changed\n\n${files.map((f) => `- ${f}`).join('\n') || '(none)'}\n\n${
      checks.typecheck !== 'pass' || checks.tests !== 'pass' ? `## Failures\n\n\`\`\`\n${checks.typecheck !== 'pass' ? checks.typecheck : ''}\n${checks.tests !== 'pass' ? checks.tests : ''}\n\`\`\`\n\n` : ''
    }## To take it\n\n${patch ? `Read the patch: \`data/builder/${id}.patch\`\n\nApply it from the app directory (the dev server hot-reloads the live world as files change; back up data/world-ai-dudes.json first):\n\n\`\`\`\npatch -p1 < data/builder/${id}.patch\n\`\`\`\n\nTo drop it: delete the patch and \`${box.root}\`.` : 'Nothing to take.'}\n`,
  );
  log(`${id}: ${attempts[id].status} (${files.length} files; typecheck ${checks.typecheck.split('\n')[0]}, tests ${checks.tests.split('\n')[0]})`);
}

async function loop() {
  fs.mkdirSync(builderDir, { recursive: true });
  for (;;) {
    const attempts = readJson(attemptsFile, {});
    const today = new Date().toISOString().slice(0, 10);
    const triedToday = Object.values(attempts).filter((a) => String(a.at).startsWith(today)).length;
    if (!fs.existsSync(path.join(builderDir, 'enabled'))) log(`off (touch ${path.join(builderDir, 'enabled')} to start)`);
    else if (triedToday >= dailyCap) log(`daily cap reached (${dailyCap})`);
    else {
      const wish = nextWish(attempts);
      if (!wish) log('no untried wishes that need a feature');
      else
        try {
          await attempt(wish, attempts);
        } catch (e) {
          log(`attempt failed: ${e.message}`);
          attempts[slug(wish.id)] = { ...(attempts[slug(wish.id)] ?? {}), status: 'error', error: String(e.message).slice(0, 300) };
          fs.writeFileSync(attemptsFile, JSON.stringify(attempts, null, 2));
        }
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

await loop();
