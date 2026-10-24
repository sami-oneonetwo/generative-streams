# FK-050 · Your home through the ages (card and camera)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-009](FK-009-sticker-toy-ui-base.md), [FK-048](FK-048-age-turn-stone.md), [FK-049](FK-049-home-through-ages-server.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-139](FK-139-design-review-m2.md) |

## Why (what changes for viewers or Sami)

A returning chatter sees their own home restyled for the new age, by name: "KEV'S HOME · SINCE THE STONE AGE".

## Scope

- A card "KEV'S HOME · Mud Hut → Bronze Villa" with one stamp per age, plus a 6 s camera focus on the home, driven by `TownView.spotlight` (FK-049).
- The rule (the same as FK-049): on a returning chatter's first line in a new age, and the top 3 after Moss's "Previously" (FK-095). Not at the age turn itself: stream 1 ends on it, so the restyles land after viewers have gone.
- If a restyle isn't ready, the instant palette swap shows (docs/ages.md:42).

## Acceptance criteria

- [ ] After `set-age bronze` on `$PORT`, test-kev's first line shows his home card; Story (dev) → Spotlight top 3 shows three cards in turn.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT shots of the card.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
