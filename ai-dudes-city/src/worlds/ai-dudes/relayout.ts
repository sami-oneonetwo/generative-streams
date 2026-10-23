// Moving a town onto a new street layout (shared/city.ts LAYOUT). A lot that is still there keeps its
// place; any other old lot is matched with a spare new lot in the order lots are handed out (nearest
// the square first), so the town keeps its shape: whoever lived next to the square still does. Builds move with their lot, keeping
// where they stood on it; anything else, and everyone walking about, is scaled onto the new town.
// Runs once at start on a save from an older layout. Zero AI.
import { CITY_BOUNDS, LAYOUT, allPlots, homePlots, civicPlots, layoutPlots, type PlotInfo } from '../../shared/city';
import type { GroundPoint } from '../../shared/objectTypes';
import type { DudesState } from './state';

interface OldLot {
  id: string;
  civic: boolean;
  q: number;
  centre: GroundPoint;
  half: number;
  rank: number;
}

/** Layout 1: 5×5 blocks 44 m apart, four 16 m lots a block, the square's four 13 m lots 3 m off its cross. */
function layout1(): OldLot[] {
  const out: OldLot[] = [];
  for (let bx = -2; bx <= 2; bx++)
    for (let bz = -2; bz <= 2; bz++)
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const civic = bx === 0 && bz === 0;
          const off = civic ? 3 + 13 / 2 : 8;
          out.push({ id: `p${bx}_${bz}_${(sx > 0 ? 1 : 0) + (sz > 0 ? 2 : 0)}`, civic, q: (sx > 0 ? 1 : 0) + (sz > 0 ? 2 : 0), centre: { x: bx * 44 + sx * off, z: bz * 44 + sz * off }, half: civic ? 6.5 : 8, rank: Math.max(Math.abs(bx), Math.abs(bz)) });
        }
  const score = (p: OldLot) => p.rank * 1000 + Math.hypot(p.centre.x, p.centre.z) + Math.atan2(p.centre.z, p.centre.x) * 0.01;
  return out.sort((a, b) => score(a) - score(b));
}
const EDGE1 = 2 * 44 + 18 + 8;

/** Layout 2: 3×3 blocks of eight 22 m lots round a courtyard, the square's four 18 m lots 3 m off its cross. */
function layout2(): OldLot[] {
  return layoutPlots({ plot: 22, sidewalk: 2, road: 8, rings: 1, cells: 3, parks: false, path: 3, site: 18 }).map((p) => ({
    id: p.id,
    civic: p.civic,
    q: (p.sx > 0 ? 1 : 0) + (p.sz > 0 ? 2 : 0),
    centre: p.centre,
    half: (p.rect.maxX - p.rect.minX) / 2,
    rank: p.rank,
  }));
}
const EDGE2 = 78 + 35 + 8;

/**
 * Old lot id → new lot. A lot that is still there (same block, same cell) keeps its place; the rest
 * go, nearest the square first, to the new lots nobody was given.
 */
function lotMap(from: number): Map<string, { old: OldLot; lot: PlotInfo | undefined }> {
  const old = from === 1 ? layout1() : layout2();
  const homes = homePlots();
  const civic = civicPlots();
  const map = new Map<string, { old: OldLot; lot: PlotInfo | undefined }>();
  const taken = new Set<string>();
  const oldHomes = old.filter((l) => !l.civic);
  if (from !== 1)
    for (const l of oldHomes) {
      const same = homes.find((h) => h.id === l.id);
      if (same) {
        map.set(l.id, { old: l, lot: same });
        taken.add(same.id);
      }
    }
  const spare = homes.filter((h) => !taken.has(h.id));
  oldHomes.filter((l) => !map.has(l.id)).forEach((l, i) => map.set(l.id, { old: l, lot: spare[i] }));
  for (const l of old.filter((x) => x.civic)) map.set(l.id, { old: l, lot: civic.find((c) => (c.sx > 0 ? 1 : 0) + (c.sz > 0 ? 2 : 0) === l.q) });
  return map;
}

