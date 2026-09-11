// Placeholder draw functions for the noodle-shop entity kinds, in the palette
// of the reference art: deep navy night, near-black tower silhouette, warm
// amber interior, neon red signage/lanterns, cyan vending machine. Real
// pixel-art replaces these one kind at a time via the shared registry.

import type { SceneEntity } from '../../../src/shared/sceneTypes';
import { register } from './registry';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const NEON = '#ff3b3b';
const AMBER = '#ffb347';
const CYAN = '#3fd0e0';
const NIGHT = '#0a0e1a';
const SILHOUETTE = '#05070f';

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

register('skyline', (g, e) => {
  // distant mountains/city, barely lifted from the night
  g.fillStyle = '#0c1120';
  for (let i = 0; i < 6; i++) {
    const bx = e.x + i * 260;
    const bh = 120 + ((i * 53) % 90);
    g.beginPath();
    g.moveTo(bx, e.h);
    g.lineTo(bx + 90, e.h - bh);
    g.lineTo(bx + 180, e.h);
    g.closePath();
    g.fill();
  }
});

register('tower', (g, e) => {
  // the multi-storey pagoda silhouette rising behind the shopfront
  g.fillStyle = SILHOUETTE;
  const tiers = [
    { w: 1.0, h: 0.32 },
    { w: 0.8, h: 0.26 },
    { w: 0.62, h: 0.24 },
    { w: 0.42, h: 0.18 },
  ];
  let y = e.y + e.h;
  for (const tier of tiers) {
    const tw = e.w * tier.w;
    const th = e.h * tier.h;
    const tx = e.x + (e.w - tw) / 2;
    y -= th;
    g.fillRect(tx, y, tw, th);
    // eave line
    g.fillStyle = '#0a1020';
    g.fillRect(tx - 10, y, tw + 20, 6);
    g.fillStyle = SILHOUETTE;
  }
  // rooftop emblem glow
  g.save();
  g.shadowColor = NEON;
  g.shadowBlur = 20;
  g.fillStyle = NEON;
  g.beginPath();
  g.arc(e.x + e.w / 2, y + 6, 10, 0, Math.PI * 2);
  g.fill();
  g.restore();
});

register('interior', (g, e) => {
  const glow = String(e.props?.glow ?? 'rgba(255,150,60,0.15)');
  g.fillStyle = '#171009';
  g.fillRect(e.x, e.y, e.w, e.h);
  g.fillStyle = glow;
  g.fillRect(e.x, e.y, e.w, e.h);
  // striped awning across the top (like the ref)
  const stripeW = 40;
  for (let x = e.x; x < e.x + e.w; x += stripeW) {
    g.fillStyle = ((x - e.x) / stripeW) % 2 < 1 ? '#7a1f1f' : '#c9c2b0';
    g.fillRect(x, e.y - 22, stripeW, 22);
  }
  g.strokeStyle = '#2a1e10';
  g.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
});

register('neonSign', (g, e, now) => {
  const flicker = 0.85 + 0.15 * Math.sin(now / 220);
  g.save();
  g.globalAlpha = flicker;
  g.shadowColor = NEON;
  g.shadowBlur = 22;
  // red ring
  g.strokeStyle = NEON;
  g.lineWidth = 6;
  const cx = e.x + 75;
  const cy = e.y + e.h / 2;
  g.beginPath();
  g.arc(cx, cy, 60, 0, Math.PI * 2);
  g.stroke();
  // bowl glyph inside the ring
  g.beginPath();
  g.moveTo(cx - 34, cy - 6);
  g.lineTo(cx + 34, cy - 6);
  g.lineTo(cx + 22, cy + 30);
  g.lineTo(cx - 22, cy + 30);
  g.closePath();
  g.stroke();
  // chopsticks
  g.beginPath();
  g.moveTo(cx - 10, cy - 40);
  g.lineTo(cx + 18, cy - 12);
  g.moveTo(cx + 2, cy - 44);
  g.lineTo(cx + 26, cy - 16);
  g.stroke();
  // neon text bar to the right
  g.strokeRect(e.x + 150, cy - 34, e.w - 160, 68);
  g.font = `bold 40px ${MONO}`;
  g.fillStyle = NEON;
  g.textAlign = 'center';
  g.fillText('ラーメン', e.x + 150 + (e.w - 160) / 2, cy + 12);
  g.textAlign = 'left';
  g.restore();
});

