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
//   npx tsx design/astra.ts critique-image <png…> [--brief "what it is"] [--age <age>] [--effort low|medium|high] [--hud 1]
//                                                          the critique on any image: critique-<name>.json beside it
//                                                          (--hud 1: a HUD mock, judged on story.ts's HUD_RUBRIC)
// Finders Keepers (design/story.ts; --notes "…" [--image <png>] revises what is there instead of starting over):
//   npx tsx design/astra.ts folly <age> [1 2 3]            the head's Folly, three takes: spec/folly/<age>.json
//   npx tsx design/astra.ts folly <age> pick <n>           make take n the one the game reads (no call)
//   npx tsx design/astra.ts cast <age> [roles…]            the band and the head on the shipped kits: spec/cast/<age>.json
//   npx tsx design/astra.ts pets [ids…|kits] [--age <age>] pets through the game's own prompt + the six age kits: spec/pets/
//   npx tsx design/astra.ts spend                          what the board has cost so far
//
// Env: DESIGN_MODEL (default openai/gpt-6-astra), DESIGN_BUDGET_USD (default 100), DESIGN_CONCURRENCY (6).
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { AGES, AGE_IDS, ageStyle, type AgeId } from '../src/shared/ages';
import { DESIGN_SYSTEM, designMessage } from '../src/worlds/ai-dudes/design';
import { validateDesign } from '../src/worlds/ai-dudes/blueprint';
import { BASE_FIGURE, ELEMENTS, ENGINE_RULES, SAMI_NOTES, WORLD, elementById, type Element } from './catalogue';
import { CAST, CAST_ROLES, FOLLIES, FOLLY_TAKES, HUD_RUBRIC, PET, PETS, PET_ANCHORS, PET_BRANCH, PET_KITS, PET_SPEC, STORY, STORY_TEXT, castIn, castLines, checkFolly, cleanParts, cleanPetKits, composeCast, kitNotes, petChecks, type CastLook, type CastRole, type FollySpec } from './story';
import { ACCESSORIES, HATS } from '../src/shared/dudesTypes';
import type { Blueprint } from '../src/shared/objectTypes';
import type { AgeOutfits } from '../src/shared/outfits';

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
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Checked before every attempt, so a retry never runs past the budget either.
    if (spent() >= BUDGET) throw new Error(`design budget spent ($${spent().toFixed(2)} of $${BUDGET}); raise DESIGN_BUDGET_USD to go on`);
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
      const json = JSON.parse(m[0]);
      console.log(`[${o.label}] $${(body.usage?.cost ?? 0).toFixed(3)}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
      return json;
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

// WORLD (what AI DUDES is and how the town is laid out) comes from the catalogue, built from src/shared/city.ts.

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
  if (spec.parts.length > 160) issues.push(`${spec.parts.length} parts (max 160)`);
  const { parts, fixed: bad } = cleanParts(spec.parts, 160);
  spec.parts = parts;
  let out = 0,
    sunk = 0;
  for (const p of spec.parts) {
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
const RUBRIC_POINTS = `Judge as a demanding art director, against: (1) age fidelity: is every piece unmistakably this age, never today's town recoloured (Sami's notes are hard requirements); (2) readability: does it read at stream distance from this camera, bold silhouette, clear colour contrast, right scale next to a 1.8 m person; (3) coherence: does every piece agree with the age's bible and each other; (4) craft: floating or sunk parts, ugly intersections, blobby or too-few parts, symmetry where nature would be irregular`;
const RUBRIC_SCORE = `Score each piece 1–10; anything under 8 is "ok":false with specific problems and a concrete fix. "verdict":"pass" only when every piece is 8 or more.`;
const RUBRIC = `${RUBRIC_POINTS}. ${RUBRIC_SCORE}`;

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

