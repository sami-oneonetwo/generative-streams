import type { SceneChatMessage, SceneEntity, SceneTraffic } from '../../src/shared/sceneTypes';

import { TERMINAL_FONT as MONO } from './terminalFont';
const LINE_H = 24;
const GREEN = '#9bea80';

export function chatScreen(e: Pick<SceneEntity, 'x' | 'y' | 'w' | 'h'>) {
  return { x: e.x + 16, y: e.y + 12, w: e.w - 40, h: e.h - 48 };
}

interface ChatRow { username: string; text: string }
type Measure = (text: string) => number;
const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();

function ellipsis(text: string, width: number, measure: Measure): string {
  const chars = Array.from(text);
  while (chars.length && measure(chars.join('') + '…') > width) chars.pop();
  return chars.join('') + '…';
}

// Bound both layout work and each message's share of the small display.
export function layoutChat(messages: SceneChatMessage[], width: number, maxRows: number, measure: Measure): ChatRow[] {
  const rows: ChatRow[] = [];
  for (const message of messages.slice(-6).reverse()) {
    // No route tag: which server carried a message is shown by the pulse
    // travelling to it, not by a code in front of somebody's name.
    let username = clean(Array.from(message.username).slice(0, 40).join(''));
    if (measure(username + ': ') > width * 0.5) username = ellipsis(username, width * 0.5 - measure(': '), measure);
    let remaining = clean(Array.from(message.text).slice(0, 500).join(''));
    const block: ChatRow[] = [];
    for (let i = 0; i < Math.min(3, maxRows) && (remaining || i === 0); i++) {
      const name = i === 0 ? username + ': ' : '';
      const available = width - measure(name);
      const chars = Array.from(remaining);
      let count = 0;
      while (count < chars.length && measure(chars.slice(0, count + 1).join('')) <= available) count++;
      count = Math.max(1, count);
      let part = chars.slice(0, count).join('');
      if (count < chars.length && part.lastIndexOf(' ') > 0) {
        part = part.slice(0, part.lastIndexOf(' '));
        count = Array.from(part).length;
      }
      remaining = chars.slice(count).join('').trimStart();
      if (i === Math.min(3, maxRows) - 1 && remaining) part = ellipsis(part, available, measure);
      block.push({ username: name, text: part });
    }
    if (rows.length + block.length > maxRows) break;
    rows.unshift(...block);
  }
  return rows;
}

let cachedMessages: unknown;
let cachedWidth = 0;
let cachedHeight = 0;
let cachedRows: ChatRow[] = [];

/**
 * What a deaf room's chat screen says (brief §5.7). Admin can't read any of this
 * — the point is that he's talking to a dead screen — but the audience typing
 * into the void needs to know the stream isn't broken and nothing is lost.
 */
