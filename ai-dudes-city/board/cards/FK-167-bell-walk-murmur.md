# FK-167 · The Bell, the gathering walk and the murmur

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | sound |
| Lane | S · Sound |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-019](FK-019-gather-visits.md), [FK-126](FK-126-story-sounds-1.md), [FK-163](FK-163-mix-director.md) |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md) |

## Why (what changes for viewers or Sami)

The Bell (FK-019) is the moment the whole town walks into a ring. It should sound like a summons, then like a crowd arriving.

## Scope

- **The Bell:** the age's Call twice, from a per-age call table this card starts (Stone: a log drum; an age without an entry uses FK-126's bell; FK-176 and FK-181 to FK-183 add the rest). Then the music thins to a pulse: drums out and music −6 dB from the scene start.
- **The walk:** footstep patter that grows with the number of walkers (dudes with `gather` set, FK-019), capped.
- **The murmur:** filtered noise at 300–1500 Hz, wobbling at about 5 Hz, swelling as they arrive. It never uses blips; what people actually say still blips as normal.

## Acceptance criteria

- [ ] On :4600/sounds Sami plays the Bell plus the walk with 6 and with 15 walkers, and approves.
- [ ] On 4600 with Story ON, Story (dev) → Gather: the Call twice, the patter, the murmur swelling, the music dropping.
- [ ] FK-157's voice hash is unchanged (the blips are untouched).
- [ ] The offline render and `audio:check` pass (FK-161); the numbers are in the card's Log.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Render the Bell sequence; on 4616 (Lane S's borrowed demo slot: `board/tools/fk-demo.sh s`; stop it when done), `?debug=sfx` during Gather.

## Notes and risks

- Audio plan A11.
- Ground rules in BOARD.md apply: the speech-blip rule, Story switch gating, live-save safety, work in Lane S's worktree, commit only your own paths, no restarts of `town` (the coordinator schedules them).
- Agents can't hear: prove the change with tests, the offline render and the level check (FK-161), and quote the numbers in the Log. The review is Sami's ear on :4600/sounds and his Approve (FK-160), after the coordinator's rebuild at a check-in.

## Log

- (picked up / review notes / done, with dates)
