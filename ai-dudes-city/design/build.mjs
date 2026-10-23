// Bundles the design board's renderer (design/board/main.ts) into design/out/board.js.
import * as esbuild from 'esbuild';
await esbuild.build({ entryPoints: ['design/board/main.ts'], bundle: true, outfile: 'design/out/board.js', format: 'iife', target: 'es2020', logLevel: 'warning' });
console.log('built design/out/board.js');