export function deafPanel(deafSince: number | undefined, now: number): { title: string; status: string; lines: string[] } {
  const seconds = deafSince === undefined ? null : Math.min(99 * 60 + 59, Math.max(0, Math.floor((now - deafSince) / 1000)));
  return {
    title: 'NO SIGNAL',
    status: seconds === null ? 'CHAT IS DOWN' : `CHAT IS DOWN · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    lines: ['nothing is reaching admin ·', 'your messages are waiting'],
  };
}

// Decorative interference, never derived from a held message or username.
// One brief fragment every seven seconds leaves the screen mostly unreadable.
export function scrambledFragment(since: number, now: number): string | null {
  const elapsed = Math.max(0, now - since);
  if (elapsed % 7000 < 5100 || elapsed % 7000 >= 6200) return null;
  const glyphs = '#/%_?+x=-';
  const beat = Math.floor(elapsed / 7000);
  return Array.from({ length: 23 }, (_, i) => i % 6 === 4 ? ' ' : glyphs[(beat * 7 + i * 13 + i * i) % glyphs.length]).join('');
}

export function drawChatMonitorText(ctx: CanvasRenderingContext2D, e: SceneEntity, now: number): void {
  const s = chatScreen(e);
  ctx.save();
  ctx.beginPath(); ctx.rect(s.x, s.y, s.w, s.h); ctx.clip();
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.font = `bold 14px ${MONO}`;
  ctx.fillStyle = e.props?.emergency ? '#d9a36a' : GREEN;
  ctx.fillText('CHAT', s.x + 12, s.y + 10);
  const traffic = e.props?.traffic as SceneTraffic | undefined;
  if (e.props?.deaf) {
    drawDeafPanel(ctx, s, e, now);
    ctx.restore();
    return;
  }
  if (traffic) {
    const behind = traffic.lagSeconds === null ? null : Math.ceil(traffic.lagSeconds);
    ctx.fillStyle = '#e0e9df';
    ctx.textAlign = 'right';
    ctx.fillText(
      behind === null ? 'CHAT IS STUCK' : behind < 1 ? 'KEEPING UP' : `${behind}s BEHIND`,
      s.x + s.w - 12,
      s.y + 10,
    );
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#27403b';
  ctx.fillRect(s.x + 12, s.y + 32, s.w - 24, 1);
  ctx.font = `20px ${MONO}`;
  const messages = (e.props?.messages ?? []) as SceneChatMessage[];
  const width = s.w - 24;
  // One header row now that the route legend is gone, so chat gets its row back.
  const maxRows = Math.floor((s.h - 44) / LINE_H);
  if (messages !== cachedMessages || width !== cachedWidth || maxRows !== cachedHeight) {
    cachedRows = layoutChat(messages, width, maxRows, text => ctx.measureText(text).width);
    cachedMessages = messages; cachedWidth = width; cachedHeight = maxRows;
  }
  if (!cachedRows.length) {
    ctx.fillStyle = '#a2b7ad';
    ctx.fillText('waiting for chat…', s.x + 12, s.y + 64);
  } else {
    const y = s.y + s.h - 8 - cachedRows.length * LINE_H;
    cachedRows.forEach((row, i) => {
      ctx.fillStyle = GREEN;
      ctx.fillText(row.username, s.x + 12, y + i * LINE_H);
      ctx.fillStyle = '#e0e9df';
      ctx.fillText(row.text, s.x + 12 + ctx.measureText(row.username).width, y + i * LINE_H);
    });
  }
  ctx.restore();
}

type Screen = { x: number; y: number; w: number; h: number };

function drawDeafPanel(ctx: CanvasRenderingContext2D, s: Screen, e: SceneEntity, now: number): void {
  const panel = deafPanel(e.props?.deafSince as number | undefined, now);
  const emergency = !!e.props?.emergency;
  ctx.textAlign = 'right';
  ctx.fillStyle = '#dd6b7d';
  ctx.fillText('DOWN', s.x + s.w - 12, s.y + 10);
  ctx.fillStyle = '#27403b';
  ctx.fillRect(s.x + 12, s.y + 32, s.w - 24, 1);

  const cx = s.x + s.w / 2;
  ctx.textAlign = 'center';
  ctx.font = `bold 34px ${MONO}`;
  ctx.fillStyle = '#8a97a5';
  ctx.fillText(emergency ? 'SIGNAL LOST' : panel.title, cx, s.y + s.h / 2 - 46);
  ctx.font = `bold 15px ${MONO}`;
  ctx.fillStyle = '#dd6b7d';
  ctx.fillText(panel.status, cx, s.y + s.h / 2 - 4);
  ctx.font = `14px ${MONO}`;
  ctx.fillStyle = '#a2b7ad';
  panel.lines.forEach((line, i) => ctx.fillText(line, cx, s.y + s.h / 2 + 28 + i * 20));
  if (emergency) {
    const fragment = scrambledFragment(Number(e.props?.deafSince ?? 0), now);
    if (fragment) {
      ctx.font = `16px ${MONO}`;
      ctx.fillStyle = '#b99879';
      ctx.fillText(fragment, cx, s.y + s.h - 27);
    }
  }
  ctx.textAlign = 'left';
}
