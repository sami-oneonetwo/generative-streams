# FK-005 · HUD sticker-kit mock (static page)

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | design |
| Lane | X · Design |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane X agent, 2026-10-24 |
| Depends on | — |
| Unblocks | [FK-137](FK-137-mayor-screen-design.md), [FK-138](FK-138-hud-design-m2.md) |
| Design spend (openai/gpt-6-astra only) | ~$1.50 (two critique-image rounds) |

## Why (what changes for viewers or Sami)

Sami signs off the look of every story HUD piece from one phone screenshot before engineers polish them.

## Scope

- design/hud/fk-hud.html, 1920×1080 over a real town shot. The coordinator copies it to public/fk-hud.html in the main checkout (untracked build output), so Sami opens /fk-hud.html on 4600 with no restart.
- Pieces: the Board (two 96 px pill bars, crown and flag, the rope tug line with its knot, the 54 px ticker), GATHER banner, NOW card, title card (140 px), subtitle in a 7vh letterbox, cast / head / chatter tags with crown or flag, side disc, RATE IT tile (160 px), rally pips, ON STREAM chip, plaque card, the "your home through the ages" strip, and **THE WONDER**: the two bars merged into one pill, filled red from one end and gold from the other by who put in what, grey for the rest (FK-130/FK-131).
- Fonts Fredoka 600/700 and Nunito 800 (OFL woff2 in design/hud/fonts). Follows board/design-system.md exactly.
- Build the page now (no dependency). Only the two `critique-image` rounds wait for FK-003; then the design gate (board/design-system.md §9).

## Acceptance criteria