register('lantern', (g, e, now) => {
  const sway = Math.sin(now / 700 + hashCode(e.id)) * 3;
  const x = e.x + sway;
  // cord
  g.strokeStyle = '#3a1010';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + e.w / 2, e.y - 40);
  g.lineTo(x + e.w / 2, e.y);
  g.stroke();
  // lantern body, glowing red
  g.save();
  g.shadowColor = NEON;
  g.shadowBlur = 12;
  g.fillStyle = '#c8252a';
  g.beginPath();
  g.ellipse(x + e.w / 2, e.y + e.h / 2, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.fillStyle = '#7a1518';
  g.fillRect(x + e.w / 2 - 3, e.y, 6, e.h);
});

register('vending', (g, e, now) => {
  const broken = Boolean(e.props?.broken);
  const flicker = broken ? (Math.sin(now / 60) > 0 ? 1 : 0.25) : 1;
  g.fillStyle = '#0e1a1e';
  g.fillRect(e.x, e.y, e.w, e.h);
  g.save();
  g.globalAlpha = flicker;
  g.shadowColor = CYAN;
  g.shadowBlur = 14;
  g.strokeStyle = CYAN;
  g.lineWidth = 2;
  g.strokeRect(e.x + 4, e.y + 4, e.w - 8, e.h - 8);
  // product rows
  g.fillStyle = broken ? '#1a3238' : CYAN;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      g.fillRect(e.x + 14 + c * 22, e.y + 20 + r * 34, 14, 22);
    }
  }
  g.restore();
  g.fillStyle = broken ? NEON : CYAN;
  g.font = `9px ${MONO}`;
  g.textAlign = 'center';
  g.fillText(broken ? 'OUT OF ORDER' : 'COLD TEA', e.x + e.w / 2, e.y + e.h - 10);
  g.textAlign = 'left';
});

register('kitchen', (g, e) => {
  g.fillStyle = '#120d07';
  g.fillRect(e.x, e.y, e.w, e.h);
  // hood
  g.fillStyle = '#1a130a';
  g.fillRect(e.x, e.y - 6, e.w, 14);
});

register('pot', (g, e, now) => {
  const servings = Number(e.props?.servings ?? 0);
  const max = Number(e.props?.max ?? 12);
  const boiling = Boolean(e.props?.boiling);
  const simmering = Boolean(e.props?.simmering);
  const burnerOut = Boolean(e.props?.burnerOut);
  // burner flame
  if (!burnerOut) {
    g.fillStyle = boiling ? '#ff6a2a' : AMBER;
    for (let i = 0; i < 4; i++) {
      const fx = e.x + 14 + i * ((e.w - 28) / 3);
      const fh = 10 + Math.abs(Math.sin(now / 120 + i)) * 8;
      g.beginPath();
      g.moveTo(fx, e.y + e.h);
      g.lineTo(fx + 6, e.y + e.h - fh);
      g.lineTo(fx + 12, e.y + e.h);
      g.closePath();
      g.fill();
    }
  }
  // pot body
  g.fillStyle = '#2a2a2e';
  g.fillRect(e.x, e.y, e.w, e.h - 6);
  g.strokeStyle = boiling ? NEON : '#4a4a52';
  g.lineWidth = 2;
  g.strokeRect(e.x + 1, e.y + 1, e.w - 2, e.h - 8);
  // broth level
  const frac = max > 0 ? servings / max : 0;
  g.fillStyle = simmering ? '#6a4a2a' : '#c98a3a';
  g.fillRect(e.x + 4, e.y + (e.h - 6) * (1 - frac) + 2, e.w - 8, (e.h - 6) * frac - 4);
  // steam / boil
  g.strokeStyle = boiling ? 'rgba(255,120,80,0.7)' : 'rgba(200,200,200,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const sx = e.x + 20 + i * 24;
    const off = Math.sin(now / (boiling ? 90 : 200) + i) * 4;
    g.beginPath();
    g.moveTo(sx, e.y - 2);
    g.quadraticCurveTo(sx + 6 + off, e.y - 18, sx + off, e.y - 34);
    g.stroke();
  }
  if (simmering) {
    g.fillStyle = AMBER;
    g.font = `9px ${MONO}`;
    g.textAlign = 'center';
    g.fillText('SIMMERING', e.x + e.w / 2, e.y - 40);
    g.textAlign = 'left';
  }
});

