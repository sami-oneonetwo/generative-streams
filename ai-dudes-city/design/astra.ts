// The design board's model calls, all on gpt-6-astra through OpenRouter (Sami, 2026-10-20: "always use
// gpt-6-astra for the design work"). Writes specs under design/spec and critiques under design/out.
// Every call's cost is logged to design/out/spend.jsonl and a hard budget stops the run.
//
//   npx tsx design/astra.ts bibles                         the six ages' world rules, in one call (coherent)
//   npx tsx design/astra.ts bible <age> <direction…>       one age's world rules afresh, in a new direction
//   npx tsx design/astra.ts elements <age|all> [ids…]      board elements (fabric + people), from the bible
//   npx tsx design/astra.ts builds <age|all> [ids…]        example builds through the game's own design prompt
//   npx tsx design/astra.ts critique <age> <round>         astra looks at out/r<round>/sheet-<age>.png (+ vignette)
//   npx tsx design/astra.ts critique-boards <round>        astra looks at the whole boards across ages
//   npx tsx design/astra.ts revise <age> <round> [ids…]    rework what the round's notes flagged (notes-<age>.json)
//   npx tsx design/astra.ts revise-bibles <round>          fold the round's world-rule notes into the bibles
//   npx tsx design/astra.ts outfits <age|all> [round]          garment kits for the rigged figures (revise from out/o<round>/notes-<age>.json)
//   npx tsx design/astra.ts critique-outfits <age|all> <round>  astra looks at out/o<round>/outfits-<age>.png
//   npx tsx design/astra.ts spend                          what the board has cost so far
//
// Env: DESIGN_MODEL (default openai/gpt-6-astra), DESIGN_BUDGET_USD (default 100), DESIGN_CONCURRENCY (6).
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { AGES, AGE_IDS, ageStyle, type AgeId } from '../src/shared/ages';
import { DESIGN_SYSTEM, designMessage } from '../src/worlds/ai-dudes/design';
import { validateDesign } from '../src/worlds/ai-dudes/blueprint';
import { BASE_FIGURE, ELEMENTS, ENGINE_RULES, SAMI_NOTES, elementById, type Element } from './catalogue';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const SPEC = path.join(ROOT, 'spec');
const OUT = path.join(ROOT, 'out');
const MODEL = process.env.DESIGN_MODEL ?? 'openai/gpt-6-astra';
const BUDGET = Number(process.env.DESIGN_BUDGET_USD ?? 100);
const CONCURRENCY = Number(process.env.DESIGN_CONCURRENCY ?? 6);
mkdirSync(SPEC, { recursive: true });
mkdirSync(OUT, { recursive: true });

function apiKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const env = readFileSync(path.join(ROOT, '..', '.env'), 'utf8');
  const m = /^OPENROUTER_API_KEY=(.+)$/m.exec(env);
  if (!m) throw new Error('OPENROUTER_API_KEY not in ai-dudes-city/.env');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

// ---- spend ---------------------------------------------------------------------------------------
const SPEND = path.join(OUT, 'spend.jsonl');
function spent(): number {
  if (!existsSync(SPEND)) return 0;
  return readFileSync(SPEND, 'utf8')
    .split('\n')
    .filter(Boolean)
    .reduce((s, l) => s + (JSON.parse(l).cost ?? 0), 0);
}

// ---- one call ------------------------------------------------------------------------------------
type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
interface CallOpts {
  label: string;
  system: string;
  user: Content;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}
