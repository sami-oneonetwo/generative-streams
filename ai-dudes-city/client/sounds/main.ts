// The sound board at /sounds (FK-159): every cue, every voice and a crowd, played by the stream's own
// client/dudes/audio.ts at the stream's levels, with a meter on the master and a phone speaker, so Sami
// can judge a sound by ear (agents can't hear). Its own AudioContext, started by a click as browsers
// need. It reads nothing from the server and writes nothing (Approve is FK-160), so it is harmless if
// someone else reaches it. The workings are in board.ts.
import { CUES, createAudio, type AudioHandles, type AudioLevels, type Bus, type Cue } from '../dudes/audio';
import { emoteNames } from '../../src/shared/emotes';
import {
  CLOCK_MS,
  CROWD_MAX,
  CROWD_SEED,
  DISTANCES,
  LISTEN,
  RATES,
  SNAPSHOT_MS,
  VOICES,
  WHAT,
  boardContext,
  createMeter,
  createOutput,
  crowd,
  crowdLines,
  cueGroups,
  cueLabel,
  isBed,
  placeAt,
  seedFrom,
  seeded,
  tickClock,
  type Distance,
  type Output,
  type Rate,
  type Talker,
  type Voice,
} from './board';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const pressed = (el: HTMLElement, on: boolean) => el.setAttribute('aria-pressed', String(on));
/** The pop-in every sticker gets (0.85 → 1.06 → 1 over 300 ms), each time it plays. */
const pop = (el: HTMLElement) => {
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
};
const el = (tag: string, cls: string, text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text });

/** The stream page's levels (main.ts's createAudio call, and /mayor's defaults on top of them). */
const STREAM: AudioLevels = { music: 0.5, sfx: 0.8, ambience: 0.6 };
/** Each talker's dot and each voice's pill: one colour per voice (seed % 9). */
const VOICE_COLOURS = ['#2F6FD0', '#4E8A3A', '#E8762B', '#8E5CC2', '#2AA198', '#D9487A', '#6E7680', '#9C6B3C', '#3FA7D6'];
const colourOf = (v: Voice | Talker) => ('low' in v && v.low ? 'var(--gold)' : VOICE_COLOURS[v.seed % 9]);

// --- the sound ---

let ctx: AudioContext | undefined;
let audio: AudioHandles | undefined;
let out: Output | undefined;
const meter = createMeter();
const levels: AudioLevels = { ...STREAM };
let tune = false,
  birds = false,
  where: Distance = 'near',
  bed: Cue | undefined;
// The buses a one-off cue opened for itself (none yet: every one-off is on the effects bus), until Hush
// or that bus's toggle goes off. A bed's bus is open while it holds. Either way only the level comes
// up: the clock doesn't tick, so a cue never brings the tune or the birds in (the hum is the ambience
// bus's own, so it comes with the fountain, as it is always under it on the stream).
const opened = new Set<Bus>();
// The throttles' clock (AudioOptions.now): the page's, moved on a minute at every click, so a click
// always plays (the stream rests a fanfare 4 s, a bray 6 s, a speaker 400 ms). The crowd never moves
// it: its talkers keep the stream's rests.
let skip = 0;
const fresh = () => {
  skip += 60_000;
  meter.mark();
};
/**
 * Whether the board may play: the town counts its context as always running (boardContext), so between
 * the browser suspending it and onstatechange hushing the board, a click or a line would wait on the
 * stopped clock and sound with the rest on waking.
 */
const playing = () => ctx?.state === 'running';

/** The levels to the town: the effects always up; the music and the ambience while something on them plays. */
function send() {
  const up = (bus: Bus, on: boolean) => on || opened.has(bus) || bed?.bus === bus;
  audio?.levels({ music: up('music', tune) ? levels.music : 0, sfx: levels.sfx, ambience: up('ambience', birds) ? levels.ambience : 0 });
}

// The buses glide from 1 to their levels in their first second: the board stays silent through it.
const SETTLE = 1.5;
let starting = false,
  settled = false,
  live = false;
