import { defineConfig } from 'vite';

// The renderer lives in src/web and is built to dist/web, which the Node
// server serves at http://localhost:4400/ for the OBS browser source.
export default defineConfig({
  root: 'src/web',
  base: '/',
  publicDir: false,
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    target: 'es2022',
  },
});
