import crypto from 'node:crypto';
import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ServerMsg } from '../shared/protocol';

/** The operator's own socket (/ws/mayor) is held to the same rule as /admin/api: localhost, or the token. */
function operatorAllowed(req: http.IncomingMessage, token?: string): boolean {
  const url = new URL(req.url ?? '/', 'http://x');
  const host = req.headers.host ?? '';
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  if (token) {
    const a = Buffer.from(url.searchParams.get('token') ?? ''),
      b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  const forwarded = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'].some((h) => req.headers[h]);
  return loopback && localHost && !forwarded;
}

export class WsHub {
  private wss: WebSocketServer;
  private operator: WebSocketServer;
  private latest: ServerMsg | null = null;
  /** Messages from the operator page (the Mayor walking, talking, posing). */
  onOperator?: (msg: unknown) => void;

  constructor(server: http.Server, worldId: string, adminToken?: string) {
    this.wss = new WebSocketServer({ noServer: true });
    this.operator = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    server.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      if (path === '/ws') this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
      else if (path === '/ws/mayor' && operatorAllowed(req, adminToken)) this.operator.handleUpgrade(req, socket, head, (ws) => this.operator.emit('connection', ws, req));
      else socket.destroy();
    });
    this.wss.on('connection', (ws) => {
      const hello: ServerMsg = { t: 'hello', protocol: 1, worldId, serverTime: Date.now() };
      ws.send(JSON.stringify(hello));
      // A fresh client is fully correct after one snapshot — no resync protocol.
      if (this.latest) ws.send(JSON.stringify(this.latest));
    });
    this.operator.on('connection', (ws) => {
      ws.on('message', (data) => {
        try {
          this.onOperator?.(JSON.parse(String(data)));
        } catch {
          // a garbled message is dropped; the next one is along in a moment
        }
      });
    });
  }

  broadcast(msg: ServerMsg): void {
    this.latest = msg;
    this.send(msg);
  }

  /** Between snapshots: something every page should see now, which the next snapshot also carries. */
  broadcastTransient(msg: ServerMsg): void {
    this.send(msg);
  }

  private send(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      // A suspended/slow browser must not retain an unbounded stream of full worlds.
      // Reconnection receives the latest complete snapshot rather than old frames.
      if (client.bufferedAmount > 2 * 1024 * 1024) { client.terminate(); continue; }
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }
}
