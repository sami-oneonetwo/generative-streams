# FK-011 · The Board data (server)

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Done (landed on main at abcaa4e, 2026-10-24) |
| Owner | lane E agent, 2026-10-24 |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-047](FK-047-red-job-make-room.md), [FK-125](FK-125-wren-site-sign.md), [FK-129](FK-129-story-jobs-drive-asks.md), [FK-130](FK-130-wonder-bar-server.md) |

## Why (what changes for viewers or Sami)

The Board shows live truth: the Folly's %, the bridge count, the side tally, and a ticker that recaps the premise for people who just arrived.

## Scope

- src/worlds/ai-dudes/story/board.ts builds `TownView.board` { gold{word, pct}, red{word, have, need}, tally{red, gold} over awake chatters, ticker[], now? }.
- Red from bridgeProgress (src/worlds/ai-dudes/caravan.ts:347) → "BRIDGE have/need", where need = ⌈0.4 × awake chatters⌉, 1 to 8 (caravan.ts:309). The bridge ask only exists after the opening has played (the live save has `caravan.asks = []`, caravan.ts:312-318), so until then the bar reads "BRIDGE · soon". Gold from `city.story.folly.pct` (0 until FK-023) → "BIG HUT".
- Ticker lines: the premise ("The Chief took Wren's home"), joiners and turncoats from `city.story.sideLog`, and the !play line that used to live in the invite panel. One line per 20 s; the client crossfades.
- Emitted by `boardView()` in story/board.ts, which FK-001 already spreads into `townView` (city.ts:1380-1389, Lane B's file): no hook needed. Only while Story is ON.

## Acceptance criteria

- [ ] Story ON, before the opening: "BRIDGE · soon". After /admin `scene-opening` (index.ts:1805) with 8 test names awake: "BRIDGE 0/4". Three *different* names each take one shift (a chatter gets one bridge shift only, worlds/ai-dudes/city.ts:887) → "BRIDGE 3/4 · type red"; "BIG HUT 0% · type gold"; tally 0–0; ticker rotating.
- [ ] Story OFF: no `board` in the view.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests), including scripts/story-board.test.ts.

## How to verify

