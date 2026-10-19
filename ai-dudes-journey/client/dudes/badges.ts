// Collectables on a name tag: one small icon per kind earned on the journey (the water droplet for a
// river, the boss's face for a boss, a star for reaching the end of a leg), a count when there is
// more than one of a kind, and only the newest few unless the chatter asked to see them all.
// Inline SVG, so they look the same in OBS as in a browser, with no emoji font involved.

const svg = (body: string) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
const ICONS: Record<string, string> = {
  river: svg('<path d="M8 1.5C6 5 3.5 7.6 3.5 10.2a4.5 4.5 0 0 0 9 0C12.5 7.6 10 5 8 1.5z" fill="#5fb3e8" stroke="#1d4f72" stroke-width="1"/><path d="M6 10.5a2 2 0 0 0 2 2" stroke="#e9f6ff" stroke-width="1.2" fill="none" stroke-linecap="round"/>'),
  'boss:moss-troll': svg('<circle cx="8" cy="8.5" r="6" fill="#6f9a4a" stroke="#2d4220"/><path d="M3 6l2-3 1.5 2.2M13 6l-2-3-1.5 2.2" fill="#6f9a4a" stroke="#2d4220"/><circle cx="6" cy="8" r="1" fill="#1b2414"/><circle cx="10" cy="8" r="1" fill="#1b2414"/><path d="M5.5 11.5h5" stroke="#1b2414" stroke-width="1.2"/><path d="M6 11.5v-1.2M10 11.5v-1.2" stroke="#f3eedc" stroke-width="1"/>'),
  'boss:iron-boar': svg('<ellipse cx="8" cy="9" rx="6" ry="5" fill="#7e8790" stroke="#2c3238"/><ellipse cx="8" cy="11" rx="2.4" ry="1.6" fill="#b8a4a0" stroke="#2c3238" stroke-width=".8"/><path d="M4.5 11.5l-1.5-3M11.5 11.5l1.5-3" stroke="#f3eedc" stroke-width="1.3" stroke-linecap="round"/><circle cx="6" cy="7.5" r=".9" fill="#c43"/><circle cx="10" cy="7.5" r=".9" fill="#c43"/>'),
  'boss:old-gnarl': svg('<path d="M8 1.5l5 4.5-1.5 8.5h-7L3 6z" fill="#7a5a3a" stroke="#2f2114"/><circle cx="6.3" cy="7.5" r="1" fill="#f2c94c"/><circle cx="9.7" cy="7.5" r="1" fill="#f2c94c"/><path d="M6 11c1.3-.8 2.7-.8 4 0" stroke="#2f2114" stroke-width="1.1" fill="none"/>'),
  star: svg('<path d="M8 1.5l1.9 4.1 4.4.5-3.3 3 .9 4.4L8 11.3 4.1 13.5l.9-4.4-3.3-3 4.4-.5z" fill="#f2c94c" stroke="#6d5413"/>'),
  other: svg('<circle cx="8" cy="8" r="5.5" fill="#c9b37a" stroke="#5d4c22"/>'),
};
export const iconOf = (kind: string) => ICONS[kind] ?? (kind.startsWith('arrived') ? ICONS.star : kind.startsWith('boss:') ? ICONS['boss:moss-troll'] : ICONS.other);

/** Shown at most this many kinds unless opened; beyond that, the newest few and a count. */
const COLLAPSE_AT = 4,
  SHOW_COLLAPSED = 3;

/** The tag's badge markup and roughly how many characters wide it is (for decluttering). */
export function badgeMarkup(badges: [string, number][] | undefined, open: boolean | undefined): { html: string; chars: number } {
  if (!badges?.length) return { html: '', chars: 0 };
  const total = badges.reduce((n, [, c]) => n + c, 0);
  const shown = open || badges.length <= COLLAPSE_AT ? badges : badges.slice(-SHOW_COLLAPSED);
  let chars = 1;
  let html = '';
  for (const [kind, count] of shown) {
    html += `<i>${iconOf(kind)}${count > 1 ? `<small>${count}</small>` : ''}</i>`;
    chars += 2 + (count > 1 ? String(count).length : 0);
  }
  if (shown.length < badges.length) {
    const rest = total - shown.reduce((n, [, c]) => n + c, 0);
    html += `<b>+${rest}</b>`;
    chars += 1 + String(rest).length;
  }
  return { html, chars };
}
