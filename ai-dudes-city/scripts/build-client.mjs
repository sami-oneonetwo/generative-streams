// Bundles the dudes page and the admin page into public/ with esbuild.
// --watch keeps rebuilding (used by npm run dev alongside tsx watch).

import { cpSync, mkdirSync } from 'node:fs';
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

mkdirSync('public', { recursive: true });
cpSync('client/admin/index.html', 'public/admin.html');
cpSync('client/dudes/index.html', 'public/dudes.html');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    admin: 'client/admin/main.ts',
    dudes: 'client/dudes/main.ts',
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
  console.log('[client] watching…');
} else {
  await esbuild.build(options);
}
