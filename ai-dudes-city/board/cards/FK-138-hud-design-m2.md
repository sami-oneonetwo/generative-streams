# FK-138 · M2 HUD design: standings, VERDICT, rally banner, turncoat pop-up

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | design |
| Lane | X · Design |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-005](FK-005-hud-sticker-kit-mock.md) |
| Unblocks | [FK-139](FK-139-design-review-m2.md) |
| Design spend (openai/gpt-6-astra only) | ~$1.50 (two critique rounds) |

## Why (what changes for viewers or Sami)

The M2 and M3 pieces need the same crisp look as M1's before engineers build them.

## Scope

- Add to the FK-005 kit: the standings card ("TONIGHT: RED 9 · GOLD 6 · Kev crossed twice"), the VERDICT: RED / GOLD card, the rally banner "WREN'S FIRE · type coming" with its pip row, the turncoat pop-up ("KEV → RED"), the final "your home through the ages" card and the cliffhanger card.
- Two `critique-image` rounds; the design gate (design-system.md §9).

## Acceptance criteria

- [ ] Shots at 1920×1080 and 390 px; every text ≥ 54 px at 1920; red and gold distinguishable in greyscale.
- [ ] Sami's thumbs-up recorded on this card.

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "file:///home/sami/workspace/fk-wt/x/ai-dudes-city/design/hud/fk-hud.html#m2" /tmp/fk-shots/design/fk138.png --w 1920 --h 1080 --wait 4000` (one shot at a time, behind the shot lock; Read the PNG), then `--mobile`.

## Notes and risks

- Critic fix 20. FK-048, FK-050, FK-057, FK-141 polish to it.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
