# FK-020 · Head prep at the Call

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane E agent, 2026-10-24 |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-025](FK-025-unveiling-v1.md), [FK-044](FK-044-intro-now.md), [FK-061](FK-061-head-walks-to-mark.md) |

## Why (what changes for viewers or Sami)

Sami never has to find a mark: at the Call the server puts his character where the scene needs him.

## Scope

- src/worlds/ai-dudes/mayor.ts `prepareHead(mark, face)`: force visible (a server-side override, separate from the page's own `hidden`, mayor.ts:230 / client/dudes/operator.ts:312), dismount, put the weapon away, free camera off, snap to the mark via `moved` (mayor.ts:333; walking is FK-061), set `MayorView.lock`.
- client/dudes/operator.ts ignores WASD while `lock` is set.
- Also add `forcedHidden` for the M2 flashback (FK-043).

## Acceptance criteria

- [ ] With /mayor open and Sami riding far away, Story (dev) → Gather puts him on the Folly mark, unmounted, facing the tarp; WASD does nothing until the release; afterwards he walks again.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev), with /mayor open.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- 2026-10-24 lane E agent: picked up.
- 2026-10-24 lane E agent: implemented on fk-e, commit ac062de (rebased onto main ce88280; not landed: waits for review). Typecheck green; `npm test` 226/226 (7 new in scripts/head-prep.test.ts). As built:
  - src/worlds/ai-dudes/mayor.ts: `prepareHead(state, mark, face, now)` (false and nothing touched with Story off): gets him off what he rides (it stays parked where he left it), stops a game, puts the weapon away, clears a pose and any `forcedHidden`, snaps him onto the mark facing `face`, puts the operator camera on him, bumps `moved` (the page jumps there) and sets `mayor.lock {at, facing, since}`. `releaseHead(state)` clears it (FK-001's `releaseShow()` does the same at boot, Story OFF and Stop). `forceHeadHidden(state, on, now)` for FK-043's flashback. `headHidden()` is what the pages and the server use for "out of sight": `forcedHidden` > the lock (shown) > the page's own H, which is kept as it is, so it holds again after the release. While locked the server pins him whatever `move` says (a step sent before the page heard, a heartbeat; the camera still turns and zooms) and refuses ride, play, arm, fire and ram; say and emote still work. All of it is gated on Story ON: a lock or a hiding left in a save does nothing with Story OFF. Safety net: a lock older than `MAYOR.lockMs` (5 min, past the Rising's 4 min cap and the 25 s Call) lets go in tickMayor, so Sami is never stuck without WASD.
  - client/dudes/operator.ts: while `MayorView.lock` is set, WASD does nothing (the figure stays pinned on the mark), R, T, G, X/Space and F are ignored, "click a name → go to them" and click-to-fire are off; when the lock arrives the free camera goes off and the page's weapon is cleared. Status rows: "camera: on his mark: WASD waits for the release", "the Mayor is on his mark for the show", "carrying: nothing (put away for the show)", "the Mayor: visible (the show)" when the show overrides H. At the release the page takes H's state from the server again.
  - **Contract for FK-019 / FK-025 / FK-044:** at the Call, `prepareHead(state, STORY_SITES.headMark.at, STORY_SITES.headMark.facing, now)`; at the release, `releaseHead(state)`. FK-043: `forceHeadHidden(state, true, now)` for the flashback, `false` after it (or `prepareHead`, which clears it). FK-061 replaces the snap inside `prepareHead`.
  - **Hook request → Lane A (FK-002's story/dev.ts, not on main yet), so Story (dev) → Gather does the head now (FK-019 later swaps the run for its gather):** add `import { STORY_SITES } from '../../../shared/storyMap'; // hook FK-020` and `import { prepareHead } from '../mayor'; // hook FK-020`; in the `story-gather` piece replace `card: 'FK-019',` with
    `// hook FK-020: the head goes onto his mark, facing the Folly, until Stop; FK-019 adds the ring and swaps this run for its gather.`
    `run: (ctx) => { prepareHead(ctx.state, STORY_SITES.headMark.at, STORY_SITES.headMark.facing, ctx.now); ctx.log('story: gather (admin): the head is on his mark (the ring is FK-019)'); },`
    and in scripts/story-dev.test.ts:85-86 drop `'story-gather'` / `'FK-019'` from the not-built list. Seven lines in dev.ts plus the two list entries; with the hook, typecheck is green and the not-built list is story-dev.test.ts's only failure (checked).
  - Verified on 4615 with FK-002's branch applied to the worktree for the check only and the hook above (both reverted after; nothing of either committed): /mayor open, the Mayor aboard the donkey ~110 m from the mark with a blaster, hidden with H and the free camera on (/tmp/fk-shots/lane-e/fk020-1-riding.png); Story (dev) → Gather: drawn at (54, 50.5) on the head mark, off the donkey, weapon gone, free camera off, visible (the show) (fk020-2-on-mark.png); holding W, A, S and pressing R, G, T, F, X moved nothing; the stream (Follow me) shows him on his mark (fk020-6-stream-on-mark.png); Story (dev) → Stop: the lock goes, H's hidden holds again, H then W walks him off the mark (fk020-4-released.png); the admin card (fk020-5-admin.png). No page errors. Story OFF afterwards; demo server stopped.
  - **Acceptance criteria pass on 4615**, given the hook above. Not changed: bits.ts still reads the page's own `hidden` (agent bits don't run in gather mode, FK-018).
