import crypto from 'node:crypto';
import type http from 'node:http';
import type { RequestHandler } from 'express';
import { isLocalRequest } from './operatorGuard';

/**
 * What the public tunnel may reach: Kick's webhook, and what the play Worker passes on (its PASS list
 * in play-worker/src/index.ts). Everything else (/admin, the operator socket, the plain views) answers
 * only on this machine. The play paths also need the Worker's key, so the tunnel URL on its own is
 * not a way round the Worker. `npm run tunnel` gives ngrok the same rules, so a request turned away
 * here never reaches this machine in the first place.
 */
export const WEBHOOK_PATH = '/kick/webhook';
export const PLAY_PATHS = ['/play', '/dudes.js', '/ws', '/ws/player', '/api/objects/parts', '/api/play/me'];
export const TUNNEL_KEY_HEADER = 'x-town-key';

function keyMatches(supplied: string | undefined, key: string): boolean {
  const a = Buffer.from(supplied ?? ''),
    b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Whether a request may come in. One from this machine always may. Without a key set, the play paths are open. */
export function tunnelAllows(r: { local: boolean; method: string; path: string; key?: string }, tunnelKey?: string): boolean {
  if (r.local) return true;
  if (r.method === 'POST' && r.path === WEBHOOK_PATH) return true;
  if (!PLAY_PATHS.includes(r.path)) return false;
  return !tunnelKey || keyMatches(r.key, tunnelKey);
}

export function tunnelGuard(tunnelKey?: string): RequestHandler {
  return (req, res, next) => {
    const local = isLocalRequest(req);
    if (tunnelAllows({ local, method: req.method, path: req.path, key: req.get(TUNNEL_KEY_HEADER) }, tunnelKey)) return next();
    res.status(404).type('text/plain').send('not found');
  };
}

/** The same rule for a socket's upgrade, which never passes through express. */
export function tunnelAllowsUpgrade(req: http.IncomingMessage, tunnelKey?: string): boolean {
  const header = (name: string) => {
    const v = req.headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const local = isLocalRequest({ get: header, socket: req.socket });
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  return tunnelAllows({ local, method: req.method ?? 'GET', path, key: header(TUNNEL_KEY_HEADER) }, tunnelKey);
}

/** ngrok's traffic policy: turn away at the edge everything tunnelAllows would turn away here. */
export function ngrokPolicy(tunnelKey: string): string {
  if (!/^[\w-]+$/.test(tunnelKey)) throw new Error('TUNNEL_KEY: letters, digits, - and _ only');
  const paths = PLAY_PATHS.map((p) => `'${p}'`).join(', ');
  const webhook = `(req.method == 'POST' && req.url.path == '${WEBHOOK_PATH}')`;
  const play = `(req.url.path in [${paths}] && '${TUNNEL_KEY_HEADER}' in req.headers && req.headers['${TUNNEL_KEY_HEADER}'][0] == '${tunnelKey}')`;
  return [
    'on_http_request:',
    '  - name: only the Kick webhook and the play Worker',
    '    expressions:',
    `      - "!(${webhook} || ${play})"`,
    '    actions:',
    '      - type: deny',
    '        config:',
    '          status_code: 404',
    '',
  ].join('\n');
}
