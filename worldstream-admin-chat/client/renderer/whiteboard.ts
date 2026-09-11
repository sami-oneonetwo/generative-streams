import type { SceneEntity } from '../../src/shared/sceneTypes';
import { fitScreenText, wrapScreenText } from './infoMonitor';
import { TERMINAL_FONT } from './terminalFont';

const MARKER = '"Comic Sans MS", "Chalkboard SE", cursive';
export const BOARD_PAPER = '#deddd0';
export const BOARD_INK = '#293b42';

export function whiteboardArea(e: SceneEntity) {
  return { x: e.x + 24, y: e.y + 20, w: e.w - 48, h: e.h - 40 };
}

/** Physical writing stays on the status page, never timed CRT pagination. */
export function whiteboardPage(e: SceneEntity) {
  return e.screen?.pages.find(page => page.id === 'emergency' || page.id === 'status') ?? e.screen?.pages[0];
}

export function drawWhiteboardText(ctx: CanvasRenderingContext2D, e: SceneEntity): void {
  const page = whiteboardPage(e);
  if (!page) return;
  const a = whiteboardArea(e);
  const dark = !!e.props?.dark;
  ctx.save();
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = dark ? '#161f28' : BOARD_INK;
  ctx.font = `bold 20px ${MARKER}`;
  ctx.fillText(fitScreenText(page.title, a.w, t => ctx.measureText(t).width), a.x, a.y);
  ctx.fillStyle = dark ? '#1d2530' : '#45626a';
  ctx.fillRect(a.x, a.y + 30, a.w - 8, 2);
  ctx.save(); ctx.beginPath(); ctx.rect(a.x, a.y + 40, a.w, a.h - 40); ctx.clip();
  ctx.font = `16px ${TERMINAL_FONT}`;
  ctx.fillStyle = dark ? '#161f28' : BOARD_INK;
  let y = a.y + 46;
  for (const line of page.lines.slice(0, 5)) {
    ctx.fillText(fitScreenText(line, a.w, t => ctx.measureText(t).width), a.x, y);
    y += 24;
  }
  ctx.font = `bold 14px ${MARKER}`;
  ctx.fillStyle = dark ? '#2c232b' : '#80504e';
  const alert = e.screen?.alerts?.[0] ?? '';
  for (const line of wrapScreenText(alert, a.w, 2, t => ctx.measureText(t).width)) {
    ctx.fillText(line, a.x, y + 8); y += 18;
  }
  ctx.font = `13px ${MARKER}`;
  ctx.fillStyle = dark ? '#161f28' : BOARD_INK;
  for (const [i, line] of wrapScreenText(page.footer ?? 'say "give me a server" to help', a.w, 2, t => ctx.measureText(t).width).entries()) {
    ctx.fillText(line, a.x, a.y + a.h - 34 + i * 16);
  }
  ctx.restore();
  ctx.font = `12px ${MARKER}`;
  ctx.fillStyle = dark ? '#24222a' : '#584945';
  for (const [dx, lines] of [[8, ['feed ping', '+ pong']], [120, ['more chat =', 'more servers']], [232, ['buy coffee', '(again)']]] as const) {
    for (const [i, line] of lines.entries()) ctx.fillText(line, e.x + dx + 8, e.y - 56 + i * 16);
  }
  ctx.restore();
}
