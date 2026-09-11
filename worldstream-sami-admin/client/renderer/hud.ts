// World-agnostic HUD panel: draws whatever HudModel the world built.

import type { HudModel } from '../../src/shared/sceneTypes';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const PANEL_BG = '#11151c';
const BORDER = '#2a3340';
const TEXT = '#e8edf5';
const DIM = '#8a93a5';
const FAINT = '#5a6472';
const ACCENT = '#ffd25e';

export function drawHud(
  g: CanvasRenderingContext2D,
  hud: HudModel,
  x0: number,
  width: number,
  height: number,
): void {
  g.fillStyle = PANEL_BG;
  g.fillRect(x0, 0, width, height);
  g.strokeStyle = BORDER;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x0 + 1, 0);
  g.lineTo(x0 + 1, height);
  g.stroke();

  const pad = 22;
  const x = x0 + pad;
  const w = width - pad * 2;
  let y = 46;

  g.fillStyle = TEXT;
  g.font = `bold 22px ${MONO}`;
  g.fillText(hud.title, x, y);
  y += 26;

  // meters
  for (const m of hud.meters) {
    g.fillStyle = DIM;
    g.font = `12px ${MONO}`;
    g.fillText(m.label, x, y + 12);
    g.textAlign = 'right';
    g.fillStyle = TEXT;
    g.fillText(`${Math.round(m.value)}${m.unit} / ${Math.round(m.max)}${m.unit}`, x + w, y + 12);
    g.textAlign = 'left';
    y += 20;
    const frac = m.max > 0 ? Math.max(0, Math.min(1, m.value / m.max)) : 0;
    g.fillStyle = '#0d1117';
    g.fillRect(x, y, w, 14);
    g.fillStyle = m.warnAt !== undefined && m.value >= m.warnAt ? '#ffb020' : '#37d67a';
    if (frac >= 1) g.fillStyle = '#ff4d4f';
    g.fillRect(x, y, w * frac, 14);
    if (m.warnAt !== undefined && m.max > 0) {
      const wx = x + w * Math.min(1, m.warnAt / m.max);
      g.strokeStyle = '#ffb020';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(wx + 0.5, y - 2);
      g.lineTo(wx + 0.5, y + 16);
      g.stroke();
    }
    g.strokeStyle = BORDER;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, 13);
    y += 30;
  }

  // counters
  if (hud.counters.length) {
    for (const c of hud.counters) {
      g.fillStyle = DIM;
      g.font = `12px ${MONO}`;
      g.fillText(c.label, x, y + 12);
      g.textAlign = 'right';
      g.fillStyle = ACCENT;
      g.font = `bold 14px ${MONO}`;
      g.fillText(c.value, x + w, y + 12);
      g.textAlign = 'left';
      y += 22;
    }
    y += 8;
  }

  // rack board
  if (hud.board.length) {
    y = sectionTitle(g, 'SERVERS', x, y);
    for (const row of hud.board) {
      g.fillStyle = row.color;
      g.beginPath();
      g.arc(x + 6, y + 7, 5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = TEXT;
      g.font = `13px ${MONO}`;
      g.fillText(clip(g, row.label, w - 130), x + 20, y + 12);
      if (row.detail) {
        g.textAlign = 'right';
        g.fillStyle = FAINT;
        g.font = `11px ${MONO}`;
        g.fillText(row.detail, x + w, y + 12);
        g.textAlign = 'left';
      }
      y += 22;
    }
    y += 10;
  }

  // task queue
  y = sectionTitle(g, 'QUEUE', x, y);
  if (hud.queue.current) {
    const c = hud.queue.current;
    g.fillStyle = TEXT;
    g.font = `13px ${MONO}`;
    g.fillText(clip(g, `> ${c.label}${c.requestedBy ? ` (${c.requestedBy})` : ''}`, w), x, y + 12);
    y += 20;
    g.fillStyle = '#0d1117';
    g.fillRect(x, y, w, 8);
    g.fillStyle = '#3fa9f5';
    g.fillRect(x, y, w * Math.min(1, c.progress), 8);
    g.strokeStyle = BORDER;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, 7);
    y += 18;
  } else {
    g.fillStyle = FAINT;
    g.font = `13px ${MONO}`;
    g.fillText('idle', x, y + 12);
    y += 22;
  }
  for (const p of hud.queue.pending.slice(0, 5)) {
    g.fillStyle = DIM;
    g.font = `12px ${MONO}`;
    g.fillText(clip(g, `- ${p.label}${p.requestedBy ? ` (${p.requestedBy})` : ''}`, w), x, y + 12);
    y += 18;
  }
  const extra = hud.queue.pending.length - 5;
  if (extra > 0) {
    g.fillStyle = FAINT;
    g.fillText(`… +${extra} more`, x, y + 12);
    y += 18;
  }
  y += 10;

  // event log
  y = sectionTitle(g, 'LOG', x, y);
  g.font = `11px ${MONO}`;
  for (const line of hud.logLines.slice(-8)) {
    g.fillStyle = line.includes('!!') ? '#ff4d4f' : FAINT;
    g.fillText(clip(g, line, w), x, y + 12);
    y += 16;
  }

  // pinned onboarding line
  const pinH = 44;
  g.fillStyle = '#1a2233';
  g.fillRect(x0 + 10, height - pinH - 12, width - 20, pinH);
  g.strokeStyle = '#3fa9f5';
  g.lineWidth = 1;
  g.strokeRect(x0 + 10.5, height - pinH - 11.5, width - 21, pinH - 1);
  g.fillStyle = '#bcd8ff';
  g.font = `bold 14px ${MONO}`;
  g.textAlign = 'center';
  g.fillText(clip(g, hud.pinned, width - 40), x0 + width / 2, height - pinH / 2 - 7);
  g.textAlign = 'left';
}

function sectionTitle(g: CanvasRenderingContext2D, title: string, x: number, y: number): number {
  g.fillStyle = FAINT;
  g.font = `bold 11px ${MONO}`;
  g.fillText(title, x, y + 10);
  return y + 20;
}

function clip(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
