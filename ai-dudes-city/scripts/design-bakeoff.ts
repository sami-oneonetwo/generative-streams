// A design bake-off: the same town requests through two (or more) design models, with exactly the
// production design call (system prompt, settings, lot fitting), timed and costed, then rendered
// side by side into one picture. Costs real money: roughly $0.2–0.7 a design.
//   npx tsx scripts/design-bakeoff.ts [modelA modelB …]
// Results land in data/bakeoff/<stamp>/ (results.json, bakeoff.png).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { config } from '../src/config';
import { DESIGN_SYSTEM, designMessage, parseDesign, type DesignInput } from '../src/worlds/ai-dudes/design';
import { fitToLot } from '../src/worlds/ai-dudes/city';
import { allPlots } from '../src/shared/city';
import type { Blueprint } from '../src/shared/objectTypes';

const models = process.argv.slice(2).length ? process.argv.slice(2) : ['anthropic/claude-opus-5.5', 'openai/gpt-6-astra'];
const PERSONA = 'Warm and a bit theatrical; likes bold colours and little jokes in the details.';
const PROMPTS: (Pick<DesignInput, 'request' | 'kind' | 'lot'> & { label: string })[] = [
  { label: 'café', request: 'a cosy corner café with a striped awning, tables outside and a big coffee cup sign', kind: 'café', lot: 16 },
  { label: 'cottage', request: 'a little cottage with a chimney, flower boxes and a picket-fenced front garden', kind: 'home', lot: 16 },
  { label: 'apartments', request: 'a four-storey brick apartment block with balconies and a green front door', kind: 'apartments', lot: 16 },
  { label: 'ramen bar', request: 'a tiny ramen bar with lanterns, a noren curtain and a counter with stools', kind: 'restaurant', lot: 16 },
  { label: 'nightclub', request: 'a neon nightclub with a queue rope, a glowing sign and a disco ball on the roof', kind: 'club', lot: 16 },
  { label: 'pool', request: 'a public swimming pool with a diving board, loungers and a little lifeguard tower', kind: 'community project', lot: 13 },
  { label: 'bandstand', request: 'a Victorian bandstand in a little park with benches and lamp posts', kind: 'park', lot: 16 },
  { label: 'bakery', request: 'a bakery shaped like a giant loaf of bread with a croissant weathervane', kind: 'bakery', lot: 16 },
];

interface Result {
  model: string;
  label: string;
  ok: boolean;
  seconds: number;
  cost?: number;
  tokensOut?: number;
  parts?: number;
  name?: string;
  notes?: string;
  error?: string;
  blueprint?: Blueprint;
}

async function design(model: string, input: DesignInput): Promise<{ text: string; cost?: number; tokensOut?: number }> {
  // The production call (index.ts liveDesign), plus usage accounting.
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'ai-dudes bakeoff' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: DESIGN_SYSTEM },
        { role: 'user', content: designMessage(input) },
      ],
      temperature: 0.7,
      max_tokens: 14_000,
      response_format: { type: 'json_object' },
      reasoning: { max_tokens: 2500, exclude: true },
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { choices?: { finish_reason?: string; message?: { content?: string } }[]; usage?: { cost?: number; completion_tokens?: number } };
  if (data.choices?.[0]?.finish_reason === 'length') throw new Error('ran past the output limit');
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('empty completion');
  return { text, cost: data.usage?.cost, tokensOut: data.usage?.completion_tokens };
}

async function run(model: string, p: (typeof PROMPTS)[number]): Promise<Result> {
  const t0 = Date.now();
  try {
    const { text, cost, tokensOut } = await design(model, { dudeName: 'bakeoff', persona: PERSONA, request: p.request, kind: p.kind, lot: p.lot });
    const parsed = parseDesign(text, false);
    if (parsed.action === 'decline') return { model, label: p.label, ok: false, seconds: (Date.now() - t0) / 1000, cost, tokensOut, error: `declined: ${parsed.reply}` };
    const lot = allPlots().find((l) => (p.lot === 13 ? l.civic : !l.civic))!;
    const blueprint = fitToLot(parsed.blueprint, lot);
    return { model, label: p.label, ok: true, seconds: (Date.now() - t0) / 1000, cost, tokensOut, parts: blueprint.parts.length, name: blueprint.name, notes: parsed.reply, blueprint };
  } catch (e) {
    return { model, label: p.label, ok: false, seconds: (Date.now() - t0) / 1000, error: (e as Error).message };
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = path.join(config.DATA_DIR, 'bakeoff', stamp);
fs.mkdirSync(out, { recursive: true });
console.log(`designing ${PROMPTS.length} requests × ${models.length} models, all at once…`);
const results = await Promise.all(models.flatMap((m) => PROMPTS.map((p) => run(m, p).then((r) => (console.log(`  ${r.ok ? 'ok ' : 'ERR'} ${m.padEnd(28)} ${p.label.padEnd(11)} ${r.seconds.toFixed(0).padStart(4)} s  ${r.cost !== undefined ? `$${r.cost.toFixed(3)}` : ''} ${r.error ?? `${r.parts} parts`}`), r)))));
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));

// Summary per model.
for (const m of models) {
  const rs = results.filter((r) => r.model === m);
  const ok = rs.filter((r) => r.ok);
  const sum = (f: (r: Result) => number | undefined) => rs.reduce((a, r) => a + (f(r) ?? 0), 0);
  const secs = ok.map((r) => r.seconds).sort((a, b) => a - b);
  console.log(
    `${m}: ${ok.length}/${rs.length} ok · median ${secs[Math.floor(secs.length / 2)]?.toFixed(0) ?? '-'} s, slowest ${secs.at(-1)?.toFixed(0) ?? '-'} s · $${sum((r) => r.cost).toFixed(2)} total · ${Math.round(sum((r) => r.parts) / Math.max(1, ok.length))} parts avg`,
  );
}

// The picture: a grid, a row per request and a column per model, each design on its own square of lawn.
const view = await esbuild.build({ entryPoints: [path.join(import.meta.dirname, 'bakeoff-view.ts')], bundle: true, write: false, format: 'iife', target: 'es2020' });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#1c2724;color:#e4e2cf;font:13px Consolas,monospace}</style></head><body><script>window.BAKEOFF=${JSON.stringify({ models, prompts: PROMPTS.map((p) => p.label), results })}</script><script>${view.outputFiles[0].text}</script></body></html>`;
fs.writeFileSync(path.join(out, 'bakeoff.html'), html);
const require = createRequire(import.meta.url);
const { chromium } = require('../../noodle-shop/.claude/preview-tools/node_modules/playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 300 + models.length * 520, height: 60 + PROMPTS.length * 420 } });
await page.goto(`file://${path.resolve(out, 'bakeoff.html')}`);
await page.waitForFunction(() => (window as unknown as { BAKEOFF_DONE?: boolean }).BAKEOFF_DONE, null, { timeout: 60_000 });
await page.screenshot({ path: path.join(out, 'bakeoff.png'), fullPage: true });
await browser.close();
console.log(`wrote ${out}/results.json and bakeoff.png`);
