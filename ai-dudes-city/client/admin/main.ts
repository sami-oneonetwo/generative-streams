// The operator's dashboard: the World card (age, switches, quick actions) up front, the characters and
// builds beside it, test chat, and everything else folded into Advanced. Polls /admin/api/status every
// two seconds and re-renders without disturbing focus, open menus, open <details> or half-typed input.
import type { AdminStatus } from '../../src/shared/protocol';
import type { DudesAdminStatus } from '../../src/shared/dudesTypes';
import { shortRef } from '../../src/shared/objectTypes';
import { AGES } from '../../src/shared/ages';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

type ApiError = Error & { status?: number };

async function api(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`/admin/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(($('operator-token') as HTMLInputElement).value
        ? { Authorization: `Bearer ${($('operator-token') as HTMLInputElement).value}` }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* plain text */
    }
    const error: ApiError = new Error(message || `${path}: HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// ---- feedback -----------------------------------------------------------

function toast(text: string, kind: 'ok' | 'bad' = 'ok'): void {
  const el = document.createElement('div');
  el.className = `toast${kind === 'bad' ? ' bad' : ''}`;
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 2600);
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
function refreshSoon(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh(), 250);
}

/** Runs a world admin action; toasts the outcome. */
async function run(id: string, value?: string | number, done?: string): Promise<boolean> {
  try {
    await api('/action', value === undefined ? { id } : { id, value });
    if (done) toast(done);
    refreshSoon();
    return true;
  } catch (e) {
    toast(errText(e), 'bad');
    return false;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function ago(ms: number): string {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
const focused = (el: Element) => document.activeElement === el;
/** Sets text only when it changed, so a scrolled <pre> keeps its place. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
function setHtml(el: HTMLElement, html: string): void {
  if (el.dataset.html !== html) {
    el.dataset.html = html;
    el.innerHTML = html;
  }
}

// ---- operator token -----------------------------------------------------

const tokenRow = $('token-row');
function showToken(show: boolean): void {
  tokenRow.hidden = !show;
  $('token-toggle').setAttribute('aria-expanded', String(show));
  if (show) ($('operator-token') as HTMLInputElement).focus();
}
$('token-toggle').onclick = () => showToken(tokenRow.hidden);
$('operator-connect').onclick = () => void refresh();
($('operator-token') as HTMLInputElement).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void refresh();
});

// ---- switches -----------------------------------------------------------

interface Switch {
  el: HTMLButtonElement;
  label: string;
  read: (s: AdminStatus) => boolean | undefined;
  set: (on: boolean) => Promise<unknown>;
  /** What was just asked for: the poll leaves it alone until the server agrees (or a few seconds pass). */
  pending?: { want: boolean; until: number };
}
const action = (on: string, off: string) => (v: boolean) => api('/action', { id: v ? on : off });
const switches: Switch[] = [
  { el: $('sw-ai'), label: 'AI agents', read: (s) => (s.dudes ? !s.dudes.ai.paused : undefined), set: action('ai-resume', 'ai-pause') },
  { el: $('sw-town'), label: 'Town life', read: (s) => (s.dudes ? s.dudes.ai.townLife !== false : undefined), set: action('town-on', 'town-off') },
  { el: $('sw-caravan'), label: 'Caravan', read: (s) => (s.dudes ? s.dudes.ai.caravan !== false : undefined), set: action('caravan-on', 'caravan-off') },
  { el: $('sw-themes'), label: 'Age themes', read: (s) => (s.dudes ? s.dudes.ai.themes !== false : undefined), set: action('themes-on', 'themes-off') },
  { el: $('sw-events'), label: 'Troublemakers', read: (s) => s.dudes?.ai.events, set: action('events-on', 'events-off') },
  { el: $('sw-idle'), label: 'Idle turns', read: (s) => s.dudes?.ai.idleLife, set: action('idle-on', 'idle-off') },
  { el: $('sw-enforce'), label: 'Call limit', read: (s) => s.dudes?.ai.enforced, set: action('allowance-enforce', 'allowance-ignore') },
  { el: $('sw-listener'), label: 'Listener', read: (s) => s.dudes?.listener?.enabled, set: action('listener-on', 'listener-off') },
  { el: $('sw-kick-replies'), label: 'Kick replies', read: (s) => s.flags.kickRepliesEnabled, set: (v) => api('/flags', { kickRepliesEnabled: v }) },
  { el: $('sw-crier'), label: 'Town Crier', read: (s) => s.flags.crierEnabled, set: (v) => api('/flags', { crierEnabled: v }) },
];
const paint = (sw: Switch, on: boolean) => sw.el.setAttribute('aria-checked', String(on));
for (const sw of switches) {
  sw.el.onclick = async () => {
    const want = sw.el.getAttribute('aria-checked') !== 'true';
    sw.pending = { want, until: Date.now() + 5000 };
    paint(sw, want);
    sw.el.classList.add('pending');
    try {
      await sw.set(want);
      toast(`${sw.label} ${want ? 'on' : 'off'}`);
    } catch (e) {
      sw.pending = undefined;
      paint(sw, !want);
      toast(`${sw.label}: ${errText(e)}`, 'bad');
    } finally {
      sw.el.classList.remove('pending');
      refreshSoon();
    }
  };
}
function syncSwitches(s: AdminStatus): void {
  for (const sw of switches) {
    const v = sw.read(s);
    sw.el.disabled = v === undefined;
    if (v === undefined) continue;
    if (sw.pending && Date.now() < sw.pending.until && v !== sw.pending.want) continue;
    sw.pending = undefined;
    paint(sw, v);
  }
}

// ---- age ----------------------------------------------------------------

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ageLabel = (i: number) => `${cap(AGES[i].name.replace(/^the /i, ''))} — the ${AGES[i].head.title}`;
const ageSelect = $('age-select') as HTMLSelectElement;
const ageStatus = $('age-status');
ageSelect.innerHTML = AGES.map((a, i) => `<option value="${a.id}">${esc(ageLabel(i))}</option>`).join('');
ageSelect.disabled = true;
let ageWant: { index: number; until: number } | undefined;
let ageDebounce: ReturnType<typeof setTimeout> | undefined;
let ageStatusTimer: ReturnType<typeof setTimeout> | undefined;
function setAgeStatus(text: string, cls = ''): void {
  ageStatus.textContent = text;
  ageStatus.className = `status-text ${cls}`;
  clearTimeout(ageStatusTimer);
  if (cls === 'ok') ageStatusTimer = setTimeout(() => setAgeStatus(''), 4000);
}
// A short wait lets arrow keys step through the list without switching the world at every step.
ageSelect.onchange = () => {
  clearTimeout(ageDebounce);
  const index = ageSelect.selectedIndex;
  ageWant = { index, until: Date.now() + 8000 };
  setAgeStatus('Switching…');
  ageDebounce = setTimeout(async () => {
    try {
      await api('/action', { id: 'set-age', value: AGES[index].id });
      setAgeStatus(`✓ Now ${AGES[index].name}`, 'ok');
      // Let go of the select so the poll can keep it in step with the world from here on.
      if (focused(ageSelect)) ageSelect.blur();
      refreshSoon();
    } catch (e) {
      ageWant = undefined;
      // Back to the age the world is actually in: the poll leaves a focused select alone.
      const age = last?.dudes?.town?.age;
      if (age !== undefined) ageSelect.selectedIndex = age;
      setAgeStatus(`Couldn't switch: ${errText(e)}`, 'bad');
    }
  }, 250);
};
function syncAge(age: number | undefined): void {
  ageSelect.disabled = age === undefined;
  if (age === undefined || focused(ageSelect)) return;
  if (ageWant && Date.now() < ageWant.until && age !== ageWant.index) return;
  ageWant = undefined;
  if (ageSelect.selectedIndex !== age) ageSelect.selectedIndex = age;
}

// ---- world: quick actions, project, town name ---------------------------

$('qa-party').onclick = () => void run('party', 'square', 'Party on the square!');
$('qa-designs-cancel').onclick = () => {
  if (confirm('Cancel every waiting and in-flight design (and the pending restyles)?\n\nThe AI stays on; chatters can ask again.')) void run('designs-cancel', undefined, 'Designs cancelled');
};
$('qa-clear-bubbles').onclick = () => void run('clear-say', 'all', 'Every bubble cleared');
$('qa-clear-feed').onclick = () => void run('feed-clear', undefined, 'Feed cleared');
$('qa-trouble-send').onclick = () => {
  const sel = $('qa-trouble') as HTMLSelectElement;
  void run('event-now', sel.value, `Sent: ${sel.options[sel.selectedIndex].text}`);
};
$('pj-finish').onclick = () => void run('project-finish', undefined, 'Community project finished');
$('pj-shelve').onclick = () => {
  if (!confirm('Shelve the community project? Coins go back to whoever chipped in.')) return;
  void run('project-shelve', undefined, 'Community project shelved');
};
let townName = '';
$('town-rename').onclick = () => {
  const v = prompt('Rename the town', townName)?.trim();
  if (!v || v === townName) return;
  void run('rename-town', v.slice(0, 40), `Town renamed to ${v.slice(0, 40)}`);
};

function renderWorld(d: DudesAdminStatus | undefined): void {
  const town = d?.town;
  syncAge(town?.age);
  townName = town?.name ?? '';
  setText($('town-name'), townName || '—');
  $('town-rename').toggleAttribute('disabled', !town);

  // What is happening right now, under the quick actions.
  const bits: string[] = [];
  if (d?.happening)
    bits.push(
      `Now: <b>${esc(d.happening.title)}</b> ${esc(d.happening.text)}${
        d.happening.until ? ` (${clock((d.happening.until - Date.now()) / 1000)} left)` : ''
      }`,
    );
  else if (d && !d.ai.events) bits.push('Troublemakers are off.');
  else if (d?.nextHappeningInS !== undefined) bits.push(`Next troublemaker in ${clock(d.nextHappeningInS)}.`);
  if (town?.party) bits.push(`🎉 <b>${esc(town.party.title)}</b> is on.`);
  setHtml($('happening'), bits.join('<br>'));

  const p = town?.project;
  $('project-wrap').hidden = !p;
  if (p) {
    setText($('pj-name'), p.name);
    setText($('pj-status'), p.status);
    const coinPct = p.coinsNeed ? Math.min(100, Math.round((p.coins / p.coinsNeed) * 100)) : 100;
    const workPct = p.workNeed ? Math.min(100, Math.round((p.work / p.workNeed) * 100)) : 100;
    setText($('pj-coins'), `Coins §${p.coins} / §${p.coinsNeed}`);
    setText($('pj-work'), `Built ${workPct}%`);
    $('pj-bar-coins').style.width = `${coinPct}%`;
    $('pj-bar-work').style.width = `${workPct}%`;
    ($('pj-finish') as HTMLButtonElement).disabled = p.status !== 'gathering';
    $('pj-finish').title = p.status === 'gathering' ? '' : 'Only while it is gathering coins and labour';
  }
}

// ---- header -------------------------------------------------------------

function pill(cls: string, html: string, title = ''): string {
  return `<span class="pill ${cls}"${title ? ` title="${esc(title)}"` : ''}>${html}</span>`;
}
function renderHeader(s: AdminStatus): void {
  const d = s.dudes;
  const town = d?.town?.name ?? s.worldName;
  setText($('h-town'), town);
  document.title = `${town} · AI Dudes admin`;
  const k = s.kick;
  const out: string[] = [
    k.connected
      ? pill('ok', `Kick · <b>${esc(k.username ?? 'connected')}</b>`, 'Kick chat connected')
      : pill(k.disabled ? '' : 'bad', k.disabled ? 'Kick: off' : 'Kick: not connected', k.disabled ? 'Kick chat is turned off in this process' : ''),
  ];
  if (d) {
    const ai = d.ai;
    out.push(
      d.fixture
        ? pill('warn', 'AI <b>fixture</b>', 'Canned agents, no model calls')
        : !ai.available
          ? pill('bad', 'AI <b>unavailable</b>', 'Check the provider configuration')
          : ai.paused
            ? pill('bad', 'AI <b>PAUSED</b>')
            : pill('ok', 'AI <b>live</b>'),
    );
    const awake = d.dudes.filter((x) => x.awake).length;
    out.push(pill(awake ? 'ok' : '', `<b>${awake}</b> awake / ${d.dudes.length} ${d.dudes.length === 1 ? 'chatter' : 'chatters'}`));
    const b = ai.budget;
    out.push(
      d.fixture
        ? ''
        : !ai.enforced
          ? pill('bad', `⚠ AI cap <b>OFF</b>${b ? ` · ≈${usd(b.usdPerHourNow)}/h` : ''}`, 'Nothing limits AI spend: turn "Enforce the budget" on under Advanced')
          : b
            ? pill(b.agentLeft < 1 || b.designLeft < 1 ? 'warn' : 'ok', `Budget ≈<b>${usd(b.usdPerHourNow)}</b>/h`, `${b.agentLeft} agent and ${b.designLeft} design calls left right now (${b.agentPerHour}/${b.designPerHour} an hour)`)
            : '',
    );
  }
  setHtml($('pills'), out.join(''));
}

// ---- characters ---------------------------------------------------------
// One element per chatter, kept across polls and updated in place, so focus, an open menu or an open
// persona survive. Rows are re-sorted (most recently heard first) only while the operator isn't
// pointing at or working in the card, so a row never slides under the cursor between aim and click.

type PersonRow = DudesAdminStatus['dudes'][number];
const people = $('people');
const peopleEmpty = $('people-empty');
const rowEls = new Map<string, HTMLElement>();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function personEl(r: PersonRow): HTMLElement {
  const el = document.createElement('div');
  el.className = 'person';
  el.dataset.id = r.id;
  el.innerHTML =
    `<div class="main"><div class="who"><i class="dot"></i><b class="nm"></b><span class="title"></span>` +
    `<span class="badge warn muted-badge">muted</span></div><div class="meta"></div></div>` +
    `<div class="acts">` +
    `<button class="sm" data-act="mute"></button>` +
    `<button class="sm" data-act="coins">Give coins</button>` +
    `<details class="menu"><summary class="btn sm" title="More actions">⋯</summary><div class="menu-pop">` +
    `<button class="sm" data-act="send-home" title="Stops whatever it is doing and walks it home">Send home</button>` +
    `<button class="sm" data-act="clear-say" title="Takes its speech bubble off screen">Clear bubble</button>` +
    `<button class="sm danger" data-act="forget" title="Wipes persona, title, memories and look; builds stay">Reset agent…</button>` +
    `<button class="sm danger" data-act="release-lot" title="Their builds on it go too">Take lot back…</button>` +
    `<button class="sm danger" data-act="remove-dude">Remove…</button>` +
    `</div></details></div>` +
    `<details class="more"><summary></summary><div class="persona"></div></details>` +
    `<div class="lasterr"></div>`;
  return el;
}

function fillPerson(el: HTMLElement, r: PersonRow): void {
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  el.dataset.name = r.name;
  el.classList.toggle('awake', r.awake);
  q('.dot').title = r.awake ? 'Awake' : 'Napping';
  setText(q('.nm'), r.name);
  const title = q('.title');
  title.hidden = !r.title;
  setText(title, r.title ?? '');
  q('.muted-badge').hidden = !r.muted;
  setHtml(
    q('.meta'),
    `<span><b>${r.coins ?? 0}</b> coins</span><span>${plural(r.builds, 'build').replace(/^(\d+)/, '<b>$1</b>')}</span>` +
      `<span><b>${r.inbox}</b> in inbox</span><span>heard ${ago(r.lastHeardAt)}</span>`,
  );
  const mute = q<HTMLButtonElement>('[data-act="mute"], [data-act="unmute"]');
  mute.dataset.act = r.muted ? 'unmute' : 'mute';
  setText(mute, r.muted ? 'Unmute' : 'Mute');
  q('details.menu > summary').setAttribute('aria-label', `More actions for ${r.name}`);
  const persona = r.persona || 'No persona yet';
  setText(q('.more > summary'), persona.length > 90 ? persona.slice(0, 87) + '…' : persona);
  setHtml(
    q('.persona'),
    esc(persona) +
      (r.memory.length
        ? `<ul>${r.memory.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
        : '<div class="muted" style="margin-top:6px">No memories.</div>'),
  );
  const err = q('.lasterr');
  err.hidden = !r.lastError;
  setText(err, r.lastError ? `⚠ ${r.lastError}` : '');
}

/** The operator is aiming at or using the card: hold the order still. */
const interacting = () =>
  people.matches(':hover') || people.contains(document.activeElement) || !!people.querySelector('details.menu[open]');

function renderPeople(d: DudesAdminStatus | undefined): void {
  const rows = [...(d?.dudes ?? [])].sort((a, b) => b.lastHeardAt - a.lastHeardAt);
  setText($('dudes-count'), d ? String(rows.length) : '');
  peopleEmpty.hidden = rows.length > 0;
  setText(peopleEmpty, d ? 'Nobody has chatted yet.' : 'This world has no characters.');
  const seen = new Set(rows.map((r) => r.id));
  for (const [id, el] of rowEls)
    if (!seen.has(id)) {
      el.remove();
      rowEls.delete(id);
    }
  for (const r of rows) {
    let el = rowEls.get(r.id);
    if (!el) {
      el = personEl(r);
      rowEls.set(r.id, el);
      people.appendChild(el); // at the end for now: nothing shifts under the cursor
    }
    fillPerson(el, r);
  }
  if (interacting()) return;
  rows.forEach((r, i) => {
    const el = rowEls.get(r.id)!;
    const at = people.children[i + 1]; // children[0] is the empty-state line
    if (at !== el) people.insertBefore(el, at ?? null);
  });
}

// One open "⋯" menu at a time; a click anywhere else closes it.
people.addEventListener(
  'toggle',
  (e) => {
    const t = e.target as HTMLDetailsElement;
    if (t.classList.contains('menu') && t.open)
      people.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach((m) => {
        if (m !== t) m.open = false;
      });
  },
  true,
);
document.addEventListener('click', (e) => {
  const inside = (e.target as HTMLElement).closest('details.menu');
  people.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach((m) => {
    if (m !== inside) m.open = false;
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') people.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach((m) => (m.open = false));
});

people.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  const row = btn?.closest<HTMLElement>('.person');
  if (!btn || !row) return;
  // Read at click time from the row the button sits in.
  const name = row.dataset.name!;
  const menu = btn.closest<HTMLDetailsElement>('details.menu');
  if (menu) menu.open = false;
  switch (btn.dataset.act) {
    case 'mute':
      void run('mute', name, `${name} muted`);
      break;
    case 'unmute':
      void run('unmute', name, `${name} unmuted`);
      break;
    case 'coins': {
      const raw = prompt(`Give ${name} coins (a minus takes some away)`, '100');
      if (raw === null) return;
      const n = Number(raw.trim());
      if (!Number.isSafeInteger(n) || n === 0) {
        toast('Enter a whole number of coins, like 100 or -50', 'bad');
        return;
      }
      void run('coins', `${name} ${n}`, n > 0 ? `Gave ${name} ${plural(n, 'coin')}` : `Took ${plural(-n, 'coin')} from ${name}`);
      break;
    }
    case 'send-home':
      void run('send-home', name, `${name} sent home`);
      break;
    case 'clear-say':
      void run('clear-say', name, `${name}'s bubble cleared`);
      break;
    case 'forget':
      if (confirm(`Reset ${name}'s agent?\n\nTheir persona, title, memories and look are wiped. Their builds stay.`))
        void run('forget', name, `${name}'s agent reset`);
      break;
    case 'release-lot':
      if (confirm(`Take ${name}'s lot back?\n\nTheir builds on it are removed too.`)) void run('release-lot', name, `${name}'s lot taken back`);
      break;
    case 'remove-dude':
      if (confirm(`Remove ${name} and all their builds?`)) void run('remove-dude', name, `${name} removed`);
      break;
  }
});

// ---- builds -------------------------------------------------------------

const BUILDS_SHOWN = 10;
/** "painted by Gary the Painter; use it…" → "painted" (the culprit is in the badge's tooltip). */
function damageTag(damage: string): string {
  const first = damage.split(';')[0].trim();
  if (/^a pile of stolen hats/i.test(first)) return 'hat pile';
  return /^(.+?) by /.exec(first)?.[1] ?? first;
}
let showAllBuilds = false;
let buildsKey = '';
function renderBuilds(d: DudesAdminStatus | undefined): void {
  const objects = d?.objects ?? [];
  setText($('builds-count'), d ? String(objects.length) : '');
  const names = new Map((d?.dudes ?? []).map((x) => [x.id, x.name]));
  const key = JSON.stringify([objects, showAllBuilds, [...names]]);
  if (key === buildsKey) return;
  buildsKey = key;
  // The town lists builds oldest first; the one just put up is the one most likely to need removing.
  const newest = [...objects].reverse();
  const shown = showAllBuilds ? newest : newest.slice(0, BUILDS_SHOWN);
  $('builds').innerHTML = shown.length
    ? shown
        .map((o) => {
          const ref = shortRef(o.id);
          return (
            `<div class="build" data-ref="${esc(ref)}" data-name="${esc(o.name)}">` +
            `<span class="ref">#${esc(ref)}</span>` +
            `<span class="nm">${esc(o.name)} <span class="by">· ${esc(names.get(o.createdBy) ?? o.createdBy)}</span></span>` +
            (o.damage ? `<span class="badge warn dmg" title="${esc(o.damage.split(';')[0].trim())}">${esc(damageTag(o.damage))}</span>` : '') +
            `<button class="sm danger" data-act="remove-build">Remove</button></div>`
          );
        })
        .join('')
    : '<div class="muted">The town has no builds yet.</div>';
  const more = $('builds-more') as HTMLButtonElement;
  more.hidden = objects.length <= BUILDS_SHOWN;
  more.textContent = showAllBuilds ? 'Show fewer' : `Show all ${objects.length}`;
}
$('builds-more').onclick = () => {
  showAllBuilds = !showAllBuilds;
  buildsKey = '';
  if (last) renderBuilds(last.dudes);
};
$('builds').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button[data-act="remove-build"]');
  const row = btn?.closest<HTMLElement>('.build');
  if (!row) return;
  const { ref, name } = row.dataset;
  if (confirm(`Remove "${name}" (#${ref})?`)) void run('remove-build', `#${ref}`, `Removed ${name}`);
});

