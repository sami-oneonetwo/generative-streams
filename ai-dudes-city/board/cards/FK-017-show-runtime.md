# FK-017 · Show runtime: scenes tick on their own

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | A · Show core |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
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
