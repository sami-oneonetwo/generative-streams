# FK-027 · Pets follow their owner

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | D · World look |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Done (landed) |
| Owner | lane D agent, 2026-10-24 |
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

- 2026-10-24 · lane D agent: picked up.
- 2026-10-24 · lane D agent: **done on fk-d, waiting for review (not landed)**: 507c2fa (the card) and 9059d3e (comment and test name), rebased onto main 173b73d. `npm run typecheck` green; `npm test` 239/239 (10 new in scripts/pets.test.ts).
  - **Server** (src/worlds/ai-dudes/movers.ts, `PETS`): with Story ON, whenever the world revision moves, `adoptPets` gives every chatter without a pet their oldest small roamer (`petSized`, blueprint.ts: `moves: 'roam'`, ≤ 0.9 m tall, ≤ 1.4 m long, not a vehicle, not a monster) as `creature.follows = owner`. So a new pet is adopted on the tick after it goes up, and existing small roamers are adopted the moment Story goes ON (the first one only; the rest roam as before). A follower skips roamLeg. It walks the owner's breadcrumbs (a crumb every ≥ 0.5 m, the newest 80, plus the corner they turned each tick; no path search) to a heel spot 1.2 m behind their left shoulder (or behind, behind-right or to either side if that spot is in a build), at 1.2× the owner's measured pace (at least 1.4 m/s, at most 9). Over 30 m away it moves to heel with a smoke `burst` at both ends. The heel is worked out from where the owner will be after this tick's walk (people move after the movers), so it holds 1.2 m and doesn't drag a tick behind. It sits (`creature.rest = 'sit'`, facing the owner's way) 1 s after they stop and stays sat while they only shuffle. When the chatter is away (`awake()` false) it goes home to sleep (`rest = 'sleep'`) at the front of their lot, off to one side (builds go to the back), or beside their flat. It trots there round the builds, or puffs there if the bed is over 30 m away, and it stays put, so no motion. If the owner goes indoors at home it goes straight to bed. Indoors elsewhere it **waits sitting by the door for 30 s, then goes home**: my reading of "sleep when hidden", so it doesn't trek home and back for every 20 s gym visit. When they come back it gets up and comes round to them. An owner who isn't in town: it roams as before. Story OFF: nothing is adopted, `follows` is ignored, `rest` is cleared, and it roams as today (`follows` stays saved, so the same pet follows again when Story comes back ON). A pet whose redesign drops `moves` keeps following while Story is ON (helps FK-028 and FK-049). The trails live in memory (a WeakMap per town) and are pruned when pets go.
  - **Save:** no schema change. `follows` was FK-001's field. `rest` is a new optional field on the `CreatureState` type only (src/shared/objectTypes.ts +2, `// hook FK-027`, an unowned shared file). It is worked out every tick, and the zod schema drops it on load. Tested: a save with a sitting pet validates, keeps `follows` and drops `rest`.
  - **Page** (client/dudes/objects.ts): a sitting pet tips back about its front feet, which stay put while the back end sinks about 40% of its height. A sleeping one lies low (sunk 32% of its height, legs hidden), leans 0.14 rad and stops wagging. Both ease in and out over about 0.25 s and snap with reduced motion; anything not resting is drawn exactly as before (rotation order YXZ only once a pet has rested, which is identical while x is 0). Unit-tested through `createObjectsLayer` with a stubbed parts fetch.
  - **Fixture pets** (fixtures.ts): the fixture agent turns a line with pet|dog|cat|goat into a build ("get me a pet dog" → `pet dog`; build/make/create keep their own wording; edits stay edits). The fixture designer makes a toy pet about 0.6–0.75 m tall facing +z (14–15 parts: big head, stubby legs, floppy ears, pointy ears or horns, a cream collar `#FFF6E0` for FK-051 to recolour, and a wagging tail as a `sway` animation) with `moves: 'roam'`. "a dog house" and the like stay builds.
  - **Verified on 4614** (fresh Story ON world, fixtures). `PORT=4614 npm run inject -- test-kev "get me a pet dog"`: built, adopted the next tick (`follows dev:test-kev`), came to heel and sat (gap 1.20 m). Walked test-kev (`walk to home`, `walk to square`, and his own town-life walks): the dog trailed him at 1.15–1.2 m and sat each time he stopped, behind his left shoulder. Shots (the stream camera put on test-kev through /ws/mayor): /tmp/fk-shots/lane-d/fk027-walk-1.png and -2.png (trotting behind him, then sat beside him; on this loaded box the two came out 20 s apart, not 3), fk027-sit-close.png (the sit pose up close), fk027-sleep.png (test-kev made away by editing the demo save: the dog puffed home from 55 m and sleeps low at the front of his lot while he naps), and fk027-story-off.png (Story OFF: the invite panel and feed are back, and the dog roams 8–46 m from test-kev, no rest). No page errors. Demo stopped; lane D's FK-065 demo world is restored; this card's demo world is kept as data/demo-d/world-ai-dudes.fk027-demo.json.
  - **Risk for the 4600 check:** a real astra "pet dog" has to come out ≤ 0.9 m tall and ≤ 1.4 m long to be adopted. The in-game prompt still says "design them at their real size" and has no pet branch yet (that is FK-070), so a tall dog or goat would roam as today. If that happens on 4600, the fix is FK-070's pet branch, not these limits (motion-budget.md's caps).
  - Files: src/worlds/ai-dudes/{movers,blueprint,fixtures}.ts, client/dudes/objects.ts, scripts/pets.test.ts (all lane D or new), src/shared/objectTypes.ts (+2, hook FK-027). No design spend ($0).
