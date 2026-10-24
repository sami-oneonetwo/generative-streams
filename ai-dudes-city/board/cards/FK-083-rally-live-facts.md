# FK-083 · Rally lines with live facts

| | |
|---|---|
| Milestone | M3 Bronze ready |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-082](FK-082-auto-rallies.md) |
| Unblocks | [FK-099](FK-099-bronze-rehearsal.md) |

## Why (what changes for viewers or Sami)

Wren names real chatters and what the head is doing right now.

## Scope

- Templates: "{chatter} built more today than the {title} has all age." / "Right now he's {mayorDoing}. That's who's in charge of us." / "{chatter}, you came. He never comes." Fall back to the fixed bank when a fact is missing. Tone: mock what he does, never who he is, never a chatter.

## Acceptance criteria

- [ ] A rally uses at least one live line with a real name.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
