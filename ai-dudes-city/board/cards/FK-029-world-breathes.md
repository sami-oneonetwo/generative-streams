# FK-029 · The world breathes

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-066](FK-066-bird-flock.md) |

## Why (what changes for viewers or Sami)

Today the stream is a still image with two ants. A little ambient motion keeps it alive without clutter.

## Scope

- River texture scroll (clone the water texture so the cached copy is not shared with other ground; 0 extra draw calls).
- Smoke from the camp hearth and the square's fire: ≤ 2 instanced meshes, big slow puffs.
- Pennants sway. Half speed while the letterbox is up; off under prefers-reduced-motion. Only active while Story is ON (`state.ai.story`); Story OFF = today's game, unchanged.

## Acceptance criteria

- [ ] Two shots 1 s apart differ at the river and both fires.
- [ ] Draw calls rise by ≤ 2 (check with FK-065 once it lands).
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Two shots of /?stream=1&demo=board with `--wait 8000` and `--wait 9000` to /tmp/fk-shots/eng-c/fk029-{a,b}.png.

## Notes and risks

- Budget: board/motion-budget.md.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
