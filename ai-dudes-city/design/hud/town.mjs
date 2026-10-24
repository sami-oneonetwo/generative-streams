// Turns a 1920×1080 town shot (PNG from shot.mjs, see design/hud/town-shot.js) into the WebP the HUD
// mock sits on, in the design browser (no image tools on this box), so fk-hud.html stays small enough
// to inline it.
//   node design/hud/town.mjs <in.png> <out.webp> [quality 0–1, default 0.86]
import { readFileSync, writeFileSync } from 'node:fs';
import { launch } from '../browser.mjs';

const [src, out, q = '0.86'] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: node design/hud/town.mjs <in.png> <out.webp> [quality]');
const browser = await launch();
const page = await browser.newPage();
const dataUrl = await page.evaluate(
  async ({ png, quality }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', quality);
  },
  { png: readFileSync(src).toString('base64'), quality: Number(q) },
);
await browser.close();
if (!dataUrl.startsWith('data:image/webp')) throw new Error('this browser cannot encode WebP');
writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log(`wrote ${out} (${Math.round(Buffer.byteLength(dataUrl.split(',')[1], 'base64') / 1024)} KB)`);
