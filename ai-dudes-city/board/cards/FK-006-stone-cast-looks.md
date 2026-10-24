# FK-006 · Stone cast looks (Wren, Ash, Moss, Oak, Kit, the Chief)

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | design |
| Lane | X · Design |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-003](FK-003-design-pipeline-repair.md) |
| Unblocks | [FK-016](FK-016-apply-stone-cast-looks.md), [FK-064](FK-064-story-colours-and-head-kit.md), [FK-086](FK-086-bronze-cast-and-adult-wren.md) |
| Design spend (openai/gpt-6-astra only) | ~$3 |

## Why (what changes for viewers or Sami)

Viewers must tell the five apart at phone size, and Wren's red must be the biggest shape in any frame she is in.

## Scope

- `cast stone` → design/spec/cast/stone.json: fixed-colour outfit kits (they skip restyleColour) plus hand-made parts over the pinned Stone kit.
- Wren: teen at scale 0.82 (today DAUGHTER_SCALE is 0.56, src/worlds/ai-dudes/caravan.ts:99); red hair cord with long tails, red-ochre shoulder hide, bone whistle; the top third of her silhouette is red.
- Ash: the tallest (1.15), grey-streaked, cream bandage on the left leg, 2.1 m carved staff, red wrist cord.
- Moss: seated on a stump, green shawl #4E8A3A, knotted cord in her lap. Oak: scale 1.25, orange apron #E8762B, mallet with a 0.35 m head. Kit: scale 0.7, plain blue #2F6FD0, 0.16 m gold badge.
- The head (Stone Chief): gold sash, hat at ×1.0 of the ladder, no red anywhere. The flashback stand-in Chief uses this Stone head kit (`headLook`, src/worlds/ai-dudes/mayor.ts:51), not MAYOR_LOOK, which is the Modern look.
- One board PNG: all six at the stream camera plus a 390 px greyscale strip.

## Acceptance criteria

- [ ] Each of the six is identifiable at 390 px in greyscale.
- [ ] Only the locked story colours from board/design-system.md §2.
- [ ] Passes the design gate (design-system.md §9).

## How to verify

- Read design/out/cast/stone-board.png.

## Notes and risks

- Engineering applies it in FK-016.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