- On your lane's demo server (`$PORT`), with Story ON in /admin → Story (dev): 8 test names say hello in /admin Test chat, then /admin → scene-opening, then "fix the bridge" from test-kev, test-dana and test-bo; `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-e/fk011.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- Lane E carries this in M1 (its own M1 load is light); story/board.ts is a new file, so no hotspot clash.
- The red column keeps the existing ask engine, so free builds of the asked kind count (bible §4).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24, lane E agent: picked up.
- 2026-10-24, lane E agent: **ready for review** on branch fk-e at `00dfea7` (one commit, rebased on main 928a0c2, after FK-010, FK-023 and FK-027; not landed). Acceptance criteria pass on 4615. `npm run typecheck` green, `npm test` 299/299 (9 new in scripts/story-board.test.ts). Design spend $0.
  - **What's in it:** src/worlds/ai-dudes/story/board.ts `boardView` → `town.board` (only while Story is ON, through FK-001's spread; nothing saved, read fresh each snapshot).
    - **gold** `{word, pct}`: FK-023's `FOLLIES[age].word` (BIG HUT … ONE SEAT) and `follyNow(state).pct` floored to a whole percent like `town.folly` (so 100 only when done); 0 before this age's cordon.
    - **red** `{word, have?, need?}`: the caravan's ask under way (the first not yet met), so the existing ask engine drives it. Stone before the opening: `{word: 'BRIDGE'}` (the page reads "BRIDGE · soon"); after it "BRIDGE have/need" from the bridge ask (need ⌈0.4 × awake⌉, 1 to 8; one shift per chatter, city.ts startLabour). Later asks switch the word by themselves through `RED_WORDS` by ask id (today's caravan: FOOD, FEED THEM, WORKSHOP, SHIFTS, PARTY; the Wonder by name, FURNACE), so FK-129/FK-047 only add their ids there; between asks, during an age turn or with the caravan off: `NEXT JOB` ("NEXT JOB · soon").
    - **tally** `{red, gold}`: awake chatters by `sideNow()`, new in story/sides.ts (my lane): the side counts in the age it was taken (`sideAge ?? age`), the same rule as FK-023's plaque carve. FK-012 should use `sideNow` for `sidesView` too, so discs and tally agree.
    - **ticker** `string[]`: "The Chief took Wren's home" (head by `headName`, so "The High Priest…" in Bronze), "Red helps Wren. Gold helps the Chief.", then up to 3 side lines from `city.story.sideLog`, newest person first, one line per person ("Nia joined gold", "Kev crossed to red"), only from the last 10 min, the latest turncoat always kept; names as the ticker says them ("kev" → Kev, own capitals kept, cut at 20). Last, the !play line "Walk your character: stream-play.kick-product.com" while the play site is set up (`PLAY_SECRET` and `PLAY_URL`, read from config like the crier's !play; the doors' open/closed state lives in src/index.ts, which I did not touch, so a closed door still shows the line, as !play still answers). The page rotates the list itself every 20 s and lets new lines cut in (FK-010), so the lines' words stay steady. `now` stays unset (nothing in M1 pins a line).
  - **Hook outside lane E:** scripts/story-save.test.ts (Lane A, FK-001's test), 1 line marked `// hook FK-011`: its "the stubs add nothing until their cards land" check expected `town.board` undefined with Story ON; it now expects the Board's ticker.
  - **Tests (scripts/story-board.test.ts):** Story OFF has no board (and ON/OFF flips it); before the opening BRIDGE · soon, BIG HUT 0, tally 0–0, premise first, nothing new in the save; the opening with 8 awake → 0/4, three different names "fix the bridge" → 3/4, kev again is turned away and it stays 3/4; after the crossing NEXT JOB, then FOOD, FEED THEM when food is met, FURNACE on the Wonder visit; the gold bar from a set Folly (37.8 → 37, 99.9 → 99, Bronze → GOLDEN ME 0 and "The High Priest took Wren's home") and from the real timer after raiseFolly (25% at a quarter of FOLLY.fillMs, equal to `town.folly.pct`); the tally (awake only, neutrals none, Stone's sides don't count in Bronze); sideLines (order, one per person, turncoat kept, 10 min, names); the !play line with and without a site, and steady words.
  - **Verified on 4615** (data/demo-e from a copy of the 4600 save, Stone; its caravan removed so the band arrives fresh and stranded; the old demo save kept as data/demo-e/world-ai-dudes.pre-fk011.json). /admin/api: story-on; 8 `test-` names said hello (Test chat's /chat route).
    - Before the opening: `board.red {word: BRIDGE}`; shot /tmp/fk-shots/lane-e/fk011-soon.png: "BIG HUT 0%", "BRIDGE · soon", type gold 0 ━●━ 0 type red, ticker "The Chief took Wren's home", caravan panel hidden.
    - /admin scene-opening, 34 s later `{BRIDGE, have 0, need 4}`; test-kev, test-dana, test-bo "fix the bridge" → `{have 3, need 4}`; test-kev "fix the bridge again" → still 3/4. Shot /tmp/fk-shots/eng-e/fk011.png (the card's path): "BIG HUT 0%", "BRIDGE 3/4" with the red fill at three quarters from the right, tally 0–0, ticker up. Eval `{"body":"stream story board","bars":["BIG HUT 0%…","BRIDGE 3/4…"],"caravan":"none"}`.
    - Story (dev) folly-raise + folly-progress 35: `gold {BIG HUT, 35}`; shot after 26 s, /tmp/fk-shots/lane-e/fk011-folly-ticker.png: "BIG HUT 38%" (the timer carries on), the ticker rotated to "Red helps Wren. Gold helps the Chief.".
    - story-off: no `town.board`, no `town.story`, the caravan board back. No schema errors in /tmp/fk-demo-e.log. Demo left with Story OFF; demo server stopped.
  - **Not shown on the demo:** joiner/turncoat lines (nothing writes `sideLog` until FK-012; covered by the unit tests).
- 2026-10-24, lane E agent: **review notes applied and landed.** Main fast-forwarded to `abcaa4e` (5b7399b the card, abcaa4e the review notes; rebased on main 039009f, after FK-128). `npm run typecheck` green, `npm test` 329/329. Design spend $0.
  - **The !play line follows the /play doors** (review notes 1 and 3): the server's ticker no longer carries it (`playSite()` gone); the page adds `Walk your character: <site>` last, from the snapshot's `play`, which src/index.ts playInfo sends only while the doors are open, the same way `?demo=board` already did. Closing the doors from /admin takes it off the ticker at the next snapshot; opening them brings it back as a fresh line. src/index.ts untouched.
  - **One wording on both boards** (review note 4): the ticker's second line is now `?demo=board`'s "Type red or gold to pick a side" (`PICK_A_SIDE`; a test pins it to demoBoard's), in place of "Red helps Wren. Gold helps the Chief.".
  - **Hook outside lane E:** client/dudes/board.ts (Lane C, FK-010's file), 2 additive lines in `boardFor`, marked `// hook FK-011`: with a server board and `play` set, the board comes back with the line appended (a malformed ticker reads as none); without `play`, the server's board unchanged (board-ui.test.ts's identity checks still hold). Tested from scripts/story-board.test.ts (open: the line last, without its scheme; closed: none; the server never sends it).
  - **Follow-up (review note 2, not M1):** BOARD.sideLines = 3 keeps only the 3 newest side lines plus the latest turncoat, so a burst of crossings within a few seconds can push older ones off the list before the page's TickerClock shows them (its fresh queue drops lines no longer listed). Nothing writes `sideLog` in M1. When FK-012 or the Defection Window card lands: keep every turncoat from the last minute or so (not just the latest), or let the page queue lines it has not shown yet, so every switch is announced (bible §258).
  - **What Sami sees once the coordinator restarts 4600 and rebuilds the client:** Story ON in /admin → the real Board on /?stream=1: "BIG HUT 0%" in gold, "BRIDGE · soon" in red until /admin scene-opening, then the live "BRIDGE have/need" as chatters "fix the bridge" (one shift each); the tally of awake chatters per side; the ticker going round every 20 s: "The Chief took Wren's home", "Type red or gold to pick a side", then "Walk your character: …" while the /play doors are open. Story OFF: today's caravan panel back.
