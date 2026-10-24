// AI Dudes, the /play front door (a Cloudflare Worker). Chatters log in with Kick here; the Worker
// reads who they are (user id + name), signs a `play` cookie with PLAY_SECRET, and from then on
// passes the page, its script, the snapshot socket and the player socket straight through to the
// town on the streamer's machine (ORIGIN_URL). The town checks the cookie itself and holds the ten
// seats (src/server/play.ts): this Worker keeps no state. Only the paths below are passed on, so
// the operator's /admin and the Kick webhook are never reachable through here.

interface Env {
  ORIGIN_URL: string;
  KICK_CLIENT_ID: string;
  KICK_CLIENT_SECRET: string;
  PLAY_SECRET: string;
  // The town's TUNNEL_KEY: without it the town (and ngrok in front of it) turns the request away.
  TUNNEL_KEY: string;
}

const AUTH = 'https://id.kick.com';
const API = 'https://api.kick.com';
const PASS = new Set(['/play', '/dudes.js', '/ws', '/ws/player', '/api/objects/parts', '/api/play/me']);
const SESSION_S = 7 * 24 * 3600;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const utf8 = (s: string) => new TextEncoder().encode(s);

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(body))));
}
/** The token the town checks (src/server/play.ts `verifyPlayToken`). */
async function playToken(secret: string, uid: string, name: string): Promise<string> {
  const body = b64url(utf8(JSON.stringify({ uid, name, exp: Date.now() + SESSION_S * 1000 })));
  return `${body}.${await hmac(secret, body)}`;
}

function cookieOf(req: Request, name: string): string | undefined {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.get('cookie') ?? '');
  return m ? decodeURIComponent(m[1]) : undefined;
}
const cookie = (name: string, value: string, maxAge: number, path = '/') => `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
const redirect = (to: string, cookies: string[] = []) => {
  const h = new Headers({ Location: to, 'Cache-Control': 'no-store' });
  for (const c of cookies) h.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers: h });
};
const page = (status: number, title: string, text: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b100f;color:#e8efe9;font:15px 'Segoe UI',sans-serif;padding:16px;box-sizing:border-box">` +
      `<div style="max-width:440px;text-align:center"><h1 style="color:#ffe08a;font:700 22px 'Trebuchet MS',sans-serif">${title}</h1><p style="line-height:1.5">${text}</p><p><a style="color:#53fc18" href="/play">Back to town</a></p></div>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );

async function login(url: URL, env: Env): Promise<Response> {
  const state = random(16);
  const verifier = random(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier))));
  const u = new URL('/oauth/authorize', AUTH);
  u.searchParams.set('client_id', env.KICK_CLIENT_ID);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', `${url.origin}/callback`);
  u.searchParams.set('scope', 'user:read');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return redirect(u.toString(), [cookie('pkce', `${state}.${verifier}`, 600, '/callback')]);
}

async function callback(req: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const [want, verifier] = (cookieOf(req, 'pkce') ?? '').split('.');
  const clear = cookie('pkce', '', 0, '/callback');
  if (!code) return page(400, 'Login cancelled', `Kick said: ${url.searchParams.get('error') ?? 'no code'}.`);
  if (!state || state !== want || !verifier) return page(400, 'Login expired', 'That login took too long or came from another tab. <a style="color:#53fc18" href="/login">Try again</a>.');
  const tokenRes = await fetch(`${AUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: env.KICK_CLIENT_ID, client_secret: env.KICK_CLIENT_SECRET, redirect_uri: `${url.origin}/callback`, code_verifier: verifier }),
  });
  if (!tokenRes.ok) return page(502, 'Kick login failed', `The token exchange failed (${tokenRes.status}). <a style="color:#53fc18" href="/login">Try again</a>.`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const userRes = await fetch(`${API}/public/v1/users`, { headers: { Authorization: `Bearer ${access_token}` } });
  // Only who they are is needed; the Kick token is handed straight back.
  ctx.waitUntil(fetch(`${AUTH}/oauth/revoke?${new URLSearchParams({ token: access_token, token_hint_type: 'access_token' })}`, { method: 'POST' }).catch(() => undefined));
  if (!userRes.ok) return page(502, 'Kick login failed', `Could not read your Kick profile (${userRes.status}).`);
  const user = ((await userRes.json()) as { data?: { user_id?: number; name?: string }[] }).data?.[0];
  if (!user?.user_id || !user.name) return page(502, 'Kick login failed', 'Kick did not say who you are.');
  const token = await playToken(env.PLAY_SECRET, String(user.user_id), user.name);
  return redirect('/play', [clear, cookie('play', token, SESSION_S)]);
}

async function proxy(req: Request, url: URL, env: Env): Promise<Response> {
  const target = new URL(url.pathname + url.search, env.ORIGIN_URL);
  const headers = new Headers(req.headers);
  headers.set('ngrok-skip-browser-warning', '1');
  headers.set('x-forwarded-host', url.host);
  headers.set('x-town-key', env.TUNNEL_KEY);
  // A WebSocket upgrade is passed through as is: the 101 and its socket come straight back.
  const upgrade = req.headers.get('upgrade')?.toLowerCase() === 'websocket';
  try {
    const res = await fetch(target.toString(), { method: req.method, headers, body: upgrade || req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body, redirect: 'manual' });
    if (upgrade) return res;
    // ngrok's own error page when the town is not running.
    if (res.status >= 500 || res.headers.get('ngrok-error-code')) return url.pathname === '/play' ? page(503, 'The town is asleep', 'The stream is offline right now. Come back when it is live.') : new Response('town offline', { status: 503 });
    const out = new Response(res.body, res);
    out.headers.delete('ngrok-agent-ips');
    return out;
  } catch {
    return url.pathname === '/play' ? page(503, 'The town is asleep', 'The stream is offline right now. Come back when it is live.') : new Response('town offline', { status: 503 });
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    switch (url.pathname) {
      case '/':
        return redirect('/play');
      case '/login':
        return login(url, env);
      case '/callback':
        return callback(req, url, env, ctx);
      case '/logout':
        return redirect('/play', [cookie('play', '', 0)]);
    }
    if (PASS.has(url.pathname)) return proxy(req, url, env);
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