// ---- test chat ----------------------------------------------------------

// Examples only fill the box; nothing is sent until "Send".
const CANNED: [string, string][] = [
  ['pirate', "hi! I'm a grumpy pirate who loves boats"],
  ['lighthouse', 'build me a tiny lighthouse'],
  ['hang out', 'go hang out with alex and dance'],
  ['pink', 'make my build pink'],
  ['wizard', 'make me look like a wizard'],
  ['nap', 'lie down for a bit'],
];
const injUser = $('inj-user') as HTMLInputElement;
const injText = $('inj-text') as HTMLInputElement;
$('inj-send').onclick = async () => {
  const username = injUser.value.trim();
  const text = injText.value.trim();
  if (!username || !text) {
    toast(username ? 'Type a message first' : 'Enter a username first', 'bad');
    return;
  }
  try {
    await api('/chat', { username, text });
    injText.value = '';
    toast(`Sent as ${username}`);
    refreshSoon();
  } catch (e) {
    toast(errText(e), 'bad');
  }
};
injText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ($('inj-send') as HTMLButtonElement).click();
});
for (const [label, text] of CANNED) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.textContent = label;
  b.onclick = () => {
    injText.value = text;
    injText.focus();
  };
  $('canned').appendChild(b);
}

// Simulate chat: every line at once, to exercise the agents in parallel.
$('sim-send').onclick = () => {
  const lines = ($('sim-lines') as HTMLTextAreaElement).value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf(':');
      return at > 0 ? { username: line.slice(0, at).trim(), text: line.slice(at + 1).trim() } : undefined;
    })
    .filter((m): m is { username: string; text: string } => !!m && !!m.username && !!m.text);
  const result = $('sim-result');
  if (!lines.length) {
    result.textContent = 'Nothing to send: use "username: message" per line';
    return;
  }
  result.textContent = `Sending ${lines.length}…`;
  void Promise.allSettled(lines.map((m) => api('/chat', m))).then((outcomes) => {
    const failed = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    result.textContent =
      `Sent ${outcomes.length - failed.length}/${outcomes.length}` + (failed.length ? ` · first error: ${errText(failed[0].reason)}` : '');
    refreshSoon();
  });
};

