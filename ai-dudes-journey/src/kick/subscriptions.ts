import type { KickAuth } from './oauth';

type LogFn = (line: string, level?: 'info' | 'warn' | 'alert') => void;

const CHAT_EVENT = 'chat.message.sent';

interface SubscriptionRow {
  id?: string;
  event?: string;
  name?: string;
  version?: number;
  [key: string]: unknown;
}

async function listSubscriptions(auth: KickAuth): Promise<SubscriptionRow[]> {
  const res = await auth.apiFetch('/public/v1/events/subscriptions');
  if (!res.ok) throw new Error(`subscription list failed: ${res.status}`);
  const j = (await res.json()) as { data?: SubscriptionRow[] };
  return j.data ?? [];
}

function isChatSubscription(row: SubscriptionRow): boolean {
  return row.event === CHAT_EVENT || row.name === CHAT_EVENT;
}

// Kick auto-unsubscribes apps whose webhook endpoint keeps failing, so this is
// called idempotently on every boot with valid tokens.
export async function ensureChatSubscription(auth: KickAuth, log: LogFn): Promise<'active' | 'created'> {
  const rows = await listSubscriptions(auth);
  const existing = rows.find(isChatSubscription);
  if (existing) {
    log(`kick chat subscription active (${existing.id ?? 'id unknown'})`);
    return 'active';
  }
  const res = await auth.apiFetch('/public/v1/events/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ events: [{ name: CHAT_EVENT, version: 1 }], method: 'webhook' }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`subscribe failed: ${res.status} ${detail}`);
  }
  log('kick chat subscription created');
  return 'created';
}

/** Delete existing chat subscriptions and recreate — for ngrok URL rotation. */
export async function resubscribe(auth: KickAuth, log: LogFn): Promise<void> {
  const rows = await listSubscriptions(auth);
  for (const row of rows.filter(isChatSubscription)) {
    if (!row.id) continue;
    const res = await auth.apiFetch(`/public/v1/events/subscriptions?id=${encodeURIComponent(row.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) log(`unsubscribe ${row.id} failed: ${res.status}`, 'warn');
  }
  await ensureChatSubscription(auth, log);
}
