# FK-003 · Design pipeline repair

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | design |
| Lane | X · Design |
| Size | S (≤ half a day) |
| Status | In progress |
| Owner | lane X agent, 2026-10-24 |
| Depends on | — |
| Unblocks | [FK-004](FK-004-fresh-design-boards.md), [FK-006](FK-006-stone-cast-looks.md), [FK-007](FK-007-the-big-hut.md), [FK-008](FK-008-camp-and-rally-fire-dressing.md), [FK-034](FK-034-intro-art.md), [FK-068](FK-068-stone-life-design.md), [FK-070](FK-070-design-prompt-tuning.md), [FK-071](FK-071-pet-designs.md), [FK-085](FK-085-golden-me.md), [FK-097](FK-097-red-job-props.md), [FK-100](FK-100-medieval-design-pack.md), [FK-101](FK-101-industrial-design-pack.md), [FK-102](FK-102-modern-design-pack.md), [FK-103](FK-103-wasteland-design-pack.md) |
| Design spend (openai/gpt-6-astra only) | $0 (≤ $0.30 for the critique smoke test) |

## Why (what changes for viewers or Sami)

No design can be reviewed until the renderers work on this box. Every design card depends on this one.

## Scope

- design/render.mjs:8 and design/render-outfits.mjs:8 load playwright from ../../noodle-shop (missing here) and launch channel:'chrome'. Port both to the ~/gs-tools playwright-core + SwiftShader setup that shot.mjs uses.
- Fix WORLD in design/astra.ts:136 (says 22 m lots in a 3×3 grid of eight-lot blocks): 12 m lots, blocks of eight lots round a courtyard, corner parks (src/shared/city.ts:9-37).
- New astra subcommands: `folly <age>`, `cast <age>`, `pets`, `critique-image <png>` (the existing critique prompt on any PNG). Model stays `openai/gpt-6-astra` (design/astra.ts:28).
- Do NOT touch src/shared/ageBibles.json here: that changes live in-game builds (it is FK-070).

## Acceptance criteria

- [ ] `node design/render.mjs` re-renders an existing sheet (rfinal2 board-life) to a new PNG on this box.
- [ ] `critique-image` on that PNG returns a score and problems for ≤ $0.30.

## How to verify

- Read the re-rendered PNG; `tail -3 design/out/spend.jsonl` shows the critique cost.

## Notes and risks

- Budget rule for every astra run: `DESIGN_BUDGET_USD = spend so far (sum of design/out/spend.jsonl, $171.92 today) + this card's ceiling`. Programme cap $240 without Sami.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 lane X agent: picked up.