// ---- advanced: allowance, listener, kick, engine ------------------------

// Fields the poll fills in (calls left, time scale) stop being refreshed once the operator types in
// them, until they set the value (or put it back as it was).
const dirty = new WeakSet<HTMLInputElement>();
const trackDirty = (el: HTMLInputElement) => el.addEventListener('input', () => dirty.add(el));
function fillField(el: HTMLInputElement, value: string): void {
  if (dirty.has(el) && el.value === value) dirty.delete(el);
  if (!dirty.has(el) && !focused(el) && el.value !== value) el.value = value;
}

// The rolling AI budget: agent and design calls per hour, each with its own field.
const budgetAgent = $('budget-agent') as HTMLInputElement;
const budgetDesign = $('budget-design') as HTMLInputElement;
for (const [input, id, what] of [
  [budgetAgent, 'budget-agent', 'agent'],
  [budgetDesign, 'budget-design', 'design'],
] as const) {
  trackDirty(input);
  const set = () => {
    const n = Number(input.value);
    if (input.value === '' || !Number.isFinite(n) || n < 0) {
      toast('Enter a number of calls per hour first', 'bad');
      return;
    }
    void run(id, Math.floor(n), `Budget: ${Math.floor(n)} ${what} calls an hour`).then((ok) => {
      if (ok) dirty.delete(input);
    });
  };
  $(`${id}-set`).onclick = set;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') set();
  });
}
function usd(n: number): string {
  return `$${n < 10 ? n.toFixed(2) : Math.round(n)}`;
}

