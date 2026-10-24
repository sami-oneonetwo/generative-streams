# FK-037 · Beat queue: armed beats, GO, the cancel gag, panic

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | A · Show core |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-035](FK-035-holds-and-mayor-slots-server.md) |
| Unblocks | [FK-038](FK-038-mayor-show-strip.md), [FK-074](FK-074-stream-1-rehearsal.md), [FK-082](FK-082-auto-rallies.md), [FK-133](FK-133-stream-1-beats.md) |

## Why (what changes for viewers or Sami)

Big beats never fire by themselves; they wait for Sami's GO so they land when the audience is there.

## Scope

- src/worlds/ai-dudes/story/beats.ts: `city.story.cue` with states locked / armed / firing / done and armed conditions (bible §5: Folly at 100%, previous beat done, 3+ chatters awake, no scene for 4+ min). A thin crowd is a lamp warning, never a lock.
- GO starts the 25 s Call, not the scene. GO again (or Esc) within 5 s cancels on stream: "…the Chief changed his mind."
- Panic exit: end the scene, release dudes, autoFrame. Sub-kinds `go`, `cancel` and `panic` of the `{t:'show'}` MayorInput, in story/beats.ts (no mayor.ts edit). The stream-1 beat list itself is FK-133.

## Acceptance criteria

- [ ] With the Folly at 100% the Unveiling arms; GO plays the Call; a second GO within 5 s plays the cancel gag.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT: `folly-progress 100`, three Test chat dudes awake, GO from /mayor.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
