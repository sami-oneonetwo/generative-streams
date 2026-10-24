# FK-019 · The Bell: everyone walks into a ring

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | A · Show core |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-017](FK-017-show-runtime.md) |
| Unblocks | [FK-025](FK-025-unveiling-v1.md), [FK-026](FK-026-rally-v1.md), [FK-052](FK-052-pets-in-the-ring.md), [FK-134](FK-134-walk-shot.md), [FK-167](FK-167-bell-walk-murmur.md) |

## Why (what changes for viewers or Sami)

The trailer shot: every dude converging on the Folly, gold at the front and red at the back, so the split shows in the crowd.

## Scope

- `dude.gather` {slot, face, until} handled in src/worlds/ai-dudes/sim.ts ahead of visits and outings, at 1.8× walk speed.
- Tiered ring slots round a STORY_SITES anchor (radius 8–14 m): gold front, neutrals middle, red back. Away dudes pad the crowd, as parties do.
- Start at 70% arrived or 25 s; stragglers fade to their slots; late joiners spawn at the back; release is staggered so nobody moves off as one block.
- Do not call caravanSaw('party') (city.ts:1064). Wire `story-gather` in Story (dev).
- /play players (index.ts:~1320-1335) get ring slots like everyone else; their walk, `fire` and `ram` inputs are ignored until the release (what they say still goes through gather mode).

## Acceptance criteria

- [ ] 12 dudes reach their slots within 25 s, all facing the anchor, gold front and red back; the release is staggered.
- [ ] A /play player is walked to a slot and can't walk, fire or ram until the release.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests), including scripts/story-gather.test.ts.

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): six Test chat dudes, Story (dev) → Gather; `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-a/fk019-ring.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
