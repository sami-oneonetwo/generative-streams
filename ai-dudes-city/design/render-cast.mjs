// Renders the story's cast for one age from design/spec/cast/<age>.json into design/out/cast/ (FK-006):
//   node design/render-cast.mjs <age>                          → <age>-board.png and <age>-measures.json
// The board: everyone at the stream camera on the age's ground (the town's own figures, kits and props),
// the same line-up from behind, and the phone check (the stream frame at 390 px, greyscale). Under each
// one: their name, scale and height, and their main colours as their pixels count them; Wren's top
// third as a share of red. note-<age>-board.txt beside the board (the design note) is printed under it.
// The measures file holds the same numbers, and the spec's hash, for scripts/design-cast.test.ts.
// Run from ai-dudes-city. NOBUILD=1 skips rebuilding the renderer; BOARD_DATE=YYYY-MM-DD pins the label's date.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { launch } from './browser.mjs';

const age = process.argv[2] ?? 'stone';
const out = path.resolve('design/out/cast');
mkdirSync(out, { recursive: true });
const started = Date.now();
if (!process.env.NOBUILD) execFileSync('node', ['design/build.mjs'], { stdio: 'inherit' });

// The spec, with each member's standing height worked out the way the page builds them (design/story.ts).
const data = JSON.parse(
  execFileSync('npx', ['tsx', '-e', `import {readFileSync} from 'node:fs'; import {CAST, standingHeight} from './design/story'; import BIBLES from './src/shared/ageBibles.json';
const spec = JSON.parse(readFileSync('design/spec/cast/${age}.json', 'utf8'));
const bible = (BIBLES as {id: string}[]).find((b) => b.id === '${age}');
const members = Object.values(spec.cast as Record<string, any>).map((c) => ({ role: c.role, name: c.name, scale: c.scale, height: standingHeight(CAST[c.role as keyof typeof CAST].body, c.scale), look: c.look, outfit: c.outfit, prop: c.prop, seat: c.seat, checks: c.checks }));
console.log(JSON.stringify({ bible, members }));`], { encoding: 'utf8', maxBuffer: 64 << 20 }),
);
if (!data.bible) throw new Error(`no ${age} world rules in src/shared/ageBibles.json`);
const date = new Date(process.env.BOARD_DATE ? `${process.env.BOARD_DATE}T12:00` : Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const ageName = data.bible.name.replace(/^the /i, '');
const noteFile = path.join(out, `note-${age}-board.txt`);
const note = existsSync(noteFile) ? readFileSync(noteFile, 'utf8') : undefined;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + path.resolve('design/board/index.html'));
await page.waitForFunction(() => typeof window.renderCast === 'function');
const { images, measures } = await page.evaluate((d) => window.renderCast(d), {
  title: `Finders Keepers: the ${ageName} cast`,
  subtitle: `${date} · design/spec/cast/${age}.json, drawn by the town's own figure builder · the stream camera (orthographic, 40° down, turned 0.65 rad) · standing on the square's dirt`,
  note,
  bible: data.bible,
  members: data.members,
});
await browser.close();
writeFileSync(path.join(out, `${age}-board.png`), Buffer.from(images.board.split(',')[1], 'base64'));
// The spec's hash, so a test can tell the board and its measures were drawn from the spec as committed.
const spec = createHash('sha256').update(readFileSync(path.resolve(`design/spec/cast/${age}.json`))).digest('hex').slice(0, 16);
writeFileSync(path.join(out, `${age}-measures.json`), JSON.stringify({ age, spec, measures }, null, 2) + '\n');
console.log(`cast ${age}: design/out/cast/${age}-board.png (${((Date.now() - started) / 1000).toFixed(0)} s)${note ? ', with the note' : ''}${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`);
for (const m of measures) console.log(`  ${m.name}: ${m.main.map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join(', ')}${m.role === 'wren' ? `; top third ${Math.round(m.topRed * 100)}% red` : ''}; ${m.phonePx}×${m.phoneW} px on the phone`);