/** Start sound: the context made (once) and woken by this click; the board is live once it runs and has settled. */
async function start() {
  if (starting) return;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return void ($('status').textContent = 'No Web Audio in this browser');
  starting = true;
  $('start').textContent = 'Starting…';
  if (!ctx) {
    const c = (ctx = new Ctx());
    out = createOutput(c);
    out.hold(SETTLE);
    audio = createAudio(true, { music: 0, sfx: levels.sfx, ambience: 0 }, { ctx: boardContext(c, out.input), now: () => performance.now() + skip });
    audio.listen(LISTEN.x, LISTEN.z, LISTEN.half);
    // The board is the town's clock (boardContext): the tune and the birds tick only while they are on.
    setInterval(() => tickClock(audio!, tune, birds), CLOCK_MS);
    requestAnimationFrame(frame);
    c.onstatechange = shown;
  }
  await ctx.resume().catch(() => {});
  if (ctx.state === 'running' && !settled) {
    $('status').textContent = 'Settling…';
    await new Promise((r) => setTimeout(r, SETTLE * 1000));
    settled = true;
  }
  starting = false;
  shown();
}
/**
 * The board as its context stands. The town counts it as always running (boardContext), so a context
 * the browser suspends or interrupts (autoplay rules, a lost output device) would stack every click
 * and line on a stopped clock, all to sound at once on waking: the board hushes and waits for Start.
 */
function shown() {
  if (starting || !ctx) return; // start() shows its own progress, then this
  const on = ctx.state === 'running' && settled;
  if (live && !on) hush();
  live = on;
  $('board').inert = !on;
  document.body.classList.toggle('on', on);
  $('status').textContent = on ? `Sound on · ${(ctx.sampleRate / 1000).toFixed(1)} kHz` : settled ? 'Paused by the browser' : 'Sound blocked · click again';
  $('start').textContent = on ? 'Hush' : 'Start sound';
}

/** Everything off: the tune, the birds, a bed, the crowd and any run of cues or voices. */
function hush() {
  run?.stop();
  stopCrowd();
  if (bed) audio?.beds(0, 0);
  bed = undefined;
  opened.clear();
  for (const t of document.querySelectorAll<HTMLElement>('#cues [aria-pressed=true]')) pressed(t, false);
  setTune(false);
  setBirds(false);
}

// --- the meter ---