async function astra(o: CallOpts): Promise<unknown> {
  if (spent() >= BUDGET) throw new Error(`design budget spent ($${spent().toFixed(2)} of $${BUDGET}); raise DESIGN_BUDGET_USD to go on`);
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json', 'X-Title': 'ai-dudes design board' },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: o.system },
            { role: 'user', content: o.user },
          ],
          max_tokens: o.maxTokens ?? 24_000,
          response_format: { type: 'json_object' },
          reasoning: { effort: o.effort ?? 'medium' },
          usage: { include: true },
        }),
        signal: AbortSignal.timeout(9 * 60_000),
      });
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
      appendFileSync(SPEND, JSON.stringify({ at: new Date().toISOString(), label: o.label, model: MODEL, ms: Date.now() - started, cost: body.usage?.cost ?? 0, in: body.usage?.prompt_tokens, out: body.usage?.completion_tokens, ok: res.ok }) + '\n');
      if (!res.ok) throw new Error(`${res.status} ${body.error?.message ?? ''}`);
      const text = body.choices?.[0]?.message?.content ?? '';
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error(`no JSON in reply: ${text.slice(0, 200)}`);
      return JSON.parse(m[0]);
    } catch (e) {
      last = e;
      console.warn(`[${o.label}] attempt ${attempt + 1} failed: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw last;
}

async function pool<T>(items: T[], fn: (t: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let t = queue.shift(); t !== undefined; t = queue.shift()) {
        try {
          await fn(t);
        } catch (e) {
          console.error(`FAILED ${JSON.stringify(t)}: ${(e as Error).message}`);
        }
      }
    }),
  );
}

// ---- files ---------------------------------------------------------------------------------------
const readJson = <T>(file: string): T | undefined => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : undefined);
const writeJson = (file: string, v: unknown) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(v, null, 2));
};
const bibleFile = (age: AgeId) => path.join(SPEC, age, 'bible.json');
const elementFile = (age: AgeId, id: string) => path.join(SPEC, age, `${id}.json`);
const roundDir = (round: number | string | string) => path.join(OUT, `r${round}`);
const png = (file: string) => ({ type: 'image_url' as const, image_url: { url: `data:image/png;base64,${readFileSync(file).toString('base64')}` } });
const ages = (arg: string | undefined): AgeId[] => (!arg || arg === 'all' ? [...AGE_IDS] : (arg.split(',') as AgeId[]).filter((a) => AGE_IDS.includes(a)));

// ---- the world rules (bibles) --------------------------------------------------------------------
export const PATTERNS = ['grass', 'meadow', 'mud', 'dirt', 'sand', 'gravel', 'moss', 'cobble', 'flagstone', 'setts', 'brick', 'planks', 'asphalt', 'concrete', 'tiles', 'glowgrid', 'water', 'snow'] as const;
const SURFACE = `{"pattern": one of ${PATTERNS.join('|')}, "base":"#rrggbb", "accent":"#rrggbb", "accent2":"#rrggbb" (optional), "scale": metres per stone/slab/tuft 0.3–3, "glow": true only for lit lines (glowgrid)}`;
const BIBLE_SHAPE = `{"id":"stone|bronze|medieval|industrial|modern|future","name":"the Stone Age","summary":"one line for the board's row label, max 110 chars",
"rules":{"sidewalks":true|false,"kerbs":true|false,"roadMarkings":true|false,"roads":"what roads are and look like","walkingEdge":"what runs along roads instead of or as pavements","lotMarkers":"the free-lot marker","boundaries":"how claimed lots are bounded","ownerMarker":"how an owner's name shows","lighting":"what lights the streets","centrepiece":"the square's centrepiece","seating":"…","market":"…","trees":"street and wild trees: shapes, irregularity","arrival":"the arrival point and its vehicle","crossing":"how the river is crossed","camp":"the caravan's camp","people":"what people wear","head":"the town's head and their symbol"},
"surfaces":{"countryside":SURFACE,"road":SURFACE,"pavement":SURFACE or null when there are no pavements,"lotRough":SURFACE,"lotClaimed":SURFACE,"square":SURFACE,"bank":SURFACE,"water":SURFACE},
"light":{"sky":"#rrggbb","fog":"#rrggbb","sun":"#rrggbb","sunIntensity":1.2–3,"hemiSky":"#rrggbb","hemiGround":"#rrggbb","hemiIntensity":1.2–3},
"palette":["8–14 #rrggbb colours the age's things are made of"],"materials":["…"],"avoid":["things that must never appear in this age"],
"designDirection":"3–5 sentences the game's design call gets so ANY chatter request (a skyscraper, a dog, a car, a café) is made the age's way, with two or three concrete examples"}`;

const WORLD = `AI DUDES is a livestreamed town game on Kick: every chatter has a small blocky character with a 22 m lot in a shared town (a 3×3 grid of big blocks, each eight lots round a green courtyard, with roads between them, a town square in the middle with four community lots, a river past the east ring road with a caravan camp across it). The town lives through six ages, moving on as chat helps it grow: ${AGES.map((a, i) => `${i + 1}. ${a.name} (the head is the ${a.head.title})`).join('; ')}. Caravans per age: mammoth herders, river traders on barges, a travelling court (knight, jester, minstrel), railway barons by train, a coach of tourists, a scrap convoy across the wasteland. Every build and every piece of the town changes with the age; things built in one age transform into the next age's version (same footprint, same purpose). The look is chunky low-poly toy-like 3D seen from above at about 40°, bright and readable on a stream.`;

async function bibles(): Promise<void> {
  const previous = AGE_IDS.map((a) => readJson(bibleFile(a))).filter(Boolean);
  const reply = (await astra({
    label: 'bibles',
    effort: 'high',
    system: `You are the art director of AI DUDES. ${WORLD}\nYou write each age's world rules (its "bible"): what every piece of the town is in that age, how surfaces look, light and palette. Think about the six ages as one progression: each age must be unmistakable at a glance and different from its neighbours, every piece in an age must agree with every other, and the same piece must be recognisably the same role across ages. Be historically grounded but playful. Answer only JSON.`,
    user: `Sami's notes (the streamer; these are requirements):\n- ${SAMI_NOTES.join('\n- ')}\n\nThe pieces of the town (each needs an answer in every age):\n${ELEMENTS.filter((e) => !e.build).map((e) => `- ${e.label}: ${e.brief}`).join('\n')}\n\nSurfaces use ${SURFACE}.\n\nReturn {"ages":[six bibles, Stone first]}, each bible exactly ${BIBLE_SHAPE}.${previous.length ? `\n\nThe current bibles, to improve on rather than start over: ${JSON.stringify(previous)}` : ''}`,
    maxTokens: 40_000,
  })) as { ages?: { id: AgeId }[] };
  for (const b of reply.ages ?? []) if (AGE_IDS.includes(b.id)) writeJson(bibleFile(b.id), b);
  console.log(`bibles: ${(reply.ages ?? []).map((b) => b.id).join(', ')}`);
}

/** One age's bible written afresh (a new direction for it), with the other five for coherence. */
async function bible(age: AgeId, direction: string): Promise<void> {
  const others = AGE_IDS.filter((a) => a !== age).map((a) => readJson(bibleFile(a))).filter(Boolean);
  const b = (await astra({
    label: `bible ${age}`,
    effort: 'high',
    system: `You are the art director of AI DUDES. ${WORLD}\nYou write one age's world rules (its "bible"): what every piece of the town is in that age, how surfaces look, light and palette. It must be unmistakable at a glance, different from its neighbours, every piece agreeing with every other, and the same piece recognisably the same role as in the other ages. Answer only JSON.`,
    user: `Rewrite the bible for ${ageStyle(AGE_IDS.indexOf(age)).name} (id "${age}") from scratch in this new direction: ${direction}\n\nHow the game describes the age: ${ageStyle(AGE_IDS.indexOf(age)).design}\n\nSami's notes (the streamer; these are requirements):\n- ${SAMI_NOTES.join('\n- ')}\n\nThe pieces of the town (each needs an answer):\n${ELEMENTS.filter((e) => !e.build).map((e) => `- ${e.label}: ${e.brief}`).join('\n')}\n\nSurfaces use ${SURFACE}.\n\nThe other ages' bibles, for coherence: ${JSON.stringify(others)}\n\nReturn the bible exactly ${BIBLE_SHAPE}.`,
    maxTokens: 24_000,
  })) as { id?: AgeId };
  writeJson(bibleFile(age), { ...b, id: age });
  console.log(`bible ${age}: ${(b as { name?: string }).name}`);
}

// ---- board elements ------------------------------------------------------------------------------
interface Part {
  shape: string;
  position: number[];
  size: number[];
  rotation: number[];
  color: string;
  glow?: boolean;
}
interface ElementSpec {
  name: string;
  description: string;
  notes?: string;
  parts: Part[];
}

const TILE_TEXT: Record<Element['tile'], string> = {
  land: 'The cell is countryside ground all over (the countryside surface), 12 × 12 m round x 0 z 0.',
  street: 'The cell is a street: the road surface runs along x across the middle (|z| ≤ 4); where the age has pavements, the pavement surface runs from |z| 4 to 6; lot ground beyond.',
  'lot-rough': 'The cell is a free lot (the lotRough surface) with the street running along its front edge beyond z +6.',
  'lot-claimed': 'The cell is a claimed lot (the lotClaimed surface) with the street running along its front edge beyond z +6.',
  square: "The cell is the town square's ground (the square surface).",
  river: 'The cell is the river: water along x across the middle (|z| ≤ 7), banks beyond.',
  none: 'Shown on its own on the age\'s ground.',
};

/** Clamp a spec into its room: |x|,|z| ≤ half, 0 ≤ y ≤ height, ≤ 160 parts; returns what had to be fixed (for the critique). */
export function checkSpec(spec: ElementSpec, e: Element): string[] {
  const issues: string[] = [];
  if (!Array.isArray(spec.parts) || !spec.parts.length) return ['no parts'];
  if (spec.parts.length > 160) {
    issues.push(`${spec.parts.length} parts (max 160)`);
    spec.parts = spec.parts.slice(0, 160);
  }
  let out = 0,
    sunk = 0,
    bad = 0;
  for (const p of spec.parts) {
    if (!['box', 'cylinder', 'sphere', 'cone'].includes(p.shape)) (p.shape = 'box'), bad++;
    const v3 = (a: unknown, d: number) => (Array.isArray(a) && a.length === 3 && a.every((n) => Number.isFinite(Number(n))) ? a.map(Number) : [d, d, d]);
    p.position = v3(p.position, 0);
    p.size = v3(p.size, 0.3).map((n) => Math.max(0.02, Math.abs(n)));
    p.rotation = v3(p.rotation, 0);
    if (!/^#[0-9a-f]{6}$/i.test(p.color ?? '')) (p.color = '#8f8a82'), bad++;
    const r = Math.max(p.size[0], p.size[2]) / 2;
    if (Math.abs(p.position[0]) + r > e.half + 0.6 || Math.abs(p.position[2]) + r > e.half + 0.6) out++;
    if (p.position[1] - p.size[1] / 2 < -0.15 && !p.rotation.some((x) => Math.abs(x) > 0.2)) sunk++;
  }
  if (out) issues.push(`${out} parts reach outside the ${e.half * 2} m room`);
  if (sunk) issues.push(`${sunk} parts sink below the ground`);
  if (bad) issues.push(`${bad} parts had a bad shape or colour`);
  return issues;
}

function elementSystem(): string {
  return `You are a 3D prop designer for AI DUDES. ${WORLD}\nYou design one piece of the town for one age as low-poly geometry. ${ENGINE_RULES}\nAnswer only JSON: {"name":"what it is in this age","description":"one sentence","notes":"how it shows the age, one sentence","parts":[…]}.`;
}
function siblings(e: Element, age: AgeId): string {
  const others = AGE_IDS.filter((a) => a !== age)
    .map((a) => ({ a, s: readJson<ElementSpec>(elementFile(a, e.id)) }))
    .filter((x) => x.s)
    .map((x) => `${ageStyle(AGE_IDS.indexOf(x.a)).name}: ${x.s!.name} (${x.s!.description})`);
  return others.length ? `\nThe same piece in the other ages (keep the role recognisable, make the age different): ${others.join('; ')}` : '';
}
function elementBrief(e: Element, age: AgeId): string {
  const bible = readJson(bibleFile(age));
  if (!bible) throw new Error(`no bible for ${age}: run "bibles" first`);
  return `Age: ${ageStyle(AGE_IDS.indexOf(age)).name}. Its bible: ${JSON.stringify(bible)}\n\nPiece: ${e.label}. ${e.brief}\n${TILE_TEXT[e.tile]} Keep every part inside |x| ≤ ${e.half} and |z| ≤ ${e.half}, at most ${e.height} m tall.${e.board === 'life' ? `\n${BASE_FIGURE}` : ''}${siblings(e, age)}\n\nSami's notes: ${SAMI_NOTES.join(' ')}`;
}

async function element(age: AgeId, e: Element): Promise<void> {
  const reply = (await astra({ label: `element ${age}/${e.id}`, system: elementSystem(), user: elementBrief(e, age) })) as ElementSpec;
  const issues = checkSpec(reply, e);
  writeJson(elementFile(age, e.id), { ...reply, ...(issues.length ? { checks: issues } : {}) });
  console.log(`${age}/${e.id}: ${reply.name} (${reply.parts.length} parts)${issues.length ? ` [${issues.join('; ')}]` : ''}`);
}

// ---- example builds, through the game's own design prompt ---------------------------------------
async function build(age: AgeId, e: Element): Promise<void> {
  const bible = readJson<{ designDirection?: string }>(bibleFile(age));
  const i = AGE_IDS.indexOf(age);
  const kind = e.build!.kind ? `${ageStyle(i).venues[e.build!.kind as keyof (typeof AGES)[0]['venues']]} (a ${e.build!.kind})` : undefined;
  const message = designMessage({
    dudeName: 'board',
    persona: '',
    request: e.build!.request,
    ...(e.build!.lot ? { lot: e.build!.lot } : {}),
    ...(kind ? { kind } : {}),
    age: bible?.designDirection ?? ageStyle(i).design,
  });
  const raw = await astra({ label: `build ${age}/${e.id}`, system: DESIGN_SYSTEM, user: message, effort: 'medium' });
  const r = validateDesign(raw, false);
  if (r.action === 'decline') throw new Error(`declined: ${r.reply}`);
  writeJson(elementFile(age, e.id), { name: r.blueprint.name, description: r.blueprint.description, notes: `via the game's design prompt: "${e.build!.request}"`, parts: r.blueprint.parts });
  console.log(`${age}/${e.id}: ${r.blueprint.name} (${r.blueprint.parts.length} parts)`);
}

// ---- critique --------------------------------------------------------------------------------------
const CRITIQUE_SHAPE = `{"verdict":"pass"|"revise","score":1-10,"summary":"two sentences","elements":[{"id":"element id","score":1-10,"ok":true|false,"problems":["…"],"fix":"concrete instruction for the redesign"}],"bible":{"ok":true|false,"changes":["world-rule changes, if any"]}}`;
const RUBRIC = `Judge as a demanding art director, against: (1) age fidelity: is every piece unmistakably this age, never today's town recoloured (Sami's notes are hard requirements); (2) readability: does it read at stream distance from this camera, bold silhouette, clear colour contrast, right scale next to a 1.8 m person; (3) coherence: does every piece agree with the age's bible and each other; (4) craft: floating or sunk parts, ugly intersections, blobby or too-few parts, symmetry where nature would be irregular. Score each piece 1–10; anything under 8 is "ok":false with specific problems and a concrete fix. "verdict":"pass" only when every piece is 8 or more.`;

async function critique(age: AgeId, round: number | string): Promise<void> {
  const dir = roundDir(round);
  const sheet = path.join(dir, `sheet-${age}.png`),
    vignette = path.join(dir, `vignette-${age}.png`);
  if (!existsSync(sheet)) throw new Error(`render round ${round} first (${sheet})`);
  const ids = ELEMENTS.map((e) => `${e.id} (${e.label})`).join(', ');
  const reply = await astra({
    label: `critique ${age} r${round}`,
    effort: 'high',
    system: `You are the art director of AI DUDES reviewing renders of the design board. ${WORLD}\n${RUBRIC}\nAnswer only JSON: ${CRITIQUE_SHAPE}`,
    user: [
      { type: 'text', text: `Age: ${ageStyle(AGE_IDS.indexOf(age)).name}. Bible: ${JSON.stringify(readJson(bibleFile(age)))}\nSami's notes: ${SAMI_NOTES.join(' ')}\nThe first image is the age's sheet (one labelled cell per piece: ${ids}); the second is a street-corner scene of the same age put together from the pieces. Review every piece.` },
      png(sheet),
      ...(existsSync(vignette) ? [png(vignette)] : []),
    ],
  });
  writeJson(path.join(dir, `critique-${age}.json`), reply);
  const r = reply as { verdict?: string; score?: number; elements?: { ok: boolean }[] };
  console.log(`critique ${age} r${round}: ${r.verdict} ${r.score}/10, ${(r.elements ?? []).filter((x) => !x.ok).length} to revise`);
}

async function critiqueBoards(round: number | string): Promise<void> {
  const dir = roundDir(round);
  const files = ['board-fabric.png', 'board-life.png', 'board-vignettes.png'].map((f) => path.join(dir, f)).filter(existsSync);
  const reply = await astra({
    label: `critique boards r${round}`,
    effort: 'high',
    system: `You are the art director of AI DUDES reviewing the whole design board: the ages in rows. ${WORLD}\nJudge the progression: each age unmistakable and different from its neighbours; the same piece recognisably the same role down a column; nothing from the wrong age; Sami's notes met. Answer only JSON: {"verdict":"pass"|"revise","score":1-10,"summary":"…","ages":[{"id":"stone…","problems":["…"]}],"columns":[{"id":"element id","problems":["…"]}],"bibleChanges":[{"id":"age id","changes":["…"]}]}`,
    user: [{ type: 'text', text: `Sami's notes: ${SAMI_NOTES.join(' ')}\nBoards: the world's fabric (ages in rows, pieces in columns), people and example builds, and a street corner per age.` }, ...files.map(png)],
  });
  writeJson(path.join(dir, 'critique-boards.json'), reply);
  console.log(`critique boards r${round}: ${(reply as { verdict?: string }).verdict} ${(reply as { score?: number }).score}/10`);
}

// ---- revise ----------------------------------------------------------------------------------------
/** The round's merged notes for an age: notes-<age>.json {elements:[{id, problems[], fix}]} (astra's critique, Claude's checks, the auto checks), or the critique alone. */
function notesFor(age: AgeId, round: number | string): { id: string; problems: string[]; fix?: string }[] {
  const dir = roundDir(round);
  const merged = readJson<{ elements: { id: string; problems: string[]; fix?: string }[] }>(path.join(dir, `notes-${age}.json`));
  if (merged) return merged.elements;
  const c = readJson<{ elements?: { id: string; ok: boolean; problems: string[]; fix?: string }[] }>(path.join(dir, `critique-${age}.json`));
  return (c?.elements ?? []).filter((x) => !x.ok);
}

async function revise(age: AgeId, round: number | string, only: string[]): Promise<void> {
  const notes = notesFor(age, round).filter((n) => !only.length || only.includes(n.id));
  await pool(notes, async (n) => {
    const e = elementById(n.id);
    if (!e) return;
    const current = readJson<ElementSpec>(elementFile(age, e.id));
    const cell = path.join(roundDir(round), 'cells', `${age}-${e.id}.png`);
    const brief = e.build
      ? `This is an example build made through the game's design prompt for "${e.build.request}"; it should look like what a chatter gets in this age. Bible: ${JSON.stringify(readJson(bibleFile(age)))}\n${ENGINE_RULES}`
      : elementBrief(e, age);
    const reply = (await astra({
      label: `revise ${age}/${e.id} r${round}`,
      system: elementSystem(),
      user: [
        { type: 'text', text: `${brief}\n\nThe current design: ${JSON.stringify(current)}\n\nThe image is how it renders now. Review notes to fix:\n- ${n.problems.join('\n- ')}${n.fix ? `\nFix: ${n.fix}` : ''}\n\nReturn the complete redesigned piece.` },
        ...(existsSync(cell) ? [png(cell)] : []),
      ],
    })) as ElementSpec;
    const issues = checkSpec(reply, e);
    writeJson(elementFile(age, e.id), { ...reply, ...(issues.length ? { checks: issues } : {}) });
    console.log(`revised ${age}/${e.id}: ${reply.name} (${reply.parts.length} parts)${issues.length ? ` [${issues.join('; ')}]` : ''}`);
  });
}

async function reviseBibles(round: number | string): Promise<void> {
  const dir = roundDir(round);
  const changes = AGE_IDS.map((a) => ({ a, c: readJson<{ bible?: { changes?: string[] } }>(path.join(dir, `critique-${a}.json`))?.bible?.changes ?? [] }));
  const boards = readJson<{ bibleChanges?: { id: string; changes: string[] }[] }>(path.join(dir, 'critique-boards.json'));
  const extra = readJson<{ ages: { id: string; changes: string[] }[] }>(path.join(dir, 'bible-notes.json'));
  const all = AGE_IDS.map((a) => ({ id: a, changes: [...(changes.find((x) => x.a === a)?.c ?? []), ...(boards?.bibleChanges?.find((x) => x.id === a)?.changes ?? []), ...(extra?.ages.find((x) => x.id === a)?.changes ?? [])] })).filter((x) => x.changes.length);
  if (!all.length) return void console.log('no bible changes');
  const reply = (await astra({
    label: `revise bibles r${round}`,
    effort: 'high',
    system: `You are the art director of AI DUDES. ${WORLD}\nApply review notes to the age bibles, keeping the six ages one coherent progression. Answer only JSON: {"ages":[the complete updated bibles, only for the ages that changed]}.`,
    user: `Bibles: ${JSON.stringify(AGE_IDS.map((a) => readJson(bibleFile(a))))}\n\nNotes:\n${all.map((x) => `${x.id}: ${x.changes.join(' | ')}`).join('\n')}\n\nSami's notes: ${SAMI_NOTES.join(' ')}\nEach bible exactly ${BIBLE_SHAPE}`,
    maxTokens: 40_000,
  })) as { ages?: { id: AgeId }[] };
  for (const b of reply.ages ?? []) if (AGE_IDS.includes(b.id)) writeJson(bibleFile(b.id), b);
  console.log(`bibles revised: ${(reply.ages ?? []).map((b) => b.id).join(', ')}`);
}

// ---- outfits: garment kits for the game's rigged figures ----------------------------------------
export const RIG = `The game's figure (one standard person, metres). It faces +z; its own left is +x; ground is y 0. It is built on bones, and every garment part you design is given in ONE bone's local frame:
- "hips": origin at the hip joint, 0.80 m above the ground, on the centre line. Base parts here: torso box centre [0,0.30,0] size [0.44,0.60,0.26] (the shirt colour); waistband box [0,0.02,0] size [0.42,0.12,0.25] (the trousers colour). Shoulders are at y 0.55, the neck at y 0.62.
- "head": origin at the neck (1.42 m above the ground). Base: head box centre [0,0.16,0] size [0.30,0.32,0.28] (skin), eyes on its +z face at y 0.18, hair box at the back [0,0.22,-0.13] size [0.32,0.20,0.06]. The top of the head is y 0.32; the face is z +0.14.
- "armL" / "armR": origin at the shoulder (x +0.295 / −0.295 in the hips frame), the arm hangs straight down −y. Base in either arm's own frame: sleeve box [0,−0.18,0] size [0.13,0.40,0.15], hand box [0,−0.46,0] size [0.12,0.12,0.13]. Something held in the hand hangs from about [0,−0.5,0.05].
- "legL" / "legR": origin at the hip (x ±0.11), the leg hangs down −y to the ground at y −0.80. Base: leg box [0,−0.355,0] size [0.17,0.73,0.19], shoe box [0,−0.755,0.04] size [0.19,0.09,0.27].
- "cape": origin behind the shoulders ([0,0.55,−0.14] in the hips frame), hangs down −y: a cape is a box about [0,−0.36,−0.01] size [0.42,0.75,0.03].
Garments are boxes a little larger than what they cover (a tunic over the torso ≈ size [0.48,0.66,0.30] at [0,0.30,0]; a skirt or kilt on the hips ≈ [0.48,0.34,0.30] at [0,−0.1,0]; boots on each leg ≈ [0.21,0.3,0.24] at [0,−0.66,0.02]). Keep garments within about 0.12 m of the body, except capes, cloaks, headdresses, staffs and held things. Arms and legs swing when walking: a part on a limb moves with that limb, so never span two bones with one part.
Each part is {"bone":"hips|head|armL|armR|legL|legR|cape","shape":"box|cylinder|sphere|cone","position":[x,y,z],"size":[w,h,d],"rotation":[x,y,z radians],"colour": a role or "#rrggbb"}. Colour roles take the wearer's own colours (already shifted into the age's palette), so everyone looks personal: "shirt", "pants", "hat", "accent", "skin", "hair", each with ":dark" or ":light" for a shade (e.g. "shirt:dark" for a belt). Use roles for the main garments and fixed colours only for materials that never vary (bone, bronze, iron, gold, glowing trim).
"hide" can set base pieces aside: "shoes" (bare feet), "sleeves" (bare arms), "trousers" (bare legs), "hair", "hat" (the person's own hat goes; use when the kit has its own headgear), "accessory".`;

const OUTFITS_SHAPE = `{"kits":[four kits, each {"name":"…","hide":[…],"parts":[…]}], "head":{"name":"…","hide":[…],"parts":[…]}, "leader":{"name":"…","hide":[…],"parts":[…]}}`;

function outfitsBrief(age: AgeId): string {
  const bible = readJson<{ rules?: Record<string, string>; palette?: string[]; materials?: string[]; avoid?: string[] }>(bibleFile(age));
  const people = ['resident', 'head', 'leader'].map((id) => readJson<ElementSpec>(elementFile(age, id))).filter(Boolean);
  return `Age: ${ageStyle(AGE_IDS.indexOf(age)).name}. The town's head is the ${ageStyle(AGE_IDS.indexOf(age)).head.title}.
World rules for people: ${bible?.rules?.people ?? ''} The head: ${bible?.rules?.head ?? ''} The caravan: ${bible?.rules?.camp ?? ''}
Palette: ${JSON.stringify(bible?.palette ?? [])}. Materials: ${JSON.stringify(bible?.materials ?? [])}. Never: ${JSON.stringify(bible?.avoid ?? [])}.
Earlier free-form figure designs for this age, for their ideas: ${people.map((p) => `${p!.name}: ${p!.description}`).join('; ')}

${RIG}

Design four everyday kits for townspeople and chatters (different silhouettes so a crowd varies: e.g. a worker, an elder, a hunter or trader, a young one), one kit for the town's head (instantly recognisable, grander, with its symbol of office), and one for the caravan's leader (says "from far away"). Each kit 8–30 parts (head and leader up to 45). Bold, chunky, readable from a stream camera above at 40°; people are small on screen, so silhouettes (headgear, capes, skirts, big collars, held staffs) matter more than detail. Sami's notes: ${SAMI_NOTES.join(' ')}`;
}

async function outfits(age: AgeId, round?: string): Promise<void> {
  const file = path.join(SPEC, age, 'outfits.json');
  const notes = round ? readJson<{ problems: string[]; fix?: string }>(path.join(OUT, `o${round}`, `notes-${age}.json`)) : undefined;
  const image = round ? path.join(OUT, `o${round}`, `outfits-${age}.png`) : '';
  const reply = await astra({
    label: `outfits ${age}${round ? ` r${round}` : ''}`,
    system: `You are the costume designer for AI DUDES. ${WORLD}\nYou design what people wear in one age, as garment parts on the game's rigged figure. Answer only JSON: ${OUTFITS_SHAPE}`,
    user: notes
      ? [
          { type: 'text', text: `${outfitsBrief(age)}\n\nThe current kits: ${JSON.stringify(readJson(file))}\n\nThe image shows them on real figures (in a row: the four kits on two different people each, then the head, then the leader). Review notes to fix:\n- ${notes.problems.join('\n- ')}${notes.fix ? `\nFix: ${notes.fix}` : ''}\n\nReturn all the kits, redesigned where the notes say.` },
          ...(existsSync(image) ? [png(image)] : []),
        ]
      : outfitsBrief(age),
  });
  writeJson(file, reply);
  const r = reply as { kits?: unknown[] };
  console.log(`outfits ${age}: ${r.kits?.length ?? 0} kits${round ? ` (revised from o${round})` : ''}`);
}

async function critiqueOutfits(age: AgeId, round: string): Promise<void> {
  const image = path.join(OUT, `o${round}`, `outfits-${age}.png`);
  if (!existsSync(image)) throw new Error(`render outfits round ${round} first`);
  const reply = await astra({
    label: `critique outfits ${age} o${round}`,
    effort: 'high',
    system: `You are the art director of AI DUDES reviewing costume renders. ${WORLD}\nJudge: unmistakably this age (no anachronism; never today's clothes recoloured), readable at stream scale from above (silhouette, contrast), the four everyday kits clearly different from each other, the head grand and recognisable with a symbol of office, the leader clearly from far away, garments fitting the body (nothing floating, sunk, clipping badly or spanning limbs). Answer only JSON: {"verdict":"pass"|"revise","score":1-10,"summary":"…","problems":["…"],"fix":"concrete instructions per kit"}`,
    user: [{ type: 'text', text: `Age: ${ageStyle(AGE_IDS.indexOf(age)).name}. The kits: ${JSON.stringify(readJson(path.join(SPEC, age, 'outfits.json')))}\nThe image: the four everyday kits on two different people each, then the head, then the caravan leader.` }, png(image)],
  });
  writeJson(path.join(OUT, `o${round}`, `critique-${age}.json`), reply);
  console.log(`critique outfits ${age} o${round}: ${(reply as { verdict?: string }).verdict} ${(reply as { score?: number }).score}/10`);
}

// ---- main ------------------------------------------------------------------------------------------
const [cmd, a1, a2, ...rest] = process.argv.slice(2);
const pick = (list: string[] | undefined, board?: (e: Element) => boolean) => ELEMENTS.filter((e) => (board ? board(e) : true) && (!list?.length || list.includes(e.id)));
async function main(): Promise<void> {
  switch (cmd) {
    case 'bibles':
      return bibles();
    case 'bible':
      return bible(a1 as AgeId, [a2, ...rest].join(' '));
    case 'elements': {
      const ids = [a2, ...rest].filter(Boolean);
      const jobs = ages(a1).flatMap((age) => pick(ids, (e) => !e.build).map((e) => ({ age, e })));
      return pool(jobs, (j) => element(j.age, j.e));
    }
    case 'builds': {
      const ids = [a2, ...rest].filter(Boolean);
      const jobs = ages(a1).flatMap((age) => pick(ids, (e) => !!e.build).map((e) => ({ age, e })));
      return pool(jobs, (j) => build(j.age, j.e));
    }
    case 'critique':
      return pool(ages(a1), (age) => critique(age, a2));
    case 'critique-boards':
      return critiqueBoards(a1);
    case 'revise':
      return pool(ages(a1), (age) => revise(age, a2, rest));
    case 'revise-bibles':
      return reviseBibles(a1);
    case 'outfits':
      return pool(ages(a1), (age) => outfits(age, a2));
    case 'critique-outfits':
      return pool(ages(a1), (age) => critiqueOutfits(age, a2));
    case 'spend':
      return void console.log(`$${spent().toFixed(2)} of $${BUDGET}`);
    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(4, 14).join('\n'));
  }
}
main().then(
  () => console.log(`spend so far: $${spent().toFixed(2)}`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