- [x] Shots at 1920×1080 and at 390 px wide.
- [x] Every text ≥ 54 px at 1920 (chatter tags 40 px by design exception); ≤ 2 text layers in the scene states; red and gold distinguishable in greyscale.
- [ ] Sami's thumbs-up recorded on this card.

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "file:///home/sami/workspace/fk-wt/x/ai-dudes-city/design/hud/fk-hud.html" /tmp/fk-shots/design/fk005-hud.png --w 1920 --h 1080 --wait 4000` (one shot at a time, behind the shot lock; Read the PNG), then the same with `--mobile` to fk005-hud-phone.png.
- After the coordinator's copy: Sami opens /fk-hud.html on 4600.

## Notes and risks

- A static page: no game code. It becomes the visual spec for FK-009, FK-010, FK-021 and FK-022, which may start from design-system.md before sign-off.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 lane X agent: picked up.
- 2026-10-24 lane X agent: **built and verified on fk-x (commit db2fbfc, not landed); acceptance 1 and 2 pass, 3 waits on Sami.** Typecheck green; `npm test` 192 tests, 191 pass, 0 fail (the 1 todo is FK-157's FK-158 note); 11 new in scripts/design-hud.test.ts.
  - **The page:** design/hud/fk-hud.html, one self-contained file (322 KB: fonts and town shots inlined by `npx tsx design/hud/build.ts` from design/hud/fk-hud.src.html; a test fails if the two drift). **Coordinator: copy just that file to public/fk-hud.html**; I checked a copy opens on its own. Nine 1920×1080 frames, scaled to the page width (so 390 px wide on a phone, as Kick shows the stream): 1 free play (the Board: gold BIG HUT 72% with the crown and red BRIDGE 3/8 with the flag, filling toward the middle; the tug line; the ticker; Wren's cast tag, chatter tags with crown or flag, side discs), 2 the Call (GATHER banner), 3 the reveal U3 (title card 140 px, RATE IT 160 px), 4 the hero shot U4 (plaque card and subtitle in the 76 px letterbox), 5 the rally (pips and subtitle), 6 the NOW card, 7 THE WONDER, 8 the home-through-the-ages card, 9 the kit sheet (every tag and chip, ON STREAM for /mayor, the palette with its greyscale check, icons, discs, rules). Knobs: `?only=wonder`, `?sheet=3`, `?grey=1`, `?still=1`; `hudAudit()` in the console checks the size and layer rules on the page as drawn.
  - **How to verify, run:** /tmp/fk-shots/design/fk005-hud.png (1920×1080) and fk005-hud-phone.png (`--mobile`), both read. `hudAudit()` on both: no text under 54 px (chatter tags 40), nothing overflowing, scene text layers reveal 2, plaque 2, rally 1. **For Sami's one PNG:** /tmp/fk-shots/design/fk005-hud-phone-all.png, all nine frames at phone width (390 px, 3×); greyscale twin fk005-hud-phone-grey.png (red and gold stay apart: gold L* 83, red L* 40, plus crown and flag).
  - **Town shots:** real stream frames from Lane C's Stone demo server (4613), taken over the camera locally (wheel and shift-drag on the page only, nothing sent to the server) with design/hud/town-shot.js, turned to WebP by design/hud/town.mjs. The band at the broken bridge (the Mammoth Herders) stands in for the cast and the chatters.
  - **Astra (openai/gpt-6-astra, `critique-image --hud 1`, a new flag: HUD_RUBRIC in design/story.ts judges stickers on the glass, not world pieces):** r1 revise 6/10 ($0.168), r2 revise 7/10 ($0.142), gate colours ✓ story colours ✓ funny ✓ phone ✗. Card spend **$0.31** of the $1.50 ceiling (DESIGN_BUDGET_USD 175.83); programme **$173.14**. Sheets and critiques: design/out/hud/r1, r2. No third round (§9): I applied r2's notes at the gate and checked the phone and greyscale shots myself. Taken from the critiques: one command in THE WONDER (`type help`; the tug's ends become plain side badges), Board and Wonder words cream with an 8 px ink keyline so they read over any fill, flat tug spans and a bigger knot, RATE IT says `type 1–10`, the plaque carries only "FRIENDS OF THE CHIEF" and the names (the title had its card), "Him or us?" with `type us` in its own chip and the pips just above it, no story gold at Wren's fire or on the home card, 6 px outlines on every pill, card, tag and badge. Not taken (the bible says otherwise): "type red" instead of "type us" at the rally (bible §4 Crowd Mic), a command on the GATHER banner (a town gathering walks everyone in), dropping `type coming` (the rally banner's word).
  - **Numbers for FK-009/010/021/022/131 (the page is the spec):** the free-play strip is 24–310 px (318 with its shadow), so autoFrame needs about 330 px clear at the top, not 250. A bar holds 480 px of label: 64 px fits "GOLDEN ME 8%", a longer label drops to 54 px without tracking, which fits "BUST WORKS 100%", so a Board word is 10 letters at most: **the Modern Folly's Board word must be GOLF, not GOLF COURSE.** Fills get a 5 px cream leading edge (red and the ink track are close in grey). Letterbox bars are INK #1E1914 (FK-009 kept #050605; either reads). Discs measured at the shot's px per metre (1.3 m, 0.1 m cream, 0.05 m ink). The funny detail: the tug knot has a face and looks at whoever leads.
  - **Asks for Sami (acceptance 3):** a thumbs-up on fk005-hud-phone-all.png or /fk-hud.html, and in particular on the chatter tags as dark pills (cast in their colours, the head gold) and the tug knot's face.
- 2026-10-24 lane X agent: **review notes applied (fk-x 994cf64)**, all eight minor notes taken. (1) THE WONDER: `type help` comes off the pill into its own chip beside the ticker, so the word is the only thing on the pill and the grey that's left and red's edge both show. `.fg`/`.fr` get the Board's 5 px cream leading edge. (2) Board and Wonder fills count from the end badge's inner edge (80 px in: 4 px inset + the 76 px badge), so GOLDEN ME 8% shows a 41 px stub past the crown, not an empty bar. On the Wonder, the two shares count between its two badges. **Spec for FK-010/FK-131: `width = 80px + fill × (inner width − 80px)`, Wonder `80px + share × (inner width − 160px)`.** (3) Free play and THE WONDER are recast so each tag and disc pair reads on its own: kev (red disc, flag tag) is the big one, dana (gold) stays, WREN's tag sits over a figure standing alone at the right, and the little one's tag is thinned under kev's, as dudes.ts thins overlapping tags. Every disc is clear of every tag now. (4) One chip rule: **an icon in a chip always sits on a cream badge**. That gives type gold a crown and type red a flag on the Board's tug, the NOW card, `type us` at the rally, `type coming` with the fire on a cream badge, and ON STREAM's eye. A side's chip always carries its icon. The badges cost the tug rope about 100 px (about 290 px at 1920); I checked it still reads at 390 px wide. ON STREAM moved up by the tags on the kit sheet so the chip row fits. (5) The NOW card now sits over the band shot, the rally's own, with the broken bridge in view above it. The reveal caption says the Big Hut itself is FK-007's build and this lot stands in for it. (6) **Answer to FK-010's follow-up 3: the bar word is cream with an 8 px ink keyline (`-webkit-text-stroke:16px` + `paint-order:stroke fill`). This replaces FK-010's two-tone ink/cream word once Sami signs off, so the coordinator should file that client change.** (7) Rebased onto main and re-run (below). (8) Acceptance boxes 1 and 2 ticked; box 3 waits on Sami. New test assertions pin the fill geometry, the chip rule (6 side chips, each with its own icon on a cream badge) and the Wonder pill holding only its word. Astra spend: none in this pass (card total stays $0.31).
- 2026-10-24 lane X agent: **landed on main at 994cf64** (FK-005 is 764d87f + 994cf64, fast-forward after rebasing onto 928a0c2). Typecheck green; `npm test` 301 tests, 301 pass, 0 fail. `hudAudit()` on the built page: no text under the size rules, nothing overflowing, scene layers reveal 2, plaque 2, rally 1. **Once the coordinator copies `ai-dudes-city/design/hud/fk-hud.html` to `public/fk-hud.html`, Sami can open /fk-hud.html on 4600 (no restart or rebuild needed) and see every story HUD piece in nine frames over real town shots,** at phone width on his phone (`?grey=1` for greyscale, `?only=wonder` for one frame). The PNGs for his thumbs-up are re-shot from the landed page: /tmp/fk-shots/design/fk005-hud-phone-all.png (all nine frames, 390 px wide @3x), fk005-hud-phone-grey.png, fk005-hud.png (1920×1080) and fk005-hud-phone.png.
  - **Follow-ups:** (a) acceptance 3: Sami's thumbs-up. (b) FK-010 (landed) client: the cream keyline bar word in place of the two-tone word, the 80 px zero for the fills, and crown or flag badges on the tug's command chips (all three are coordinator to file once Sami signs off). (c) FK-131: the Wonder geometry and `type help` off the pill, as in frame 7. (d) FK-138 (rally banner): `type coming` with the fire on a cream badge, per the chip rule. (e) FK-013 can take frame 1 as its side-marker spec as recast.
