# FK-009 · Sticker Toy UI base: fonts, tokens, slim letterbox

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | C · Stream client |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-010](FK-010-board-client.md), [FK-021](FK-021-show-hud.md), [FK-050](FK-050-home-through-ages-card.md) |

## Why (what changes for viewers or Sami)

One crisp, consistent look for every story UI piece: two fonts, thick ink outlines, hard shadows, and a letterbox that stops eating the frame.

## Scope

- Self-host Fredoka 600/700 and Nunito 800 woff2 (OFL) under client/dudes/fonts; scripts/build-client.mjs copies them into public/.
- CSS tokens in client/dudes/index.html: --red #B3262E, --red-deep #7A1419, --gold #FFC633, --gold-deep #A86E00, --ink #1E1914, --cream #FFF6E0, --dust #8C8577, plus the cast colours; `.pill`, `.card`, 6 px ink outline, `0 8px 0 #0006` hard shadow, pop-in 0.85 → 1.06 → 1 over 300 ms.
- `body.story` when `town.story` is set or a `?demo=` param is present: letterbox 11vh → 7vh (index.html:41, subtitle bottom offset with it); in stream mode hide #feed, the `.invite` header panel and #caravan (they return with Story OFF).

## Acceptance criteria

- [ ] Story OFF: /?stream=1 lays out exactly as today.
- [ ] `/?stream=1&demo=board`: the new fonts load; invite, feed and caravan panels are gone; letterbox bars are 76 px tall at 1080.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-c/fk009-off.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG), then the same with `&demo=board` to fk009-on.png.

## Notes and risks

- In the main checkout a client build goes live on 4600 the moment it is built (public/ is served statically), so only the coordinator builds there, off-air. Lanes build in their own worktree. Everything new must still key off `town.story` or a `?demo=` param, because the coordinator's rebuild ships it.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
