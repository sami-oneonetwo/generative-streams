# FK-124 · Story scenes play on the stream page

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md), [FK-017](FK-017-show-runtime.md) |
| Unblocks | [FK-025](FK-025-unveiling-v1.md), [FK-026](FK-026-rally-v1.md), [FK-031](FK-031-m1-demo.md), [FK-134](FK-134-walk-shot.md), [FK-163](FK-163-mix-director.md), [FK-164](FK-164-scene-cue-track.md) |

## Why (what changes for viewers or Sami)

Without this no story scene shows on stream at all. cinema() looks scenes up in the static `SCENES[sc.id]` (client/dudes/main.ts:699-700), keyed by the saved `SceneId` enum (src/shared/scenes.ts:71, 78), and the page only sees `city.scene` through sceneView (caravan.ts:441-444, used at city.ts:1389). It blocks the Unveiling and the Rally.

## Scope

- client/dudes/main.ts cinema(): `const scene = sc && (STORY_SCENES[sc.id] ?? SCENES[sc.id])`, importing `STORY_SCENES` from src/shared/storyScenes.ts (Lane B's registry; FK-001 creates it with a `test` scene, FK-025 and FK-026 add theirs).
- Read `shift` and `heldAt` when present (treat as 0 until FK-036 does the hold maths).
- The server side is already wired, with no edit to city.ts or caravan.ts: FK-001 widens the view type `TownView.scene.id` to `string` and spreads `storyTownView` after `scene`; FK-017's `showView` puts `city.story.scene` into `town.scene`. (The critic's three-lane split collapses into those two cards plus this one.)

## Acceptance criteria

- [ ] Story (dev) → Play: test shows the test scene's shots and subtitle on /?stream=1.
- [ ] The old scenes (opening, Crossing, age turn) still play; Story OFF is unchanged.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`), with Story ON in /admin → Story (dev): Play: test; `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-c/fk124.png --w 1920 --h 1080 --wait 4000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- Critic fix 2. Lands day 4 so FK-025 can start day 5.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
