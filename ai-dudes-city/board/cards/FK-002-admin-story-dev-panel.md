# FK-002 · /admin "Story (dev)" panel

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane A agent, 2026-10-24 |
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

- 2026-10-24 lane A agent: picked up.
- 2026-10-24 lane A agent: implemented on fk-a, rebased onto main ce88280 (FK-014, FK-158 and FK-009 landed; no conflicts), not landed: waits for review. Commits bddd559 (the card), 1bb4471 (Story OFF lets go of what Stop does), b5c1c7e (empty-argument press), b6b5dfb (Reset the cast). Typecheck green; `npm test` 227/227 on the rebased branch, 8 of them in scripts/story-dev.test.ts. As built:
  - src/worlds/ai-dudes/story/dev.ts (new, lane A): every Story (dev) action and its buttons in one table (`PIECES`, `STORY_PLAYS`); index.ts spreads `storyDevActions()` after `scene-opening` (+1 line, +1 import) and sends `storyDev: storyDevButtons()` in the admin status (`StoryDevButton` in dudesTypes.ts), so the /admin card draws itself from the server. **Wiring a later piece = swap its `card: 'FK-0NN'` for a `run` in dev.ts**; the button follows on its own.
  - The gate on every action: Story off → "Story is off: switch Story ON first" (every button but Story ON, Story OFF included); not landed → "not built yet: FK-0NN". Either way the world doesn't change, and the refusal goes to the log as a warn.
  - Built now: `story-on`, `story-off` (FK-001's `releaseShow()`: scene, every `gather`, the head's lock and hiding; plus a Crossing played from here), `story-stop` (the same release; "Nothing to stop" when nothing is held), `story-play crossing` (today's Crossing via `playScene`, the same preconditions as `scene-opening`: caravan on, town life on, this age's caravan come; it never cuts the opening or the age turn short, which open the bridge ask / turn the age as they end), `cast-reset` (FK-014 landed today: the age's cast as new and back on their marks, across the river while the bridge is down, else at the gate; anyone missing comes back; refuses mid-scene and while the age turns).
  - Not built yet, each naming its card: Play Intro FK-043, Rally FK-026, Unveiling FK-025, Age turn FK-127, test FK-017; Gather FK-019; folly-raise / folly-progress 0·50·100 / folly-retarp FK-023; side-set FK-012; spotlight-test FK-049; stage-stream-1 FK-056 (asks to confirm once built). These match each card's "wire Story (dev) → …" line. FK-127 also adds "Play: Opening"; until then the card links today's `scene-opening` (unchanged).
  - /admin (client/admin/*): a folded "Story (dev)" card under World (its open/closed state remembered), on/off badge, the Story switch (`town.story`), a note ("Playing: crossing, 0:03 in." / "Story is OFF: … 15 of 17 not built yet"), one argument box, buttons in Scenes / Folly / Sides, homes and the cast / Stage (unbuilt ones dashed with an FK badge), and preview links (/?stream=1, demo=board, demo=show, stats=1, /fk-hud.html, /mayor). Its actions are left out of Advanced's "Other actions". A button that takes the argument, pressed with the box empty, says "Story is off" / "not built yet: FK-0NN" first, and asks for the argument only when the press would run.
  - Outside lane A: src/worlds/ai-dudes/caravan.ts (lane B) +6 lines, `resetCast(state, cv, now)` (sendTravellersHome + FK-014's fresh `bringTravellers`), marked `// hook FK-002`.
  - Verified on 4611 (a copy of the live save, age 5, Story OFF): all 17 buttons and Story OFF answered 409 "Story is off" over /admin/api/action, the world unchanged; Story ON → `town.story: true`; the 15 unbuilt each 409 "not built yet: FK-0NN", world unchanged; Play: Crossing → `town.scene.id` crossing; Stop → no scene; Stop again → "Nothing to stop"; Play: Crossing then Story OFF mid-scene → no scene, no `town.story`. Shots: /tmp/fk-shots/lane-a/fk002-admin-off.png (Story OFF, card open, "Story is off" toast from an empty-box Set side), fk002-admin-on.png (switch flipped in the page, Play: Crossing pressed: "Playing: crossing, 0:03 in.", then Play: Rally: "not built yet: FK-026" toast), fk002-stream-crossing.png (/?stream=1 cut to the bridge with today's panels dimmed: the Crossing playing; the band is in town in that save, so it's a look only, as before FK-127). Demo left with Story OFF.
  - Re-verified on 4611 after the rebase (FK-014 and FK-009 in): Reset the cast with Story ON in age 5 moved the four (no Ash from Medieval on) from around the square to their gate marks (x 22.5, z −1.2…2.4), log "story: the cast reset, on their marks at the town gate"; shot fk002-admin-cast-reset.png (Reset the cast solid, "Done: Reset the cast" toast, "14 of 17 not built yet"). The /ws snapshot carries `town.story` + `town.cast` on Story ON, `scene: crossing` on Play, and neither after Story OFF. **Criterion 4 on the page:** /?stream=1 loaded with Story ON had `body.story` and FK-009's hidden feed / invite / caravan panel, still so mid-Crossing; Story OFF from /admin mid-scene → `body.story` gone and `#feed`, `.invite`, `#caravan` visible again, today's band (Road Boss Mara, Ama, Patch, Rust) back where the cast stood (FK-014's swap): shot fk002-stream-story-off.png. Demo saved with Story OFF and stopped.
  - **Acceptance criteria pass on 4611.** For Sami once the coordinator restarts 4600 and rebuilds the client: /admin gets a folded "Story (dev)" card under World; Story stays OFF until he flips it there, so the stream is unchanged. For the next lanes: each piece card swaps its `card` for a `run` in story/dev.ts (or files a ≤10-line hook request with lane A); FK-017 should extend `story-stop` / `story-off` (both call `letGo()` → `releaseShow()`), and FK-127 adds Play: Opening and takes over Play: Crossing / Age turn.
- 2026-10-24 lane A agent: **landed on main 173b73d** (rebased onto 10a3bc7: FK-162 in, no conflicts; typecheck green, `npm test` 229/229, 8 in scripts/story-dev.test.ts). Review notes applied first (c5d9486 → 173b73d, dev.ts +6 lines, tests extended): Play: Crossing refuses "The <id> scene is playing: Stop it first" while a story-runtime scene (`city.story.scene`) plays, as Reset the cast does; Reset the cast after the last age's finale says "The journey is over (the last age has had its finale): no cast to reset" instead of waiting for a caravan that never comes; Stop with only today's opening / arrival / age turn / finale playing answers "Nothing to stop: today's <id> scene plays on to its end (Stop cuts only what Story (dev) starts)" instead of a bare "Nothing to stop".
  - **For Sami once the coordinator restarts 4600 and rebuilds the client:** /admin has a folded "Story (dev)" card under World: the Story ON/OFF switch, Play: Crossing (a look), Stop (panic exit), Reset the cast, and every not-yet-built piece as a dashed button naming its FK card; plus preview links. Story stays OFF until he flips it, so the stream is today's game.
  - Follow-ups: (1) Play: Crossing is a look only until FK-127: with the bridge down the camera cuts to the bridge and the subtitle says "ROAD BOSS MARA: Thank you. We're coming over." while the band on screen is the cast (Wren, Moss, Oak, Kit) and nobody crosses; FK-127 should resolve the speaker to the cast leader and walk the band over (worth telling Sami before he presses it on 4600). (2) Criterion 4's dude / WASD / Mayor parts are covered by the unit test "Story OFF mid-scene lets everyone go" and `letGo()` → `releaseShow()` only: nothing sets `dude.gather`, `mayor.lock` or `mayor.forcedHidden` yet; once FK-019 / FK-020 land, re-check on /mayor that Story OFF mid-Gather gives WASD back and shows the head. (3) FK-017 / FK-127 extend `story-stop` / `story-off` (both through `letGo()`) when they take over these buttons.
