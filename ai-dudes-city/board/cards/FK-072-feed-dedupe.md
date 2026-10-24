# FK-072 · Feed dedupe

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | C · Stream client |
| Size | XS (≤ 2 h) |
| Status | Done (landed) |
| Owner | lane C agent, 2026-10-24 |
| Depends on | — |
| Unblocks | — |

## Why (what changes for viewers or Sami)

The feed repeats lines, cuts words mid-way ("Find the p…") and shows Sami's raw typed lines.

## Scope

- Drop repeats and the operator's raw typed lines; trim at word boundaries. (The feed is hidden on stream with Story ON, but stays for Story OFF and /mayor.)

## Acceptance criteria

- [ ] A repeated line shows once; no mid-word cuts.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-c/fk072.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 · lane C agent: picked up.
- 2026-10-24 · lane C agent: done on fk-c, commit 027d499 (not on main; for review). New `client/dudes/feed.ts`: `feedLines` shows each line once (at its newest; case and spacing ignored) and drops the operator's typed lines (`"<head>: <text>"` from mayor.ts speak(), matched on the town's current head name and every age's, so lines from before an age turn stay out too); `fitWords` cuts a too-long line after a whole word with "…" (no dangling `.`/`:`/dash). `client/dudes/main.ts` hud() uses them; `fitFeed` measures each row once per feed change, resize or font load (one layout, canvas widths scaled by the row's own overflow so the stream's zoom is handled; retried while the feed is hidden by a style). CSS ellipsis stays only as the safety net for a single word wider than the row. Touches the Story OFF feed on purpose (the card's scope: the feed is Story OFF and /mayor only); no server, save or sound change, no hooks in other lanes' files.
- Tests: `scripts/feed.test.ts` (4: repeats, operator lines incl. after an age turn through the real mayorInput, word cuts at every width). `npm run typecheck` green; `npm test` 120/120 (116 existing on this base + 4).
- Verify on 4613 (save seeded with the live feed's real lines: "Sticky Ug is stealing hats…" ×3, "The Chief: Hi / fuck / cool", a long project line; plus a live operator say over /ws/mayor): /tmp/fk-shots/lane-c/fk072.png (stream 1920×1080): two lines, "test-bo proposed a community project…" and "Sticky Ug is stealing hats. Find the…", no repeats, no "The Chief:" lines, every row fits (checked scrollWidth ≤ clientWidth in the page). Phone: /tmp/fk-shots/lane-c/fk072-phone.png, cuts at words at 58% width. Demo server stopped.
- Note for review: the server sends only the last 8 lines (index.ts:1568, Lane A), so after dedupe the feed can show fewer than 3 lines when the operator is chatty or a line repeats. Left as is (a wider slice is a bandwidth call for Lane A); server-side `.slice(0, n)` cuts inside some feed texts (city.ts, index.ts, mayor.ts) are also untouched, but on stream those lines are always longer than a row, so the client's word cut lands first.
- 2026-10-24 · lane C agent: landed on main as 85b7702 (rebased onto 079ebfc, FK-073; no conflicts; `npm run typecheck` green, `npm test` 126/126). Review notes were all minor; none needed a code change in Lane C, so they are follow-ups below.
- What Sami sees once the coordinator rebuilds the client and restarts 4600: the feed (stream with Story OFF, and /mayor) shows each line once, never shows his own typed "<head>: …" lines, and a line too long for its row ends after a whole word with "…" instead of mid-word.
- Follow-up, hook request for Lane A (index.ts:1568, 1 line): send `state.feed.slice(-16)` instead of `slice(-8)` (LIMITS.feed is 24, lines ≤200 chars), so the dedupe and operator filter still leave 3 rows when Sami is chatty or a troublemaker line repeats. Today the feed can show 1–2 rows, or none if all 8 lines are his. Not blocking.
- Follow-up, optional (Lane A): an optional `op` flag on FeedItem for operator lines, so the client stops matching on the "<head>:" / "The <title>:" prefix. Today, if the aide changes or clears a custom title, lines typed under the old title can show again while they are still in the window.
- Follow-up, no action now (Lanes A, B, E): some server feed texts are cut with `.slice(0, n)` (city.ts:774/840, mayor.ts:382/398, index.ts:750/885). On stream and /mayor those lines are always longer than a row, so the client's word cut lands first, but a word-boundary slice on the server would guarantee it.
