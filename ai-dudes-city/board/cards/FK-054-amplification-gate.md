# FK-054 · Crowd Mic amplification gate

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | A · Show core |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-018](FK-018-gather-mode.md) |
| Unblocks | [FK-055](FK-055-big-bubbles.md), [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

Only safe lines get blown up on stream. A troll never goes big.

## Scope

- src/worlds/ai-dudes/story/crowd.ts: a local blocklist that normalises leetspeak and spacing, and drops @mentions, digit runs, links and repeated characters.
- LLM moderation that fails closed: import moderateText from src/llm/moderate.ts (it fails OPEN today) and wrap it with a 2.5 s timeout → not amplified. The chatter must also have had 3+ earlier passing lines tonight. A passing line gets `say.big`.
- Do not plumb this through world options: that would edit src/index.ts, which is Sami's file.

## Acceptance criteria

- [ ] "f.u.c.k" never goes big; a moderation timeout never goes big; a clean 4th line does.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit tests with a stubbed moderator.

## Notes and risks

- Cost: fast model, ≤ 4 lines per shot, about $0.01 per scene.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
