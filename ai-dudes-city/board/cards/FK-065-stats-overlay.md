# FK-065 · Stats overlay (?stats=1)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | D · World look |
| Size | S (≤ half a day) |
| Status | Review |
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
