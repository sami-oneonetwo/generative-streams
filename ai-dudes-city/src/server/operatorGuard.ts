import crypto from 'node:crypto';
import type { RequestHandler } from 'express';

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
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
      const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
      const forwarded = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'].some((h) =>
        req.get(h),
      );
      if (!isLoopback(req.socket.remoteAddress) || !localHost || forwarded) {
        res
          .status(403)
          .json({ error: 'Remote admin access requires ADMIN_TOKEN; use localhost for local controls' });
        return;
      }
    }
    next();
  };
}
