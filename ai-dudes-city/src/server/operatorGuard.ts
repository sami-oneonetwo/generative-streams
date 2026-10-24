import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import { config } from '../config';

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/** TRUSTED_IPS: the operator's own addresses, let in straight to the public port as if on this machine. */
const TRUSTED = config.TRUSTED_IPS.split(',').map((ip) => ip.trim()).filter(Boolean);

/**
 * This machine (or a trusted address), whatever the token: nothing forwarded (the ngrok tunnel
 * forwards), and a Host that is localhost or, from a trusted address, a bare IPv4 address. A Host
 * that is a domain name would let another site rebind its name to this box and ride the trust.
 */
export function isLocalRequest(
  req: { get(name: string): string | undefined; socket: { remoteAddress?: string } },
  trusted: string[] = TRUSTED,
): boolean {
  const host = req.get('host') ?? '';
  const forwarded = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'].some((h) => req.get(h));
  if (forwarded) return false;
  const address = req.socket.remoteAddress?.replace(/^::ffff:/, '');
  if (isLoopback(req.socket.remoteAddress)) return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  return !!address && trusted.includes(address) && /^(localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/.test(host);
}

/**
 * The Kick connection (/kick/login, /kick/callback): localhost only, never through the tunnel. No
 * Origin/Sec-Fetch-Site check here: Kick's redirect back to the callback is a cross-site navigation.
 */
export function localOnlyGuard(): RequestHandler {
  return (req, res, next) => {
    if (!isLocalRequest(req)) {
      res.status(403).type('text/plain').send('Connect Kick from the streaming computer itself, via /admin on localhost.');
      return;
    }
    next();
  };
}

// Browser sources are public read-only views. Fake chat, flags and undo are not.
export function operatorGuard(token?: string): RequestHandler {
  return (req, res, next) => {
    const origin = req.get('origin');
    const host = req.get('host') ?? '';
    if (origin) {
      try {
        if (new URL(origin).host !== host) {
          res.status(403).json({ error: 'Cross-origin operator requests are not allowed' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'Invalid request origin' });
        return;
      }
    }
    if (req.get('sec-fetch-site') === 'cross-site') {
      res.status(403).json({ error: 'Cross-site operator requests are not allowed' });
      return;
    }
    if (token) {
      const supplied = req.get('authorization')?.replace(/^Bearer /, '') ?? '';
      const a = Buffer.from(supplied),
        b = Buffer.from(token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(401).json({ error: 'Enter the operator token to use admin controls' });
        return;
      }
    } else {
      if (!isLocalRequest(req)) {
        res
          .status(403)
          .json({ error: 'Remote admin access requires ADMIN_TOKEN; use localhost for local controls' });
        return;
      }
    }
    next();
  };
}
