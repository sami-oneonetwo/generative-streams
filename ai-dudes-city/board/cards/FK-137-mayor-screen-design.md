# FK-137 · /mayor operator screen design

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | design |
| Lane | X · Design |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-005](FK-005-hud-sticker-kit-mock.md) |
| Unblocks | [FK-038](FK-038-mayor-show-strip.md), [FK-139](FK-139-design-review-m2.md) |
| Design spend (openai/gpt-6-astra only) | ~$1 (one critique round) |

## Why (what changes for viewers or Sami)

Sami runs the whole show alone from /mayor while talking. The strip, the lamp and the cue cards have to read at a glance, in the same look as the stream.

## Scope

- design/hud/fk-mayor.html: a static 1920×1080 mock over a real /mayor shot: the one-line NEXT strip, the lamp (locked / armed / firing), cue cards 1/2/3 in large type, the grey ON STREAM chip, a `warn` ping, Autopilot, the safety drawer closed and open.
- Same tokens and fonts as FK-005; one `critique-image` round; the design gate (design-system.md §9).

## Acceptance criteria

- [ ] A shot at 1920×1080; every label readable at arm's length (≥ 28 px: /mayor isn't on stream, so the 54 px rule doesn't apply).
- [ ] Sami's thumbs-up recorded on this card.

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "file:///home/sami/workspace/fk-wt/x/ai-dudes-city/design/hud/fk-mayor.html" /tmp/fk-shots/design/fk137.png --w 1920 --h 1080 --wait 4000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- Critic fix 20. FK-038 builds to it.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
