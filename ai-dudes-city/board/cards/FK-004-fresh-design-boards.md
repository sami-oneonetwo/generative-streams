# FK-004 · Fresh design boards for Sami

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | design |
| Lane | X · Design |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-003](FK-003-design-pipeline-repair.md) |
| Unblocks | — |
| Design spend (openai/gpt-6-astra only) | $0 (+ $0.55 optional critique-boards) |

## Why (what changes for viewers or Sami)

Sami asked to look at the designs. The boards he has (design/out/rfinal2/board-life.png, design/out/ofinal/outfits-board.png) still show the old pastel Future; he has never seen the shipped Wasteland on a board.

## Scope

- Re-render builds as round rfinal3 and outfits as round o4 from the shipped kits (src/shared/ages.ts, client/dudes/agePieces.json), all six ages, one labelled board per set.
- Optional `critique-boards` ($0.55). Attach a one-paragraph crisp / playful / consistent note per board, using the audit in board/design-system.md §1.

## Acceptance criteria

- [ ] Two PNGs (design/out/rfinal3/, design/out/o4/) show all six ages including the shipped Wasteland.
- [ ] The audit note names the top 3 fixes, each pointing at an FK card.

## How to verify

- Read both PNGs; the coordinator posts them to Sami.

## Notes and risks

- Render only; no generation.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
