// Dev harness CLI: node scripts/inject.mjs dave "give me a box"
// Sends a fake chat message through the exact same pipeline as Kick webhooks.

const [username, ...rest] = process.argv.slice(2);
const text = rest.join(' ');

if (!username || !text) {
  console.error('usage: npm run inject -- <username> <message...>');
  process.exit(1);
}

const port = process.env.PORT ?? 4400;
try {
  const res = await fetch(`http://localhost:${port}/admin/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, text }),
  });
  console.log(res.ok ? `sent as ${username}: ${text}` : `error ${res.status}: ${await res.text()}`);
  process.exit(res.ok ? 0 : 1);
} catch (e) {
  console.error(`server unreachable on port ${port} — is npm run dev running? (${e.message})`);
  process.exit(1);
}