$('listener-now').onclick = () => void run('listener-now', undefined, 'Listener is reading chat');
$('listener-clear').onclick = () => {
  if (confirm('Clear every wish and tip the Listener has collected?')) void run('listener-clear', undefined, 'Wishes and tips cleared');
};

$('kick-resub').onclick = () => {
  api('/kick/resubscribe', {})
    .then(() => toast('Resubscribed to Kick events'))
    .catch((e) => toast(errText(e), 'bad'));
};
$('btn-save').onclick = () => {
  api('/save', {})
    .then(() => toast('World saved'))
    .catch((e) => toast(errText(e), 'bad'));
};
$('btn-reset').onclick = () => {
  const ok = confirm(
    'Reset the whole world to a fresh start?\n\n' +
      'Every character, persona, memory and build is removed and the field comes back empty. ' +
      'A backup of the current world is saved first, and AI pause/allowance settings are kept.',
  );
  if (!ok) return;
  api('/reset', { confirm: 'RESET' })
    .then((r) => {
      toast(`World reset. Backup: ${(r as { backup: string | null }).backup ?? 'none (no saved world yet)'}`);
      refreshSoon();
    })
    .catch((e) => toast(errText(e), 'bad'));
};

const tsInput = $('flag-timescale') as HTMLInputElement;
trackDirty(tsInput);
const setTimeScale = (n: number) => {
  if (!Number.isFinite(n) || n < 1 || n > 10_000) {
    toast('Time scale must be between 1 and 10000', 'bad');
    return Promise.resolve();
  }
  return api('/flags', { devTimeScale: n })
    .then(() => {
      dirty.delete(tsInput);
      toast(`Time scale ×${n}`);
    })
    .catch((e) => toast(errText(e), 'bad'));
};
$('flag-timescale-set').onclick = () => void setTimeScale(Number(tsInput.value));
tsInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void setTimeScale(Number(tsInput.value));
});
document.querySelectorAll<HTMLButtonElement>('button[data-ts]').forEach((b) => {
  b.onclick = () => {
    tsInput.value = b.dataset.ts!;
    void setTimeScale(Number(b.dataset.ts));
  };
});

