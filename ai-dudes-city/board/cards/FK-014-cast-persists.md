# FK-014 · Cast persists: ids, spawn and the three wipes

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-015](FK-015-cast-ignores-small-talk.md), [FK-016](FK-016-apply-stone-cast-looks.md), [FK-025](FK-025-unveiling-v1.md), [FK-026](FK-026-rally-v1.md), [FK-044](FK-044-intro-now.md), [FK-045](FK-045-crossing-new-cast.md), [FK-046](FK-046-kit-follows-head.md), [FK-048](FK-048-age-turn-stone.md), [FK-056](FK-056-stage-stream-1.md), [FK-060](FK-060-cast-idle-bits.md), [FK-125](FK-125-wren-site-sign.md), [FK-127](FK-127-old-scenes-through-runtime.md), [FK-128](FK-128-cast-renames-and-daughter.md), [FK-173](FK-173-cast-voices.md) |

## Why (what changes for viewers or Sami)

Without this the age turn wipes the cast at the end of stream 1 and the story has no characters.

## Scope

- src/worlds/ai-dudes/story/cast.ts: role → {name, tag, look}: Wren ("Wren"), Ash ("Ash the hunter"), Moss ("Old Moss"), Oak ("Oak the builder"), Kit ("Kit"). Cast townies get `townie.role` and id `cast-<role>` instead of the `${name}:${age}` hash (caravan.ts:166).
- bringTravellers (caravan.ts:159) spawns the cast while Story is ON. The three wipes skip cast: startCaravan (caravan.ts:231), caravan off (caravan.ts:517), town life off (city.ts:1377).
- Ash leaves the cast table from Medieval on.
- Role tags reach the page through `castView()` (FK-001's spread). The renames, Toma / Ama and the daughter clean-up are FK-128.

## Acceptance criteria

- [ ] Story ON: the five show with their role tags.
- [ ] After an off-air `set-age bronze` on $PORT the same five ids are there.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests), including scripts/story-cast.test.ts (Stone → Bronze keeps 5 ids; every wipe skips the cast).

## How to verify

- On your lane's demo server (`$PORT`; it changes the age, so never on 4600): Story ON, `set-age bronze`, check the same five ids; one shot of the five with role tags: `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-b/fk014.png --w 1920 --h 1080 --wait 8000` (Read the PNG).

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
