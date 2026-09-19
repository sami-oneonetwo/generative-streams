// OBS browser source. Stateless: draws the last full snapshot on every frame,
// interpolating walk segments and cosmetic animation client-side.

import type { ServerMsg } from '../../src/shared/protocol';
import type { Scene, SceneProtagonist } from '../../src/shared/sceneTypes';
import { drawEntity } from './draw/registry';
// All worlds' draw modules register into the shared kind->fn registry; entity
// kinds don't collide across worlds, so importing both is safe and automatic.
import './draw/serverRoom';
import { drawRoomProtagonist } from './draw/serverRoomProtagonist';
import './draw/noodleShop';
import { drawHud } from './hud';
import { drawChatMonitorText } from './chatMonitor';
import { drawInfoMonitorText } from './infoMonitor';
import { drawWhiteboardText } from './whiteboard';
import { TERMINAL_FONT } from './terminalFont';
import { ChatGlance } from './chatGlance';
import { SceneChaos, type FrameEffects } from './chaos';
import { MessagePulses, chatReceipts, drawMessageCables, drawMessagePulses } from './messagePulses';
import { drawTrafficReadout } from './trafficReadout';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

interface Snapshot {
  scene: Scene;
  serverTime: number;
  atPerf: number;
}

let latest: Snapshot | null = null;
let connected = false;
const chatGlance = new ChatGlance();
const sceneChaos = new SceneChaos();
const messagePulses = new MessagePulses();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function connect(): void {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => {
    connected = true;
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMsg;
    if (msg.t === 'state') {
      const atPerf = performance.now();
      const p = msg.scene.protagonist;
      if (latest?.scene.protagonist.art !== p.art) sceneChaos.reset();
      chatGlance.observe(msg.scene.chatRevision, p.art === 'server-room' && p.pose === 'console' && p.state !== 'walking', atPerf);
      messagePulses.observe(chatReceipts(msg.scene), msg.serverTime);
      latest = { scene: msg.scene, serverTime: msg.serverTime, atPerf };
    }
  };
  ws.onclose = () => {
    connected = false;
    chatGlance.reset();
    messagePulses.reset();
    setTimeout(connect, 1000);
  };
  ws.onerror = () => ws.close();
}

const canvas = document.getElementById('c') as HTMLCanvasElement;
const screen = canvas.getContext('2d')!;

// Pixel-art pipeline done the right way: the world is rendered NATIVELY at low
// resolution into a small buffer (world draws use full-scene coordinates via a
// scale transform), then scaled UP with no smoothing — so every art pixel is a
// clean PIX×PIX block, not a blurred downsample. The HUD and any legible text
// are drawn crisp on top, never pixelated. Bigger PIX = chunkier pixels.
const PIX = 4;
const pixCanvas = document.createElement('canvas');
const g = pixCanvas.getContext('2d')!; // world draws target this low-res buffer (scaled)

function sizeBuffers(worldWidth: number, height: number): void {
  const pw = Math.max(1, Math.round(worldWidth / PIX));
  const ph = Math.max(1, Math.round(height / PIX));
  if (pixCanvas.width !== pw || pixCanvas.height !== ph) {
    pixCanvas.width = pw;
    pixCanvas.height = ph;
  }
}

/** Begin a frame: clear the low-res buffer and map full-scene coords into it. */
function beginWorld(): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, pixCanvas.width, pixCanvas.height);
  g.imageSmoothingEnabled = false;
  g.setTransform(1 / PIX, 0, 0, 1 / PIX, 0, 0); // draw in full-scene units
}

function blitWorld(worldWidth: number, height: number): void {
  g.setTransform(1, 0, 0, 1, 0, 0);
  screen.imageSmoothingEnabled = false;
  screen.drawImage(pixCanvas, 0, 0, pixCanvas.width, pixCanvas.height, 0, 0, worldWidth, height);
}

function dimOnBackup(scene: Scene, foreground = false): void {
  if (!scene.power) return;
  g.save();
  // Tint only the pixels in this pass; foreground transparency must not dim
  // the battery-backed screen text beneath it a second time.
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = scene.power.mode === 'booting' || foreground ? 'rgba(5, 8, 18, 0.30)' : 'rgba(5, 8, 18, 0.53)';
  g.fillRect(0, 0, scene.worldWidth, scene.height);
  g.restore();
}

