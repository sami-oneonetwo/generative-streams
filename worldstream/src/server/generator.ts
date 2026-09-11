// When chat asks for something the world does not have, the model draws it as a
// text grid on this world's palette. The server checks every pixel, saves it
// beside the hand-drawn sprites, pushes it to the renderer, and places it.
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Atlas, AtlasSprite, PixelFrame } from '../shared/atlas.js';
import { normaliseName, type Catalogue, type SpriteDef } from '../shared/catalogue.js';
import type { Config } from '../shared/config.js';
import { VIEW, type Layer, type World } from '../shared/state.js';
import type { ChatUser, IncomingChat } from './ingest.js';
import { runCommand, type InterpreterContext } from './interpreter.js';
import { pick } from './drift.js';
import { log } from './log.js';

export type Completion = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

export interface GenRequest {
  query: string;
  description?: string;
  user: ChatUser;
  world: World;
  msg: IncomingChat;
}

export interface GeneratorDeps {
  cfg: Config;
  ctx: InterpreterContext;
  worlds: Map<World, Catalogue>;
  root: string;
  say: (text: string) => void;
  onSprite: (world: World, sprite: AtlasSprite) => void;
  onRemove?: (world: World, name: string) => void;
  complete?: Completion;
  now?: () => number;
}

export type GenVerdict = { ok: true; queued: number } | { ok: false; reason: string };

const SPRITE_TOOL: Anthropic.Beta.BetaTool = {
  name: 'sprite',
  description: 'The finished pixel sprite as rows of palette keys.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'short snake_case name, e.g. hot_dog_cart' },
      rows: { type: 'array', items: { type: 'string' }, description: 'One string per pixel row, top to bottom, every character a palette key; "." is transparent. All rows the same length.' },
      layer: { type: 'string', enum: ['stage', 'near', 'mid'], description: 'stage for things that stand on the ground, near for things on walls, mid for things in the air' },
      tags: { type: 'array', items: { type: 'string' } },
      aliases: { type: 'array', items: { type: 'string' }, description: 'other words a viewer might use for it' },
    },
    required: ['name', 'rows', 'layer', 'tags', 'aliases'],
    additionalProperties: false,
  },
};

/** Pad, bound and palette-check a drawn grid. Throws a readable reason when it fails. */
export function validateRows(rows: unknown, keys: Record<string, string>, maxW: number, maxH: number): PixelFrame {
  if (typeof rows === 'string') rows = rows.split(/\r?\n/);
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every((r) => typeof r === 'string')) throw new Error('no rows');
  const clean = (rows as string[]).map((r) => r.replace(/\s+$/, '')).filter((r, i, all) => !(r === '' && (i === 0 || i === all.length - 1)));
  const w = Math.max(...clean.map((r) => r.length));
  const h = clean.length;
  if (w < 3 || h < 3) throw new Error('too small');
  if (w > maxW || h > maxH) throw new Error(`too big (${w}x${h}, max ${maxW}x${maxH})`);
  let painted = 0;
  const padded = clean.map((r) => r.padEnd(w, '.'));
  for (const r of padded)
    for (const ch of r) {
      if (!(ch in keys)) throw new Error(`"${ch}" is not a palette key`);
      if (ch !== '.') painted++;
    }
  if (painted < 12) throw new Error('almost empty');
  return { w, h, rows: padded };
}

function dominantColour(frame: PixelFrame, keys: Record<string, string>): string {
  const counts = new Map<string, number>();
  for (const r of frame.rows) for (const ch of r) if (ch !== '.') counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? keys[top[0]] : '#ffffff';
}

