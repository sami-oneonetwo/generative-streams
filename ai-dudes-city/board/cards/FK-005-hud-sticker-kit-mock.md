# FK-005 · HUD sticker-kit mock (static page)

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | design |
| Lane | X · Design |
| Size | S (≤ half a day) |
| Status | Ready |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | — |
| Unblocks | [FK-137](FK-137-mayor-screen-design.md), [FK-138](FK-138-hud-design-m2.md) |
| Design spend (openai/gpt-6-astra only) | ~$1.50 (two critique-image rounds) |

## Why (what changes for viewers or Sami)

Sami signs off the look of every story HUD piece from one phone screenshot before engineers polish them.

## Scope

- design/hud/fk-hud.html, 1920×1080 over a real town shot. The coordinator copies it to public/fk-hud.html in the main checkout (untracked build output), so Sami opens /fk-hud.html on 4600 with no restart.
- Pieces: the Board (two 96 px pill bars, crown and flag, the rope tug line with its knot, the 54 px ticker), GATHER banner, NOW card, title card (140 px), subtitle in a 7vh letterbox, cast / head / chatter tags with crown or flag, side disc, RATE IT tile (160 px), rally pips, ON STREAM chip, plaque card, the "your home through the ages" strip, and **THE WONDER**: the two bars merged into one pill, filled red from one end and gold from the other by who put in what, grey for the rest (FK-130/FK-131).
- Fonts Fredoka 600/700 and Nunito 800 (OFL woff2 in design/hud/fonts). Follows board/design-system.md exactly.
- Build the page now (no dependency). Only the two `critique-image` rounds wait for FK-003; then the design gate (board/design-system.md §9).

## Acceptance criteria

- [ ] Shots at 1920×1080 and at 390 px wide.
- [ ] Every text ≥ 54 px at 1920 (chatter tags 40 px by design exception); ≤ 2 text layers in the scene states; red and gold distinguishable in greyscale.
- [ ] Sami's thumbs-up recorded on this card.

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "file:///home/sami/workspace/fk-wt/x/ai-dudes-city/design/hud/fk-hud.html" /tmp/fk-shots/design/fk005-hud.png --w 1920 --h 1080 --wait 4000` (one shot at a time, behind the shot lock; Read the PNG), then the same with `--mobile` to fk005-hud-phone.png.
- After the coordinator's copy: Sami opens /fk-hud.html on 4600.

## Notes and risks

- A static page: no game code. It becomes the visual spec for FK-009, FK-010, FK-021 and FK-022, which may start from design-system.md before sign-off.
- Design generation uses openai/gpt-6-astra only. Set `DESIGN_BUDGET_USD` to the spend so far (sum of design/out/spend.jsonl) plus this card's ceiling for the run; stop and ask the coordinator if a run would pass the ceiling.

## Log

- (picked up / review notes / done, with dates)
