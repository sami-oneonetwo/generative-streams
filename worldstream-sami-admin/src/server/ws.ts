import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ServerMsg } from '../shared/protocol';

export class WsHub {
  private wss: WebSocketServer;
  private latest: ServerMsg | null = null;

  constructor(server: http.Server, worldId: string) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => {
      const hello: ServerMsg = { t: 'hello', protocol: 1, worldId, serverTime: Date.now() };
      ws.send(JSON.stringify(hello));
      // A fresh client is fully correct after one snapshot — no resync protocol.
      if (this.latest) ws.send(JSON.stringify(this.latest));
    });
  }

  broadcast(msg: ServerMsg): void {
    this.latest = msg;
    const data = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }
}
