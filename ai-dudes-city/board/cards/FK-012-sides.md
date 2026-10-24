# FK-012 · Sides: red, gold and help on the fast path

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-026](FK-026-rally-v1.md), [FK-031](FK-031-m1-demo.md), [FK-047](FK-047-red-job-make-room.md), [FK-048](FK-048-age-turn-stone.md), [FK-059](FK-059-crier-premise.md), [FK-092](FK-092-defection-window.md), [FK-093](FK-093-verdict.md), [FK-129](FK-129-story-jobs-drive-asks.md), [FK-130](FK-130-wonder-bar-server.md), [FK-141](FK-141-verdict-decision.md), [FK-171](FK-171-ui-sounds.md) |

## Why (what changes for viewers or Sami)

Chat's core choice: one word joins a side and sends your dude to work, with no AI call.

## Scope

- src/worlds/ai-dudes/story/sides.ts. `red`, `gold` and `help` count **only as the whole message** (trimmed, case-insensitive, an optional trailing `!`), checked in hear() before the agent path *and* in the newcomer branch (src/worlds/ai-dudes/index.ts:1123-1130); Lane A applies both ≤10-line hooks. Not in crierCommand: `COMMAND` only matches `!` commands (crier.ts:298). So "make my house gold" stays a build line and "help me build a hut" stays an agent line.
- A match sets `dude.side` + `dude.sideAge`, pushes a sideLog line ("Kev joined red") and starts the side's job. Red: a bridge shift while the bridge ask is open (one per chatter, city.ts:887), otherwise a walk to Wren's site sign. Gold: the name goes on the Folly plaque and the dude walks to the cordon. **No gold shift in stream 1:** the Folly fills on its timer only (bible §9); gold shifts are FK-096 (M3).
- A bare `help` works your side's job; a neutral's `help` goes to red.
- One switch per age (the Defection Window is FK-092). `DudeView.side` in the view.

## Acceptance criteria

- [ ] "kev: red" → kev is red, the ticker says "Kev joined red", the tug line moves, and no agent call is logged.
- [ ] "kev: gold" in the same age → crier reply "You're red this age, kev", side unchanged.
- [ ] Sides survive save and load.
- [ ] "make my house gold" and "help me build a hut" are not side words: both reach the agent as today, in hear() and in the newcomer branch (tests for both).
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests), including scripts/story-sides.test.ts (switch limit, tally, round trip, 0 agent calls).

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): /admin Test chat as test-kev, test-dana, test-bo; `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-e/fk012.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).

## Notes and risks

- Cast names are never commands (bible §2).
- Lane E carries this; the hooks go to hear() and the newcomer branch in index.ts (Lane A). The "You're red this age" reply goes through the crier's reply function (a ≤10-line export from crier.ts by Lane B if it isn't exported).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
