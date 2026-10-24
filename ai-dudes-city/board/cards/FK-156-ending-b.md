# FK-156 · The Rising 3b: ending B, he abdicates

| | |
|---|---|
| Milestone | Later |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-039](FK-039-show-keys.md), [FK-088](FK-088-the-ask.md), [FK-115](FK-115-rising-count.md) |
| Unblocks | [FK-185](FK-185-rising-sound-2.md) |

## Why (what changes for viewers or Sami)

Sami's redemption ending, all his improv. Split out of FK-116.

## Scope

- B held 2 s at any time in the Rising (capture-phase, Rising only, the operator.ts:264 clash handled): he hands Wren the key. Wren: "…Huh." Moss: "Still here." If he helped in the Bronze Ask, Wren adds "He gave the bronze. I remember that too."

## Acceptance criteria

- [ ] Plays on `$PORT` with and without `helped`.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `$PORT` (shot list added when promoted).

## Notes and risks

- Critic fix 18.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