- 2026-10-24 · lane D agent: **landed on main at 928a0c2** (1f1febf the card, 8205b67 comment and test name, 928a0c2 review notes), rebased onto 02be521 with no conflicts. `npm run typecheck` green; `npm test` 290/290.
  - **Review note applied** (928a0c2): a pet waits by the door only while its owner's chatter is still here. Before, if the chatter went quiet during the 30 s wait and the owner then came out, the pet could stay sitting at that door until the chatter spoke again. Now it goes home to bed. The indoors test in scripts/pets.test.ts covers this case, and it fails without the fix.
  - **What Sami can see once 4600 is restarted and the client rebuilt:** with Story ON, a chatter's first small roaming build (a real "get me a pet dog") trails them round town 1.2 m behind their left shoulder, puffs to them from over 30 m away, sits when they stop, and sleeps on their lot while they are away or indoors. With Story OFF, pets roam as they do today.
  - **Follow-ups (from review, not done here):**
    - The 4600 check-in: a real astra "pet dog" is only adopted if it comes out at most 0.9 m tall and 1.4 m long (petSized). The in-game prompt has no pet branch until FK-070, so the coordinator should check the dog's size. If it is oversized, the fix is FK-070's pet branch, not looser limits.
    - Coordinator or Sami to confirm the 30 s door wait (owner indoors away from home: the pet sits by the door for 30 s, then goes home). If it isn't wanted, set `PETS.doorMs` to 0.
    - Polish: when the owner turns sharply or reverses, the dog cuts in to 0.4-0.6 m for about a second (it reads as dodging round him). Possible fix: hold the heel target for a tick when the owner's facing jumps by more than about 90°.
    - Polish (with FK-052's crowd-ring sit): the sit (a pitch of about 17°) barely reads at the stream's close-follow zoom (the dog is about 50 px tall at 1080p). Possible fix: a stronger sit, about 25°, or tucked back legs.
    - Verify shots: on this box one swiftshader frame takes 12-13 s, so the "two shots 3 s apart" came out 12-20 s apart, both from one walk. For exactly 3 s, use a GPU browser.