export class Generator {
  private readonly queue: GenRequest[] = [];
  private busy = false;
  private readonly calls: number[] = [];
  private readonly lastByUser = new Map<string, number>();
  private readonly complete: Completion;
  private client: Anthropic | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: GeneratorDeps) {
    this.now = deps.now ?? Date.now;
    this.complete =
      deps.complete ??
      ((params) => {
        this.client ??= new Anthropic();
        return this.client.beta.messages.create(params);
      });
  }

  get enabled(): boolean {
    return this.deps.cfg.generate.enabled;
  }

  status(): Record<string, unknown> {
    const now = this.now();
    return { enabled: this.enabled, queued: this.queue.length, busy: this.busy, callsThisHour: this.calls.filter((t) => now - t < 3_600_000).length, budget: this.deps.cfg.generate.maxPerHour };
  }

  request(req: GenRequest): GenVerdict {
    const g = this.deps.cfg.generate;
    if (!g.enabled) return { ok: false, reason: 'I am not drawing anything new today' };
    const now = this.now();
    if (this.calls.filter((t) => now - t < 3_600_000).length >= g.maxPerHour) return { ok: false, reason: 'my hands are tired. no new things for a bit.' };
    const last = this.lastByUser.get(req.user.id) ?? 0;
    if (now - last < g.perUserCooldownMs) return { ok: false, reason: `${req.user.name}, one new thing every few minutes. give it ${Math.ceil((g.perUserCooldownMs - (now - last)) / 1000)}s` };
    if (this.queue.length >= 3 || this.queue.some((q) => q.user.id === req.user.id)) return { ok: false, reason: 'I have a few to draw already. hold that thought.' };
    const catalogue = this.deps.worlds.get(req.world);
    if (!catalogue || !('keys' in catalogue)) return { ok: false, reason: 'I cannot draw in this world yet' };
    this.lastByUser.set(req.user.id, now);
    this.queue.push(req);
    void this.drain();
    return { ok: true, queued: this.queue.length };
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    const req = this.queue.shift();
    if (!req) return;
    this.busy = true;
    try {
      await this.run(req);
    } catch (err) {
      log('generate', `failed for "${req.query}"`, String(err).slice(0, 200));
      this.deps.say(`I tried to make a ${req.query} and it fell apart. sorry, ${req.user.name}. another time.`);
    } finally {
      this.busy = false;
      if (this.queue.length) void this.drain();
    }
  }

  private examples(atlas: Atlas): string {
    const picks = atlas.sprites.filter((s) => s.frames && !s.generated && s.frames[0].w <= 24 && s.frames[0].h <= 24).slice(0, 3);
    return picks.map((s) => `${s.name} (${s.frames![0].w}x${s.frames![0].h}):\n${s.frames![0].rows.join('\n')}`).join('\n\n');
  }

  private async run(req: GenRequest): Promise<void> {
    const g = this.deps.cfg.generate;
    const atlas = this.deps.worlds.get(req.world) as Atlas;
    const legend = Object.entries(atlas.keys)
      .filter(([k]) => k !== '.')
      .map(([k, hex]) => `${k} = ${hex}`)
      .join(', ');
    const system = [
      `You draw pixel art for a ${VIEW.w}x${VIEW.h} pixel-art world called "${req.world}". Sprites are text grids: one string per row, every character a palette key, "." for transparent.`,
      `Palette keys for this world: ${legend}. Use only these keys. Never use "8", "9", "a", "d", "e", "h" or "t" as your main colours: they belong to the main character.`,
      `Rules: all rows the same width; at most ${g.maxWidth} wide and ${g.maxHeight} tall; small things 8 to 16 pixels, big things up to the limit; a readable silhouette first, then one or two highlight and shadow tones; a darker outline on the bottom and one side reads well at this scale; things that stand on the ground should have a flat base row. No text, no gradients, no dithering.`,
      'Match the style of these existing sprites from the same world:',
      this.examples(atlas),
    ].join('\n\n');
    const patience = setTimeout(() => this.deps.say(pick(['still drawing. detail takes a moment.', 'nearly there. pixels are fiddly.', 'give me a few more seconds on this one.'])!), 25_000);
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.complete({
      model: g.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: g.effort },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: [SPRITE_TOOL],
      messages: [{ role: 'user', content: `Draw: ${req.query}.${req.description ? ` ${req.description}.` : ''} A viewer named ${req.user.name} asked for it. Call the sprite tool once with the finished grid.` }],
      });
    } finally {
      clearTimeout(patience);
    }
    this.calls.push(this.now());
    if (res.stop_reason === 'refusal') throw new Error('declined');
    if (res.stop_reason === 'max_tokens') throw new Error(`ran out of room (${res.usage.output_tokens} output tokens)`);
    const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'sprite');
    if (!call) throw new Error('no sprite returned');
    const input = call.input as { name?: unknown; rows?: unknown; layer?: unknown; tags?: unknown; aliases?: unknown };
    const frame = validateRows(input.rows, atlas.keys, g.maxWidth, g.maxHeight);
    let name = normaliseName(typeof input.name === 'string' && input.name ? input.name : req.query) || 'thing';
    while (atlas.sprites.some((s) => s.name === name)) name = name.replace(/_\d+$/, '') + '_' + Math.floor(Math.random() * 900 + 100);
    const layer = (['stage', 'near', 'mid'] as Layer[]).includes(input.layer as Layer) ? (input.layer as Layer) : 'stage';
    const tags = Array.isArray(input.tags) ? (input.tags as unknown[]).filter((t): t is string => typeof t === 'string').map((t) => normaliseName(t)).filter(Boolean).slice(0, 8) : [];
    const aliases = Array.isArray(input.aliases) ? (input.aliases as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 8) : [];
    if (!aliases.map(normaliseName).includes(normaliseName(req.query))) aliases.unshift(req.query);

    const def: AtlasSprite = { name, layers: [layer], w: frame.w, h: frame.h, colour: dominantColour(frame, atlas.keys), tags: [...new Set([...tags, 'generated'])], aliases, generated: true, frames: [frame] };
    atlas.sprites.push(def);
    this.persist(req.world, def, frame);
    this.deps.onSprite(req.world, def);
    log('generate', `${req.user.name} asked for "${req.query}" -> ${name} ${frame.w}x${frame.h} on ${layer}`, { in: res.usage.input_tokens, out: res.usage.output_tokens });

    // Place it for the person who asked, cooldown-free: they waited.
    const asMod: IncomingChat = { ...req.msg, at: this.now(), user: { ...req.user, badges: [...req.user.badges, 'moderator'] } };
    const outcome = runCommand({ kind: 'add', sprite: name }, asMod, { ...this.deps.ctx, silent: true });
    const pretty = name.replace(/_/g, ' ');
    this.deps.say(outcome.applied ? `there. a ${pretty}. first one of those in the ${req.world}. that one is yours, ${req.user.name}.` : `I drew a ${pretty} for ${req.user.name}. it is in the catalogue now, ask for it any time.`);
  }

  private persist(world: World, def: AtlasSprite, frame: PixelFrame): void {
    const dir = join(this.deps.root, 'assets/worlds', world);
    mkdirSync(join(dir, 'generated'), { recursive: true });
    writeFileSync(join(dir, 'generated', `${def.name}.sprite`), `name: ${def.name}\nanchor: bottom\n---\n${frame.rows.join('\n')}\n`);
    const file = join(dir, 'generated.json');
    const list: SpriteDef[] = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SpriteDef[]) : [];
    const { frames: _f, ...plain } = def;
    list.push(plain);
    writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
  }

  /** Remove a generated sprite from the world, its files, and anything placed with it. */
  remove(world: World, name: string): boolean {
    const cat = this.deps.worlds.get(world);
    const idx = cat?.sprites.findIndex((s) => s.name === name && s.generated) ?? -1;
    if (!cat || idx < 0) return false;
    cat.sprites.splice(idx, 1);
    const dir = join(this.deps.root, 'assets/worlds', world);
    const f = join(dir, 'generated', `${name}.sprite`);
    if (existsSync(f)) unlinkSync(f);
    const file = join(dir, 'generated.json');
    if (existsSync(file)) {
      const list = (JSON.parse(readFileSync(file, 'utf8')) as SpriteDef[]).filter((s) => s.name !== name);
      writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
    }
    for (const e of this.deps.ctx.store.state.entities.filter((e) => e.sprite === name)) this.deps.ctx.store.dispatch({ type: 'remove_entity', id: e.id }, 'operator');
    this.deps.onRemove?.(world, name);
    log('generate', `removed ${name} from ${world}`);
    return true;
  }
}
