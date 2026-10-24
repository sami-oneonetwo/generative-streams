# FK-070 · In-game design prompt tuning, with an A/B

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | design |
| Lane | X · Design |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-003](FK-003-design-pipeline-repair.md) |
| Unblocks | — |
| Design spend (openai/gpt-6-astra only) | ~$4.45 (ceiling $5) |

## Why (what changes for viewers or Sami)

Chatters' builds should be chunky, playful and readable from 40° up, and the in-game prompt still describes the wrong town layout.

## Scope

- Strip "5×5 plan, 16 m parcels" from every `designDirection` in src/shared/ageBibles.json (it goes into every in-game design call, src/shared/ages.ts:151).
- Style line in src/worlds/ai-dudes/design.ts:31 → "Toy-like: chunky, slightly exaggerated (roofs, doors, signs about 1.2×); 2–4 main colours plus one accent; a strong roof silhouette that reads from 40° above; at least 25% lightness gap between roof and walls; nothing under 0.12 m; one funny detail." Add: avoid #B3262E and #FFC633 as main colours unless asked. Add a pet branch (`isFor:'pet'` → the companion spec, `moves:'follow'`).
- ENGINE_RULES minimum part thickness 0.06 → 0.12 m (design/catalogue.ts:224).
- A/B: **15 builds per arm** (old vs new: 30 × $0.13 = $3.90, plus about $0.55 of critique = about $4.45, inside the $5 ceiling), then `critique-boards`. Ship only if new wins; Sami gets one PNG.

## Acceptance criteria

- [ ] The A/B board shows new ≥ old on the critique and the design gate; Sami says yes before it ships.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Read design/out/ab/prompt-ab.png.

## Notes and risks

- This changes live chatter builds after the next restart; it ships only with Sami's yes.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
