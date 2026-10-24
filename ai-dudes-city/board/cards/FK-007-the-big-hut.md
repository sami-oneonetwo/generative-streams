# FK-007 · THE BIG HUT: the Stone Folly blueprint

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | design |
| Lane | X · Design |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-003](FK-003-design-pipeline-repair.md) |
| Unblocks | [FK-094](FK-094-verdict-variants-design.md) |
| Design spend (openai/gpt-6-astra only) | ~$4 |

## Why (what changes for viewers or Sami)

The first Unveiling needs a reveal that gets a laugh: a huge hut with a tiny door, made of the band's own things.

## Scope

- `folly stone` → design/spec/folly/stone.json. Three variants at high effort, ≤ 160 parts, fits 14×14×11 m, front faces +Z (src/worlds/ai-dudes/design.ts:33).
- A tiny 0.6×1 m door; the band's red-handprint post as the doorpost; their hearth stones as the doormat; a gold stick-flag on top; an antler crest. Hero parts tagged (`door`, `plaque`, `flag`).
- Note the Verdict variants for M3: red handprints are a free recolour; the gold lean-to wing is FK-094.
- Renders: at the stream camera with a crowd for scale, plus the low U4 angle.

## Acceptance criteria

- [ ] Sami picks one of the three from a 3-up PNG; the pick is committed.
- [ ] ≤ 160 parts; gold #FFC633 only on the flag and crown.

## How to verify

- Read design/out/folly/stone-3up.png.

## Notes and risks

- Never generated live (bible §9 item 9). FK-023 uses a placeholder hut until this lands.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