function renderAdvanced(s: AdminStatus): void {
  const d = s.dudes;
  if (d) {
    const ai = d.ai;
    const b = ai.budget;
    $('budget-warn').hidden = ai.enforced || d.fixture;
    if (b) {
      fillField(budgetAgent, String(b.agentPerHour));
      fillField(budgetDesign, String(b.designPerHour));
      setHtml(
        $('allow-info'),
        `Last hour: <b style="color:var(--text)">${b.agentHour}</b> agent + <b style="color:var(--text)">${b.designHour}</b> design calls ≈ <b style="color:var(--text)">${usd(b.usdLastHour)}</b>` +
          ` · pace now ≈ <b class="${b.usdPerHourNow > 30 ? 'bad' : b.usdPerHourNow > 10 ? 'warn' : 'ok'}">${usd(b.usdPerHourNow)}/h</b>` +
          `<br>Left right now: <b class="${ai.enforced && b.agentLeft < 1 ? 'bad' : 'ok'}">${b.agentLeft}</b> agent · <b class="${ai.enforced && b.designLeft < 1 ? 'bad' : 'ok'}">${b.designLeft}</b> design` +
          ` <span class="muted">(${ai.callsUsed} calls ever; estimate at ${usd(b.agentUsd)}/${usd(b.designUsd)} a call)</span>`,
      );
    }
    setHtml(
      $('ai-models'),
      `${d.fixture ? '<span class="warn">Fixture mode: canned agents, no AI calls.</span><br>' : ''}` +
        `Models: agent ${esc(d.models.agent)} · design ${esc(d.models.design)}${d.models.listener ? ` · listener ${esc(d.models.listener)}` : ''}`,
    );
    setHtml(
      $('ai-flight'),
      `${ai.thinking}/${ai.agentLimit} thinking · ${ai.designing}/${ai.designLimit} designing · ${ai.waiting} waiting`,
    );
    const names = new Map(d.dudes.map((x) => [x.id, x.name]));
    setHtml(
      $('dudes-jobs'),
      d.jobs.length
        ? d.jobs
            .map(
              (j) =>
                `${esc(names.get(j.dude) ?? j.dude)} · ${j.kind} · ${esc(j.label)} · ` +
                `<span class="${j.status === 'failed' ? 'bad' : j.status === 'done' ? 'ok' : 'warn'}">${j.status}</span>` +
                (j.error ? ` <span class="err">— ${esc(j.error)}</span>` : ''),
            )
            .join('\n')
        : '<span class="muted">No jobs.</span>',
    );
  }
  renderListener(d?.listener);

  const k = s.kick;
  const yes = (v: boolean) => `<span class="${v ? 'ok' : 'bad'}">${v ? 'yes' : 'no'}</span>`;
  setHtml(
    $('kick-info'),
    [
      ['ingestion', k.disabled ? '<span class="bad">disabled in this process</span>' : '<span class="ok">enabled</span>'],
      ['configured', yes(k.configured)],
      ['connected', `${yes(k.connected)}${k.username ? ` as <b>${esc(k.username)}</b>` : ''}`],
      ['subscription', `<span class="${k.subscription ? 'ok' : 'warn'}">${esc(k.subscription ?? 'none')}</span>`],
      ['last webhook', k.lastWebhookAt ? new Date(k.lastWebhookAt).toLocaleTimeString() : '—'],
      ...(k.webhookPublicUrl ? [['webhook', `<span class="mono">${esc(k.webhookPublicUrl)}</span>`]] : []),
    ]
      .map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`)
      .join(''),
  );

  fillField(tsInput, String(s.flags.devTimeScale));
  setHtml(
    $('engine-info'),
    `${esc(s.worldName)} (${esc(s.worldId)}) · rev ${s.engine.rev} · ${s.engine.wsClients} viewers · queue ${s.engine.queueLength}` +
      ` · ${s.engine.currentTask ? esc(s.engine.currentTask) : 'idle'}`,
  );

  renderOtherActions(s);
  setText($('state-summary'), s.stateSummary);

  const classifications = s.engine.classifications ?? [];
  $('classifications-section').hidden = !classifications.length;
  setHtml(
    document.querySelector<HTMLElement>('#classifications tbody')!,
    classifications
      .map(
        (c) =>
          `<tr><td>${new Date(c.ts).toLocaleTimeString()}</td><td class="name">${esc(c.username)}</td>` +
          `<td>${esc(c.text.slice(0, 60))}</td>` +
          `<td class="${c.source === 'fallback' ? 'warn' : 'ok'}">${esc(c.intent)}</td>` +
          `<td>${c.confidence.toFixed(2)}</td><td>${c.source}</td></tr>`,
      )
      .join(''),
  );
}

// The Listener: what chat keeps asking for.
function renderListener(l: DudesAdminStatus['listener']): void {
  $('listener-section').hidden = !l;
  if (!l) return;
  setHtml(
    $('listener-info'),
    `${l.runs} runs · ${l.buffered} messages buffered · last run ${ago(l.lastRunAt)}` +
      (l.lastError ? `<br><span class="err">${esc(l.lastError)}</span>` : ''),
  );
  setHtml($('listener-tips'), l.tips.length ? l.tips.map((t) => `· ${esc(t)}`).join('\n') : '<span class="muted">No tips yet.</span>');
  // What the Builder (npm run builder) made of the wishes: a branch each, for review and a hand merge.
  setHtml(
    $('builder-proposals'),
    l.proposals?.length
      ? l.proposals
          .map(
            (p) =>
              `<span class="${p.status === 'ready' ? 'ok' : p.status === 'running' ? 'warn' : 'bad'}">${esc(p.status)}</span> ${esc(p.wish)}` +
              `${p.tests ? ` · tests ${esc(p.tests)}` : ''} · ${esc(p.at.slice(0, 16).replace('T', ' '))} · data/builder/${esc(p.id)}.md / .patch`,
          )
          .join('\n')
      : '<span class="muted">None yet (npm run builder, then touch data/builder/enabled).</span>',
  );
  setText($('listener-count'), String(l.wishes.length));
  const cls = (status: string) => (status === 'works-now' ? 'ok' : status === 'blocked' ? 'bad' : 'warn');
  setHtml(
    document.querySelector<HTMLElement>('#listener-wishes tbody')!,
    l.wishes
      .map(
        (w) =>
          `<tr><td class="num">${w.count}</td><td class="${cls(w.status)}">${esc(w.status)}</td>` +
          `<td class="name">${esc(w.wish)}</td><td>${esc(w.askers.join(', '))}</td>` +
          `<td>${w.examples.map((x) => `“${esc(x)}”`).join('<br>')}</td><td>${esc(w.how)}</td></tr>`,
      )
      .join('') || '<tr><td colspan="6" class="muted">No wishes yet.</td></tr>',
  );
}

// Every admin action the curated controls above don't cover, with the generic field + button, so a
// new action on the server shows up here without touching this page.
const CURATED = new Set([
  'ai-pause', 'ai-resume', 'allowance-set', 'allowance-ignore', 'allowance-enforce', 'event-now',
  'budget-agent', 'budget-design', 'designs-cancel', 'send-home', 'clear-say', 'feed-clear',
  'listener-now', 'listener-off', 'listener-on', 'listener-clear', 'party', 'project-shelve', 'project-finish',
  'coins', 'release-lot', 'set-age', 'rename-town', 'town-off', 'town-on', 'events-off', 'events-on',
  'idle-off', 'idle-on', 'mute', 'unmute', 'forget', 'remove-dude', 'remove-build',
]);
function renderOtherActions(status: AdminStatus): void {
  const actionsEl = $('actions');
  const others = status.adminActions.filter((a) => !CURATED.has(a.id));
  $('other-section').hidden = !others.length;
  const key = JSON.stringify(others);
  if (actionsEl.dataset.key === key) return;
  actionsEl.dataset.key = key;
  actionsEl.replaceChildren();
  for (const a of others) {
    const wrap = document.createElement('div');
    wrap.className = 'other-action';
    const b = document.createElement('button');
    b.className = 'sm';
    b.textContent = a.label;
    if (!a.input) {
      b.onclick = () => void run(a.id, undefined, `Done: ${a.label}`);
      wrap.appendChild(b);
      actionsEl.appendChild(wrap);
      continue;
    }
    // An action that takes a value: a small field beside its button — text, or a number by default.
    const input = a.input;
    const text = input.kind === 'text';
    const field = document.createElement('input');
    field.type = text ? 'text' : 'number';
    field.style.width = text ? '14em' : '7em';
    if (text && input.maxLength !== undefined) field.maxLength = input.maxLength;
    if (!text && input.min !== undefined) field.min = String(input.min);
    if (!text && input.max !== undefined) field.max = String(input.max);
    if (!text && input.step !== undefined) field.step = String(input.step);
    field.placeholder = input.placeholder ?? input.label;
    field.title = input.label;
    field.setAttribute('aria-label', input.label);
    b.onclick = () => {
      const raw = field.value.trim();
      const value = text ? raw : Number(raw);
      if (!raw || (!text && !Number.isFinite(value))) {
        toast(`Enter ${text ? `a ${input.label}` : 'a number'} for "${a.label}" first`, 'bad');
        return;
      }
      void run(a.id, value, `Done: ${a.label}`).then((ok) => {
        if (ok) field.value = '';
      });
    };
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') b.click();
    });
    wrap.append(field, b);
    actionsEl.appendChild(wrap);
  }
}

// ---- status poll --------------------------------------------------------

let last: AdminStatus | undefined;
let refreshing = false;
function banner(text: string | undefined): void {
  $('banner').hidden = !text;
  if (text) setText($('banner-text'), text);
}
async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  let status: AdminStatus;
  try {
    status = (await api('/status')) as AdminStatus;
  } catch (error) {
    refreshing = false;
    const code = (error as ApiError).status;
    if (code === 401) {
      banner(`${errText(error)}. Enter the operator token with the 🔒 button at the top.`);
      if (tokenRow.hidden) showToken(true);
    } else if (code) banner(errText(error));
    else banner(`Can't reach the server: ${errText(error)}`);
    return;
  }
  last = status;
  // Each card renders on its own: one that throws doesn't blank the others.
  const failures: string[] = [];
  const parts: [string, () => void][] = [
    ['header', () => renderHeader(status)],
    ['switches', () => syncSwitches(status)],
    ['world', () => renderWorld(status.dudes)],
    ['characters', () => renderPeople(status.dudes)],
    ['builds', () => renderBuilds(status.dudes)],
    ['advanced', () => renderAdvanced(status)],
  ];
  for (const [name, render] of parts) {
    try {
      render();
    } catch (e) {
      failures.push(`${name}: ${errText(e)}`);
      console.error(e);
    }
  }
  banner(failures.length ? `Dashboard error (${failures.join(' · ')})` : undefined);
  refreshing = false;
}

