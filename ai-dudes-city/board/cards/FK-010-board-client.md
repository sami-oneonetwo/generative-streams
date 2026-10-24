# FK-010 · The Board on stream (client) + ?demo=board

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | C · Stream client |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Done (landed on main at f210eed) |
| Owner | lane C agent, 2026-10-24 |
| Depends on | [FK-009](FK-009-sticker-toy-ui-base.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-131](FK-131-wonder-bar-client.md), [FK-171](FK-171-ui-sounds.md) |

## Why (what changes for viewers or Sami)

The one thing always on screen: what gold builds, what red builds and who is winning, readable on a phone. With `?demo=board` Sami can see it on 4600 after the coordinator's client-only rebuild, before any server restart.

## Scope

- New client/dudes/board.ts rendering `TownView.board` into a root element `#board` in a top-centre strip 1240 px wide: gold pill bar on the left (crown, word inside the fill), red pill bar on the right (flag, "BRIDGE 3/8"), the rope tug line `type gold 7 ━━●━━ 4 type red` with a sliding knot, the 54 px ticker pill (crossfades every 20 s, hidden in cinema).
- Replaces renderCaravan (client/dudes/main.ts:862) when `board` is present; hidden during scenes. autoFrame (main.ts:201) keeps subjects below the top 250 px while the Board shows.
- `?demo=board` fills fake board data and assigns fake sides to visible dudes (for FK-013), locally, with no server change. Wren's site sign (FK-125) reads the same fake data.

## Acceptance criteria

