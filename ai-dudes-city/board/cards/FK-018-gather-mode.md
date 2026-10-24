# FK-018 · Gather mode: chat in a scene becomes bubbles and votes

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-017](FK-017-show-runtime.md) |
| Unblocks | [FK-025](FK-025-unveiling-v1.md), [FK-026](FK-026-rally-v1.md), [FK-054](FK-054-amplification-gate.md) |

## Why (what changes for viewers or Sami)

Without it 15 lines in a scene fire 15 agent turns: cost and chaos. With it the crowd's own words become the show.

## Scope

- src/worlds/ai-dudes/story/gather.ts `hearInGather()`: show the bubble, parse keywords (1–10, us, coming, red, gold, warn, help).
- Hooked into hear() after the emote-only branch (src/worlds/ai-dudes/index.ts:1163-1167, before the bridge branch at :1176), into the /play say path (index.ts:1339), and pumpAgents (index.ts:335) skips nudge turns while a scene or gathering runs.
- Nothing reaches the inbox, spokeTo, overhear or leaveVisit; party-leave on speech is off.
- **Free building keeps working.** A move or build line typed during a scene is queued: at most one queued agent turn per chatter (their latest non-keyword line wins), replayed after the release, staggered at least 2 s apart. `red` / `gold` / `help` use FK-012's whole-message match.

## Acceptance criteria

- [ ] 15 test lines during a scene → 0 agent calls, votes counted, bubbles shown.
- [ ] "build me a hut" typed during a scene gets built after the release; a chatter who typed three lines gets one queued turn; queued turns start at least 2 s apart.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): play a scene, type in /admin Test chat, check logs/town.log shows no agent turns.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
