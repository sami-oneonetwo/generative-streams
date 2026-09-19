import WebSocket from 'ws';
const ws = new WebSocket('ws://127.0.0.1:4400/ws');
let n = 0, total = 0, max = 0; const t0 = Date.now();
ws.on('message', (d) => { const s = String(d); const m = JSON.parse(s); if (m.t !== 'state') return; n++; total += s.length; max = Math.max(max, s.length);
  if (n === 1) { const sh = m.scene.safehouse; const parts = sh.objects.reduce((a,o)=>a+(o.blueprint.partCount ?? o.blueprint.parts?.length ?? 0),0); const objBytes = JSON.stringify(sh.objects).length; const arcBytes = JSON.stringify(sh.combat.archive).length; console.log(JSON.stringify({ snapshotBytes: s.length, objects: sh.objects.length, parts, objectBytes: objBytes, archive: sh.combat.archive.length, archiveBytes: arcBytes, zombies: sh.combat.zombies.length })); }
  if (n >= 10 || Date.now() - t0 > 8000) { console.log(JSON.stringify({ snapshots: n, seconds: (Date.now()-t0)/1000, avgBytes: Math.round(total/n), maxBytes: max })); ws.close(); }
});
setTimeout(() => { if (n === 0) console.log('no snapshot in 10s'); ws.close(); }, 10000);
