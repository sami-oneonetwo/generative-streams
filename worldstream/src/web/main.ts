import type { ServerMessage } from '../shared/protocol.js';
import type { WorldState } from '../shared/state.js';
import { Music } from './music.js';
import { Renderer } from './renderer.js';

const screen = document.getElementById('screen') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const renderer = new Renderer(screen, { hud: params.has('hud') });
const music = params.has('nomusic') ? null : new Music();

let state: WorldState | null = null;
let connected = false;
let clockOffset = 0; // serverNow - Date.now()

function connect(): void {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => {
    connected = true;
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as ServerMessage;
    if (m.type === 'hello') {
      renderer.setWorlds(m.worlds, m.character.name);
      if (m.wardrobe) renderer.setWardrobe(m.wardrobe);
      renderer.showMeters = params.has('meters') || Boolean(m.ui?.meters);
    }
    else if (m.type === 'state') {
      state = m.state;
      clockOffset = m.now - Date.now();
    } else if (m.type === 'atlas_add') renderer.addSprite(m.world, m.sprite);
    else if (m.type === 'atlas_remove') renderer.removeSprite(m.world, m.name);
  };
  ws.onclose = () => {
    connected = false;
    setTimeout(connect, 1000);
  };
  ws.onerror = () => ws.close();
}
connect();

function frame(t: number): void {
  const now = Date.now() + clockOffset;
  music?.update(state, now);
  renderer.soundHint = Boolean(music?.needsGesture);
  renderer.render(state, t, connected, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
