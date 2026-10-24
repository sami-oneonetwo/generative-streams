# FK-009 · Sticker Toy UI base: fonts, tokens, slim letterbox

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Done (landed on main at ce88280) |
| Owner | lane C agent, 2026-10-24 |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-010](FK-010-board-client.md), [FK-021](FK-021-show-hud.md), [FK-050](FK-050-home-through-ages-card.md) |

## Why (what changes for viewers or Sami)

One crisp, consistent look for every story UI piece: two fonts, thick ink outlines, hard shadows, and a letterbox that stops eating the frame.

## Scope

- Self-host Fredoka 600/700 and Nunito 800 woff2 (OFL) under client/dudes/fonts; scripts/build-client.mjs copies them into public/.
- CSS tokens in client/dudes/index.html: --red #B3262E, --red-deep #7A1419, --gold #FFC633, --gold-deep #A86E00, --ink #1E1914, --cream #FFF6E0, --dust #8C8577, plus the cast colours; `.pill`, `.card`, 6 px ink outline, `0 8px 0 #0006` hard shadow, pop-in 0.85 → 1.06 → 1 over 300 ms.
- `body.story` when `town.story` is set or a `?demo=` param is present: letterbox 11vh → 7vh (index.html:41, subtitle bottom offset with it); in stream mode hide #feed, the `.invite` header panel and #caravan (they return with Story OFF).

## Acceptance criteria

- [ ] Story OFF: /?stream=1 lays out exactly as today.
- [ ] `/?stream=1&demo=board`: the new fonts load; invite, feed and caravan panels are gone; letterbox bars are 76 px tall at 1080.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-c/fk009-off.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG), then the same with `&demo=board` to fk009-on.png.

## Notes and risks

