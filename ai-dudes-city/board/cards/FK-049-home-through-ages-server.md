# FK-049 · Your home through the ages (server)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-050](FK-050-home-through-ages-card.md), [FK-051](FK-051-pets-age-with-world.md) |

## Why (what changes for viewers or Sami)

Persistence is the big hook: your home survives every stream and changes with each age. Show it.

## Scope

- Each restyle appends `object.past` {age, name} (names only, max 6) and **keeps `moves`, `creature` and `follows`**: today mayor.ts:411-414 replaces the whole blueprint and drops `moves`, which is why a pet would stop following after an age turn. One ≤10-line hook at mayor.ts:411-414, applied by Lane E.
- nextRestyle (src/worlds/ai-dudes/index.ts:817) does returning chatters' homes first, then pets.
- **One spotlight rule (the same in FK-050):** a returning chatter's home is spotlighted on their first chat line in a new age; and `spotlight-top3` shows the three oldest homes in turn, called by Moss's "Previously" (FK-095) as it ends, plus a Story (dev) button. `TownView.spotlight` {owner, names[], objectId} comes from `spotlightView()` (story/spotlight.ts, FK-001's spread). At most one every 20 s, never during a scene.
- No new AI cost: only the order of restyles that already happen changes.

## Acceptance criteria

- [ ] After `set-age bronze` on `$PORT`, test-kev's first line spotlights his home; his pet still follows him (`moves` kept); Story (dev) → Spotlight top 3 shows three homes in turn.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `$PORT`: three test homes and one test pet, `set-age bronze`, then a line from test-kev.

## Notes and risks

- Stream 1 ends on the age turn, so the restyles land after viewers have gone: the spotlights pay off in stream 2, where returning chatters are.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
