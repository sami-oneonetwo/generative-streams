// Renders the age's garment kits on real rigged figures into design/out/o<round>/ (outfits-<age>.png, outfits-board.png).
//   node design/render-outfits.mjs <round> [ages=stone,bronze,…] [--only outfits-board] [--shipped]
// --shipped draws the kits the game ships (src/shared/ageOutfits.json, design/shipped.ts) instead of
// design/spec/<age>/outfits.json. The board is labelled with its round and date, every kit is named
// under its wearers, and note-outfits-board.txt in the round's folder (the audit note) is printed
// under it. --only keeps just the named images. NOBUILD=1 skips rebuilding the renderer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch } from './browser.mjs';

const args = process.argv.slice(2);
const flag = (name) => (args.includes(`--${name}`) ? args.splice(args.indexOf(`--${name}`), 2)[1] : undefined);
const keep = (flag('only') ?? '').split(',').filter(Boolean);
const shipped = args.includes('--shipped') && !!args.splice(args.indexOf('--shipped'), 1);
const round = args[0] ?? '0';
const AGE_IDS = ['stone', 'bronze', 'medieval', 'industrial', 'modern', 'future'];
const only = (args[1] ?? '').split(',').filter(Boolean);
const out = path.resolve(`design/out/o${round}`);
mkdirSync(out, { recursive: true });
if (!process.env.NOBUILD) execFileSync('node', ['design/build.mjs'], { stdio: 'inherit' });
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined);
const ship = shipped ? JSON.parse(execFileSync('npx', ['tsx', '-e', "import {shippedAges} from './design/shipped'; console.log(JSON.stringify(shippedAges()))"], { encoding: 'utf8', maxBuffer: 64 << 20 })) : [];
const ages = AGE_IDS.map((id, index) => {
  const game = ship.find((a) => a.id === id);
  return { id, index, bible: game?.bible ?? read(path.resolve('design/spec', id, 'bible.json')), outfits: game?.outfits ?? read(path.resolve('design/spec', id, 'outfits.json')) };
})
  .filter((a) => !only.length || only.includes(a.id))
  .map((a) => ({ ...a, name: a.bible?.name ?? a.id }));
// BOARD_DATE=2026-10-24 pins the label's date, so a board re-renders byte-identical on another day.
const date = new Date(process.env.BOARD_DATE ? `${process.env.BOARD_DATE}T12:00` : Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const subtitle = `Round o${round}, ${date} · ${shipped ? "as shipped: the game's garment kits today" : 'from design/spec'}, each everyday kit on two people`;
const noteFile = path.join(out, 'note-outfits-board.txt');
const note = existsSync(noteFile) ? readFileSync(noteFile, 'utf8') : undefined;
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + path.resolve('design/board/index.html'));
await page.waitForFunction(() => typeof window.renderOutfits === 'function');
const images = await page.evaluate((data) => window.renderOutfits(data), { subtitle, note, ages });
const saved = Object.keys(images).filter((name) => !keep.length || keep.some((k) => name === k || name === `${k}.png`));
for (const name of saved) writeFileSync(path.join(out, name), Buffer.from(images[name].split(',')[1], 'base64'));
await browser.close();
console.log(`outfits round ${round}${shipped ? ' (as shipped)' : ''}: ${saved.length} images in ${out}${note ? ', with the note' : ''}${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`);
