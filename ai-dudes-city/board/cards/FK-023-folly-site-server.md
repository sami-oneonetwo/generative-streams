# FK-023 · The Folly site (server)

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
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
