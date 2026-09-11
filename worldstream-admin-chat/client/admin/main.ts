import type { AdminStatus } from '../../src/shared/protocol';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

async function api(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`/admin/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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
  api('/chat', { username, text }).catch((e) => alert(String(e)));
}

$('inj-send').onclick = () => {
  sendChat(($('inj-user') as HTMLInputElement).value.trim(), ($('inj-text') as HTMLInputElement).value.trim());
  ($('inj-text') as HTMLInputElement).value = '';
};
($('inj-text') as HTMLInputElement).addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ($('inj-send') as HTMLButtonElement).click();
});

const cannedEl = $('canned');
for (const [label, text] of CANNED) {
  const b = document.createElement('button');
  b.className = 'small';
  b.textContent = label;
  b.onclick = () => sendChat(($('inj-user') as HTMLInputElement).value.trim(), text);
  cannedEl.appendChild(b);
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
  api('/kick/resubscribe').then(() => alert('resubscribed')).catch((e) => alert(String(e)));
};
$('btn-save').onclick = () => {
  api('/save').catch((e) => alert(String(e)));
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

async function refresh(): Promise<void> {
  try {
    const status = (await api('/status')) as AdminStatus;

    if (!userEditingFlags) {
      kickRepliesEl.checked = status.flags.kickRepliesEnabled;
      tsInput.value = String(status.flags.devTimeScale);
    }

    const k = status.kick;
    $('kick-info').innerHTML = [
      `configured: <span class="${k.configured ? 'ok' : 'bad'}">${k.configured}</span>`,
      `connected: <span class="${k.connected ? 'ok' : 'bad'}">${k.connected}</span>${k.username ? ` as <b>${esc(k.username)}</b>` : ''}`,
      `subscription: <span class="${k.subscription ? 'ok' : 'warn'}">${k.subscription ?? 'none'}</span>`,
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
        b.onclick = () => api('/action', { id: a.id }).catch((e) => alert(String(e)));
        actionsEl.appendChild(b);
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
  } catch {
    $('kick-info').textContent = 'server unreachable';
  }
}

refresh();
setInterval(refresh, 2000);
