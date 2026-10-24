# FK-162 · Voice bus split, and the N-key question

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | sound |
| Lane | S · Sound |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-157](FK-157-speech-blip-guard.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-163](FK-163-mix-director.md), [FK-171](FK-171-ui-sounds.md) |

## Why (what changes for viewers or Sami)

The blips share the sfx bus (audio.ts:81) with booms, hammers and fanfares, so anything that ducks the effects ducks the voices too. A voice bus of their own, at exactly today's gain, is what lets every later mix change leave the voices alone.

## Scope

- audio.ts: a `voice` bus fed only by speech(), with gain = sfx level × 0.7 (the same as the sfx bus today), into the same master and compressor. No level, wave or timing changes.
- N on /mayor (client/dudes/operator.ts:277) still mutes the blips with the effects, exactly as today: the voice bus follows the sfx level.
- The N-key question for Sami, written in this card's Log for the M1 check-in: (a) keep today's N, effects and voices together (the default); or (b) N for effects only, plus a separate voice key. (b) would be a new card: ≤10-line hooks into operator.ts (Lane E) and main.ts (Lane C), with the level in a new optional field (no saved enum widened; the levels are saved at src/worlds/ai-dudes/state.ts:497).

## Acceptance criteria

- [ ] FK-157's golden voice hash is unchanged: the split provably changes nothing.
- [ ] With the fake context, speech() connects only to the voice bus and no other cue does; `levels({sfx: 0})` silences both buses.
- [ ] Sami at the check-in: the blips sound the same; he answers the N-key question (recorded in the Log).
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `nice -n 10 npm test` (the golden test plus a routing test).

## Notes and risks

- Audio plan A6. The plan's order is A1 → A2 → A6, so pick it up after FK-158 even though it only needs FK-157.
- Speech-blip rule: this touches the sfx and voice bus gain, so the hash must not move.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)
