# FK-011 · The Board data (server)

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
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
