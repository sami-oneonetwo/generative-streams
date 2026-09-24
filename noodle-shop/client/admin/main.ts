import type { AdminStatus } from '../../src/shared/protocol';
import { shortRef } from '../../src/shared/safehouseTypes';

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

const CANNED: [string, string][] = [
  ['provision', 'give me a server'],
  ['restart', 'restart mine'],
  ['upgrade', 'upgrade mine'],
  ['report', "something's beeping"],
  ['claim', "I'll take it"],
  ['ask', 'what do you actually do all day?'],
  ['gibberish', 'asdf qwerty zxcv'],
];

function sendChat(username: string, text: string): void {
  if (!username || !text) return;
  const x = ($('place-x') as HTMLInputElement).value,
    z = ($('place-z') as HTMLInputElement).value;
  if (examplesWorld === 'safehouse' && x !== '' && z !== '') text += ` at ${Number(x)},${Number(z)}`;
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

const cannedEl = $('canned');
let examplesWorld = '';
function examples(worldId: string): void {
  if (examplesWorld === worldId) return;
  examplesWorld = worldId;
  $('placement-controls').hidden = worldId !== 'safehouse';
  cannedEl.replaceChildren();
  const rows: [string, string][] =
    worldId === 'safehouse'
      ? [
          ['barricade', 'Build a barricade at 3,13'],
          ['turret', 'Build a turret in the front yard'],
          ['move barricade', 'Move the barricade next to the house'],
          ['turn car', "Turn Rook's car around"],
          ['paint house', "Paint Rook's house green"],
          ['repair fence', 'Repair the fence section 3'],
          ['watchtower', 'Build a small duck-shaped watchtower behind the house'],
          ['ask', 'What are we building today?'],
        ]
      : CANNED;
  for (const [label, text] of rows) {
    const b = document.createElement('button');
    b.className = 'small';
    b.textContent = label;
    b.onclick = () => {
      ($('inj-text') as HTMLInputElement).value = text;
      ($('inj-text') as HTMLInputElement).focus();
    };
    cannedEl.appendChild(b);
  }
}

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
      'Every creation, move, repair and bit of damage is removed and the neighborhood comes back as new. ' +
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
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

let refreshing = false;
async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const status = (await api('/status')) as AdminStatus;
    examples(status.worldId);
    $('safehouse-jobs').hidden = !status.safehouse;
    if (status.safehouse) {
      const s = status.safehouse;
      $('safehouse-queue').textContent = [
        s.fixture
          ? 'FIXTURE MODE — deterministic samples, no AI calls'
          : s.generationAvailable
            ? 'LIVE GENERATION — requests incur API charges'
            : 'AI unavailable — check provider configuration',
        `AI generation: ${s.generationPaused ? 'PAUSED' : 'enabled'} · ${
          s.allowanceEnforced ? `${s.callsRemaining} model calls remaining` : `call limit IGNORED (${s.callsRemaining} on the counter)`
        } · ${s.callsUsed} calls made so far (a call count, not a dollar cap)`,
        `Trusted chatters (no design time limit, may !delete <name>): ${s.privileged.length ? s.privileged.join(', ') : 'none'}`,
        `Block readings: ${s.surveyPaused ? 'PAUSED' : 'enabled'} · ${s.surveyCallsRemaining} left on their own allowance · ${s.surveyCallsUsed} made` +
          (s.themes.length
            ? ` · ${s.themes.map((t) => `${t.name}: ${t.theme ?? 'no theme yet'}${t.left ? ` (${t.left} to go)` : ''}`).join(' · ')}`
            : ''),
        // Grudges and favourites: what each neighbour holds against (or for) which chatter, and Rook's own.
        `Grudges: ${
          s.regard?.length
            ? s.regard.map((r) => `${r.name} · ${r.phrase} (${r.score < 0 ? '−' : ''}${Math.abs(Math.round(r.score))})`).join(' · ')
            : 'none'
        }`,
        `Rook: ${
          s.grudges?.length
            ? s.grudges.map((g) => `${g.user} (${Math.round(g.score)})${g.reason ? ` — ${g.reason}` : ''}`).join(' · ')
            : 'no grudges'
        }`,
        // The hoops scoreboard (`!shoot` while a hoop stands), best shooters first.
        `Hoops: ${
          s.scores?.length
            ? s.scores.map((r) => `${r.user} ${r.hits}/${r.shots}${r.best >= 2 ? ` (best ${r.best})` : ''}`).join(' · ')
            : 'nobody has shot yet'
        }`,
        s.wave
          ? `Wave ${s.wave.number} · ${s.wave.phase === 'prep' ? `next wave in ${s.wave.secondsLeft} s` : `in progress, straggler cut-off in ${s.wave.secondsLeft} s`} · ${s.wave.zombies} zombies · record wave ${s.wave.best}${s.wave.fell ? ` · house last fell on wave ${s.wave.fell}` : ''}`
          : '',
        ...s.objects
          .filter((o) => !o.fixed || o.ruined)
          .map((o) => `#${shortRef(o.id)} ${o.name} — creator ${o.createdBy}; last edit ${o.editedBy}`),
        `Neighborhood pieces (movable, paintable, destructible): ${s.objects.filter((o) => o.fixed && !o.ruined).length} — ` +
          s.objects
            .filter((o) => o.fixed && !o.ruined)
            .map((o) => `${o.name.replace(/ \[.*$/, '')} #${shortRef(o.id)}`)
            .join(', '),
        s.current
          ? `NOW: ${s.current.status} · ${s.current.label} (${Math.round(s.current.progress * 100)}%)`
          : 'No active build',
        ...s.pending.map((j) => `QUEUED: ${j.label} — ${j.requestedBy}`),
        ...s.recent
          .slice(-5)
          .map((j) => `${j.status.toUpperCase()}: ${j.label}${j.error ? ` — ${j.error}` : ''}`),
      ].join('\n');
    }

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

    const actionsEl = $('actions');
    if (!actionsEl.childElementCount) {
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

    const tbody = document.querySelector('#classifications tbody')!;
    tbody.innerHTML = status.engine.classifications
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
