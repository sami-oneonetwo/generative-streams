// Renders the design board from design/spec into design/out/r<round>/ (sheets, street corners, cells, boards).
//   node design/render.mjs <round> [ages=stone,bronze,…] [--only board-life,sheet-stone,cells] [--shipped]
// --only keeps just the named images (a name, or a folder such as "cells"); everything is still drawn,
// since the boards are made from the cells. --shipped draws what the game ships instead of design/spec
// (design/shipped.ts): the town's pieces from client/dudes/agePieces.json, the world rules from
// src/shared/ageBibles.json, and the people columns as the town's figures in the shipped kits; the
// example builds stay design samples. Every board is labelled with its round and date, and a
// note-<board>.txt in the round's folder (the audit note) is printed under that board.
// Run from ai-dudes-city. NOBUILD=1 skips rebuilding the renderer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch } from './browser.mjs';

const args = process.argv.slice(2);
const flag = (name) => (args.includes(`--${name}`) ? args.splice(args.indexOf(`--${name}`), 2)[1] : undefined);
const keep = (flag('only') ?? '').split(',').filter(Boolean);
const shipped = args.includes('--shipped') && !!args.splice(args.indexOf('--shipped'), 1);
const wanted = (name) => !keep.length || keep.some((k) => name === k || name === `${k}.png` || name.startsWith(`${k}/`));
const round = args[0] ?? '0';
const AGE_IDS = ['stone', 'bronze', 'medieval', 'industrial', 'modern', 'future'];
const only = (args[1] ?? '').split(',').filter(Boolean);
const out = path.resolve(`design/out/r${round}`);
mkdirSync(out, { recursive: true });
const started = Date.now();

if (!process.env.NOBUILD) execFileSync('node', ['design/build.mjs'], { stdio: 'inherit' });
// The catalogue and the shipped kits are TypeScript: read them through tsx.
const tsx = (code) => JSON.parse(execFileSync('npx', ['tsx', '-e', code], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const elements = tsx("import {ELEMENTS} from './design/catalogue'; console.log(JSON.stringify(ELEMENTS.map(({id,label,board,tile,half})=>({id,label,board,tile,half}))))");
const ship = shipped ? tsx("import {shippedAges} from './design/shipped'; console.log(JSON.stringify(shippedAges()))") : [];
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined);
const ages = AGE_IDS.filter((a) => !only.length || only.includes(a)).map((id) => {
  const dir = path.resolve('design/spec', id);
  const game = ship.find((a) => a.id === id);
  const bible = game?.bible ?? read(path.join(dir, 'bible.json'));
  if (!bible) throw new Error(`no bible for ${id}`);
  const specs = {};
  for (const e of elements) specs[e.id] = game && e.board === 'fabric' ? game.pieces[e.id] : read(path.join(dir, `${e.id}.json`));
  return { id, name: bible.name ?? id, bible, elements: specs, ...(game ? { index: game.index, people: game.outfits } : {}) };
});
const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const label = `Round r${round}, ${date}`;
const notes = Object.fromEntries(['board-fabric', 'board-life', 'board-vignettes'].map((b) => [`${b}.png`, existsSync(path.join(out, `note-${b}.txt`)) ? readFileSync(path.join(out, `note-${b}.txt`), 'utf8') : undefined]).filter(([, n]) => n));

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + path.resolve('design/board/index.html'));
await page.waitForFunction(() => typeof window.renderBoard === 'function');
const images = await page.evaluate((data) => window.renderBoard(data), { title: 'AI DUDES', label, shipped, notes, ages, elements });
const saved = Object.keys(images).filter(wanted);
for (const name of saved) {
  mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
  writeFileSync(path.join(out, name), Buffer.from(images[name].split(',')[1], 'base64'));
}
await browser.close();
const missing = ages.flatMap((a) => elements.filter((e) => !a.elements[e.id]).map((e) => `${a.id}/${e.id}`));
console.log(`round ${round}${shipped ? ' (as shipped)' : ''}: ${saved.length} images in ${out}${Object.keys(notes).length ? `, notes on ${Object.keys(notes).join(', ')}` : ''} (${((Date.now() - started) / 1000).toFixed(0)} s)${missing.length ? `; missing specs: ${missing.join(', ')}` : ''}${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`);