const pct = (db: number) => `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
const num = (db: number) => (db > -90 ? db.toFixed(1).replace('-', '−') : '—');
function frame(ms: number) {
  if (out) {
    const r = meter.feed(out.sample(), ms / 1000);
    $('peak-bar').style.setProperty('--w', pct(r.peak));
    $('peak-hold').style.left = pct(r.held);
    $('rms-bar').style.setProperty('--w', pct(r.rms));
    $('peak-v').textContent = num(r.peak);
    $('rms-v').textContent = num(r.rms);
    $('play-v').textContent = r.playPeak > -90 ? `peak ${num(r.playPeak)} · RMS ${num(r.playRms)} dBFS` : '—';
    $('clip').classList.toggle('on', r.playPeak >= -0.1);
  }
  requestAnimationFrame(frame);
}

// --- runs: every cue, every voice ---

let run: { button: HTMLElement; stop(): void } | undefined;
/** Plays `items` one after another, `gap` ms apart; the button shows how far it has got, and stops it. */
function sequence<T>(button: HTMLElement, items: readonly T[], gap: number, play: (x: T) => void) {
  const was = run?.button;
  run?.stop();
  if (was === button) return;
  const label = button.textContent;
  let i = 0,
    timer = 0;
  const stop = () => {
    clearTimeout(timer);
    button.textContent = label;
    pressed(button, false);
    run = undefined;
  };
  const next = () => {
    if (i >= items.length) return stop();
    play(items[i++]);
    button.textContent = `Stop · ${i} of ${items.length}`;
    timer = window.setTimeout(next, gap);
  };
  run = { button, stop };
  pressed(button, true);
  next();
}

// --- cues ---

const tiles = new Map<string, HTMLElement>();
function playCue(c: Cue) {
  if (!audio || !playing()) return;
  fresh();
  const tile = tiles.get(c.name)!;
  pop(tile);
  if (!isBed(c)) {
    // Heard on its bus: a one-off on the music or the ambience bus opens it (see `opened`). A bus glides
    // up (levels(): a 0.3 s time constant), so the first cue there would start soft and should wait a
    // second for it; FK-126's whistle and bell are on the effects bus, so none needs to yet.
    if (c.bus === 'music' || c.bus === 'ambience') {
      opened.add(c.bus);
      send();
    }
    return c.play(audio, c.placed ? placeAt(where) : undefined);
  }
  // A bed holds until it is clicked again; one at a time, as each bed's play() sets the others to 0.
  // Its bus is open while it holds (the fountain's is the ambience), and closes behind it.
  const was = bed;
  if (was) pressed(tiles.get(was.name)!, false);
  bed = was === c ? undefined : c;
  if (bed) {
    c.play(audio);
    pressed(tile, true);
  } else audio.beds(0, 0);
  send();
}
for (const g of cueGroups(CUES)) {
  const h = el('h3', '', g.title);
  if (g.note) h.append(el('small', '', g.note));
  const grid = el('div', 'tiles');
  for (const c of g.cues) {
    const b = el('button', `tile${c.placed ? ' placed' : ''}`, cueLabel(c)) as HTMLButtonElement;
    b.type = 'button';
    b.style.setProperty('--bus', `var(--${c.bus})`);
    if (isBed(c)) pressed(b, false);
    b.title = `${c.name} · ${c.bus} bus${c.placed ? ' · placed' : ''}`;
    if (WHAT[c.name]) b.append(el('small', '', WHAT[c.name]));
    b.onclick = () => playCue(c);
    tiles.set(c.name, b);
    grid.append(b);
  }
  $('cues').append(h, grid);
}
const oneOffs = CUES.filter((c) => tiles.has(c.name) && !isBed(c));
$('cues-all').onclick = () => sequence($('cues-all'), oneOffs, 2000, playCue);

// --- speech ---

const line = () => emoteNames(($('line') as HTMLInputElement).value) || 'hello';
function say(seed: number, low: boolean, button?: HTMLElement) {
  if (!audio || !playing()) return;
  fresh();
  audio.speech(seed, line(), placeAt(where), low);
  if (button) pop(button);
}
const voicePills = VOICES.map((v) => {
  const b = el('button', `pill${v.low ? ' mayor' : ''}`) as HTMLButtonElement;
  b.type = 'button';
  const sw = el('span', 'sw');
  sw.style.setProperty('--c', colourOf(v));
  b.append(sw, v.low ? 'Mayor (low)' : `Voice ${v.label}`);
  b.title = v.low ? `the head's low voice (seed ${v.seed}, the Mayor's)` : `voice ${v.label}: every speaker whose seed % 9 is ${v.seed}`;
  b.onclick = () => say(v.seed, v.low, b);
  $('voices').append(b);
  return b;
});
$('voices-all').onclick = () => sequence($('voices-all'), VOICES.map((v, i) => [v, voicePills[i]] as const), 1500, ([v, b]) => say(v.seed, v.low, b));
function seedNote() {
  const s = seedFrom(($('seed') as HTMLInputElement).value);
  $('seed-is').textContent = s === undefined ? 'Type a seed (digits) or a speaker id.' : `Seed ${s} · voice ${(s % 9) + 1}${($('seed-low') as HTMLInputElement).checked ? ', low' : ''}`;
  return s;
}
$('seed').oninput = $('seed-low').onchange = () => void seedNote();
$('seed-play').onclick = () => {
  const s = seedNote();
  if (s !== undefined) say(s, ($('seed-low') as HTMLInputElement).checked, $('seed-play'));
};
seedNote();

// --- the crowd ---

let rate: Rate = 'busy';
let talking: { n: number; timer: number; dots: HTMLElement[]; heard: number; since: number } | undefined;
function stopCrowd() {
  if (!talking) return;
  clearInterval(talking.timer);
  for (const d of talking.dots) d.remove();
  talking = undefined;
  pressed($('crowd-6'), false);
  pressed($('crowd-15'), false);
  $('crowd-stat').textContent = 'Nobody talking.';
}
function startCrowd(n: number) {
  const was = talking?.n;
  stopCrowd();
  if (!audio || was === n) return;
  // The same seed each run: the same talkers in the same places, saying the same lines at the same moments.
  const rand = seeded(CROWD_SEED);
  const talkers = crowd(n, rand);
  const ring = $('ring');
  const scale = ring.clientHeight / 2 / 12;
  const dots = talkers.map((t) => {
    const d = el('span', 'who', t.name[0]);
    d.style.setProperty('--c', colourOf(t));
    d.style.left = `calc(50% + ${t.at.x * scale}px)`;
    d.style.top = `calc(50% + ${t.at.z * scale}px)`;
    d.title = `${t.name} (${t.id}, voice ${(t.seed % 9) + 1})`;
    ring.append(d);
    return d;
  });
  const c = { n, dots, heard: 0, since: performance.now(), timer: 0 };
  const last = new Map<string, string>();
  c.timer = window.setInterval(() => {
    if (!playing()) return;
    const every = RATES.find((r) => r.key === rate)!.every;
    for (const [t, text] of crowdLines(talkers, every, rand, last)) {
      audio!.speech(t.seed, emoteNames(text), t.at, false);
      const d = dots[talkers.indexOf(t)];
      d.classList.add('talk');
      setTimeout(() => d.classList.remove('talk'), 350);
      c.heard++;
      $('crowd-last').textContent = `${t.name}: “${emoteNames(text)}”`;
    }
    const secs = (performance.now() - c.since) / 1000;
    $('crowd-stat').textContent = `${c.heard} lines · ${(c.heard / Math.max(1, secs)).toFixed(1)} a second (expect ${+(n / every).toFixed(2)})`;
  }, SNAPSHOT_MS);
  talking = c;
  meter.mark();
  pressed($(`crowd-${n}`), true);
}
$('crowd-6').onclick = () => startCrowd(6);
$('crowd-15').onclick = () => startCrowd(CROWD_MAX);
for (const r of RATES) {
  const b = el('button', '', r.label) as HTMLButtonElement;
  b.type = 'button';
  b.append(el('small', '', `every ${r.every} s`));
  pressed(b, r.key === rate);
  b.onclick = () => {
    rate = r.key;
    for (const x of $('rates').children) pressed(x as HTMLElement, x === b);
    if (talking) Object.assign(talking, { heard: 0, since: performance.now() }); // the readout counts the new rate afresh
  };
  $('rates').append(b);
}

// --- music and levels ---

function setTune(on: boolean) {
  tune = on;
  if (!on) opened.delete('music');
  pressed($('tune'), on);
  send();
}
function setBirds(on: boolean) {
  birds = on;
  if (!on) opened.delete('ambience');
  pressed($('amb'), on);
  send();
}
$('tune').onclick = () => (fresh(), setTune(!tune));
$('amb').onclick = () => (fresh(), setBirds(!birds));
const sliders = (['music', 'sfx', 'ambience'] as const).map((k) => {
  const input = $(`lv-${k}`) as HTMLInputElement;
  const show = () => ($(`lv-${k}-v`).textContent = levels[k].toFixed(2));
  input.oninput = () => {
    levels[k] = Number(input.value);
    show();
    send();
  };
  return { k, input, show };
});
$('lv-stream').onclick = () => {
  Object.assign(levels, STREAM);
  for (const s of sliders) {
    s.input.value = String(levels[s.k]);
    s.show();
  }
  send();
};

// --- the output: the phone speaker, where things play, start and hush ---

$('phone').onclick = () => {
  const on = $('phone').getAttribute('aria-pressed') !== 'true';
  pressed($('phone'), on);
  $('phone').querySelector('em')!.textContent = on ? 'on' : 'off';
  out?.phone(on);
  meter.mark(); // Last play reads the sound as it is heard now
};
for (const d of DISTANCES) {
  const b = el('button', '', d.label) as HTMLButtonElement;
  b.type = 'button';
  b.append(el('small', '', d.note));
  pressed(b, d.key === where);
  b.onclick = () => {
    where = d.key;
    for (const x of $('where').children) pressed(x as HTMLElement, x === b);
  };
  $('where').append(b);
}
$('start').onclick = () => (live ? hush() : void start());