// --- players: chatters walking their own character from the /play page ---
interface PlayStatus {
  used: number;
  cap: number;
  open: boolean;
  configured: boolean;
  players: { userId: string; name: string; since: number; lastInputAt: number; connected: boolean }[];
}
let play: PlayStatus | undefined;
function renderPlay(p: PlayStatus): void {
  play = p;
  $('play-count').textContent = p.configured ? `${p.used}/${p.cap}` : 'PLAY_SECRET not set';
  $('play-open').textContent = p.open ? 'Doors open: close' : 'Doors closed: open';
  const cap = $('play-cap') as HTMLInputElement;
  if (document.activeElement !== cap) cap.value = String(p.cap);
  const rows = p.players.map((x) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:3px 0;border-top:1px solid #ffffff12';
    const name = document.createElement('b');
    name.textContent = x.name;
    const note = document.createElement('span');
    note.className = 'muted';
    note.style.flex = '1';
    note.textContent = `${x.connected ? 'on' : 'reconnecting'} · ${Math.round((Date.now() - x.since) / 60_000)} min · idle ${Math.round((Date.now() - x.lastInputAt) / 1000)} s`;
    const kick = document.createElement('button');
    kick.className = 'sm ghost';
    kick.textContent = 'Send out (10 min)';
    kick.onclick = () => void api('/play', { kick: x.userId }).then((r) => renderPlay(r as PlayStatus)).catch((e) => banner(errText(e)));
    row.append(name, note, kick);
    return row;
  });
  $('play-list').replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement('div'), { className: 'muted', textContent: 'Nobody playing right now.' })]));
}
$('play-open').onclick = () => void api('/play', { open: !play?.open }).then((r) => renderPlay(r as PlayStatus)).catch((e) => banner(errText(e)));
$('play-cap').addEventListener('change', () => {
  const n = Number(($('play-cap') as HTMLInputElement).value);
  if (Number.isInteger(n)) void api('/play', { cap: n }).then((r) => renderPlay(r as PlayStatus)).catch((e) => banner(errText(e)));
});
const refreshPlay = () => void api('/play').then((r) => renderPlay(r as PlayStatus)).catch(() => undefined);

void refresh();
refreshPlay();
setInterval(() => {
  void refresh();
  refreshPlay();
}, 2000);