- In the main checkout a client build goes live on 4600 the moment it is built (public/ is served statically), so only the coordinator builds there, off-air. Lanes build in their own worktree. Everything new must still key off `town.story` or a `?demo=` param, because the coordinator's rebuild ships it.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 lane C agent: picked up.
- 2026-10-24 lane C agent: **ready for review** on branch fk-c at `c565d1d` (rebased on main 3e354da, after FK-013, FK-077 and FK-004; not landed). Acceptance criteria pass on 4613.
  - **What's in it:** Fredoka 600/700 and Nunito 800 self-hosted under client/dudes/fonts (Fontsource 5.3.0 woff2, latin and latin-ext cuts with `unicode-range`, `font-display:block`, both OFL texts); scripts/build-client.mjs copies the folder to public/fonts. index.html gets the tokens on `:root` (--red, --red-deep, --gold, --gold-deep, --ink, --cream, --dust, cast colours --wren/--moss/--oak/--kit/--ash, --font-display, --font-text, `--px` = design px at 1920×1080, --outline 6 px ink, --drop `0 8px 0 #0006`), `.pill` / `.card` (+ `.red`, `.gold`, `.ink` at 92%), and `.pop-in` (0.85 → 1.06 → 1 over 300 ms on `scale`, so an element's own centring transform stays; none under reduced motion). New client/dudes/sticker.ts: `storyLook(town.story, params)` and `setStoryLook()`, which toggles `body.story` and asks for the three faces once. main.ts calls it twice (at start for `?demo=`, and on each snapshot for `town.story`), +4 lines. `body.story` sets `--letterbox` to 7vh (the bars and the subtitle offset both read it) and, with `body.stream`, hides #feed, .invite and #caravan.
  - **Story OFF unchanged:** today's light text colour was `--ink` in index.html; it keeps its value as `--text`, so `--ink` can be the design system's ink. The /play gate's inner `.card` became `.gate` (same rules), so `.card` is free for the sticker card. Nothing else in the client used `var(--ink)` or `.card`/`.pill` (checked client/dudes; /admin has its own sheet).
  - **Tests:** scripts/sticker-ui.test.ts, 7 tests (the look's switch, fonts asked once, faces/files/OFL/build copy, tokens = design/story.ts STORY and CAST, pill/card/pop-in values, letterbox 11vh → 7vh and the subtitle, Story OFF rules never use a story token). `npm run typecheck` green; `npm test` 197 tests, 196 pass, 0 fail, 1 todo (FK-157's, waiting on FK-158). One full run before that had a one-off failure in scripts/dudes.test.ts ("driving through people runs them over…", nothing to do with this card); it passed 3 of 3 runs on its own and in the next full run, so it looks flaky under load.
  - **Verified on 4613** (shots in /tmp/fk-shots/lane-c/): `fk009-off.png` (/?stream=1, Story OFF): eval `{"body":"stream","letterbox":"11vh","feed":"block","invite":"block","subtitleBottom":"140.8px"}`, invite top-right and feed bottom-left as today. `fk009-on.png` (/?stream=1&demo=board): eval `{"body":"stream story cinema","bars":["75.5938px","75.5938px"],"subtitleBottom":"97.6px","feed":"none","invite":"none","caravan":"none","fonts":["600 54px Fredoka:true","700 54px Fredoka:true","800 54px Nunito:true"],"pill":"Nunito 800 54px / 6px rgb(30, 25, 20) / rgba(0, 0, 0, 0.4) 0px 8px 0px 0px","card":"28px rgb(255, 246, 224)","pop":{"ms":300,"scales":["0.85","1.06","1"]}}`, with sample pills, a card and a subtitle in the frame (software WebGL never advances the bars' 0.9 s ease, so the shot pins `cinema` and finishes the page's animations; screenshot-only). `fk009-storyon-town.png`: the demo save had `ai.story: true` left from earlier, so plain /?stream=1 came up in the story look through `town.story` too. I removed `ai.story` from data/demo-c (Story OFF) for the OFF shot and left it off.
  - **Story OFF style diff:** I loaded main's index.html and fk-c's in headless Chrome (markup only, every `hidden` panel shown, transitions off), as the plain page, `stream`, `stream cinema` and `cinema`. All 224 elements plus the bars' pseudo-elements match: 0 of 28,664 computed values differ (layout rect, font, colours, borders, shadows, z-index). A negative control with `story` on finds the 49 expected differences.
  - **Notes for later cards:** (1) The latin subsets don't carry ♛ or ⚑ (they rendered as boxes in the test page), so FK-010 / FK-021 should draw the crown and the pennant as inline SVG, not as glyphs, as FK-013's tag icons already do (client/dudes/sideMarks.ts). (2) `/fonts` isn't in the tunnel's PLAY_PATHS (src/server/tunnelGuard.ts, play-worker), so /play through the tunnel falls back to Trebuchet/Segoe for any story pill. The stream and /mayor are local, so they're fine. I left it alone because tunnel files are Sami's; the coordinator can add `/fonts/` if /play ever shows story HUD. (3) The pop-in animates the `scale` property (Chromium 104+). OBS 31+ (CEF 127) has it; an older OBS just fades the pill in.
  - Hooks into other lanes' files: none (every file touched is lane C's: client/dudes/{index.html, main.ts, sticker.ts, fonts/*}, scripts/build-client.mjs, scripts/sticker-ui.test.ts).
- 2026-10-24 lane C agent: **Done (landed)**. Rebased on main d631b7b (after FK-014 and FK-158; no overlapping files), main fast-forwarded to `ce88280`. `npm run typecheck` green, `npm test` 219 of 219 pass. None of the review notes asked for a code change on this card, so the commit is unchanged apart from the rebase.
  - **What Sami can see once the coordinator rebuilds the client and restarts 4600:** with Story OFF, /?stream=1 looks exactly as it does today. With Story ON (or `/?stream=1&demo=board`), the stream switches to the Sticker Toy look: slimmer letterbox bars (7vh, 76 px at 1080) with the subtitle moved down to match, and the feed, invite and caravan panels hidden. Fredoka and Nunito are served from /fonts, and the `.pill` / `.card` / `.pop-in` kit is ready for FK-010, FK-021 and FK-050.
  - **Follow-ups from review (coordinator):**
    1. **Tunnel fonts:** /fonts/* is not on PLAY_PATHS (src/server/tunnelGuard.ts) or play-worker PASS, so /play through the tunnel would get 404s for the woff2 files and fall back to Trebuchet/Segoe. Before any card puts story HUD on /play, add the six /fonts/*.woff2 paths (or a /fonts/ prefix) with Sami's OK, since these are tunnel files. Keep scripts/server-safety.test.ts green. The stream and /mayor are local, so they are not affected.
    2. **Lane D, FK-065 stats overlay:** client/dudes/stats.ts:155 already asks for `Nunito` 800, which now resolves to the self-hosted face (font-display:block). So a ?stats= page downloads Nunito (about 16 KB, local) and its text stays blank until the font arrives. This is probably what lane D wanted, but FK-065's look should be checked against the real Nunito. Story OFF without ?stats= is unaffected.
    3. **Play URL on stream:** with Story ON on the stream, the `.invite` panel (the `!play` URL and the "Walk your character" line) is hidden until FK-021's ticker brings the URL back. That follows the spec (design-system "Retired on stream in story mode"). Avoid a Story ON demo on 4600 that needs the play URL before FK-021 lands.
    4. **Subtitle restyle:** in the story look, #subtitle still uses today's style (Segoe, a separate speaker line, 22 px above the bar). Design-system §4 puts it inside the bottom bar at 58 px with a speaker chip, using the kit fonts and tokens. That belongs to the show-HUD card (FK-021 or similar), not FK-009.
