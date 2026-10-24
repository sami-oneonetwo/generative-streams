# FK-002 · /admin "Story (dev)" panel

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md) |

## Why (what changes for viewers or Sami)

Sami can trigger every scene and story piece for a look, off-air, from one place: no chat, no WASD, no waiting for conditions.

## Scope

- Admin actions in src/worlds/ai-dudes/index.ts, the same shape as `scene-opening` (index.ts:1805, `refuse()` for reasons): `story-on`, `story-off`, `story-play <crossing|unveil|rally|intro|ageTurn>` (skips arming and GO), `story-stop` (panic exit), `story-gather` (gather at the Folly with no scene), `folly-raise`, `folly-progress <0|50|100>`, `folly-retarp`, `side-set <name> <red|gold|none>`, `cast-reset`, `spotlight-test <name>`, `stage-stream-1`.
- A collapsible "Story (dev)" card in client/admin/index.html + client/admin/main.ts: the buttons, one argument box, and preview links (/?stream=1, /?stream=1&demo=board, /?stream=1&demo=show, /?stream=1&stats=1, /fk-hud.html, /mayor).
- A button whose piece has not landed refuses with "not built yet: FK-0NN". Every button except story-on refuses with "Story is off" while off.
- Rule for later cards: each scene or piece card wires its own button here; Lane A applies the ≤10-line hook the same day.
- The existing /admin `scene-opening` action (index.ts:1805) stays as it is; Story (dev) links to it.

## Acceptance criteria

- [ ] /admin shows a "Story (dev)" card; Story ON/OFF flips `town.story`.
- [ ] Pressing an unbuilt button shows its FK number and changes nothing in the world.
- [ ] `story-play crossing` plays today's Crossing (fully once FK-017 lands).
- [ ] Story OFF pressed mid-scene releases every dude, unlocks WASD, unhides the Mayor and brings back the old band and its panels (the same clean-up FK-001 runs at boot).
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Open http://localhost:$PORT/admin locally, press each button with Story OFF, then ON. `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/admin" /tmp/fk-shots/eng-a/fk002-admin.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- /admin stays local-or-token (src/server/operatorGuard.ts is Sami's file: do not touch).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
