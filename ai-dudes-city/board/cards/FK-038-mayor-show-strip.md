# FK-038 · /mayor strip, lamp, cue cards and ON STREAM chip

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-037](FK-037-beat-queue.md), [FK-137](FK-137-mayor-screen-design.md) |
| Unblocks | [FK-039](FK-039-show-keys.md), [FK-045](FK-045-crossing-new-cast.md), [FK-057](FK-057-stream-only-rallies.md), [FK-058](FK-058-autopilot-and-safety-drawer.md), [FK-074](FK-074-stream-1-rehearsal.md), [FK-139](FK-139-design-review-m2.md), [FK-147](FK-147-medieval-cast-bits.md) |

## Why (what changes for viewers or Sami)

Sami sees what is armed and what to say, and the stream sees none of it.

## Scope

- `MayorView.show` {next, state, why, cue[3], plaque, shot, chip}.
- In client/dudes/operator.ts: one always-on line "NEXT: Unveiling ● ARMED · red 7 gold 4 · 9 awake · AI ●" (says why when locked, e.g. "folly 72%"; in a scene "Unveiling · shot 4/9 · 0:48"); the lamp pulses amber when armed (no chime); cue cards in large type at centre-bottom, only when armed or in a scene; the grey "ON STREAM" chip.

## Acceptance criteria

- [ ] /mayor shows the strip and lamp; /?stream=1 shows none of it.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT: one shot of /mayor and one of /?stream=1 at the same moment.

## Notes and risks

- Look from FK-137 (the /mayor design).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
