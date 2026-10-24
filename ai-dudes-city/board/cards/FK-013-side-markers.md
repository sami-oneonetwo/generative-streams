# FK-013 · Side markers: ground disc and crown or flag

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane D agent, 2026-10-24 |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-030](FK-030-story-world-kit-review.md), [FK-031](FK-031-m1-demo.md) |

## Why (what changes for viewers or Sami)

Sides must read on a phone and in greyscale: a disc under the dude, a crown for gold, a flag for red.

## Scope

- client/dudes/dudes.ts: from `DudeView.side` draw a 1.3 m ground disc (#B3262E or #FFC633) with the sticker rim (0.1 m cream, then 0.05 m ink). Instanced: one draw call per colour.
- Tag icon: crown for gold, pennant flag for red; neutrals get nothing.

## Acceptance criteria

- [ ] /?stream=1&demo=board shows discs and icons on visible dudes; real sides after FK-012.
- [ ] Red and gold discs differ clearly in a greyscale shot.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1&demo=board" /tmp/fk-shots/eng-d/fk013.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG); `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1&demo=board" /tmp/fk-shots/eng-d/fk013-phone.png --mobile --wait 8000`.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 lane D agent: picked up.
- 2026-10-24 lane D agent: implemented on fk-d, commit dc45407 (rebased on main 383fc05; not landed: waits for review). Typecheck green; `npm test` 167/167 (161 on main + 6 in scripts/side-marks.test.ts). As built:
  - New client/dudes/sideMarks.ts (lane D): the locked colours (RED #B3262E, GOLD #FFC633, CREAM, INK); the disc geometry (the side colour 1.3 m across, then 0.1 m cream, then 0.05 m ink, so 1.6 m outside the rim; vertex colours, one mesh per face colour); `SideDiscs`, two InstancedMeshes = **one draw call per colour**, empty and `visible=false` when nobody is on a side, so **Story OFF draws nothing new** (no draw call, no state change). Unlit and `toneMapped:false`, so the screen shows the locked hex in any age's light; drawn after the opaque world (renderOrder 1) with no depth write, so a disc lies on the ground under the feet, hides behind anything in front, and overlapping discs in a gathering stack cleanly instead of z-fighting. No shadows cast. The disc goes while a dude is up on / aboard / inside a build or swimming (the tag still shows the side); it shrinks with them into a build and dims with them when napping.
  - Tag icon: inline-SVG crown (gold) / pennant flag (red) in the sticker style (cream rim, ink line), in front of the name; neutrals get nothing (the slot is `hidden`). `sideIcon(side)` is exported so FK-010's Board and FK-021's banners/NOW card can use the same crown and flag. The icon's CSS is injected by dudes.ts (no index.html edit); its width counts in the tag declutter.
  - `?demo=board` fake sides live here (client/dudes/sideMarks.ts `demoSide`, wired in dudes.ts): chatters only (never troublemakers, residents, travellers or the head), steady per id, two in five gold, two in five red, one neutral; a real `DudeView.side` from the server always wins. **Note for lane C (FK-010):** the "assigns fake sides to visible dudes (for FK-013)" half of `?demo=board` is done; FK-010 only needs the fake Board data.
  - dudes.ts: +34 lines (the import, `side` / `tagSide` on a figure, the disc in pose(), the icon in sync(), dispose). No other lane's file touched; no server change (real sides arrive with FK-012's `sidesView`).
- 2026-10-24 lane D agent: verified on 4614 (data/demo-d, 40 chatters, Story OFF on the server; six `test-` names injected to wake tags, removed afterwards with /admin remove-dude). `/?stream=1&demo=board`: gold and red discs under the chatters, crown / flag on the tags (eval: 8 tags shown, 3 crowns, 2 flags), no page errors: /tmp/fk-shots/lane-d/fk013.png (copied to /tmp/fk-shots/eng-d/fk013.png). Greyscale (`filter:grayscale(1)` on the page): gold discs read near-white, red discs dark, crown light and flag dark: /tmp/fk-shots/lane-d/fk013-grey.png; close-ups fk013-zoom.png, fk013-zoom-red.png; the stream at phone width (390 px, colour and grey) fk013-phone-scale.png: the discs show as gold and red dots under the dudes. Phone page (`--mobile`): /tmp/fk-shots/lane-d/fk013-phone.png (a red disc reads; today's stream HUD covers most of a 390 px page, which FK-009/FK-010 replace). Story OFF `/?stream=1&stats=1`: no discs, no icons (eval `icons: 0`), tags unchanged: fk013-off.png. Unit tests: locked colours and greyscale gap (luminance 0.11 vs 0.62, contrast > 4:1), disc bands and radii and face-up, one mesh per colour and none drawn with nobody on a side, real side beats demo, demo only for chatters, disc placement rules, icons. **Acceptance criteria pass on 4614** (real sides follow FK-012). Demo server stopped. Design spend: $0. Unblocks (with the others): FK-030, FK-031.
- 2026-10-24 lane D agent: review notes applied (3e354da): the disc now really shrinks with a dude going into a build (`discHeight` drops the `hidden` check; pose() scales the disc by `f.vis` and stops at 0), and it lies at y 0.045, over the kerb tops (0.04) and the raised pavement (0.02), still under ON_GROUND, so a kerb no longer cuts a band out of a disc on the walking edge (orthographic camera, near 0.1 / far 2400: the 5 mm gap is about 25 depth steps, no z-fighting). Rebased on main c4dc38f; typecheck green; `npm test` 190 tests, 189 pass, 0 fail, 1 todo (FK-158's NaN-gain todo, not this card).
- 2026-10-24 lane D agent: **landed on main 3e354da** (1ed09c1 + 3e354da, fast-forward). Once the coordinator rebuilds the client and restarts 4600, Sami can open `/?stream=1&demo=board` and see red and gold sticker-rimmed discs under the chatters, with a crown (gold) or pennant flag (red) in front of their names; neutrals and the town's own people get nothing. With Story OFF and no `?demo=board` the town looks exactly as it does today. Real sides follow FK-012.
  - Follow-ups (not done here):
    - **Disc size, design lead's call:** the build reads "1.3 m" as the coloured face, so the disc is 1.6 m across with the rim. If design-system.md §5 "Side disc: 1.3 m" means the whole disc, set `SIDE_DISC.face` to 0.5 (0.5 + 0.1 + 0.05 = 0.65 radius) and update the 1.3 m assertion in scripts/side-marks.test.ts. It matters most in tight rallies, where 1.6 m discs overlap more.
    - **Coordinator → lane C (FK-010):** the "assigns fake sides to visible dudes (for FK-013)" half of `?demo=board` is built. FK-010 should import `demoSidesOn`, `demoSide` and `sideOf` from client/dudes/sideMarks.ts for its fake Board totals, so the Board numbers match the marks on the dudes, and drop that part from its scope.
    - **shot.mjs:** `--mobile` swallows the argument after it, so this card's How to verify `... --mobile --wait 8000` runs with the default wait. Put `--mobile` last, or make ~/gs-tools/shot.mjs treat it as a flag with no value.
    - **Mood diamond colours (FK-009 / FK-064):** the tag's old mood diamond (yellow #e9c23c for "ok", red #e0523f for "low") sits next to the new crown and flag and can read as a side colour at phone size. Hand this to the stream-mode accent rules, not this card.
