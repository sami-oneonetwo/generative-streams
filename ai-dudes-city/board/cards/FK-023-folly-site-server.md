# FK-023 · The Folly site (server)

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Done (landed on main at 6958c4f) |
| Owner | lane B agent, 2026-10-24 |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-025](FK-025-unveiling-v1.md), [FK-044](FK-044-intro-now.md), [FK-056](FK-056-stage-stream-1.md), [FK-087](FK-087-golden-me-in-game.md), [FK-093](FK-093-verdict.md), [FK-096](FK-096-gold-shifts-wages.md), [FK-141](FK-141-verdict-decision.md), [FK-150](FK-150-wasteland-gold.md), [FK-168](FK-168-unveiling-score.md) |

## Why (what changes for viewers or Sami)

The Chief's cordon stands on the camp plot, fills on its own timer so Sami's beat never waits, and nobody can build over it.

## Scope

- src/worlds/ai-dudes/story/folly.ts: a FOLLY constant and `follyLot()` modelled on WONDER / wonderLot (src/shared/city.ts:105-123), at STORY_SITES.folly.
- Place design/spec/folly/stone.json (a placeholder catalogue hut until FK-007) as one object {folly: 'stone', civic: true, silhouette: true}. `silhouette` already means "under wraps" and is skipped by breakable() (damage.ts:38), agent.ts:608 and talk.ts:126.
- Fills on a timer (`city.story.folly.pct`, 100% in **40 min** by default: the bible has the cordon up at ~0:05 and the Unveiling at ~0:45); gold side-joiners' names go to `plaque[]` (trimmed to FK-001's max); queueRestyles (city.ts:112) skips it as it skips the Wonder; while Story is ON the STORY_SITES rects join reserved() (src/worlds/ai-dudes/sim.ts:34, a ≤10-line hook by Lane A), so no build lands there.
- Once unveiled it is still unbreakable: add `o.folly` to the exclusions in breakable() (src/worlds/ai-dudes/damage.ts:38; Lane B takes damage.ts), because `silhouette` turns off at the unveil.
- Story (dev): `folly-raise`, `folly-progress`, `folly-retarp`. An `unveil` beat turns `silhouette` off.
- Hook request to Lane C: no park trees inside the Folly rect (client/dudes/environment.ts:229).

## Acceptance criteria

