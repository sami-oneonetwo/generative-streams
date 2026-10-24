# FK-017 · Show runtime: scenes tick on their own

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | A · Show core |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Done (landed) |
| Owner | lane A agent, 2026-10-24 |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-018](FK-018-gather-mode.md), [FK-019](FK-019-gather-visits.md), [FK-032](FK-032-calm-during-scenes.md), [FK-033](FK-033-bridge-intact-and-collapse.md), [FK-035](FK-035-holds-and-mayor-slots-server.md), [FK-045](FK-045-crossing-new-cast.md), [FK-048](FK-048-age-turn-stone.md), [FK-059](FK-059-crier-premise.md), [FK-124](FK-124-story-scenes-on-stream.md), [FK-127](FK-127-old-scenes-through-runtime.md), [FK-163](FK-163-mix-director.md), [FK-164](FK-164-scene-cue-track.md) |

## Why (what changes for viewers or Sami)

Today scenes only tick inside tickCaravan (caravan.ts:513-533), which needs town life and the caravan on. Story scenes must run whatever the caravan is doing, even with nobody awake.

## Scope

- src/worlds/ai-dudes/story/show.ts: `tickShow()` called from tickCity (src/worlds/ai-dudes/city.ts:1367) whenever Story is ON; state in `city.story.scene` {id, at, shift, heldAt, beat, vars}.
- `showView()` (FK-001's spread) puts `city.story.scene` {id, at, shift, heldAt, vars} into `town.scene` while a story scene runs, ahead of the caravan's `sceneView` (caravan.ts:441-444). The page plays it once FK-124 lands.
- Running the old caravan scenes (opening, Crossing, age turn) through the runtime is FK-127.
- Watchdog: try/catch round every beat → panic exit (end scene, release dudes, autoFrame) with an alert in the log. Hard lock caps per scene (bible §5).
- Wire `story-play` and `story-stop` in the Story (dev) panel.

## Acceptance criteria

- [ ] `story-play test` (FK-001's test scene) runs its beats with nobody awake and the caravan off, and `town.scene.id` is `test` while it runs.
- [ ] A beat that throws ends the scene cleanly and logs an alert.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests), including scripts/story-show.test.ts.

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): press Story (dev) → Play: test; read `town.scene` in the page (`--eval "JSON.stringify(state.town.scene)"` or the ws log).

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 · lane A agent: picked up.
- 2026-10-24 · lane A agent: **ready for review** on fk-a, commit 93373c9 (on top of main 173b73d, not landed). Typecheck green; `npm test` 239/239 (229 on main + 10 in the new scripts/story-show.test.ts). As built:
  - src/worlds/ai-dudes/story/show.ts: `playShow(state, id, now, vars?)` starts a STORY_SCENES scene in `city.story.scene` {id, at, shift 0, beat 0, vars clipped to the save's limits}; refuses an unknown id (`constructor` too) or a scene already playing. `tickShow(state, now, log)` runs the due beats once each, in order, on scene time `sceneTime()` = now − at − shift, frozen at `heldAt` (FK-035 sets both; `at` never moves), and ends the scene at its length (`story: the test scene ended`). `showView()` puts {id, at, shift, heldAt?, vars?} into `town.scene`, spread after the caravan's, so it plays ahead of today's scene. Beats are played from `SHOW_BEATS` (`step`, `emote` so far; a story beat's `who` is its place in the age's cast, castIn order); scene cards add their kinds there (hook requests to lane A).
  - Watchdog: a try/catch round each beat and round the whole tick. A beat that throws, a beat kind or scene id this build doesn't know, a NaN clock, or a scene held past its lock cap → `panicShow()`: releaseShow (scene, gatherings, the head's lock and hiding), alert `story: PANIC EXIT from the X scene: <why>; let go of N held things`. The page's camera goes back to autoFrame on its own once `town.scene` is gone. tickShow never throws into the world tick.
  - Lock caps (bible §5) in src/shared/scenes.ts: `LOCK_CAPS` {walk 25 s, rally 60 s, unveiling 120 s, lastLight 150 s, rising 4 min}, `Scene.lockMs?` (a scene names its cap); none named = its length + 15 s. Only holds can trip it: a stalled server ends the scene as written, no panic.
  - Called from the world tick in index.ts (lane A's), first thing, `if (storyOn) tickShow(...)`, not from inside tickCity: it is the same moment in the tick (tickCity's only caller), it needs no hook into Lane B's city.ts, it gets `ctx.log` for the watchdog's alert, and nothing later in the tick can hold a scene up.
  - Story (dev): Play: test runs through the runtime (refuses over today's caravan scene, "let it finish first", and over a story scene, "Stop it first"); Stop's alert names the scene it cut. /admin's note reads scene time (shift, heldAt, "held").
  - Hook into Lane B's src/shared/storyScenes.ts (+5/−1, marked `// hook FK-017`): the test scene's `beats: []` became two beats (1 s: the age's leader waves; 6 s: the next of the cast cheers), so Play: test exercises beats. scripts/story-dev.test.ts (lane A's) updated: Play: test no longer names FK-017, and a story scene now shows in `town.scene`.
  - Verified on 4611 (booted from the lane's demo copy of the live save, Wasteland, 1 chatter asleep): Story ON, then caravan-off and town-off (0 awake, no caravan). Pressed Play: test from the stream page's eval and read the socket 1.5 s in: `town.scene` = `{"id":"test","at":…,"shift":0}`, Wren (the Wasteland cast's first) `emote: wave`; the log then says `story: the test scene ended`. A second Play said "The test scene is playing: Stop it first"; Stop → `ALERT story: stopped the test scene (admin, panic exit): let go of 1 held thing`, `town.scene` gone. Shots: /tmp/fk-shots/lane-a/fk017-playing.png (/?stream=1 mid-scene: the stream unchanged, no cinema until FK-124, no page errors), /tmp/fk-shots/lane-a/fk017-admin.png (Story (dev): "Playing: test, 0:02 in", Play: test solid, the rest dashed). The throwing beat, the lock cap and the unknown scene are covered by the tests (no way to make a beat throw on a demo without a code change). Cleaned up: Story OFF, caravan and town life back on, demo stopped, demo save restored to its pre-demo copy.
  - Unblocks (once landed): FK-018, FK-019, FK-032, FK-033, FK-035, FK-124, FK-127 (with FK-014), FK-163 and FK-164 (with their other deps).
- 2026-10-24 · lane A agent: **landed** on main at `02be5212425eea83e1dcc3817c2e190ac530868c` (fk-a fast-forwarded; rebased onto f210eed, FK-010/FK-020/FK-023 in between). Typecheck green; `npm test` 280/280.
  - Review notes applied (commit 9dfa01f): /admin's "Story: play the opening" (scene-opening, index.ts) refuses while a story scene plays, "The test scene is playing: Stop it first", as Story (dev)'s Plays do; tickShow treats a clock stepped back more than 2 s before a scene's start as a broken clock (panic exit with an alert), so a scene can no longer sit forever on negative scene time with its lock cap never tripping; story-show.test.ts covers both and the `step` beat (Wren walks STEP_FORWARD the way she faces, atan2(dx, dz)).
  - Rebase: story/dev.ts import conflict (FK-023's FOLLY_DEV next to playShow) resolved keeping both. story-dev.test.ts's "at least 8 unbuilt" went stale once Play: test, Gather and the Folly buttons were all built: now pinned to the 7 left (Intro, Rally, Unveiling, Age turn, sides, spotlight, Stage stream 1) (commit 02be521).
  - Once the coordinator restarts 4600 and rebuilds the client, Sami can: Story ON in /admin → Story (dev), press Play: test, and the test scene runs on its own (even with nobody awake, caravan and town life off): the age's leader waves at 1 s and the next of the cast cheers at 6 s, the card reads "Playing: test, 0:0N in", it ends at 10 s ("story: the test scene ended" in the log), and Stop cuts it with an alert. The stream looks the same until FK-124 plays story scenes on the page.
  - Follow-ups (from the review, not done here):
    - FK-127 and FK-032 (coordinator, please add to those cards): the caravan's automatic scenes (arrival, crossing, ageTurn, finale; caravan.ts ~300/418/520) can still start while a story scene plays. showView puts the story scene ahead in `town.scene`, so the caravan scene plays on unseen and shows again partway through once the story scene ends; an ageTurn's age beat mid-story-scene changes castAt()'s cast. Today only a 10 s dev Play: test can overlap them (Story ON). Those cards should guard the overlap.
    - How to verify (coordinator, on the next sync): the stream page has no `state` global, so read `town.scene` from the page socket (ws://localhost:$PORT/ws), not with `--eval "JSON.stringify(state.town.scene)"`. On a demo save with no cast in town, Reset the cast first (it needs the caravan and town life on), then switch both off; without that Play: test's beats have nobody to move.
    - Optional, cosmetic: Stop and the panic exit leave the current beat's emote running for up to 2.5 s (Wren keeps waving after Stop). releaseShow could clear the emotes the scene's beats started; left as is (it ends on its own, and the card doesn't ask for it).
