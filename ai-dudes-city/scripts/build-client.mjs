// Bundles the dudes page and the admin page into public/ with esbuild.
// --watch keeps rebuilding (used by npm run dev alongside tsx watch).

import { cpSync, mkdirSync, watch as watchFile } from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

mkdirSync('public', { recursive: true });
const PAGES = { 'client/admin/index.html': 'public/admin.html', 'client/dudes/index.html': 'public/dudes.html' };
PAGES['client/sounds/index.html'] = 'public/sounds/index.html'; // hook FK-159: the sound board, served at /sounds/ (Lane S)
PAGES['client/dudes/audio-approved.json'] = 'public/sounds/approved.json'; // hook FK-160: what Sami has approved, for /sounds (each Approve refreshes it too) (Lane S)
for (const [from, to] of Object.entries(PAGES)) cpSync(from, to);
// The story HUD's fonts (Fredoka and Nunito woff2 with their OFL texts), served as /fonts/… (FK-009).
cpSync('client/dudes/fonts', 'public/fonts', { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    admin: 'client/admin/main.ts',
    dudes: 'client/dudes/main.ts',
    'sounds/main': 'client/sounds/main.ts', // hook FK-159: the sound board's script, /sounds/main.js
  },
  bundle: true,
  outdir: 'public',
  format: 'iife',
  target: 'es2020',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // esbuild only watches the scripts: copy the pages again when they change, or a page whose
  // script now expects a new element would load the old markup and throw.
  for (const [from, to] of Object.entries(PAGES))
    watchFile(from, () => {
      try {
        cpSync(from, to);
        console.log(`[client] copied ${from}`);
      } catch (e) {
        console.warn(`[client] copy ${from} failed: ${e.message}`);
      }
    });
  console.log('[client] watching…');
} else {
  await esbuild.build(options);
}