- [ ] A 390 px phone shot of /?stream=1&demo=board shows "BIG HUT · type gold" and "BRIDGE 3/8 · type red" legibly.
- [ ] Story OFF: the caravan panel is back.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1&demo=board" /tmp/fk-shots/eng-c/fk010.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG); `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1&demo=board" /tmp/fk-shots/eng-c/fk010-phone.png --mobile --wait 8000`.

## Notes and risks

- Look per board/design-system.md §4; adjust details after FK-005 sign-off.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 · lane C agent: picked up (fk-c rebased on main at ce88280, FK-009 landed).
- 2026-10-24 · lane C agent: **ready for review** on branch fk-c at `897f15e` (rebased on main 173b73d, after FK-002; not landed). Acceptance criteria pass on 4613. Design spend $0.
  - **What's in it:** new client/dudes/board.ts. `createBoard()` builds `#board` the first time there is a board and removes it when the board goes (Story OFF has no `#board`, as FK-001's check wants). It is a top-centre strip 1240 px wide (design px, `--px`), with two 96 px ink pill bars. Gold is on the left: crown, then "BIG HUT 35%" in Fredoka 700 at 64 px. The fill is a gold copy of the face clipped to the %, so the word is ink over the fill and cream over the track. Red is on the right: "BRIDGE 3/8" (or "BRIDGE · soon" before the ask has a count), the flag at the outer end, filling from the right, cream text throughout. Under the bars is the tug line: the "type gold" chip (54), the gold tally (64), a striped rope that is gold up to the knot and red after it, the red tally, then the "type red" chip. The knot sits at gold's share of everyone on a side (the bible's `GOLD 7 ═════╪═══ RED 4`) and slides 0.8 s on change through a registered `--knot` property. Last comes the 54 px ink ticker pill. It shows one line at a time, the next every 20 s. A fresh line (a joiner, a turncoat) cuts in once the current line has had 5 s. The board's `now` holds the slot while it is set. The change is a dip: the old line fades out over 0.3 s, then the new one fades in, while the pill's width eases between them (an overlapping crossfade looked muddy in a mid-fade shot). Long bar words shrink from 64 to no less than 54, then cut at a word; long ticker lines cut at a word. Nothing moves at rest. With reduced motion there are no fades or pops.
  - **main.ts (+16/−5):** the viewer page only (stream and plain; /mayor gets FK-038's strip, /play keeps today's panels). `boardFor(town, dudes, location.search, play)` returns the server's `town.board`, else `?demo=board`'s, else nothing. `renderCaravan` gets `undefined` while the Board shows, so the caravan comes back the moment the board goes. autoFrame fits everyone below the strip's measured bottom + 12 px (`fitUnder`/`liftUnder`) and centres them there. The tags and bubbles keep out of the banner rect and the Board rect, merged into one (`reserved`). index.html: `#board` rules only (it fades with `body.cinema`); the troublemaker banner and the stream's knockout board drop under the strip via `--board-b`.
  - **`?demo=board`:** BIG HUT 35%, BRIDGE 3/8. The tally counts awake chatters by FK-013's `sideOf(d, true)`, so the numbers match the discs and icons. The ticker carries the premise ("The Chief took Wren's home", from `town.head`), "Type red or gold to pick a side", one joiner a side, and the !play line when the server has one. **FK-125:** Wren's sign can read the same board through `boardFor()` (exported). `board` is computed on every page in `apply()`, so the storyProps hook can take it from there.
  - **Tests:** scripts/board-ui.test.ts, 12 tests: bar texts and fills with edge values; the knot's position, mirror symmetry and monotonicity; the demo tally equals `sideOf` over awake chatters; boardFor priority; the ticker's rotation, fresh-line cut-in, list-of-one and pinned `now`; the autoFrame maths (the highest subject ends exactly at the strip); the reserve union; the sheet's sizes (1240/96/64/54); the scene fade and reduced motion; no `#board` in the markup and the main.ts wiring. scripts/sticker-ui.test.ts (FK-009's): its "Story OFF is today" check now allows `#board` rules to use story tokens, since that element only exists while a board shows. `npm run typecheck` green; `npm test` 241/241 after the rebase.
  - **Verified on 4613** (data/demo-c, Story OFF on the server; six `test-` names said hello). Shots are in /tmp/fk-shots/eng-c/ and /tmp/fk-shots/lane-c/.
    - `fk010.png` (/?stream=1&demo=board, 1920×1080): eval `{"body":"stream story board","rect":[340,14,1240,284],"bars":["BIG HUT 35%","BRIDGE 3/8"],"tally":["3","2"],"chips":["type gold","type red"],"ticker":"The Chief took Wren's home","caravan":"none","boardB":"298px","fonts":["Fredoka 600","Fredoka 700","Nunito 800"]}`. The 3–2 tally matches the crowns and flags in frame, and everyone is framed below the strip.
    - `fk010-phone.png` (`--mobile`, 390 px): "BIG HUT 35%" over "type gold" and "BRIDGE 3/8" over "type red", legible (words 13 px CSS at 3×, strip 252×57).
    - `fk010-off.png` (/?stream=1, Story OFF): `{"body":"stream","board":false,"caravan":"block","caravanTitle":"the Mammoth Herders · stuck at the river","feed":"block","invite":"block","happeningTop":"22px"}`: today's page.
    - Live flip (lane-c/fk010-flip-*.png): a Playwright script added `town.story` + `town.board` to the real snapshots, then took them away. It read OFF (caravan) → ON (board 62% / 2/4, tally 1–3, knot 28%, caravan none) → scene `opening` (`cinema`, board opacity 0) → after (opacity 1) → OFF again (no `#board`, caravan block, `--board-b` cleared).
    - `lane-c/fk010-banner.png`: a forced troublemaker banner and knockout board both start at 310 px, under the strip's 298 px bottom.
    - `lane-c/fk010-plain.png` (/?demo=board, not stream): the strip clears the invite panel at 1920.
    - Demo server stopped.
  - **Notes for later:**
    1. The strip measures 284 px tall at 1080 (bars + tug line + ticker at the spec'd 96/64/54 sizes), not the 250 in design-system §4. autoFrame reserves the measured height (298 + 12 px), so it stays right if FK-005's sign-off changes sizes.
    2. FK-011: the client rotates `ticker[]` itself (20 s, fresh lines within 5 s) and pins `now`, so the server only has to send the list.
    3. FK-021 (mine): hide the Board while the GATHER banner holds the strip.
    4. FK-171 (Lane S): `setBar()` in board.ts is where a bar's fill changes. A quarter-crossing note hooks in there.
    5. On the plain (non-stream) page, windows narrower than about 1500 px may let the strip touch the invite panel. The stream is unaffected.
    6. ~/gs-tools/shot.mjs: `--mobile` must come last (FK-013's note), so I used `--wait 8000 --mobile`.
    7. I briefly held the shot lock with a hung eval (a MutationObserver loop) and killed it within about 3 minutes. No other lane's shot was lost.
- 2026-10-24 · lane C agent: **landed** on main at `f210eed` (fk-c rebased on main 6958c4f, fast-forward; the card's commits are 472db43 and f210eed). `npm run typecheck` green, `npm test` 269/269, client bundle builds. Design spend $0. No demo-server re-check after the review fixes (both demo slots were taken); they are covered by scripts/board-ui.test.ts (15 tests now).
  - **What Sami can see once the coordinator rebuilds the client on 4600** (client-only, no restart needed): open `/?stream=1&demo=board` (or `/?demo=board`, or a phone at 390 px) to get the Board in place of the caravan panel. It shows a gold "BIG HUT 35%" bar, a red "BRIDGE 3/8" bar, the "type gold 3 ━━●━━ 2 type red" tug line counting the fake sides the dudes wear, and the ticker changing every 20 s. Without `?demo=board` and with Story OFF, the page is today's, caravan panel included. The real Board arrives with FK-011's `town.board`.
  - **Review notes applied (f210eed):** (1) a long bar word is cut, never its number: `fitBar` keeps "2/4" / "100%" whole and cuts only the word ("HEALER'S… 2/4", "ROYAL… 100%"), so the bible's Age 2–6 jobs keep their counts; (2) `checkBoard` gives a server board with a missing tally or ticker zeros or no line, and treats one without both bars as no board, so a malformed FK-011 board blanks the strip instead of throwing in apply() ahead of the dudes and builds; (3) while a scene has faded the HUD (`body.cinema`), tags and bubbles no longer keep out of the banner/Board rect; (4, part) on pages ≤1000 / ≤650 px wide the troublemaker banner never sits above today's 118 / 100 px (`max()` with `--board-b`); (7) `--knot` is set before anything measures a new strip, so the knot appears in place instead of sliding in from the middle.
  - **Follow-ups (not done here):**
    1. Plain (non-stream) page at phone width with Story ON: the strip (69..321 × 3..60 px at 390) still overlaps the header and invite panel (top 18 px). Shift the header below the Board on narrow plain pages when `body.board` is set (stream unaffected). Lane C, small.
    2. FK-005 sign-off: the strip is 284 px tall at 1080 (bottom 298), not design-system §4's 250. Either accept 284 and update §4, or tighten the gaps or the tug line. autoFrame uses the measured height either way.
    3. FK-005 sign-off: the two-tone bar word (ink on the fill, cream on the track, cut where the fill ends, e.g. through the G of BIG at 35%). Confirm it or choose another treatment (e.g. the word always in the fill's colour).
    4. `?demo=board` only: a joiner line that appears as chatters wake counts as news and cuts in after 5 s, so on a fresh page the demo can skip "Type red or gold to pick a side" once. Real lines come from FK-011. Mention it at Sami's demo review, or seed the demo's joiner lines into TickerClock's first look.
    5. FK-125 (Wren's sign) should read the board through `checkBoard(boardFor(...))`, so it gets the same missing-field defaults.
