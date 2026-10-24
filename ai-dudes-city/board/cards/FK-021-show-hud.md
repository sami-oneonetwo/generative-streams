# FK-021 · Show HUD: gather banner, NOW card, title card, subtitles

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | C · Stream client |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-009](FK-009-sticker-toy-ui-base.md) |
| Unblocks | [FK-022](FK-022-prompt-tiles-and-crowd-shot.md), [FK-025](FK-025-unveiling-v1.md), [FK-026](FK-026-rally-v1.md), [FK-048](FK-048-age-turn-stone.md), [FK-142](FK-142-ribbon-beat-and-card.md), [FK-171](FK-171-ui-sounds.md) |

## Why (what changes for viewers or Sami)

Every gathering says what is happening in four words, and every scene ends by telling chat what to type.

## Scope

- New client/dudes/show.ts driven by `TownView.show`: the GATHER banner (72 px "GATHER: THE UNVEILING 0:25" with a countdown, 54 px premise) in the top strip in place of the Board.
- NOW card: 96 px word + 64 px "type red" chip, centre-lower, 6 s.
- Title card restyle (140 px caps, 10 px ink stroke); subtitle 58 px in the 7vh bar, one line of ≤ 42 characters, speaker chip 54 px in the speaker's colour. HUD fades as the letterbox comes in (0.9 s).
- `?demo=show` cycles the pieces locally.

## Acceptance criteria

- [ ] A phone shot of each piece is legible.
- [ ] Never more than two text layers during a scene.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Three shots of /?stream=1&demo=show (`--wait 4000`, `8000`, `12000`) to /tmp/fk-shots/eng-c/fk021-*.png.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
