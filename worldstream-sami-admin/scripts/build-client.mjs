// Bundles the renderer and admin clients into public/ with esbuild.
// --watch keeps rebuilding (used by npm run dev alongside tsx watch).

import { cpSync, mkdirSync } from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

mkdirSync('public', { recursive: true });
cpSync('client/renderer/index.html', 'public/index.html');
cpSync('client/admin/index.html', 'public/admin.html');
cpSync('client/renderer/fonts', 'public/fonts', { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    renderer: 'client/renderer/main.ts',
    admin: 'client/admin/main.ts',
  },
  bundle: true,
  outdir: 'public',
  format: 'iife',
  target: 'es2020',
  sourcemap: 'inline',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[client] watching…');
} else {
  await esbuild.build(options);
}
