import type { AdminStatus } from '../../src/shared/protocol';
import type { DudesAdminStatus } from '../../src/shared/dudesTypes';
import { shortRef } from '../../src/shared/objectTypes';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

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
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

// ---- inject -------------------------------------------------------------

// Examples only fill the box; nothing is sent until "send".
const CANNED: [string, string][] = [
  ['pirate', "hi! I'm a grumpy pirate who loves boats"],
  ['lighthouse', 'build me a tiny lighthouse'],
  ['hang out', 'go hang out with alex and dance'],
  ['pink', 'make my build pink'],
  ['wizard', 'make me look like a wizard'],
  ['nap', 'lie down for a bit'],
];

function sendChat(username: string, text: string): void {
  if (!username || !text) return;
  api('/chat', { username, text }).catch((e) => alert(String(e)));
}

$('inj-send').onclick = () => {
  sendChat(
    ($('inj-user') as HTMLInputElement).value.trim(),
    ($('inj-text') as HTMLInputElement).value.trim(),
  );
  ($('inj-text') as HTMLInputElement).value = '';
};
($('inj-text') as HTMLInputElement).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ($('inj-send') as HTMLButtonElement).click();
});
for (const [label, text] of CANNED) {
  const b = document.createElement('button');
  b.className = 'small';
  b.textContent = label;
  b.onclick = () => {
    ($('inj-text') as HTMLInputElement).value = text;
    ($('inj-text') as HTMLInputElement).focus();
  };
  $('canned').appendChild(b);
}

// ---- simulate chat: every line at once, to exercise the agents in parallel ----

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
    result.textContent = 'nothing to send — use "username: message" per line';
    return;
  }
  result.textContent = `sending ${lines.length}…`;
  void Promise.allSettled(lines.map((m) => api('/chat', m))).then((outcomes) => {
    const failed = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    result.textContent =
      `sent ${outcomes.length - failed.length}/${outcomes.length}` +
      (failed.length ? ` · first error: ${String(failed[0].reason)}` : '');
  });
};

// ---- flags --------------------------------------------------------------

const kickRepliesEl = $('flag-kick-replies') as HTMLInputElement;
kickRepliesEl.onchange = () => {
  api('/flags', { kickRepliesEnabled: kickRepliesEl.checked }).catch((e) => alert(String(e)));
};

const tsInput = $('flag-timescale') as HTMLInputElement;
$('flag-timescale-set').onclick = () => {
  api('/flags', { devTimeScale: Number(tsInput.value) || 1 }).catch((e) => alert(String(e)));
};
document.querySelectorAll<HTMLButtonElement>('button[data-ts]').forEach((b) => {
  b.onclick = () => {
    tsInput.value = b.dataset.ts!;
    api('/flags', { devTimeScale: Number(b.dataset.ts) }).catch((e) => alert(String(e)));
  };
});

// ---- kick / engine ------------------------------------------------------

$('kick-resub').onclick = () => {
  api('/kick/resubscribe')
    .then(() => alert('resubscribed'))
    .catch((e) => alert(String(e)));
};
$('btn-save').onclick = () => {
  api('/save').catch((e) => alert(String(e)));
};
$('btn-reset').onclick = () => {
  const ok = confirm(
    'Reset the whole world to a fresh start?\n\n' +
      'Every character, persona, memory and build is removed and the field comes back empty. ' +
      'A backup of the current world is saved first, and AI pause/allowance settings are kept.',
  );
  if (!ok) return;
  api('/reset', { confirm: 'RESET' })
    .then((r) =>
      alert(`World reset. Backup: ${(r as { backup: string | null }).backup ?? 'none (no saved world yet)'}`),
    )
    .catch((e) => alert(String(e)));
};

// ---- status poll --------------------------------------------------------

