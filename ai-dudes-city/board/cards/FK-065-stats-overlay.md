# FK-065 · Stats overlay (?stats=1)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane D agent, 2026-10-24 |
| Depends on | — |
| Unblocks | [FK-118](FK-118-merge-static-parts-1.md) |

## Why (what changes for viewers or Sami)

The motion budget needs numbers: fps, draw calls, and how many things move.

## Scope

- `?stats=1` shows fps, draw calls, triangles, walkers in frame and movers moving; off by default; readable on `?stream=1`.
- New client/dudes/stats.ts (Lane D) with a ≤10-line hook into main.ts's render loop (Lane C).

## Acceptance criteria

- [ ] Baseline numbers recorded on a 40-dude $PORT demo world, not the live one, in board/motion-budget.md.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1&stats=1" /tmp/fk-shots/eng-c/fk065.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- A good warm-up on day 1 for Lane C while FK-001 lands.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 lane D agent: picked up.
- 2026-10-24 lane D agent: done on `fk-d` (5bbb8f9, rebased on main 958e6fd), ready for review. **What:** new `client/dudes/stats.ts`: `?stats=1` shows fps (with the page's own work per frame, mean and worst ms), draw calls and triangles (shadow pass included: three.js r160 clears its count after the shadow pass, so with the overlay on the page sets `renderer.info.autoReset = false` and resets it at the top of each frame), walking people in frame (on foot, drawn speed > 0.5 m/s, not riding, not inside a build) out of everyone in frame, and movers moving town-wide by kind (drive / fly / roam / ridden) and in frame. Redrawn twice a second; anything over the motion budget (frame > 10 ms, draws > 1,500, walkers in frame > 12, movers in frame > 8, drive > 3 / fly > 2 / roam > 4) turns into a cream chip. Sticker-style ink panel, cream rim, scales with `--ui-scale`, left-centre, above the letterbox. `window.__stats.read()` gives the latest sample (smokes, baselines). Without `?stats=1` nothing is created and the renderer is untouched (checked: no `#fk-stats`, no `__stats`).
- Lane D files: `dudes.ts` `each()` passes the drawn speed as a 4th argument; `objects.ts` gets `movers()` and a per-frame `moving` flag (kind comes from the creature, because the snapshot's blueprint has no `moves`: `zoom` = drive, `flying` = fly, else roam; driven or local = ridden).
- **Hook into Lane C's main.ts:** 4 additive lines, each marked `// hook FK-065`: the import, `createStats(...)` just before the frame loop, `stats?.begin()` at the top of `draw()`, `stats?.end(now)` at its end.
- Tests: 8 new in `scripts/stats.test.ts` (off by default, in-frame, walkers, movers by kind, frame window, rows and formatting, budget flags, the objects layer's movers). `npm run typecheck` green; `npm test` 124/124 (116 existing, not 112 as the card says, + 8 new).
- Verify: `/tmp/fk-shots/lane-d/fk065.png` (fresh world, 40 test dudes), `/tmp/fk-shots/lane-d/fk065-baseline.png` (the baseline world below), `/tmp/fk-shots/lane-d/fk065-off.png` (no param, no panel). Read all three: the panel reads clearly at 1080p over the busy tag field; over-budget chips show on fps and walking.
- **Baseline numbers for motion-budget.md "Today"** (this lane may only edit this card, so the coordinator copies them in): Lane D demo port 4614, a copy of the 2026-10-23 live save (10 chatters, 11 real builds = 459 parts, 3 movers: one each of drive, fly, roam) + 30 test chatters = **40 chatters**, Stone, `?stream=1&stats=1` at 1920×1080, auto-framed wide shot, 8 samples over ~11 s:
  - **fps at 1080p: 0.1–2**, from headless Chrome on SwiftShader (software GL) on the shared 4-core ARM box. That is not the OBS number: re-read it on the OBS machine with `?stream=1&stats=1`. Page work here was 11–34 ms a frame.
  - **draw calls: 880–984** (main + shadow pass). The same 40 chatters with no builds drew 164–170, so it's about 1.7 draws per build part. At 40 chatters with one ~42-part build each that comes to about 3,000, double the 1,500 budget, which backs FK-118.
  - **triangles: 196k–203k**.
  - **walkers in frame: 20–27 of 40–41 people in frame** (budget about 12, so over: FK-120).
  - **movers moving: 0–3 town-wide** (drive 1, fly 1, roam 1), **0–1 in frame**.
  - The baseline world is kept as `data/demo-d/world-ai-dudes.fk065-baseline-40.json` in Lane D's worktree. Copy it over `data/demo-d/world-ai-dudes.json` to measure "After M1" and "After M2" on the same world. Demo server stopped.
- 2026-10-24 lane D agent (fixer, after review): fixes on `fk-d`, rebased on main fd27274 (FK-072 and the board commit; one import conflict in main.ts resolved by keeping both, so the hook is still the same 4 lines marked `// hook FK-065`). Head is 59da952, and the branch fast-forwards onto main.
  - **Blocking (baseline not in motion-budget.md):** this lane may only edit this card, so here is the "Today" column ready to paste. It merges three runs on the same 40-chatter world (`?stream=1&stats=1`, 1920×1080, port 4614): mine before review, the reviewer's re-run, and mine after the fix (8 samples over ~12 s). The fixtures keep the world busy and the stream's shots change, so the counts drift a little between runs. These are ranges, not one number.
    | Measure | Today |
    |---|---|
    | fps at 1080p | pending: Sami reads `?stream=1&stats=1` on the OBS machine (0.1–2 here is software GL on the shared box, not OBS) |
    | draw calls | 880–1,092 (main + shadow pass; ~1.7 per build part; triangles 180k–225k) |
    | walkers in frame | 19–28 of 40–42 in frame |
    | movers moving | 0–3 town-wide (drive ≤1, fly 1, roam ≤1), 0–3 in frame |
  - **Minor, fixed: hidden tab.** main.ts skips frames while `document.hidden`, but the window's clock kept running, so the first sample back was one very slow fps. Now `FrameWindow.restart()` drops the window on every `visibilitychange`, and the next frame starts the clock again. This is in stats.ts, not in main.ts. I didn't use a gap threshold because software GL legitimately runs frames seconds apart. New test: "a hidden tab: the gap is dropped" (9 tests in `scripts/stats.test.ts` now).
  - **Minor, left as is: the panel's 92% ink.** It matches design-system.md ("panels at 92%") and the KNOCKOUTS and feed panels, and this overlay is for debugging only.
  - **Minor, for the coordinator:** acceptance criterion 2's count is now 126 existing + 9 new = **135**. `npm run typecheck` is green and `npm test` passes 135/135 after the rebase. The client build is clean.
  - Verify: `/tmp/fk-shots/lane-d/fk065-fix.png` (the baseline world, after the fix). I read it: the panel is clear, the over-budget chips show on fps and walking, and after a forced `visibilitychange` the overlay sampled again (1.6 fps, no stale window). Demo server stopped.
- 2026-10-24 lane D agent: **landed on main at 31fd62c** (fast-forward from fd27274; `npm run typecheck` green, `npm test` 135/135). One review note applied first (31fd62c): the fps row's note now reads `page 6.0 ms · worst 12`, because that number is the page's CPU time per frame only (GPU and compositor time show up in fps, not there).
  - **What Sami can see once the coordinator rebuilds the client and restarts 4600:** add `&stats=1` to any page, for example `/?stream=1&stats=1` in OBS. A small ink panel at the left centre shows fps (with page ms), draw calls of 1,500, triangles, people walking in the frame, and builds on the move by kind. Any number over the motion budget turns into a cream chip. Without `?stats=1` nothing changes.
  - **Follow-ups (from review, not done in this lane):**
    - *Coordinator:* paste the "Today" table from the fixer entry above into motion-budget.md's Baseline numbers. Add this note under it: "walkers measured right after the 30 test chatters chatted; to re-measure, copy `data/demo-d/world-ai-dudes.fk065-baseline-40.json` over the demo save, inject one line per test chatter, then sample". Ten minutes later, with many dudes away, the same world read 10–13 walking of 31–32 in frame. Draw calls read 750–920.
    - *Sami:* read fps from `?stream=1&stats=1` on the OBS machine and fill in the fps cell. If GPU-bound frames turn out to matter, the fps row could also flag below a floor. That floor depends on the OBS browser source's frame rate (30 or 60), so it isn't set yet.
    - *FK-027/FK-028:* pets are blueprint `roam`, so `movers()` in objects.ts would count them against the town-wide `roam ≤ 4` budget. When follow-pets land, report them as their own kind or skip them.
    - *Caveat, no change:* with prefers-reduced-motion the overlay reports 0 movers, because `entry.moving` respects `still`. This is intended and tested, and OBS doesn't set reduced motion.
