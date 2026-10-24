// The headless browser the design board renders in, the same setup ~/gs-tools/shot.mjs uses for the
// town's screenshots: playwright-core from ~/gs-tools, the chrome-headless-shell under ~/.t3/tools,
// and SwiftShader for WebGL (software, so slow, but it runs on a box with no GPU and matches the
// shots). design/render.mjs and design/render-outfits.mjs both launch through here.
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

/** playwright-core: the app's own node_modules if it ever gets it, else the shared ~/gs-tools copy. */
function playwright() {
  for (const from of [path.resolve('package.json'), path.join(os.homedir(), 'gs-tools', 'package.json')]) {
    try {
      return createRequire(from)('playwright-core');
    } catch {
      // not there; try the next
    }
  }
  throw new Error('playwright-core not found: expected it in ~/gs-tools/node_modules (cd ~/gs-tools && npm i playwright-core)');
}

/** The newest chrome-headless-shell under ~/.t3/tools for this platform, or undefined to let playwright look. */
function headlessShell() {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  const dir = path.join(os.homedir(), '.t3', 'tools', 'chrome-headless-shell', `${os.platform()}-${arch}`);
  if (!existsSync(dir)) return undefined;
  const byVersion = (a, b) => b.split('.').map(Number).reduce((d, n, i) => d || n - (Number(a.split('.')[i]) || 0), 0);
  for (const v of readdirSync(dir).sort(byVersion)) {
    const exe = path.join(dir, v, 'chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

/** A headless browser with software WebGL. Close it when done. */
export async function launch() {
  const { chromium } = playwright();
  return chromium.launch({
    headless: true,
    executablePath: headlessShell(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}
