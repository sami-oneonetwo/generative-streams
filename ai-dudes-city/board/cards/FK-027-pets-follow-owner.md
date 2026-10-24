# FK-027 · Pets follow their owner

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | D · World look |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-028](FK-028-one-pet-per-chatter.md), [FK-051](FK-051-pets-age-with-world.md), [FK-052](FK-052-pets-in-the-ring.md), [FK-180](FK-180-pet-voices.md) |

## Why (what changes for viewers or Sami)

Sami's ask: a companion that trails its chatter round town, so every dude has a buddy on stream.

## Scope

- When a roaming build ≤ 0.9 m tall and ≤ 1.4 m long (not a vehicle or monster; movesFromRequest, src/worlds/ai-dudes/blueprint.ts:323) goes up for a chatter, set `creature.follows = ownerId`.
- src/worlds/ai-dudes/movers.ts: followers skip roamLeg (movers.ts:131). Trail the owner's recent path (breadcrumbs, no pathfinding) to 1.2 m behind-left at 1.2× the owner's speed; teleport with a puff if > 30 m away; sit when the owner idles; sleep on the owner's lot when the owner is away or hidden.
- Existing small roaming builds become their owner's companion (the first one only). Only active while Story is ON (`state.ai.story`); Story OFF = today's game, unchanged: pets roam as today.
- **Fixture pets** so this can be checked on a demo server: in src/worlds/ai-dudes/fixtures.ts (Lane D takes the file) a line matching `/\b(pet|dog|cat|goat)\b/i` builds a 0.6 m creature with `moves: 'roam'`. Today the fixture agent only builds on build|make|create (fixtures.ts:32) and the fixture designer never sets `moves` (fixtures.ts:105-150), so no demo server can make a pet.

## Acceptance criteria

- [ ] "kev: get me a pet dog" → the dog trails kev across town and sits when he stops.
- [ ] Story OFF → it roams as today.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `$PORT`: your lane's demo server, then `PORT=$PORT npm run inject -- test-kev "get me a pet dog"` and walk test-kev; two shots 3 s apart. The coordinator repeats it on 4600 at the check-in (a real astra call, about $0.13, cleaned up afterwards).

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
