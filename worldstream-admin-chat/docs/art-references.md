# Server-room art references

The September 2026 reskin replaces the original equipment-wall scene with an original 16-bit-style cyberpunk apartment workspace: a seated protagonist, rainy city window, wooden desk, comfortable furnishings, and restrained neon.

## References inspected visually

These primary artist pages supplied the reference images actually downloaded and inspected during implementation:

### Pixel Jeff — Night Shift

- Project: https://www.behance.net/gallery/100649593/Night-Shift
- Reference GIF: https://mir-s3-cdn-cf.behance.net/project_modules/max_1200/d42bdf100649593.5f0d9db97b899.gif
- Local copies: `.preview/references/night-shift.gif` and `night-shift.png`.
- Relevant qualities: deliberate pixel clusters, stepped character silhouettes, selective surface detail, and warm interior light contrasted with cool exterior shadows. The artwork depicts a brightly lit shop, not the room implemented here.

### Pixel Jeff — Night Shift ll

- Project: https://www.behance.net/gallery/124024167/Night-Shift-ll
- Reference GIF: https://mir-s3-cdn-cf.behance.net/project_modules/max_1200/dece5f124024167.60fb03546918b.gif
- Local copies: `.preview/references/night-shift-ii.gif` and `night-shift-ii.png`.
- Relevant qualities: a limited nighttime palette, readable silhouettes, localized practical lighting, and lived-in details such as plants, shelving, and small personal objects.

## Additional references located

These were found during research, but their images were not inspected directly during implementation. Do not treat them as visually verified references:

- Pixel Jeff — **Room series**: https://pixeljeff1995.artstation.com/projects/95wKv
- Cristian Rojas Conejo — **Cyber Future City Room Pixel Art**: https://www.artstation.com/artwork/03X01e

## Use and attribution

The references informed general pixel-art treatment, lighting, and detail hierarchy. The implemented room composition, furniture, city, and character artwork were authored in code; the reference images are not production assets and are not bundled with the app.

The referenced artwork belongs to its respective creators. No redistribution license was established. Reference GIFs and PNGs in `.preview/references/` are explicitly allowed by `.gitignore` so they can be committed alongside this provenance note; other preview files remain ignored. Before publishing these images in a public repository or distributing them elsewhere, verify the creators' licensing or obtain permission.

## Implementation locations

- Room artwork: `client/renderer/draw/serverRoom.ts`
- Character artwork: `client/renderer/draw/serverRoomProtagonist.ts`
- Pixel primitives and palette: `client/renderer/draw/pixelArt.ts`
- Scene layout: `src/worlds/server-room/scene.ts`
