// npm run tunnel: ngrok to this town, with a traffic policy that turns away at ngrok's edge everything
// but Kick's webhook and the play Worker's paths (src/server/tunnelGuard.ts, which the server also
// enforces). The policy holds TUNNEL_KEY, so it is written to data/ (not in git), readable by you only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ngrokPolicy } from '../src/server/tunnelGuard';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const key = process.env.TUNNEL_KEY;
if (!key || key.length < 32) {
  console.error('Set TUNNEL_KEY in .env first (openssl rand -hex 32), and the same on the Worker (wrangler secret put TUNNEL_KEY).');
  process.exit(1);
}
const hookUrl = process.env.KICK_WEBHOOK_PUBLIC_URL;
const domain = process.env.NGROK_URL ?? (hookUrl ? new URL(hookUrl).host : undefined);
if (!domain) {
  console.error('Set NGROK_URL (your static ngrok domain) or KICK_WEBHOOK_PUBLIC_URL in .env.');
  process.exit(1);
}
const port = process.env.PORT ?? '4600';
const file = path.resolve(process.env.DATA_DIR ?? 'data', 'ngrok-policy.yml');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, ngrokPolicy(key), { mode: 0o600 });
fs.chmodSync(file, 0o600);

console.log(`ngrok: https://${domain} -> 127.0.0.1:${port}, webhook and play paths only`);
const ngrok = spawn('ngrok', ['http', `--url=${domain}`, `--traffic-policy-file=${file}`, `127.0.0.1:${port}`], { stdio: 'inherit' });
ngrok.on('error', (err) => {
  console.error(`could not start ngrok: ${err.message}`);
  process.exit(1);
});
ngrok.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => ngrok.kill(sig));
