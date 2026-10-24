// The town shots under the HUD mock (FK-005) are real stream frames, taken with ~/gs-tools/shot.mjs on a
// lane's demo server with this file as --eval. It takes the camera over (a wheel and a shift-drag act on
// this page only: nothing goes to the server), zooms out, finds the anchor's name tag, zooms back in
// round its feet to HALF metres half-height, drags it to (TX, TY) on screen, then hides every DOM piece
// of today's HUD so only the 3D town is left. It returns where every visible name tag sat, which is
// where the mock's tags go. Set the knobs in front of it, e.g.
//   flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:4613/?stream=1" /tmp/fk-shots/lane-x/town.png \
//     --w 1920 --h 1080 --wait 8000 --after 200 --eval "window.ANCHOR='^Toma'; window.HALF=8; $(cat design/hud/town-shot.js)"
// then `node design/hud/town.mjs /tmp/fk-shots/lane-x/town.png design/hud/town-<name>.webp`.
// Travellers are good anchors: their tags are never decluttered.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tags = () =>
    [...document.querySelectorAll('#people > div')]
      .map((d) => {
        const r = d.getBoundingClientRect();
        return { t: d.textContent.trim().slice(0, 30), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height), w: Math.round(r.width) };
      })
      .filter((t) => t.w > 30);
  const c = document.querySelector('canvas');
  const wheel = (dy, x, y) => c.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  const fire = (type, x, y) =>
    c.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: type === 'pointermove' ? -1 : 2, buttons: 2, clientX: x, clientY: y, bubbles: true, shiftKey: true }));
  const ANCHOR = new RegExp(window.ANCHOR ?? '^Toma'),
    HALF = window.HALF ?? 14,
    TX = window.TX ?? 960,
    TY = window.TY ?? 640;
  wheel(3000, 960, 540); // out to the widest view (main.ts HALF_MAX)
  await sleep(4000);
  const wide = tags();
  const a = wide.find((t) => ANCHOR.test(t.t));
  if (!a) return { err: 'no anchor', wide };
  wheel(Math.log(HALF / 60) / 0.0012, a.x, a.y + 30); // back in round the anchor's feet
  await sleep(4000);
  const b = tags().find((t) => ANCHOR.test(t.t));
  if (b) {
    fire('pointerdown', b.x, b.y);
    for (let i = 1; i <= 10; i++) {
      fire('pointermove', b.x + ((TX - b.x) * i) / 10, b.y + ((TY - b.y) * i) / 10);
      await sleep(30);
    }
    fire('pointerup', TX, TY);
  }
  await sleep(5000);
  const after = tags();
  const s = document.createElement('style');
  s.textContent = 'body > *:not(#world){opacity:0!important;transition:none!important} body::before,body::after{display:none!important}';
  document.head.append(s);
  return { after };
})();
