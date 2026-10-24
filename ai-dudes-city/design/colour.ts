// How the design board reads a colour the way a viewer does: is it the red side's red, the gold side's
// gold (board/design-system.md §2)? Shared by the checks on astra's answers (design/story.ts) and the
// cast board's pixel counts (design/board/cast.ts), so both judge red and gold the same way.

export function hsl(hex: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
/** Would a viewer read this as the red side's red? A saturated mid red (the hide browns, ochres and oranges are not). */
export function readsRed(hex: string): boolean {
  const c = hsl(hex);
  return !!c && (c[0] >= 345 || c[0] <= 8) && c[1] >= 0.45 && c[2] >= 0.2 && c[2] <= 0.62;
}
/** Would a viewer read this as the gold side's gold? A bright saturated yellow-gold (bronze browns and sand are not). */
export function readsGold(hex: string): boolean {
  const c = hsl(hex);
  return !!c && c[0] >= 38 && c[0] <= 54 && c[1] >= 0.7 && c[2] >= 0.45 && c[2] <= 0.75;
}
