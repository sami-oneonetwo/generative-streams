# FK-024 · Folly look: cordon, tarp, sign, beam and the drop

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | D · World look |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-025](FK-025-unveiling-v1.md), [FK-030](FK-030-story-world-kit-review.md), [FK-168](FK-168-unveiling-score.md) |

## Why (what changes for viewers or Sami)

The Folly must read as "something big and secret" from across town, and the reveal has to pop.

## Scope

- client/dudes/objects.ts for `folly` objects: replace the 0.1 silhouette shade (objects.ts:395) with draped cream canvas #EFE3C2 over the bounding box, gold rope bands and a giant gold crown stencil, scaled with pct.
- Cordon: a stake every 2 m, gold rope, swaying gold-and-ink pennants. Sign 4×1.6 m "KEEP OUT. SOMETHING AMAZING." (gold face; only the frame material changes per age). A plaque plate.
- Gold beam: radius 0.6 m at 20% while the cordon is up; 1.6 m at 45% with a 0.4 Hz pulse during a Call.
- Reveal on the `unveil` beat: the tarp drops in 0.4 s, 6 large dust puffs, gold confetti (≤ 24 big pieces), camera still.
- `?demo=folly` draws a local fake Folly (cordon, tarp, sign, beam at STORY_SITES.folly, pct climbing) and plays the drop every 15 s, with no server change, so Sami sees it on 4600 after a client-only rebuild.

## Acceptance criteria

- [ ] A stream-framed shot of the tarped Folly reads at phone size.
- [ ] The drop plays on the `unveil` beat.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): Story (dev) → Raise the cordon → `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-d/fk024.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).
- `?demo=folly`: two shots of /?stream=1&demo=folly on `$PORT`, one under the tarp and one just after a drop.

## Notes and risks

- Engine-drawn so it is the same in every age (board/design-system.md §5).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