/** The design gate (board/design-system.md §9) as a fifth point, so the critique of any image covers it too. */
const GATE = `(5) the design gate: it still reads at phone size (390 px wide, and in greyscale); at most 4 main colours per piece; story red ${STORY.red} and story gold ${STORY.gold} only where they mean something; one funny detail`;
const IMAGE_SCORE = `Score every piece you can see 1–10, but list only the ones under 8 (at most 8, worst first). "verdict":"pass" only when every piece is 8 or more.`;
const IMAGE_CRITIQUE_SHAPE = `{"verdict":"pass"|"revise","score":1-10,"summary":"two sentences","problems":["at most 8, worst first, each specific enough to act on"],"elements":[{"id":"a short name for a piece under 8","score":1-10,"problems":["…"],"fix":"concrete instruction"}],"gate":{"phone":true|false,"colours":true|false,"storyColours":true|false,"funny":true|false}}`;
interface ImageCritique {
  brief?: string;
  age?: AgeId;
  effort?: CallOpts['effort'];
  /** A HUD mock: judged on the HUD rubric (story.ts) instead of the world one, without the map and Sami's world notes. */
  hud?: boolean;
}
/**
 * The critique on any image (a board render, an in-game shot, a HUD mock), written beside it as
 * critique-<name>.json. Cost is mostly the answer (about $53 per million tokens out, $13 in; a big
 * board is about 7k in), so it lists only the failing pieces, runs at medium effort and is capped at
 * 3,500 tokens out: at most about $0.28 a board (listing all 55 pieces of the people board ran
 * $0.37). --effort high when it matters more than the money.
 */