let userEditingFlags = false;
document.addEventListener('focusin', (e) => {
  userEditingFlags = (e.target as HTMLElement)?.tagName === 'INPUT';
});
document.addEventListener('focusout', () => {
  userEditingFlags = false;
});

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
const onOff = (v: boolean | undefined) => (v ? '<span class="ok">on</span>' : '<span class="muted">off</span>');
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function ago(ms: number): string {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

function renderActions(status: AdminStatus): void {
  const actionsEl = $('actions');
  const key = JSON.stringify(status.adminActions);
  if (actionsEl.dataset.key === key) return;
  actionsEl.dataset.key = key;
  actionsEl.replaceChildren();
  for (const a of status.adminActions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    if (!a.input) {
      b.onclick = () => api('/action', { id: a.id }).catch((e) => alert(String(e)));
      actionsEl.appendChild(b);
      continue;
    }
    // An action that takes a value: a small field beside its button — text, or a number by default.
    const input = a.input;
    const text = input.kind === 'text';
    const wrap = document.createElement('span');
    wrap.style.display = 'inline-flex';
    wrap.style.gap = '4px';
    wrap.style.alignItems = 'center';
    const field = document.createElement('input');
    field.type = text ? 'text' : 'number';
    field.style.width = text ? '10em' : '6em';
    if (text && input.maxLength !== undefined) field.maxLength = input.maxLength;
    if (!text && input.min !== undefined) field.min = String(input.min);
    if (!text && input.max !== undefined) field.max = String(input.max);
    if (!text && input.step !== undefined) field.step = String(input.step);
    field.placeholder = input.placeholder ?? input.label;
    field.title = input.label;
    b.onclick = () => {
      if (text) {
        const value = field.value.trim();
        if (!value) {
          alert(`Enter a ${input.label} for "${a.label}" first.`);
          return;
        }
        api('/action', { id: a.id, value })
          .then(() => {
            field.value = '';
          })
          .catch((e) => alert(String(e)));
        return;
      }
      const value = Number(field.value);
      if (field.value === '' || !Number.isFinite(value)) {
        alert(`Enter a number for "${a.label}" first.`);
        return;
      }
      api('/action', { id: a.id, value }).catch((e) => alert(String(e)));
    };
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') b.click();
    });
    wrap.append(b, field);
    actionsEl.appendChild(wrap);
  }
}

// ---- dudes --------------------------------------------------------------

// Which persona rows are expanded survives the two-second re-render.
const openPersonas = new Set<string>();
$('dudes-table').addEventListener(
  'toggle',
  (e) => {
    const d = e.target as HTMLDetailsElement;
    const id = d.dataset.id;
    if (!id) return;
    if (d.open) openPersonas.add(id);
    else openPersonas.delete(id);
  },
  true,
);
let dudesKey = '';

