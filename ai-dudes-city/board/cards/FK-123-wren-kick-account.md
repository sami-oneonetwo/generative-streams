# FK-123 · Wren's own Kick account (Appendix C, smallest version)

| | |
|---|---|
| Milestone | Later |
| Discipline | eng |
| Lane | E · Operator and jobs |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Blocked / Needs Sami (Needs Sami: optional; he must create the account and green-light it) |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | Sami: optional; he must create the account and green-light it |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Wren lives where phone viewers look: the chat.

## Scope

- A second KickAuth token file and sender; her username in KICK_IGNORE_BOTS; ~10 template lines a stream from crier events; a "Say as Wren" box in /admin. Watch the trap: route webhooks on broadcaster first (bible Appendix C).

## Acceptance criteria

- [ ] On a test channel, Wren posts ≤ 10 template lines and never becomes a dude.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Test channel only.

## Notes and risks

- Touches src/server/http.ts and src/kick/*: needs Sami's OK because http.ts is one of his tunnel files.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
