import type { SceneEntity, SceneScreen } from '../../src/shared/sceneTypes';
import { chatScreen } from './chatMonitor';

import { TERMINAL_FONT as MONO } from './terminalFont';
export const SCREEN_INK = '#e0e9df';
export const SCREEN_MUTED = '#a2b7ad';
export const SCREEN_BG = '#0b1919';

type Measure = (s: string) => number;

export function screenPageIndex(screen: SceneScreen, now: number): number {
  if (!screen.pages.length) return 0;
  return Math.floor(Math.max(0, now) / Math.max(1, screen.dwellMs)) % screen.pages.length;
}

export function screenPhase(screen: SceneScreen, now: number) {
  const time = Math.max(0, now);
  const interlude = screen.interlude;
  if (interlude?.pages.length && screen.pages.length) {
    const every = Math.max(1, Math.floor(interlude.every));
    const dwell = Math.max(1, screen.dwellMs);
    const boxSpan = every * dwell;
    const cycleMs = boxSpan + Math.max(1, interlude.dwellMs);
    const cycle = Math.floor(time / cycleMs);
    const offset = time % cycleMs;
    if (offset >= boxSpan) {
      const index = cycle % interlude.pages.length;
      const elapsed = offset - boxSpan;
      return { page: interlude.pages[index], label: interlude.label, index, count: interlude.pages.length,
        room: true, flash: elapsed < interlude.flashMs ? 1 - elapsed / interlude.flashMs : 0 };
    }
    const index = (cycle * every + Math.floor(offset / dwell)) % screen.pages.length;
    return { page: screen.pages[index], label: screen.label, index, count: screen.pages.length, room: false, flash: 0 };
  }
  const index = screenPageIndex(screen, time);
  return { page: screen.pages[index], label: screen.label, index, count: screen.pages.length, room: false, flash: 0 };
}

/**
 * Fold every kind of whitespace down to a plain space so newlines and exotic
 * spaces can't break the layout — but leave runs of plain spaces alone. A
 * screen that lays its lines out in columns pads with spaces, and collapsing
 * those turned an aligned label/value table into ragged text.
 */
const normalise = (text: string) => text.replace(/[^\S ]+/g, ' ');

export function fitScreenText(text: string, width: number, measure: Measure): string {
  const chars = Array.from(normalise(text).trimEnd()).slice(0, 500);
  if (measure(chars.join('')) <= width) return chars.join('');
  while (chars.length && measure(chars.join('') + '…') > width) chars.pop();
  return chars.join('') + '…';
}

export function wrapScreenText(text: string, width: number, maxRows: number, measure: Measure): string[] {
  const chars = Array.from(normalise(text).trimEnd()).slice(0, 500);
  const rows: string[] = [];
  while (chars.length && rows.length < maxRows) {
    if (rows.length === maxRows - 1) { rows.push(fitScreenText(chars.join(''), width, measure)); break; }
    let count = 0;
    while (count < chars.length && measure(chars.slice(0, count + 1).join('')) <= width) count++;
    count = Math.max(1, count);
    if (count < chars.length) {
      const space = chars.slice(0, count).lastIndexOf(' ');
      if (space > 0) count = space;
    }
    rows.push(chars.splice(0, count).join(''));
    while (chars[0] === ' ') chars.shift();
  }
  return rows;
}

export function drawInfoMonitorText(ctx: CanvasRenderingContext2D, e: SceneEntity, now: number, allowFlash = true): void {
  const model = e.screen;
  if (!model?.pages.length) return;
  const s = chatScreen(e);
  const phase = screenPhase(model, now);
  const { page, index } = phase;
  const width = s.w - 24;
  const x = s.x + 12;
  const compact = e.h < 288;
  const bodySize = compact ? 16 : 20;
  const smallSize = compact ? 12 : 14;
  const lineHeight = compact ? 20 : 24;
  const bodyTop = compact ? 56 : 72;
  ctx.save();
  ctx.beginPath(); ctx.rect(s.x, s.y, s.w, s.h); ctx.clip();
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  const measure = (text: string) => ctx.measureText(text).width;
  ctx.font = `${smallSize}px ${MONO}`; ctx.fillStyle = SCREEN_MUTED;
  ctx.fillText(phase.label, x, s.y + 8);
  // A page counter on a screen that never advances is just noise.
  ctx.textAlign = 'right';
  if (phase.count > 1) ctx.fillText(`${index + 1}/${phase.count}`, s.x + s.w - 12, s.y + 8);
  ctx.textAlign = 'left'; ctx.font = `bold ${bodySize}px ${MONO}`; ctx.fillStyle = SCREEN_INK;
  ctx.fillText(fitScreenText(page.title, width, measure), x, s.y + (compact ? 28 : 32));
  ctx.fillStyle = '#27403b'; ctx.fillRect(x, s.y + bodyTop - 10, width, 1);
  ctx.font = `${bodySize}px ${MONO}`; ctx.fillStyle = SCREEN_INK;
  // Five rows for telemetry; sparse event/queue pages can wrap into the same space.
  let row = 0;
  const maxRows = Math.floor((s.h - bodyTop - 36) / lineHeight);
  page.lines.forEach((line, i) => {
    const available = maxRows - row - (page.lines.length - i - 1);
    for (const part of wrapScreenText(line, width, Math.max(1, available), measure)) {
      if (row >= maxRows) break;
      ctx.fillText(part, x, s.y + bodyTop + row++ * lineHeight);
    }
  });
  ctx.font = `${smallSize}px ${MONO}`; ctx.fillStyle = SCREEN_MUTED;
  if (page.footer) ctx.fillText(fitScreenText(page.footer, width, measure), x, s.y + s.h - 36);
  const alerts = model.alerts ?? [];
  const footer = alerts.length
    ? `${alerts.length > 1 ? `[${alerts.length}] ` : ''}${alerts[Math.floor(now / 3500) % alerts.length]}`
    : 'AUTO CYCLE';
  ctx.fillStyle = SCREEN_INK;
  ctx.fillText(fitScreenText(footer, width, measure), x, s.y + s.h - 18);
  if (allowFlash && phase.flash > 0) {
    // One localized pulse before the room bulletin, never a repeating strobe.
    ctx.fillStyle = SCREEN_BG; ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.globalAlpha = phase.flash * 0.65;
    ctx.fillStyle = '#b4e3d5'; ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = phase.flash > 0.5 ? SCREEN_BG : SCREEN_INK;
    ctx.font = `bold ${bodySize}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('ROOM UPDATE', s.x + s.w / 2, s.y + s.h / 2 - bodySize / 2);
  }
  ctx.restore();
}