- [ ] Raise the cordon → a tarped object stands in the SE corner park; the Board's gold bar climbs on its own; `folly-progress 100` → 100%.
- [ ] A chatter's off-lot build never lands on the plot.
- [ ] After the unveil, a chatter's weapon does no damage to the Folly.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests), including scripts/story-folly.test.ts.

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): Story (dev) → Raise the cordon; `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-b/fk023.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- The site is provisional (board/layout-options.md §1). Sami approved layout A+ (river east) on 2026-10-24: in M2, FK-079 moves STORY_SITES to the River Bank (only STORY_SITES moves); M1 keeps this site.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24, lane B agent: picked up.
- 2026-10-24, lane B agent: implemented on fk-b, commits 51b875e (the card) and a1b81a5 (troublemaker hook), rebased onto main 10a3bc7. `npm run typecheck` green, `npm test` 232/232 (11 new in scripts/story-folly.test.ts). Not landed: waits for review. As built:
  - src/worlds/ai-dudes/story/folly.ts: `FOLLY` (plot id `folly`, `fillMs` 40 min, `box` 14x14x11 m), `FOLLIES[age]` (name and Board word: `The Big Hut` / `BIG HUT` ... `One Seat`), `follyLot()` (as wonderLot, from STORY_SITES.folly). `raiseFolly` stands the age's Folly on the plot as one build {folly: 'stone', civic: true, silhouette: true}, createdBy the head, no owner, no venue (nobody visits a tarp), no "designing..." line; feed: "The Chief's cordon goes up by the old camp: KEEP OUT. SOMETHING AMAZING." The design is design/spec/folly/<age>.json (FK-007; picked up with no code change once it lands), else the age's catalogue hut design/spec/<age>/home.json as the stand-in, scaled up or down to fill the 14x14x11 box (83 parts, 14x13.2x6.5 m in Stone); a builtin 3-part hut if neither reads. Raising makes room: an off-lot build already on the plot moves to free ground, nobody is left inside, and (M1's one plot) an earlier age's Folly comes down for the next age's (FK-079 gives each age its own spot).
  - The timer: `tickFolly` (called from city.ts tickCity) fills `city.story.folly.pct` by dt, 100% in 40 min, only while Story is on and the Folly is under wraps; `setFollyProgress` (folly-progress) sets it and the timer carries on. Gold's names (`side: 'gold'` in the Folly's age) are carved into `plaque` first joiners first (by sideLog), capped at STORY_CAPS.plaque (40), names clipped to 40; red never; nothing new after the unveil. FK-012 only has to set `side`/`sideAge` and log the join.
  - `unveilFolly` (the `unveil` beat, for FK-025): `silhouette` off, pct 100. `retarpFolly`: back under wraps. `follyOf`, `follyNow` for FK-024 / FK-025 / FK-011. `follyView`: `town.folly {pct (whole percent, floor), plaque}` while Story is on and this age's cordon is up.
  - Unbreakable: `!o.folly` in breakable() (damage.ts), so no weapon, bomb, rocket, ram or rampaging creature takes anything off it, wrapped or unveiled. queueRestyles skips `o.folly` (city.ts). Story OFF takes every Folly off the map (count and plaque stay in the save) and Story ON puts it back as it was; after a restart while Story is off, Story ON raises this age's again from its saved count and plaque, under wraps (the unveiled flag lived on the build).
  - Hooks outside lane B, each marked `// hook FK-023`: sim.ts (A) reserved() `.concat(storyOn(state) ? STORY_RECTS : [])` + 2 import lines, so no build (a head's click, an off-lot job, a grown edit, a parked vehicle) lands on the Folly's plot or the crowd's ring while Story is on; events.ts (A) startHappening: one line, `&& !o.folly` (on the demo the painter troublemaker had turned the Big Hut pink); client/dudes/environment.ts (C) +9 lines: park trees on the plot (and 2 m round it) go in their own group, hidden while `town.story`, so Story OFF keeps today's park.
  - **Hook request to Lane A (FK-002's story/dev.ts, on fk-a, in Review):** `import { FOLLY_DEV } from './folly';` and swap `card: 'FK-023'` for `run: FOLLY_DEV['folly-raise']`, `run: FOLLY_DEV['folly-progress']`, `run: FOLLY_DEV['folly-retarp']` on the three Folly pieces (4 lines; FOLLY_DEV's runners have dev.ts's `Run` signature and log on success). Until then those buttons say "not built yet: FK-023".
  - Verified on 4612 (demo-b booted from a copy of the 4600 save, which had just been reset: Stone, no chatters; two test chatters cloned in by the Folly, test-dana gold). FK-002 is not on main, so Raise / folly-progress 100 / unveil / Story OFF were run with this card's functions on the save between restarts (/tmp/fk-b/prep-folly.mts). Live: /admin/api/status `town.folly` went {pct 0, plaque ['test-dana']} to 13% about 5 minutes later on its own; folly-progress 100 read pct 100. Shots: /tmp/fk-shots/lane-b/fk023-tarped.png (the Folly under wraps in the SE corner park, test-dana at the head's mark, no park trees on the plot), fk023-unveiled.png (the stand-in Big Hut unveiled, door to the front; test-dana's `kick the big hut` left no health, hit or crumble on it), fk023-story-off.png (Story OFF: no Folly, no `town.story`/`folly`, the feed back). The gold bar on the stream itself waits for FK-011 (Board data reads city.story.folly / FOLLIES[age].word) and FK-010; the tarp look is FK-024 (today the 0.1 silhouette shade). Design spend $0. Demo server stopped; demo-b left with Story OFF (the pre-card save kept as world-ai-dudes.pre-fk023.json).
- 2026-10-24, lane B agent: **landed** on main at **6958c4f** (00be380 the card, 7c5113b the troublemaker hook, 73e0eb0 review notes, 6958c4f the Story (dev) buttons), rebased onto 93ce607 (FK-020). `npm run typecheck` green, `npm test` 254/254 (15 in scripts/story-folly.test.ts). Review notes:
  - Applied: (1) the Unveiling is saved: `city.story.folly.unveiled` (hook FK-023 in state.ts (A), 2 lines: the Story type and its schema, an optional boolean); unveilFolly sets it, retarpFolly and a re-raise clear it; after unveil, Story OFF, a restart, Story ON the Folly comes back unveiled, its bar still and its plaque closed (the timer and carve() stop on it); test through stateSchema, and re-tarp then restart comes back under wraps. (2) raiseFolly refuses "The town is full: no room for the Folly" at LIMITS.objects; unstow never pushes past it (the next Story ON tries again); test. (3) makeRoom also moves an off-lot build in flight placed on the plot (choosePlacement with reserved() and the plot); a walking or building job goes back to ready, so its builder walks to the new spot; test. (4) The Story (dev) Folly buttons are wired, by me as FK-020 did for Gather, so the earlier hook request to Lane A is withdrawn: hook FK-023 in story/dev.ts (A) is 1 import and 3 `run: (ctx, v) => FOLLY_DEV['folly-raise'](ctx, v)` lines (wrapped, so the import loop folly -> sim -> bits -> index -> dev never reads FOLLY_DEV while it loads; importing folly.ts first works), and scripts/story-dev.test.ts (A) drops the three Folly buttons from the not-built list (`>= 10` to `>= 8`, 8 left); a new test presses them through storyDevActions(). Lane A, please look it over (7 lines). Seen while checking: importing story/dev.ts as the very first module already fails on main ("Cannot access 'PIECES' before initialization", via caravan -> ... -> index's createAiDudesWorld at load); that is from FK-002's imports, not this hook, and no server path or test loads dev.ts first. (6) Story OFF takes the Folly's own feed lines off (the cordon, the unveil, an earlier Folly making way, matched exactly; a chatter's "kim built The Big Hut" stays); test.
  - Not code: (5) the Board's gold bar can't be seen until FK-011 and FK-010 land: the coordinator re-checks it on stream then, at the latest at FK-031 step 7 (it reads `city.story.folly.pct` / `town.folly`). (7) design/spec/folly/stone.json was not placed (design/** is Lane X): the Folly falls back to design/spec/stone/home.json fitted to about 14x13.2x6.5 m, and picks up FK-007's file with no code change; coordinator to confirm that is fine until FK-007.
  - Follow-ups: FK-079 must give earlier ages' Follies their own saved record (only this age's count, plaque and unveiling are saved; a restart while Story is off loses earlier ages' Folly builds). The Unveiling itself (Story (dev) Play: Unveiling) is FK-025's; the tarp look is FK-024's.
  - Hooks outside lane B now on main, each marked `// hook FK-023`: sim.ts (A) reserved(); events.ts (A) startHappening; state.ts (A) `folly.unveiled`; story/dev.ts and scripts/story-dev.test.ts (A) the three Folly buttons; client/dudes/environment.ts (C) the park trees.
  - **What Sami sees once the coordinator restarts 4600 and rebuilds the client:** /admin, Story (dev), Story ON, Raise the cordon: the Big Hut (the Stone catalogue hut as a stand-in) stands under wraps, dark, in the SE corner park with no park trees on its plot, and the feed says the Chief's cordon is up; it fills on its own to 100% in 40 min, and Folly → 0 / 50 / 100 sets it (`town.folly` in /admin/api/status until the Board shows it); no chatter's build lands on it or the crowd's ring, no weapon or troublemaker touches it; Re-tarp puts it back under wraps; Story OFF takes it and its feed lines away and leaves today's park.