/** Move a save onto this layout. True when anything moved. */
export function relayout(state: DudesState): boolean {
  const c = state.city;
  if (!c || c.layout === LAYOUT) return false;
  const from = c.layout ?? 1;
  c.layout = LAYOUT;
  const map = lotMap(from);
  const k = CITY_BOUNDS.maxX / (from === 1 ? EDGE1 : EDGE2);
  const scaled = (p: GroundPoint): GroundPoint => ({ x: p.x * k, z: p.z * k });
  /** A point on an old lot to the same spot on its new lot (kept inside it); otherwise scaled. */
  const moved = (p: GroundPoint, plot: string | undefined, margin = 0.5): GroundPoint => {
    const m = plot ? map.get(plot) : undefined;
    if (!m?.lot || Math.abs(p.x - m.old.centre.x) > m.old.half + 0.5 || Math.abs(p.z - m.old.centre.z) > m.old.half + 0.5) return scaled(p);
    const r = m.lot.rect;
    // Where it stood on the old lot, shrunk to the new lot's size, and kept on it.
    const f = (r.maxX - r.minX) / 2 / m.old.half;
    const edge = Math.min(margin, (r.maxX - r.minX) / 2);
    return {
      x: Math.max(r.minX + edge, Math.min(r.maxX - edge, m.lot.centre.x + (p.x - m.old.centre.x) * f)),
      z: Math.max(r.minZ + edge, Math.min(r.maxZ - edge, m.lot.centre.z + (p.z - m.old.centre.z) * f)),
    };
  };
  const newId = (plot: string | undefined) => (plot && map.has(plot) ? map.get(plot)!.lot?.id : plot && allPlots().some((l) => l.id === plot) ? plot : undefined);

  // Claims: the old ones moved over; any handed out on the new layout before this ran (a restart in
  // between) give way to an owner's old lot.
  const oldClaims = Object.entries(c.plots).filter(([id]) => map.has(id));
  const owners = new Set(oldClaims.map(([, claim]) => claim.owner));
  const plots: typeof c.plots = {};
  for (const [id, claim] of oldClaims) {
    const to = newId(id);
    if (to) plots[to] = claim;
  }
  for (const [id, claim] of Object.entries(c.plots)) if (!map.has(id) && !owners.has(claim.owner) && !plots[id] && allPlots().some((l) => l.id === id)) plots[id] = claim;
  c.plots = plots;
  const ownerLot = new Map(Object.entries(plots).map(([id, claim]) => [claim.owner, id]));

  for (const o of state.objects) {
    const half = Math.max(o.footprint.width, o.footprint.depth) / 2;
    o.position = moved(o.position, o.plot, Math.min(half + 0.3, 8));
    if (o.driven) o.driven = { ...o.driven, at: moved(o.driven.at, o.plot) };
    if (o.creature) Object.assign(o.creature, { path: [], node: undefined, prevNode: undefined, targetId: undefined });
    const to = newId(o.plot);
    if (to) o.plot = to;
    else delete o.plot;
  }
  for (const j of state.jobs) {
    j.anchor = moved(j.anchor, j.plot);
    if (j.position) j.position = moved(j.position, j.plot);
    const to = newId(j.plot);
    if (to) j.plot = to;
    else delete j.plot;
  }
  if (c.project) {
    const p = c.project;
    if (p.position) p.position = moved(p.position, p.plot);
    p.plot = newId(p.plot) ?? civicPlots()[0].id;
  }
  for (const d of state.dudes) {
    const lot = ownerLot.get(d.id);
    d.plot = lot;
    const at = lot ? allPlots().find((l) => l.id === lot)!.centre : scaled(d.position);
    d.position = { ...at };
    d.path = [];
    d.use = undefined;
    d.riding = undefined;
    d.y = undefined;
    d.hidden = undefined;
    d.attack = undefined;
  }
  for (const t of c.townies) {
    t.position = scaled(t.position);
    t.path = [];
  }
  if (state.mayor) state.mayor.position = scaled(state.mayor.position);
  state.effects = [];
  state.worldRevision++;
  return true;
}
