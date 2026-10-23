// Exports the design board's specs into the game:
//   src/shared/ageBibles.json   each age's world rules (surfaces, light, palette, design direction): server and page
//   client/dudes/agePieces.json the town's fabric, piece by piece, per age (low-poly parts): page only
// Run from ai-dudes-city: node design/export.mjs   (re-run whenever design/spec changes)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const AGES = ['stone', 'bronze', 'medieval', 'industrial', 'modern', 'future'];
const FABRIC = ['ground', 'street', 'lot-sale', 'lot-claimed', 'street-tree', 'wild-tree', 'street-light', 'centrepiece', 'bench', 'market', 'arrival', 'river', 'civic-lot', 'camp'];
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined);
/**
 * Parts the town draws itself, dropped from pieces: big flat ground slabs (the board's tiles had no
 * textured ground under a wild tree, a river piece or an arrival point, so some pieces brought their
 * own), and, on pieces that run along a road, the kerb and pavement strips (the town lays its own
 * walking edge). The caravan camp keeps its water: a pond is part of a barge camp.
 */
function townDraws(id, p) {
  const [w, h, d] = p.size.map(Math.abs);
  const top = p.position[1] + h / 2;
  const turned = p.rotation.some((r) => Math.abs(r) > 0.05);
  if (id !== 'camp' && !turned && h <= 0.22 && top <= 0.3 && w * d >= 30) return true;
  if ((id === 'street' || id === 'arrival') && !turned && top <= 0.35 && Math.abs(p.position[2]) >= 3.6 && Math.abs(p.position[2]) <= 6.4 && w >= 5 && d <= 2.2) return true;
  return false;
}
let dropped = 0;
const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

const bibles = AGES.map((id) => {
  const b = read(path.resolve('design/spec', id, 'bible.json'));
  return { id, name: b.name, summary: b.summary, rules: b.rules, surfaces: b.surfaces, light: b.light, palette: b.palette, designDirection: b.designDirection };
});
const pieces = Object.fromEntries(
  AGES.map((age) => [
    age,
    Object.fromEntries(
      FABRIC.filter((id) => existsSync(path.resolve('design/spec', age, `${id}.json`))).map((id) => {
        const s = read(path.resolve('design/spec', age, `${id}.json`));
        return [
          id,
          {
            name: s.name,
            parts: s.parts.filter((p) => !(townDraws(id, p) && ++dropped)).map((p) => ({
              shape: p.shape,
              position: p.position.map(r3),
              size: p.size.map(r3),
              rotation: p.rotation.map(r3),
              color: p.color,
              ...(p.glow ? { glow: true } : {}),
            })),
          },
        ];
      }),
    ),
  ]),
);
/** The garment kits, checked and cleaned for the game (src/shared/outfits.ts reads them). */
const BONES = ['hips', 'head', 'armL', 'armR', 'legL', 'legR', 'cape'];
const SHAPES = ['box', 'cylinder', 'sphere', 'cone'];
const HIDES = ['shoes', 'sleeves', 'trousers', 'hair', 'hat', 'accessory'];
const ROLE = /^(shirt|pants|hat|accent|skin|hair)(:(dark|light))?$|^#[0-9a-f]{6}$/i;
const v3 = (a, d) => (Array.isArray(a) && a.length === 3 && a.every((n) => Number.isFinite(Number(n))) ? a.map((n) => r3(n)) : [d, d, d]);
let kitParts = 0;
const kit = (k) =>
  k && Array.isArray(k.parts)
    ? {
        name: String(k.name ?? '').slice(0, 60),
        ...(Array.isArray(k.hide) && k.hide.filter((h) => HIDES.includes(h)).length ? { hide: k.hide.filter((h) => HIDES.includes(h)) } : {}),
        parts: k.parts
          .filter((p) => BONES.includes(p.bone) && SHAPES.includes(p.shape))
          .slice(0, 50)
          .map((p) => (kitParts++, { bone: p.bone, shape: p.shape, position: v3(p.position, 0), size: v3(p.size, 0.1).map((n) => Math.min(2.5, Math.max(0.01, Math.abs(n)))), rotation: v3(p.rotation, 0), colour: ROLE.test(String(p.colour ?? '')) ? String(p.colour) : 'shirt' })),
      }
    : undefined;
const outfits = Object.fromEntries(
  AGES.map((age) => [age, read(path.resolve('design/spec', age, 'outfits.json'))])
    .filter(([, o]) => o)
    .map(([age, o]) => [age, { kits: (o.kits ?? []).map(kit).filter(Boolean), ...(kit(o.head) ? { head: kit(o.head) } : {}), ...(kit(o.leader) ? { leader: kit(o.leader) } : {}) }]),
);
writeFileSync('src/shared/ageOutfits.json', JSON.stringify(outfits));
writeFileSync('src/shared/ageBibles.json', JSON.stringify(bibles));
writeFileSync('client/dudes/agePieces.json', JSON.stringify(pieces));
const count = Object.values(pieces).reduce((n, a) => n + Object.keys(a).length, 0);
console.log(`exported ${bibles.length} bibles, ${Object.keys(outfits).length} ages of outfits (${kitParts} parts) and ${count} pieces, ${dropped} ground parts left to the town (${(JSON.stringify(pieces).length / 1024).toFixed(0)} KB)`);
