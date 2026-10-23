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

/**
 * A player's socket comes from the play site (through the Worker, which passes the browser's Origin on)
 * or from the town's own pages; any other page could otherwise ride a logged-in player's cookie.
 */
export function playerOriginAllowed(req: http.IncomingMessage, allowed: string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const o = new URL(origin);
    return o.host === req.headers.host || allowed.some((a) => a.replace(/\/+$/, '') === o.origin);
  } catch {
    return false;
  }
}

/** How often every socket is pinged; one that has not answered the last ping by the next is cut. */
const PING_MS = 20_000;

/** This process's start: ids and revisions can repeat after a restart (a save older than the last snapshot). */
const BOOT_EPOCH = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export class WsHub {
  private wss: WebSocketServer;
  private operator: WebSocketServer;
  private players: WebSocketServer;
  private latest: ServerMsg | null = null;
  /** Messages from the operator page (the Mayor walking, talking, posing). */
  onOperator?: (msg: unknown) => void;
  /** A logged-in player's socket (/ws/player): the hook checks who it is, and takes it or turns it away. */
  onPlayer?: (req: http.IncomingMessage, ws: WebSocket) => void;

  constructor(server: http.Server, worldId: string, adminToken?: string, playOrigins: string[] = []) {
    // Compressed where the page offers it: snapshots are repetitive JSON, and the /play page's
    // viewers come through the tunnel, which counts every byte.
    this.wss = new WebSocketServer({ noServer: true, perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: 6 } } });
    this.operator = new WebSocketServer({ noServer: true, maxPayload: 4096 });
    this.players = new WebSocketServer({ noServer: true, maxPayload: 2048 });
    server.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      if (path === '/ws') this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
      else if (path === '/ws/mayor' && operatorAllowed(req, adminToken)) this.operator.handleUpgrade(req, socket, head, (ws) => this.operator.emit('connection', ws, req));
      else if (path === '/ws/player' && this.onPlayer && playerOriginAllowed(req, playOrigins))
        this.players.handleUpgrade(req, socket, head, (ws) => {
          this.players.emit('connection', ws, req); // the ping below keeps it honest
          try {
            this.onPlayer!(req, ws);
          } catch {
            ws.close(1011, 'error');
          }
        });
      else socket.destroy();
    });
    this.wss.on('connection', (ws) => {
      const hello: ServerMsg = { t: 'hello', protocol: 1, worldId, serverTime: Date.now(), epoch: BOOT_EPOCH };
      ws.send(JSON.stringify(hello));
      // A fresh client is fully correct after one snapshot — no resync protocol.
      if (this.latest) ws.send(JSON.stringify(this.latest));
    });
    // A dropped phone or a sleeping laptop leaves a socket that looks open for minutes (and a /play
    // seat held with it): ping every socket, and cut the ones that stop answering.
    const alive = new WeakSet<WebSocket>();
    for (const wss of [this.wss, this.operator, this.players]) {
      wss.on('connection', (ws) => {
        alive.add(ws);
        ws.on('pong', () => alive.add(ws));
        ws.on('error', () => ws.terminate());
      });
    }
    setInterval(() => {
      for (const wss of [this.wss, this.operator, this.players])
        for (const ws of wss.clients) {
          if (!alive.has(ws)) {
            ws.terminate();
            continue;
          }
          alive.delete(ws);
          try {
            ws.ping();
          } catch {
            ws.terminate();
          }
        }
    }, PING_MS).unref();
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
