// Builds the HUD mock (FK-005) into one self-contained page: design/hud/fk-hud.src.html with its fonts
// (design/hud/fonts) and town shots (design/hud/town-*.webp) inlined as data: URLs, written to
// design/hud/fk-hud.html. One file, so the coordinator copies just it to public/fk-hud.html and it
// works on 4600 with no restart, and through file:// as well.
//   npx tsx design/hud/build.ts
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HUD_DIR = path.dirname(fileURLToPath(import.meta.url));
const TYPES: Record<string, string> = { woff2: 'font/woff2', webp: 'image/webp' };

/** The page with every url(<local .woff2 or .webp>) swapped for its data: URL. */
export function inline(html: string, dir = HUD_DIR): string {
  return html.replace(/url\((['"]?)([\w./-]+\.(woff2|webp))\1\)/g, (_m, _q, file: string, ext: string) => {
    const data = readFileSync(path.join(dir, file)).toString('base64');
    return `url(data:${TYPES[ext]};base64,${data})`;
  });
}

/** The built page, from the source as it is on disk now. */
export function build(dir = HUD_DIR): string {
  return inline(readFileSync(path.join(dir, 'fk-hud.src.html'), 'utf8'), dir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = build();
  writeFileSync(path.join(HUD_DIR, 'fk-hud.html'), html);
  console.log(`wrote design/hud/fk-hud.html (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
}