async function critiqueImage(file: string, o: ImageCritique): Promise<void> {
  if (!/\.png$/i.test(file) || !existsSync(file)) throw new Error(`no PNG at ${file}`);
  const reply = (await astra({
    label: `critique-image ${path.basename(file)}`,
    effort: o.effort ?? 'medium',
    maxTokens: 3500,
    system: o.hud
      ? `You are the art director of AI DUDES reviewing a HUD mock. ${STORY_TEXT}\n${HUD_RUBRIC}; ${GATE}. ${IMAGE_SCORE}\nAnswer only JSON: ${IMAGE_CRITIQUE_SHAPE}`
      : `You are the art director of AI DUDES reviewing a render. ${WORLD}\n${STORY_TEXT}\n${RUBRIC_POINTS}; ${GATE}. ${IMAGE_SCORE}\nAnswer only JSON: ${IMAGE_CRITIQUE_SHAPE}`,
    user: [
      { type: 'text', text: `${o.brief ? `The image: ${o.brief}\n` : ''}${o.age ? `Age: ${ageStyle(AGE_IDS.indexOf(o.age)).name}. Bible: ${JSON.stringify(readJson(bibleFile(o.age)))}\n` : ''}${o.hud ? '' : `Sami's notes: ${SAMI_NOTES.join(' ')}\n`}Review everything you can see.` },
      png(file),
    ],
  })) as { verdict?: string; score?: number; summary?: string; problems?: string[] };
  const out = path.join(path.dirname(file), `critique-${path.basename(file, path.extname(file))}.json`);
  writeJson(out, reply);
  console.log(`critique-image ${path.basename(file)}: ${reply.verdict} ${reply.score}/10 (${out})\n  ${reply.summary ?? ''}${(reply.problems ?? []).map((p) => `\n  - ${p}`).join('')}`);
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

// ---- Finders Keepers: the Follies, the cast, the pets (design/story.ts) ----------------------------
/** Revise what is there instead of starting over: the notes to fix and, if given, the render they came from. */
interface Revise {
  notes?: string;
  image?: string;
}
const reviseText = (r: Revise, current: unknown) => `\n\nThe current design: ${JSON.stringify(current)}\n\nReview notes to fix:\n${r.notes}\n\nReturn the complete redesign, keeping what the notes don't mention.`;
const reviseImage = (r: Revise) => (r.image && existsSync(r.image) ? [png(r.image)] : []);

// The Folly: three takes in one file; the game reads the picked one at the top (FK-023 places it).
type Take = (FollySpec & { take: string }) | null;
interface FollyFile extends FollySpec {
  age: AgeId;
  folly: string;
  pick: number;
  variants: Take[];
}
const follyFile = (age: AgeId) => path.join(SPEC, 'folly', `${age}.json`);
function writeFolly(age: AgeId, variants: Take[], pick: number): void {
  const at = variants[pick] ? pick : variants.findIndex(Boolean);
  if (at < 0) throw new Error(`no ${age} Folly takes to write`);
  const { take: _take, ...chosen } = variants[at]!;
  writeJson(follyFile(age), { age, folly: FOLLIES[age].name, pick: at, ...chosen, variants });
}
function follySystem(): string {
  return `You are the set designer for AI DUDES. ${WORLD}\n${STORY_TEXT}\nYou design the head's Folly for one age as low-poly geometry: the comic centrepiece of that age's story, unveiled on stream to the whole town. ${ENGINE_RULES}\nHero parts also carry a "tag" from the list you are given, so the engine can find them (to frame a door, raise a deck, run a belt); only those parts get one.\nAnswer only JSON: {"name":"its name","description":"one sentence","notes":"how it shows the age and lands the joke, one sentence","parts":[…]}.`;
}
function follyBrief(age: AgeId, take: string): string {
  const f = FOLLIES[age],
    a = ageStyle(AGE_IDS.indexOf(age));
  return `Age: ${a.name}; the head is the ${a.head.title}. Its bible: ${JSON.stringify(readJson(bibleFile(age)))}

The Folly: ${f.name}. ${f.brief}
This take: ${take}
Room: every part inside |x| ≤ ${f.half} and |z| ≤ ${f.half}, at most ${f.height} m tall, standing on y 0, at most 160 parts. The front faces +Z: the stream camera looks down from the +X +Z side, so the entrance and every hero detail face +Z. A 1.8 m person stands beside it at the Unveiling: keep human-scale details at human scale.
Hero tags ("tag" on those parts; ${f.required.join(', ')} must each be on at least one part):
${Object.entries(f.tags)
  .map(([t, what]) => `- ${t}: ${what}`)
  .join('\n')}
Colours: story gold ${STORY.gold} only on parts tagged ${f.gold.join(' or ')}; ${f.red?.length ? `story red ${STORY.red} only on parts tagged ${f.red.join(' or ')}` : `no story red ${STORY.red} anywhere`}; everything else in the age's own palette, 4 main colours at most. One funny detail.

Sami's notes: ${SAMI_NOTES.join(' ')}`;
}
/** The age's Folly in its three takes (or just the takes named), at high effort; --notes revises a take. */
async function folly(age: AgeId, takes: number[], r: Revise): Promise<void> {
  const was = readJson<FollyFile>(follyFile(age));
  const variants: Take[] = FOLLY_TAKES.map((_, i) => was?.variants?.[i] ?? null);
  await pool(takes.length ? takes : FOLLY_TAKES.map((_, i) => i + 1), async (n) => {
    const take = FOLLY_TAKES[n - 1];
    if (!take) throw new Error(`no take ${n} (1–${FOLLY_TAKES.length})`);
    const current = r.notes ? variants[n - 1] : null;
    const brief = follyBrief(age, take);
    const reply = await astra({
      label: `folly ${age} ${n}${current ? ' revise' : ''}`,
      effort: 'high',
      maxTokens: 40_000,
      system: follySystem(),
      user: current ? [{ type: 'text', text: brief + reviseText(r, { name: current.name, description: current.description, parts: current.parts, checks: current.checks }) }, ...reviseImage(r)] : brief,
    });
    const spec = checkFolly(age, reply);
    variants[n - 1] = { take, ...spec };
    console.log(`folly ${age} ${n}: ${spec.name} (${spec.parts.length} parts; tags ${Object.keys(spec.heroes).join(', ') || 'none'})${spec.checks ? ` [${spec.checks.join('; ')}]` : ''}`);
  });
  writeFolly(age, variants, was?.pick ?? 0);
}
function pickFolly(age: AgeId, n: number): void {
  const was = readJson<FollyFile>(follyFile(age));
  if (!was?.variants?.[n - 1]) throw new Error(`no ${age} Folly take ${n}`);
  writeFolly(age, was.variants, n - 1);
  console.log(`folly ${age}: take ${n} (${was.variants[n - 1]!.name}) is the one the game reads`);
}

// The cast: the band and the head, pinned on the age's shipped kits, in fixed colours (FK-016 applies it).
const castFile = (age: AgeId) => path.join(SPEC, 'cast', `${age}.json`);
/** The age's kits as the game ships them (src/shared/ageOutfits.json, from design/export.mjs). */
const shippedKits = (age: AgeId) => readJson<Record<string, AgeOutfits>>(path.join(ROOT, '..', 'src', 'shared', 'ageOutfits.json'))?.[age];
const CAST_SHAPE = `{"cast":[{"role":"${CAST_ROLES.join('|')}","name":"their outfit's name","base":0|1|2|3|"head"|"leader" (the shipped kit to pin them on),"look":{"skin":"#rrggbb","hair":"#rrggbb","shirt":"#rrggbb","pants":"#rrggbb","hat":"${HATS.join('|')}","hatColor":"#rrggbb","accessory":"${ACCESSORIES.join('|')}","accessoryColor":"#rrggbb","build":0.85-1.2},"hide":[…],"parts":[their own garment parts],"prop":{"name":"…","parts":[…]} (only where asked),"notes":"what makes them readable, one sentence"}]}`;
function castBrief(age: AgeId, roles: CastRole[]): string {
  const a = ageStyle(AGE_IDS.indexOf(age));
  const bible = readJson<{ rules?: Record<string, string>; palette?: string[]; materials?: string[]; avoid?: string[] }>(bibleFile(age));
  const kits = shippedKits(age);
  return `Age: ${a.name}. The head is the ${a.head.title}.
World rules for people: ${bible?.rules?.people ?? ''} Palette: ${JSON.stringify(bible?.palette ?? [])}. Materials: ${JSON.stringify(bible?.materials ?? [])}. Never: ${JSON.stringify(bible?.avoid ?? [])}.

The age's shipped kits (the game draws these; pin each person on one with "base", and its role colours take that person's look; the head is always on "head"): ${JSON.stringify({ kits: kits?.kits?.map((k, base) => ({ base, ...k })), head: kits?.head, leader: kits?.leader })}
What each kit already wears and holds (a kit's parts stay on under a person's own and can't be taken off, so choose the pin with this in mind: a held thing stays in that hand, so whoever carries their own staff or mallet needs that hand free, and only the head keeps a pole; "head" is the head's alone):
${kits ? kitNotes(kits).map((n) => `- ${n}`).join('\n') : ''}

${RIG}

Their looks are fixed colours: the game never restyles them, so choose every colour on purpose, in the age's palette, except the locked ones: red ${STORY.red} (Wren, and Ash's wrist cord), gold ${STORY.gold} (the head's sash and Kit's badge), Moss ${CAST.moss.colour}, Oak ${CAST.oak.colour}, Kit ${CAST.kit.colour}, Ash ${CAST.ash.colour}. Nobody else wears red or gold. Each band member's locked colour is their biggest shape (the head's gold is his sash), and at most 4 main colours each (skin aside).
Give each person 3–20 garment parts of their own over the pinned kit ("hide" the base pieces they replace); their parts must sit outside the kit's parts they cover, or the kit shows through. Design them on the standard figure: the game sets their body and scales the whole person afterwards (the sizes below are already worked out for that). Silhouettes first: they must be told apart at phone size, in greyscale, from the stream camera 40° above: Ash the tallest and thinnest with his staff, Oak the broadest with his mallet, Kit small and blue, Moss low and seated under her shawl, Wren red on top, the Chief under his antlers with the gold sash. One funny detail on each.

The cast:
${castLines(age, roles)}

Sami's notes: ${SAMI_NOTES.join(' ')}`;
}
/** The age's cast (or just the roles named) in one call, so they are designed to stand apart; --notes revises them. */
async function cast(age: AgeId, only: CastRole[], r: Revise): Promise<void> {
  const roles = castIn(age).filter((x) => !only.length || only.includes(x));
  if (!roles.length) throw new Error(`nobody to dress in ${age} (the cast then: ${castIn(age).join(', ')})`);
  const kits = shippedKits(age);
  if (!kits) throw new Error(`no shipped ${age} kits in src/shared/ageOutfits.json`);
  const was = readJson<{ cast?: Partial<Record<CastRole, CastLook>> }>(castFile(age))?.cast ?? {};
  const current = r.notes
    ? roles.flatMap((x) => {
        const c = was[x];
        return c ? [{ role: x, name: c.outfit.name, base: c.base.split(':')[1], look: c.look, hide: c.outfit.hide, parts: c.outfit.parts.slice(c.outfit.parts.length - c.extras), prop: c.prop, checks: c.checks }] : [];
      })
    : [];
  const brief = castBrief(age, roles);
  const reply = (await astra({
    label: `cast ${age}${only.length ? ` ${roles.join(',')}` : ''}${current.length ? ' revise' : ''}`,
    effort: 'high',
    maxTokens: 40_000,
    system: `You are the costume designer for AI DUDES. ${WORLD}\n${STORY_TEXT}\nYou dress the story's cast for one age on the game's rigged figure: each person is pinned on one of the age's shipped kits and gets fixed colours and a few garment parts of their own that make them unmistakable. Answer only JSON: ${CAST_SHAPE}`,
    user: current.length ? [{ type: 'text', text: brief + reviseText(r, current) }, ...reviseImage(r)] : brief,
  })) as { cast?: { role?: string }[] };
  const next = { ...was };
  for (const role of roles) {
    const raw = (reply.cast ?? []).find((c) => c?.role === role);
    if (!raw) {
      console.warn(`cast ${age}: no ${role} in the reply`);
      continue;
    }
    const c = composeCast(age, role, raw, kits);
    next[role] = c;
    console.log(`cast ${age}/${role}: ${c.outfit.name} on ${c.base}, ${c.extras} parts of their own${c.prop ? `, ${c.prop.name}` : ''}${c.checks ? ` [${c.checks.join('; ')}]` : ''}`);
  }
  writeJson(castFile(age), { age, cast: Object.fromEntries(castIn(age).flatMap((x) => (next[x] ? [[x, next[x]]] : []))) });
}

// Pets: through the game's own design prompt, plus the age kits the page shows while a restyle waits (FK-027, FK-051).
const petFile = (age: AgeId, id: string) => path.join(SPEC, 'pets', age, `${id}.json`);
/** One pet the way a chatter's ask makes it: DESIGN_SYSTEM and designMessage with the age's shipped direction, plus the pet branch FK-070 will ship. */
async function pet(age: AgeId, p: (typeof PETS)[number], r: Revise): Promise<void> {
  const current = r.notes ? readJson<Blueprint>(petFile(age, p.id)) : undefined;
  const message = designMessage({
    dudeName: 'board',
    persona: '',
    request: current ? `${p.request}, as my pet. Change: ${r.notes}` : `${p.request}, as my pet`,
    kind: 'pet',
    age: ageStyle(AGE_IDS.indexOf(age)).design,
    ...(current ? { target: { name: current.name, description: current.description, parts: current.parts, ...(current.animations ? { animations: current.animations } : {}), ...(current.moves ? { moves: current.moves } : {}) } } : {}),
  });
  const raw = await astra({ label: `pet ${age}/${p.id}${current ? ' revise' : ''}`, system: `${DESIGN_SYSTEM}\n${PET_BRANCH}`, user: current ? [{ type: 'text', text: message }, ...reviseImage(r)] : message, effort: 'medium' });
  const d = validateDesign(raw, !!current);
  if (d.action === 'decline') throw new Error(`declined: ${d.reply}`);
  const checks = petChecks(d.blueprint);
  writeJson(petFile(age, p.id), { ...d.blueprint, request: p.request, ...(checks.length ? { checks } : {}) });
  console.log(`pet ${age}/${p.id}: ${d.blueprint.name} (${d.blueprint.parts.length} parts)${checks.length ? ` [${checks.join('; ')}]` : ''}`);
}
const PET_KIT_SHAPE = `{"kits":{${AGE_IDS.map((a) => `"${a}":{"name":"…","parts":[…]}`).join(',')}}}`;
/** The six age kits in one call, so they read as one set. */
async function petKits(r: Revise): Promise<void> {
  const file = path.join(SPEC, 'pets', 'kits.json');
  const current = r.notes ? readJson(file) : undefined;
  const brief = `Design the six age kits a pet wears while its own restyle is on the way: one small touch per age that says the age at a glance, the same on every pet: ${AGE_IDS.map((a) => `${a}: ${PET_KITS[a]}`).join('; ')}.
Pets are ${PET_SPEC}
Design each kit for a reference pet ${PET.reference} m tall (the game scales a kit by the pet's height over ${PET.reference}). Every part hangs from an anchor, "at": "neck" is the centre of the collar at the front of the neck, "face" is the middle of the face at eye level on the front of the head; positions are metres from that anchor, +z forward, +y up. The collar itself is the game's (in the owner's side colour): add only the age's touch. 1–8 parts per kit, each between 0.04 and 0.4 m, chunky enough to read from the stream camera; the age's own materials and colours; "glow": true on lights; no story red ${STORY.red} or gold ${STORY.gold}.
Each part is {"at":"${PET_ANCHORS.join('|')}","shape":"box|cylinder|sphere|cone","position":[x,y,z],"size":[w,h,d],"rotation":[x,y,z],"color":"#rrggbb","glow":true (lights only)}.`;
  const reply = await astra({
    label: `pet kits${current ? ' revise' : ''}`,
    system: `You are the prop designer for AI DUDES. ${WORLD}\nAnswer only JSON: ${PET_KIT_SHAPE}`,
    user: current ? [{ type: 'text', text: brief + reviseText(r, current) }, ...reviseImage(r)] : brief,
    effort: 'medium',
    maxTokens: 16_000,
  });
  const { kits, checks } = cleanPetKits(reply);
  writeJson(file, { reference: PET.reference, anchors: { neck: 'the centre of the collar, front of the neck', face: 'the middle of the face at eye level' }, kits, ...(checks.length ? { checks } : {}) });
  console.log(`pet kits: ${Object.entries(kits).map(([a, k]) => `${a} ${k!.name} (${k!.parts.length})`).join(', ')}${checks.length ? ` [${checks.join('; ')}]` : ''}`);
}
async function pets(age: AgeId, ids: string[], r: Revise): Promise<void> {
  const unknown = ids.filter((id) => id !== 'kits' && !PETS.some((p) => p.id === id));
  if (unknown.length) throw new Error(`no pet ${unknown.join(', ')} (${PETS.map((p) => p.id).join(', ')}, kits)`);
  const jobs = [...PETS.map((p) => p.id), 'kits'].filter((id) => !ids.length || ids.includes(id));
  await pool(jobs, (id) => (id === 'kits' ? petKits(r) : pet(age, PETS.find((p) => p.id === id)!, r)));
}

// ---- main ------------------------------------------------------------------------------------------
// Words in order, and "--name value" flags anywhere (--notes, --image, --brief, --age, --effort).
const args: string[] = [];
const flags: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) flags[a.slice(2)] = process.argv[++i] ?? '';
  else args.push(a);
}
const [cmd, a1, a2, ...rest] = args;
const one = (arg: string | undefined): AgeId => {
  if (!AGE_IDS.includes(arg as AgeId)) throw new Error(`which age? ${AGE_IDS.join(', ')}`);
  return arg as AgeId;
};
const revising: Revise = { ...(flags.notes ? { notes: flags.notes } : {}), ...(flags.image ? { image: path.resolve(flags.image) } : {}) };
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
    case 'critique-image': {
      const files = [a1, a2, ...rest].filter(Boolean);
      if (!files.length) throw new Error('critique-image <png…>');
      const effort = (['low', 'medium', 'high'] as const).find((e) => e === flags.effort);
      const age = flags.age ? one(flags.age) : undefined;
      return pool(files, (f) => critiqueImage(path.resolve(f), { brief: flags.brief, age, effort, hud: 'hud' in flags }));
    }
    case 'folly':
      return a2 === 'pick' ? pickFolly(one(a1), Number(rest[0])) : folly(one(a1), [a2, ...rest].filter(Boolean).map(Number), revising);
    case 'cast': {
      const roles = [a2, ...rest].filter(Boolean);
      const bad = roles.filter((x) => !CAST_ROLES.includes(x as CastRole));
      if (bad.length) throw new Error(`no cast role ${bad.join(', ')} (${CAST_ROLES.join(', ')})`);
      return cast(one(a1), roles as CastRole[], revising);
    }
    case 'pets':
      return pets(flags.age ? one(flags.age) : 'stone', [a1, a2, ...rest].filter(Boolean), revising);
    case 'spend':
      return void console.log(`$${spent().toFixed(2)} of $${BUDGET}`);
    default: {
      const head = readFileSync(new URL(import.meta.url), 'utf8').split('\n');
      console.log(head.slice(4, head.indexOf('//', 4)).join('\n'));
    }
  }
}
main().then(
  () => console.log(`spend so far: $${spent().toFixed(2)}`),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
