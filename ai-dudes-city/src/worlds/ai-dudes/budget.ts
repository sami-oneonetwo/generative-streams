// The rolling AI budget. Two kinds of call are counted apart: agent turns (with the Mayor's aide and the
// Listener), which are small and many, and designs (builds, projects, restyles), which are big and few.
// Each draws from a bucket that holds a quarter of an hour's worth and refills continuously at its
// per-hour rate, so a burst is allowed, a long busy night settles at the rate, and switching
// enforcement on with an empty bucket only slows calls down for a moment instead of stopping them.
// Calls are counted (and the bucket drawn down) whether or not the budget is enforced, so the readout
// on /admin is true either way.
import type { AiSettings } from './state';

export type CallKind = 'agent' | 'design';
export interface BudgetDefaults {
  agentPerHour: number;
  designPerHour: number;
}

/** How much of an hour's budget can go at once. */
const BURST = 0.25;
const HOUR = 3_600_000;
const MINUTE = 60_000;

export const perHourOf = (ai: AiSettings, kind: CallKind, d: BudgetDefaults): number =>
  kind === 'agent' ? (ai.agentPerHour ?? d.agentPerHour) : (ai.designPerHour ?? d.designPerHour);
export const capacityOf = (perHour: number): number => Math.max(perHour > 0 ? 1 : 0, perHour * BURST);

/** The buckets brought up to now (created full the first time). */
function refill(ai: AiSettings, d: BudgetDefaults, now: number): NonNullable<AiSettings['bucket']> {
  const capA = capacityOf(perHourOf(ai, 'agent', d)),
    capD = capacityOf(perHourOf(ai, 'design', d));
  const b = (ai.bucket ??= { agent: capA, design: capD, at: now });
  const dt = Math.max(0, now - b.at);
  b.agent = Math.min(capA, b.agent + (dt * perHourOf(ai, 'agent', d)) / HOUR);
  b.design = Math.min(capD, b.design + (dt * perHourOf(ai, 'design', d)) / HOUR);
  b.at = Math.max(b.at, now);
  return b;
}

/** Whole calls the budget has left of a kind right now. */
export function callsLeft(ai: AiSettings, kind: CallKind, d: BudgetDefaults, now: number): number {
  return Math.floor(refill(ai, d, now)[kind]);
}

/** A call of this kind may go now; `keep` holds that many back (a restyle leaves room for chat's own builds). */
export function canSpend(ai: AiSettings, kind: CallKind, d: BudgetDefaults, now: number, keep = 0): boolean {
  return !ai.enforced || refill(ai, d, now)[kind] >= 1 + keep;
}

/** Book one call: false (and nothing booked) when the budget is enforced and has none left. */
export function spend(ai: AiSettings, kind: CallKind, d: BudgetDefaults, now: number): boolean {
  const b = refill(ai, d, now);
  if (ai.enforced && b[kind] < 1) return false;
  b[kind] = Math.max(0, b[kind] - 1);
  ai.callsUsed++;
  const minute = Math.floor(now / MINUTE);
  const rows = (ai.minutes ??= []);
  let row = rows[rows.length - 1];
  if (!row || row[0] !== minute) rows.push((row = [minute, 0, 0]));
  row[kind === 'agent' ? 1 : 2]++;
  while (rows.length && (rows[0][0] <= minute - 60 || rows.length > 61)) rows.shift();
  return true;
}

/** Calls made in the last hour and the last five minutes, of each kind. */
export function recentCalls(ai: AiSettings, now: number): { agentHour: number; designHour: number; agent5m: number; design5m: number } {
  const minute = Math.floor(now / MINUTE);
  const out = { agentHour: 0, designHour: 0, agent5m: 0, design5m: 0 };
  for (const [m, a, des] of ai.minutes ?? []) {
    if (m <= minute - 60) continue;
    out.agentHour += a;
    out.designHour += des;
    if (m > minute - 5) {
      out.agent5m += a;
      out.design5m += des;
    }
  }
  return out;
}