function protagonistX(p: SceneProtagonist, now: number): number {
  if (p.walk) {
    const t = Math.min(1, Math.max(0, (now - p.walk.startedAt) / p.walk.durationMs));
    return p.walk.fromX + (p.walk.toX - p.walk.fromX) * t;
  }
  return p.x;
}

function drawFigure(x: number, feetY: number, h: number, now: number, p: Scene['protagonist']): void {
  // A human-scaled silhouette built from proportion ratios of `h` (total
  // height): head ~1/6, torso ~2/5, legs the rest. Rim light on one edge
  // suggests the scene's key light; kept simple so it survives pixelation.
  const bob = p.state === 'walking' ? Math.sin(now / 64) * (h * 0.02) : 0;
  const top = feetY - h + bob;
  const headR = h * 0.09;
  const headCx = x;
  const headCy = top + headR;
  const shoulderY = headCy + headR + h * 0.03;
  const hipY = shoulderY + h * 0.4;
  const bodyW = h * 0.24;
  const tint = p.tint ?? '#2b333f';
  const rim = p.rim ?? '#3fd0e0';

  // legs
  g.fillStyle = '#171c22';
  const legW = bodyW * 0.38;
  if (p.state === 'walking') {
    const sw = Math.sin(now / 64) * (h * 0.06);
    g.fillRect(x - legW - 1 + sw, hipY, legW, feetY - hipY);
    g.fillRect(x + 1 - sw, hipY, legW, feetY - hipY);
  } else {
    g.fillRect(x - legW - 1, hipY, legW, feetY - hipY);
    g.fillRect(x + 1, hipY, legW, feetY - hipY);
  }
  // torso / jacket (slightly tapered)
  g.fillStyle = tint;
  g.beginPath();
  g.moveTo(x - bodyW / 2, shoulderY);
  g.lineTo(x + bodyW / 2, shoulderY);
  g.lineTo(x + bodyW / 2 - 2, hipY + 2);
  g.lineTo(x - bodyW / 2 + 2, hipY + 2);
  g.closePath();
  g.fill();
  // hood/shoulders
  g.fillStyle = tint;
  g.fillRect(x - bodyW / 2 - 2, shoulderY, bodyW + 4, h * 0.06);
  // head
  g.fillStyle = '#b98d63';
  g.beginPath();
  g.arc(headCx, headCy, headR, 0, Math.PI * 2);
  g.fill();
  // rim light down one side
  g.fillStyle = rim;
  g.globalAlpha = 0.55;
  g.fillRect(x + bodyW / 2 - 2, shoulderY, 2, hipY - shoulderY);
  g.globalAlpha = 0.8;
  g.beginPath();
  g.arc(headCx + headR - 1, headCy, 1.5, -Math.PI / 2, Math.PI / 2);
  g.fill();
  g.globalAlpha = 1;
}

// A hooded figure seen from behind at a workstation: chair back, hunched hood,
// a headset band with a live LED. Sold by the rim light from the screens.
function drawConsoleFigure(x: number, feetY: number, h: number, now: number, p: Scene['protagonist']): void {
  const vis = h * 0.86;
  const top = feetY - vis;
  const shoulderW = h * 0.42;
  const seatY = feetY - h * 0.16;
  const tint = p.tint ?? '#242c37';
  const rim = p.rim ?? '#39ff8a';

  // chair back behind the figure
  g.fillStyle = '#0b1116';
  g.fillRect(x - shoulderW / 2 - 8, top + h * 0.12, shoulderW + 16, seatY - (top + h * 0.12));
  g.fillStyle = '#121b22';
  g.fillRect(x - shoulderW / 2 - 4, top + h * 0.16, shoulderW + 8, seatY - (top + h * 0.16));

  // hunched hooded torso (trapezoid, wider at the shoulders)
  const shoulderY = top + h * 0.28;
  g.fillStyle = tint;
  g.beginPath();
  g.moveTo(x - shoulderW / 2, shoulderY);
  g.quadraticCurveTo(x, shoulderY - h * 0.06, x + shoulderW / 2, shoulderY);
  g.lineTo(x + shoulderW / 2 - 4, seatY);
  g.lineTo(x - shoulderW / 2 + 4, seatY);
  g.closePath();
  g.fill();

  // hood + head
  const headR = h * 0.11;
  const headCy = top + headR + h * 0.05;
  g.fillStyle = tint;
  g.beginPath();
  g.moveTo(x - headR - 4, shoulderY);
  g.quadraticCurveTo(x, headCy - headR * 1.7, x + headR + 4, shoulderY);
  g.closePath();
  g.fill();
  g.fillStyle = '#0d141a';
  g.beginPath();
  g.arc(x, headCy, headR, 0, Math.PI * 2);
  g.fill();

  // headset band + mic boom + LED
  g.strokeStyle = '#39424f';
  g.lineWidth = Math.max(2, h * 0.014);
  g.beginPath();
  g.arc(x, headCy, headR + 2, Math.PI * 0.9, Math.PI * 2.1);
  g.stroke();
  dot(x + headR + 2, headCy, Math.max(1.5, h * 0.014), CABLE);
  // little antenna
  g.strokeStyle = '#2a3038';
  g.beginPath();
  g.moveTo(x - headR * 0.4, headCy - headR);
  g.lineTo(x - headR * 0.6, headCy - headR - h * 0.06);
  g.stroke();

  // rim light down the right side of the hood + shoulder
  g.save();
  g.globalAlpha = 0.6;
  g.strokeStyle = rim;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x + headR * 0.8, headCy - headR * 0.7);
  g.quadraticCurveTo(x + headR + 3, shoulderY, x + shoulderW / 2 - 4, seatY);
  g.stroke();
  g.restore();
}