function renderDudes(s: DudesAdminStatus | undefined): void {
  $('dudes-section').hidden = !s;
  if (!s) return;
  const ai = s.ai;
  const out = ai.enforced && ai.callsRemaining <= 0;
  $('dudes-ai').innerHTML = [
    s.fixture
      ? '<span class="warn">FIXTURE MODE — canned agents, no AI calls</span>'
      : ai.available
        ? 'LIVE AI — every turn and design is a model call'
        : '<span class="bad">AI unavailable — check provider configuration</span>',
    `models: agent <b>${esc(s.models.agent)}</b> · design <b>${esc(s.models.design)}</b>${
      s.models.listener ? ` · listener <b>${esc(s.models.listener)}</b>` : ''
    }`,
    `calls: ${ai.callsUsed} used · ${
      ai.enforced
        ? `<span class="${out ? 'bad' : 'ok'}">${ai.callsRemaining} remaining</span>`
        : `limit IGNORED (${ai.callsRemaining} on the counter)`
    }${ai.paused ? ' · <span class="bad">PAUSED</span>' : ''}`,
    `in flight: ${ai.thinking}/${ai.agentLimit} thinking · ${ai.designing}/${ai.designLimit} designing · ${ai.waiting} waiting`,
    `idle life: ${onOff(ai.idleLife)} · troublemakers: ${onOff(ai.events)}`,
    s.town
      ? `town: <b>${esc(s.town.name)}</b> · ${s.town.lots.length} lots taken${s.town.project ? ` · project <b>${esc(s.town.project.name)}</b> (${esc(s.town.project.status)}, §${s.town.project.coins}/${s.town.project.coinsNeed}, ${Math.round((s.town.project.work / s.town.project.workNeed) * 100)}% built)` : ''}${
          s.town.party ? ` · <span class="warn">${esc(s.town.party.title)}</span>` : ''
        }${s.town.wants.length ? ` · wants: ${esc(s.town.wants.join(', '))}` : ''}`
      : '',
    s.happening
      ? `<span class="warn">NOW: ${esc(s.happening.title)}</span> — ${esc(s.happening.text)}${
          s.happening.until ? ` (deadline in ${clock((s.happening.until - Date.now()) / 1000)})` : ''
        }`
      : s.nextHappeningInS !== undefined
        ? `next troublemaker in ${clock(s.nextHappeningInS)}`
        : 'no troublemaker scheduled',
  ].join('\n');

  // Rebuild the table only when something in it changed (the "heard" column ticks on its own below).
  const key = JSON.stringify(s.dudes);
  $('dudes-count').textContent = String(s.dudes.length);
  const tbody = document.querySelector('#dudes-table tbody')!;
  if (key !== dudesKey) {
    dudesKey = key;
    const rows = [...s.dudes].sort((a, b) => b.lastHeardAt - a.lastHeardAt);
    tbody.innerHTML = rows
      .map((d) => {
        const persona = d.persona || '(no persona yet)';
        const memory = d.memory.length
          ? `<ul>${d.memory.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
          : '<div class="muted">no memories</div>';
        return (
          `<tr><td class="name">${esc(d.name)}<br><span class="muted">${esc(d.id)}</span></td>` +
          `<td>${esc(d.title ?? '')}</td>` +
          `<td class="num">${d.turns}</td><td class="num">${d.builds}</td><td class="num">${d.inbox}</td>` +
          `<td>${d.muted ? '<span class="warn">muted</span>' : ''}</td>` +
          `<td data-heard="${d.lastHeardAt}">${ago(d.lastHeardAt)}</td>` +
          `<td><details data-id="${esc(d.id)}"${openPersonas.has(d.id) ? ' open' : ''}><summary>${esc(
            persona.length > 60 ? persona.slice(0, 57) + '…' : persona,
          )}</summary><div>${esc(persona)}</div>${memory}</details>` +
          (d.lastError ? `<div class="err">${esc(d.lastError)}</div>` : '') +
          `</td></tr>`
        );
      })
      .join('');
  } else
    tbody.querySelectorAll<HTMLElement>('td[data-heard]').forEach((td) => {
      td.textContent = ago(Number(td.dataset.heard));
    });

  const names = new Map(s.dudes.map((d) => [d.id, d.name]));
  $('dudes-jobs').innerHTML = s.jobs.length
    ? s.jobs
        .map(
          (j) =>
            `${esc(names.get(j.dude) ?? j.dude)} · ${j.kind} · ${esc(j.label)} · ` +
            `<span class="${j.status === 'failed' ? 'bad' : j.status === 'done' ? 'ok' : 'warn'}">${j.status}</span>` +
            (j.error ? ` <span class="err">— ${esc(j.error)}</span>` : ''),
        )
        .join('\n')
    : '<span class="muted">no jobs</span>';
  $('dudes-objects').innerHTML = s.objects.length
    ? s.objects
        .map(
          (o) =>
            `#${esc(shortRef(o.id))} ${esc(o.name)} — ${esc(names.get(o.createdBy) ?? o.createdBy)}` +
            (o.damage ? ` <span class="warn">· ${esc(o.damage)}</span>` : ''),
        )
        .join('\n')
    : '<span class="muted">the field is empty</span>';
}

// ---- the Listener: what chat keeps asking for ----------------------------

let wishesKey = '';
function renderListener(l: DudesAdminStatus['listener']): void {
  $('listener-section').hidden = !l;
  if (!l) return;
  $('listener-info').innerHTML = [
    `${l.enabled ? '<span class="ok">enabled</span>' : '<span class="muted">disabled</span>'} · ${l.runs} runs · ${l.buffered} messages buffered · last run ${ago(l.lastRunAt)}${l.lastRunAt ? ' ago' : ''}`,
    l.lastError ? `<span class="err">${esc(l.lastError)}</span>` : '',
  ]
    .filter(Boolean)
    .join('\n');
  $('listener-tips').innerHTML = l.tips.length
    ? l.tips.map((t) => `· ${esc(t)}`).join('\n')
    : '<span class="muted">no tips yet</span>';
  // What the Builder (npm run builder) made of the wishes: a branch each, for review and a hand merge.
  $('builder-proposals').innerHTML = l.proposals?.length
    ? l.proposals
        .map(
          (p) =>
            `<span class="${p.status === 'ready' ? 'ok' : p.status === 'running' ? 'warn' : 'bad'}">${esc(p.status)}</span> ${esc(p.wish)}` +
            `${p.tests ? ` · tests ${esc(p.tests)}` : ''} · ${esc(p.at.slice(0, 16).replace('T', ' '))} · data/builder/${esc(p.id)}.md / .patch`,
        )
        .join('\n')
    : '<span class="muted">none yet (npm run builder, then touch data/builder/enabled)</span>';
  $('listener-count').textContent = String(l.wishes.length);
  const key = JSON.stringify(l.wishes);
  if (key === wishesKey) return;
  wishesKey = key;
  const cls = (status: string) => (status === 'works-now' ? 'ok' : status === 'blocked' ? 'bad' : 'warn');
  document.querySelector('#listener-wishes tbody')!.innerHTML = l.wishes
    .map(
      (w) =>
        `<tr><td class="num">${w.count}</td><td class="${cls(w.status)}">${esc(w.status)}</td>` +
        `<td class="name">${esc(w.wish)}</td><td>${esc(w.askers.join(', '))}</td>` +
        `<td>${w.examples.map((x) => `“${esc(x)}”`).join('<br>')}</td><td>${esc(w.how)}</td></tr>`,
    )
    .join('');
}

let refreshing = false;
async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const status = (await api('/status')) as AdminStatus;
    renderDudes(status.dudes);
    renderListener(status.dudes?.listener);

    if (!userEditingFlags) {
      kickRepliesEl.checked = status.flags.kickRepliesEnabled;
      tsInput.value = String(status.flags.devTimeScale);
    }

    const k = status.kick;
    $('kick-info').innerHTML = [
      k.disabled
        ? '<strong>DISABLED in this process — no live ingestion or outgoing chat</strong>'
        : 'Live ingestion enabled',
      `configured: <span class="${k.configured ? 'ok' : 'bad'}">${k.configured}</span>`,
      `connected: <span class="${k.connected ? 'ok' : 'bad'}">${k.connected}</span>${k.username ? ` as <b>${esc(k.username)}</b>` : ''}`,
      `subscription: <span class="${k.subscription ? 'ok' : 'warn'}">${esc(k.subscription ?? 'none')}</span>`,
      `last webhook: ${k.lastWebhookAt ? new Date(k.lastWebhookAt).toLocaleTimeString() : '—'}`,
      k.webhookPublicUrl ? `webhook: ${esc(k.webhookPublicUrl)}` : '',
    ]
      .filter(Boolean)
      .join('<br>');

    $('engine-info').innerHTML = [
      `world: <b>${esc(status.worldName)}</b> (${esc(status.worldId)})`,
      `rev: ${status.engine.rev} · ws clients: ${status.engine.wsClients} · queue: ${status.engine.queueLength}`,
      status.engine.currentTask ? `current: ${esc(status.engine.currentTask)}` : 'current: idle',
    ].join('<br>');

    renderActions(status);

    const eventsEl = $('events');
    if (eventsEl.textContent === 'loading…' || !eventsEl.childElementCount) {
      eventsEl.textContent = '';
      for (const name of status.events) {
        const b = document.createElement('button');
        b.className = 'small';
        b.textContent = name;
        b.onclick = () => api('/event', { name }).catch((e) => alert(String(e)));
        eventsEl.appendChild(b);
      }
      if (!status.events.length) eventsEl.textContent = 'no events registered';
    }

    $('state-summary').textContent = status.stateSummary;

    const classifications = status.engine.classifications ?? [];
    $('classifications-section').hidden = !classifications.length;
    const tbody = document.querySelector('#classifications tbody')!;
    tbody.innerHTML = classifications
      .map(
        (c) =>
          `<tr><td>${new Date(c.ts).toLocaleTimeString()}</td><td>${esc(c.username)}</td>` +
          `<td>${esc(c.text.slice(0, 60))}</td>` +
          `<td class="${c.source === 'fallback' ? 'fallback' : 'intent'}">${esc(c.intent)}</td>` +
          `<td>${c.confidence.toFixed(2)}</td><td>${c.source}</td></tr>`,
      )
      .join('');
  } catch (error) {
    $('kick-info').textContent = String(error);
  } finally {
    refreshing = false;
  }
}

$('operator-connect').onclick = () => void refresh();
void refresh();
setInterval(refresh, 2000);