- 2026-10-24 lane E fixer: review fixes on fk-e, commit 9694790 (on top of ac062de; not landed). Typecheck green; `npm test` 228/228 (2 new in scripts/head-prep.test.ts).
  - **Blocking, fixed:** /mayor's Enter now opens the say box on `shown` (what the stream sees), not H's `visible`: hidden with H when the Call comes, he can say his line on his mark; in the flashback (forced hidden, H showing him) the box stays shut instead of sending a line the server drops. Walking through things ("hidden, he is only a camera") follows `shown` too. Story OFF: `shown` is H's own say, so today's game.
  - So `shown` can't flicker with Story OFF: for 1 s after H (`H_HEARD_MS`) a reply sent before the server heard H no longer overrides the page's own say (it used to flip the status row for one reply).
  - **Minor, fixed: the Call reaches /mayor at once.** World code can't push a `mayor` message (the broadcast is in src/index.ts, Sami's server file), so the page does it: with Story on (`town.story`) its standing-still heartbeat is 0.5 s instead of 2 s, and its reply carries the lock or the release to /mayor and the stream. Measured on 4615 standing still: Story OFF a reply every ~2.0 s (as today), Story ON every ~0.57 s (headless at ~4.5 fps). No broadcast needed from FK-017/FK-019/FK-025 after prepareHead / releaseHead.
  - **Minor, fixed:** `prepareHead` keeps his facing for a non-finite `face` (a NaN would have saved as null and failed the Mayor schema; tested against stateSchema) and returns false, nothing touched, for a non-finite mark.
  - **Minor, fixed (hook FK-020 in src/worlds/ai-dudes/bits.ts, no lane owns it in BOARD.md → Lanes):** the import plus the two Mayor checks (targetOf, mayorSpot) read `headHidden(state, m)` instead of `m.hidden`, each line marked `// hook FK-020`: on his mark after H-hide chatters' bits can reach him; in the flashback they can't. Story OFF `headHidden` is `m.hidden`, so unchanged. Tested.
  - **Minor, no change needed:** relayout.ts scales `mayor.position` but not `lock.at`; relayout only runs in `start()` (index.ts:2022), and `releaseShow` drops any lock a few lines later (index.ts:2035), so a lock never lives through a relayout.
  - **Still open, for the coordinator / Lane A:** the dev.ts hook above (Story (dev) → Gather) applies when FK-002 lands; the fixes don't touch it. The review checked it: green with fk-a + fk-e + the hook.
  - Verified on 4615 (Playwright driving /mayor; a temporary uncommitted trigger in mayor.ts's tickMayor called prepareHead / releaseHead / forceHeadHidden, reverted after and checked identical; the demo save restored): hidden with H, Enter shut; the Call → "visible (the show)", on his mark, Enter opens, "Behold. Mine." accepted by the server (lock on, not hidden); released → hidden as H said; H shows him, Enter opens; flashback → "hidden (the show)", Enter shut; Story OFF → Enter as H says, and 6 H presses while walking only ever show "visible"/"hidden" (never "(the show)"). No page errors. Shots: /tmp/fk-shots/lane-e/fk020-fix-1-locked-after-H.png, fk020-fix-2-said-on-mark.png, fk020-fix-3-flashback.png, fk020-fix-4-story-off.png. Demo server stopped; Story OFF.
- 2026-10-24 lane E agent: **landed on main, 93ce607** (fk-e rebased onto 173b73d: f7cc2d3, 013277a, 44e43fc, 93ce607). Typecheck green; `npm test` 239/239.
  - **Review notes applied:** (1) the Story (dev) → Gather hook, as logged above, now that FK-002 is on main (44e43fc): 2 imports and the run swap in Lane A's src/worlds/ai-dudes/story/dev.ts, each marked `// hook FK-020` (4 lines added, 1 removed), and scripts/story-dev.test.ts's not-built list drops `story-gather` / `FK-019` (2 lines). (2) /mayor's H with the show deciding (93ce607): `MayorView.ownHidden` carries H's own say while Story is on and the show decides (a lock, or `forcedHidden`): hook FK-020 in Lane A's src/shared/dudesTypes.ts, 2 lines. client/dudes/operator.ts seeds from it and syncs it, so a /mayor opened mid-lock or mid-flashback shows "(the show)" at once, takes H's say back when a flashback ends, and while the show decides an H press never shows him early (the 1 s H window holds only the page's own say, not what the stream sees). Story OFF: no `ownHidden`, the page works as before. Tests: head-prep.test.ts adds a Story (dev) → Gather / Stop test and `ownHidden` asserts.
  - Checked on 4615 with Playwright on /mayor. A temporary, uncommitted file trigger in tickMayor ran the flashback; I reverted it and checked it was gone, restored the demo save, set Story OFF and stopped the demo. Results: hidden with H → Gather → "visible (the show)", on his mark, Enter opens; a second /mayor opened mid-lock showed "visible (the show)" at once; H on the mark → "visible", then H again → "visible (the show)"; Stop → "hidden", as H said. In the flashback with H showing him: "hidden (the show)", Enter shut. Two H presses read "hidden" and then "hidden (the show)" every 250 ms, never "visible". A third /mayor opened mid-flashback read "hidden (the show)", then "visible" when the flashback ended. Story OFF: H flips only "visible"/"hidden". No page errors. Shot: /tmp/fk-shots/lane-e/land020-1-gather.png.
  - **What Sami can do after the coordinator restarts 4600 and rebuilds the client** (server: mayor.ts, story/dev.ts, bits.ts; client: operator.ts): with /mayor open, /admin → Story (dev) → Story ON → Gather snaps his character onto the Folly mark, facing the tarp. He gets off whatever he was riding, his weapon is put away, the free camera goes off, and he is shown even if H hid him. WASD, R, G, T, F, X and click-to-go wait until Stop, which gives him his walk back and lets H's own say hold again. Story OFF is today's game.
  - **Follow-ups (for other cards, not this one):** FK-019 swaps the Gather run in dev.ts for its own gather and keeps `prepareHead` at the Call and `releaseHead` at the release. FK-025 and FK-044 call the same pair. FK-043 calls `forceHeadHidden(state, true/false, now)` around the flashback, and /mayor already handles it. FK-061 replaces the snap inside `prepareHead`. Nothing is left open from the reviews.