const CABLE = '#e02323';
// crisp two-tone dot (bright core + faint halo ring), no blur
function dot(x: number, y: number, r: number, color: string): void {
  g.globalAlpha = 0.35;
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r + 1.5, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function drawProtagonist(scene: Scene, now: number, effects: FrameEffects): void {
  const p = scene.protagonist;
  const x = protagonistX(p, now);
  const y = p.y;
  const h = p.heightPx ?? 120;
  const seated = p.pose === 'console' && p.state !== 'walking';

  if (p.art === 'server-room') {
    drawRoomProtagonist(g, p, x, now, chatGlance.amount(performance.now()), reducedMotion.matches ? 0 : now, effects.mess);
    return;
  }

  // faint reflection on a wet floor
  if (p.reflect) {
    g.save();
    g.globalAlpha = 0.14;
    g.translate(0, y * 2);
    g.scale(1, -1);
    if (seated) drawConsoleFigure(x, y, h * 0.92, now, p);
    else drawFigure(x, y, h * 0.92, now, p);
    g.restore();
  }

  if (seated) drawConsoleFigure(x, y, h, now, p);
  else drawFigure(x, y, h, now, p);
}

// Name tag + working indicator, drawn crisp on the screen layer (world coords
// map 1:1 to the screen over the world area) so the text never pixelates.
function drawProtagonistLabel(ctx: CanvasRenderingContext2D, scene: Scene, now: number): void {
  const p = scene.protagonist;
  const x = protagonistX(p, now);
  const y = p.y;
  const h = p.heightPx ?? 120;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#aeb8c6';
  ctx.font = `bold 15px ${MONO}`;
  ctx.fillText(p.name, x, y - h - 12);
  if (p.state === 'working') {
    const dots = 1 + (Math.floor(now / 260) % 3);
    ctx.fillStyle = '#ffd25e';
    ctx.font = `bold 20px ${MONO}`;
    ctx.fillText('•'.repeat(dots), x, y - h - 30);
  }
  ctx.textAlign = 'left';
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawSpeech(ctx: CanvasRenderingContext2D, scene: Scene, now: number): void {
  const speech = scene.speech;
  if (!speech || speech.until <= now) return;
  const p = scene.protagonist;
  const x = protagonistX(p, now);
  const h = p.heightPx ?? 120;
  const lines = wrapText(speech.text, 40);
  ctx.font = `16px ${MONO}`;
  const lineH = 22;
  const w = Math.min(460, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 28);
  const bh = lines.length * lineH + 18;
  let bx = x - w / 2;
  bx = Math.max(12, Math.min(scene.worldWidth - w - 12, bx));
  const by = p.y - h - 44 - bh;

  ctx.fillStyle = 'rgba(14, 19, 26, 0.95)';
  ctx.strokeStyle = '#4a5568';
  ctx.lineWidth = 1.5;
  roundRect(ctx, bx, by, w, bh, 8);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 7, by + bh);
  ctx.lineTo(x + 7, by + bh);
  ctx.lineTo(x, by + bh + 10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#e8edf5';
  lines.forEach((line, i) => ctx.fillText(line, bx + 14, by + 24 + i * lineH));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function draw(): void {
  requestAnimationFrame(draw);
  screen.imageSmoothingEnabled = false;
  screen.clearRect(0, 0, canvas.width, canvas.height);

  if (!latest) {
    screen.fillStyle = '#0b0f14';
    screen.fillRect(0, 0, canvas.width, canvas.height);
    screen.fillStyle = '#5a6472';
    screen.font = `20px ${MONO}`;
    screen.textAlign = 'center';
    screen.fillText('connecting…', canvas.width / 2, canvas.height / 2);
    screen.textAlign = 'left';
    return;
  }

  const { scene } = latest;
  const now = latest.serverTime + (performance.now() - latest.atPerf);
  sizeBuffers(scene.worldWidth, scene.height);

  // --- render the world natively at low resolution (crisp pixels) ---
  beginWorld();
  g.fillStyle = scene.bg;
  g.fillRect(0, 0, scene.worldWidth, scene.height);

  const back = scene.entities.filter((e) => (e.props as { layer?: string } | undefined)?.layer !== 'fore');
  const fore = scene.entities.filter((e) => (e.props as { layer?: string } | undefined)?.layer === 'fore');

  if (!back.some((e) => e.kind === 'sky' || e.kind === 'techWall' || e.kind === 'apartmentShell')) {
    g.strokeStyle = '#242b36';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, scene.protagonist.y + 1);
    g.lineTo(scene.worldWidth, scene.protagonist.y + 1);
    g.stroke();
  }

  const effectsNow = reducedMotion.matches ? (scene.power?.since ?? 0) : now;
  const effects = sceneChaos.frame(scene.chaos ?? 0, performance.now(), connected && !reducedMotion.matches);
  for (const e of back) drawEntity(g, e,
    scene.power && (e.kind === 'serverSmoke' || e.kind === 'chatMonitor') ? effectsNow : now, effects);
  drawMessageCables(g, scene);
  if (connected && !reducedMotion.matches && !scene.power) drawMessagePulses(g, scene, messagePulses.visible(now), now);
  dimOnBackup(scene);
  blitWorld(scene.worldWidth, scene.height);
  const displayNow = connected ? now : latest.serverTime;
  for (const e of back) {
    if (e.kind === 'chatMonitor') drawChatMonitorText(screen, e, reducedMotion.matches && scene.power ? effectsNow : displayNow);
    if (e.kind === 'trafficReadout') drawTrafficReadout(screen, e);
    if (e.kind === 'whiteboard') drawWhiteboardText(screen, e);
    else if (e.screen) drawInfoMonitorText(screen, e, displayNow, connected && !reducedMotion.matches);
  }

  // Composite a transparent foreground pass over background screens, including
  // their crisp text. The protagonist and furniture can occlude a TV without text bleeding through.
  beginWorld();
  drawProtagonist(scene, now, effects);
  for (const e of fore) drawEntity(g, e, now, effects);
  dimOnBackup(scene, true);
  blitWorld(scene.worldWidth, scene.height);
  for (const e of fore) {
    if (e.kind === 'chatMonitor') drawChatMonitorText(screen, e, reducedMotion.matches && scene.power ? effectsNow : displayNow);
    if (e.kind === 'trafficReadout') drawTrafficReadout(screen, e);
    if (e.kind === 'whiteboard') drawWhiteboardText(screen, e);
    else if (e.screen) drawInfoMonitorText(screen, e, displayNow, connected && !reducedMotion.matches);
  }
  drawSpeech(screen, scene, now);
  if (scene.worldWidth < scene.width) {
    drawProtagonistLabel(screen, scene, now);
    drawHud(screen, scene.hud, scene.worldWidth, scene.width - scene.worldWidth, scene.height);
  }

  if (!connected) {
    screen.fillStyle = '#ff4d4f';
    screen.font = `bold 14px ${MONO}`;
    screen.fillText('● reconnecting', 16, 26);
  }
}
// Canvas font metrics must be stable before caching any chat layout.
Promise.all([document.fonts.load(`20px ${TERMINAL_FONT}`), document.fonts.load(`bold 20px ${TERMINAL_FONT}`)])
  .catch(() => undefined)
  .then(() => { connect(); draw(); });