register('plant', (g, e, now) => {
  const stage = String(e.props?.stage ?? 'healthy');
  const buds = Number(e.props?.buds ?? 0);
  // shelf
  g.fillStyle = '#1a130a';
  g.fillRect(e.x - 6, e.y + e.h, e.w + 12, 8);
  // pot
  g.fillStyle = '#8a5a3a';
  g.fillRect(e.x + e.w / 2 - 18, e.y + e.h - 34, 36, 34);
  // foliage — colour + droop by stage
  const palette: Record<string, string> = {
    blooming: '#4fd06a',
    healthy: '#3ba85a',
    wilting: '#9a9a3a',
    critical: '#8a6a3a',
  };
  const droop = stage === 'critical' ? 14 : stage === 'wilting' ? 7 : 0;
  g.strokeStyle = palette[stage] ?? '#3ba85a';
  g.lineWidth = 3;
  const baseX = e.x + e.w / 2;
  const baseY = e.y + e.h - 34;
  for (let i = -2; i <= 2; i++) {
    const sway = Math.sin(now / 900 + i) * 2;
    g.beginPath();
    g.moveTo(baseX, baseY);
    g.quadraticCurveTo(baseX + i * 12 + sway, baseY - 34 + droop, baseX + i * 20 + sway, baseY - 20 + droop * 2);
    g.stroke();
  }
  // blossoms when blooming
  if (stage === 'blooming') {
    g.fillStyle = '#ff9ec4';
    for (let i = 0; i < Math.min(buds, 4); i++) {
      g.beginPath();
      g.arc(baseX + (i - 1.5) * 14, baseY - 30 + Math.sin(now / 800 + i) * 2, 4, 0, Math.PI * 2);
      g.fill();
    }
  }
});

register('register', (g, e) => {
  const till = Number(e.props?.till ?? 0);
  g.fillStyle = '#1c1c22';
  g.fillRect(e.x, e.y, e.w, e.h);
  g.strokeStyle = '#3d4654';
  g.lineWidth = 2;
  g.strokeRect(e.x + 1, e.y + 1, e.w - 2, e.h - 2);
  g.fillStyle = AMBER;
  g.font = `bold 12px ${MONO}`;
  g.textAlign = 'center';
  g.fillText(`¥${till}`, e.x + e.w / 2, e.y + e.h / 2 + 4);
  g.textAlign = 'left';
});

register('counter', (g, e) => {
  g.fillStyle = '#3a2a18';
  g.fillRect(e.x, e.y, e.w, e.h);
  g.fillStyle = '#4a3826';
  g.fillRect(e.x, e.y, e.w, 6); // polished top edge
  g.strokeStyle = '#22160c';
  g.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
});

register('stool', (g, e, now) => {
  if (e.props?.empty) {
    g.strokeStyle = '#2a323e';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(e.x, e.y + e.h / 2, e.w / 2, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#232a34';
    g.fillRect(e.x - 3, e.y + e.h / 2, 6, e.h / 2);
    return;
  }
  const owner = String(e.props?.owner ?? '');
  const hasBowl = Boolean(e.props?.hasBowl);
  const eaten = Boolean(e.props?.eaten);
  const mess = Boolean(e.props?.mess);

  // seated customer (simple silhouette)
  g.fillStyle = '#2b3340';
  g.fillRect(e.x - 12, e.y - 46, 24, 40);
  g.fillStyle = '#c9a27e';
  g.beginPath();
  g.arc(e.x, e.y - 54, 10, 0, Math.PI * 2);
  g.fill();
  // stool
  g.fillStyle = '#5a4632';
  g.beginPath();
  g.arc(e.x, e.y + e.h / 2, e.w / 2, 0, Math.PI * 2);
  g.fill();
  // name tag
  g.fillStyle = '#8a93a5';
  g.font = `11px ${MONO}`;
  g.textAlign = 'center';
  g.fillText(owner, e.x, e.y + e.h + 16);

  // bowl on the counter in front of them (counter sits ~80px above stool)
  const bowlY = e.y - 84;
  if (mess) {
    g.fillStyle = '#6a3a1a';
    g.fillRect(e.x - 20, bowlY + 6, 40, 6); // spill
    g.fillStyle = NEON;
    g.font = `10px ${MONO}`;
    g.fillText('!', e.x, bowlY);
  } else if (hasBowl) {
    g.save();
    if (!eaten) {
      g.strokeStyle = 'rgba(255,200,150,0.4)';
      g.lineWidth = 2;
      const off = Math.sin(now / 200) * 3;
      g.beginPath();
      g.moveTo(e.x - 4, bowlY - 2);
      g.quadraticCurveTo(e.x + off, bowlY - 14, e.x, bowlY - 24);
      g.stroke();
    }
    g.fillStyle = eaten ? '#5a4a3a' : '#e8c88a';
    g.beginPath();
    g.moveTo(e.x - 16, bowlY);
    g.lineTo(e.x + 16, bowlY);
    g.lineTo(e.x + 10, bowlY + 14);
    g.lineTo(e.x - 10, bowlY + 14);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.textAlign = 'left';
});
