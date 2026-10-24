# FK-128 · Cast renames and the daughter clean-up

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane B agent, 2026-10-24 |
| Depends on | [FK-014](FK-014-cast-persists.md) |
| Unblocks | [FK-031](FK-031-m1-demo.md), [FK-173](FK-173-cast-voices.md) |

## Why (what changes for viewers or Sami)

Nobody else in town may be called Wren, Ash or Oak, and the old "Toma / Ama" daughter must not talk over Wren. Split out of FK-014.

## Scope

- With Story ON drop Toma / Ama (caravan.ts:87, 98, 102: `DAUGHTER`, `daughterTitle`) and the new-band greetings; leave `city.daughter` alone.
- The `name-daughter` admin action (index.ts:1815) refuses with "Story is on: Wren is the daughter" (≤10-line hook, Lane A).
- Rename clashing NPCs: "Wren" in TOWNIE_NAMES (city.ts:77), Minstrel Wren (caravan.ts:89), Ashur the Boatman (caravan.ts:88), Mr Ashby (caravan.ts:90), Road Boss Mara (caravan.ts:92); the street "Oak Street" (src/shared/city.ts:44) → "Alder Street".

## Acceptance criteria

- [ ] No townie or traveller is called Wren, Ash* or Oak*.
- [ ] `name-daughter` refuses with Story ON and works as today with Story OFF.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Unit test over every name table; on `$PORT`, /admin → name-daughter with Story ON and OFF.

## Notes and risks

- Renaming Oak Street changes the addresses on that street; only Sami's lot is claimed today.
- Critic fix 18 (split of FK-014).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 lane B agent: picked up.
- 2026-10-24 lane B agent: implemented on fk-b, commit 313d5c6 (rebased onto main 928a0c2; **not landed**, waits for review). Typecheck green; `npm test` 297: 297 pass, 0 fail. 7 of them are new, in scripts/story-names.test.ts. As built:
  - **Renames** (Story ON or OFF): townie "Wren" → Hattie (TOWNIE_NAMES, same slot), Ashur the Boatman → Hori the Boatman, Minstrel Wren → Minstrel Robin, Mr Ashby → Mr Hargreaves, Road Boss Mara → Road Boss Roxy, Oak Street → Alder Street (addresses are worked out, not saved, so nothing in a save changes). The rule is story/cast.ts `clashesWithCast`: Wren, Moss or Kit as a word, or a word starting Ash or Oak. The test runs it over every name table: residents, town names, every age's caravan (leader, travellers, specialist), the daughter, troublemakers per age and sandbox, every age's place names, streets, avenues, every lot's address and the districts.
  - **Saves from before** (city.ts `clearCastNames`, every town tick): travellers saved under the old names are renamed where they stand (same townie, same id, still in the band). With Story ON a resident who shares a cast name (a "Wren" off the bus before the rename, FK-014's follow-up) takes the first free name on the list. With Story OFF she stays Wren (there's no cast to clash with).
  - **Story ON: no Toma or Ama** (caravan.ts `bandOf(state, age)`): the cast's leader speaks for the band (Ash; Wren from Medieval), and the band is "the travellers". The lines that only fit a new band are dropped: the arrival greeting, the ageTurn goodbye and the daughter's arrival line come out empty, so the page skips them. `daughterOf` is Wren with Story ON, and `city.daughter` is left alone. `daughterTitle` and "leader of the travellers" are used only with Story OFF. The change reaches every place the band is named: the opening, Crossing and age-turn subtitles (`{leader}`), the feed, the agents' `caravanLine` (it names the cast by their tags) and tells, the board's `caravanView`, every crier (Kick) line and the Wonder's "proposed by". With Story ON the stranded leader's "Is anyone coming? The little one is cold." becomes Ash's bible line "Mend the bridge, and we'll mend the rest.", and the crier's bridge line drops "a little girl among them".
  - **name-daughter** refuses with Story ON: "Story is on: Wren is the daughter". Story OFF works as today. **Hook FK-128 in src/worlds/ai-dudes/index.ts** (Lane A's): 3 additive lines, an `import { daughterLocked } from './caravan'` and `const locked = daughterLocked(ctx.state); if (locked) return refuse(ctx, locked);` at the top of the action. caravan.ts `nameDaughter` also does nothing with Story ON.
  - Beyond the card's letter: with Story ON the band is called "the travellers" instead of the age's band name, because "Ash of the Mammoth Herders" (or "Ash of the River Traders" in Bronze) reads wrong. This covers FK-129's "no Mammoth Herders line" everywhere except openVisit's `problems` and specialist lines, which stay FK-129's (storyOpenVisit).
  - Story OFF is today's game apart from the renamed NPCs. The tests check it: Toma and Ama at the river, Ama's "his daughter" title, Toma's goodbye and the River Traders' greeting with Ama's line. Voices: a renamed traveller's id (the `name:age` hash) changes for new caravans, so those four may get a different one of the 9 blip voices. Townies renamed in a save keep their ids and voices. seedOf, speech() and the buses are untouched.
  - **Verified on 4612** (fixture world, Stone, test-kev/-dana/-bo/-nia awake): with Story OFF, /admin name-daughter "Nell" → ok, the feed says "The girl at the river is called Nell", and the band's Ama is now Nell. With Story ON, name-daughter "Bea" → 409 "Story is on: Wren is the daughter", city.daughter still "Nell", no feed line. Shot of /admin with the red toast: /tmp/fk-shots/lane-b/fk128-admin-story-on.png. Story ON → scene-opening: /?stream=1 at 1920×1080 shows the subtitle "ASH · We've been travelling." over the cast at the river (/tmp/fk-shots/lane-b/fk128-opening-ash.png). After the scene, the feed reads `Ash of the travellers: "The bridge is gone. We can't cross. Can you mend it?"` and the crier "…Ash asked for help. 2 pairs of hands at the bridge…". No Toma, Ama or Mammoth line in that session's crier log. The feed also shows "test-bo moved into 15 Alder Street". Back to Story OFF, demo stopped, data/demo-b restored to its pre-demo save. **Acceptance criteria pass on 4612.**
  - Not in this card (still open elsewhere): openVisit's leader bubble, `problems` lines and specialist with Story ON (FK-129). Scene beats still find the band by caravan index (FK-127, FK-045). The cast tag style (FK-014's note, FK-009 / FK-064).
- 2026-10-24 lane B agent: review notes applied (commit 039009f): with Story OFF, `bringTravellers` reuses a band member already in town under the same name (so their id, even one made from an old name, is kept), and the re-spawn in `tickCaravan` (town life off then on) and `resumeCaravan` (caravan back on) now store the ids they get back. A save's Ashur, now Hori, is never doubled and never left with a dangling id, and the same goes for a daughter named by admin. With Story ON the finale's daughter line is blank (`bandOf(state, 0).daughterLine`), so Wren doesn't say Ama's "I was a little girl at the river". 2 new tests in scripts/story-names.test.ts: an old-save id through resumeCaravan, town-off/town-on, caravan-off/on and name-daughter; the finale with Story ON and OFF. Both fail without the fix.
- 2026-10-24 lane B agent: **landed** on main at 039009f498128d3d2fc27d3aedcd39b9976eec53 (rebased on 502d7b8; typecheck green, `npm test` 320 pass, 0 fail). After the coordinator restarts 4600 and rebuilds the client, Sami will see that nobody but the cast is called Wren, Ash or Oak: the resident Wren is now Hattie, and the travellers are Hori the Boatman, Minstrel Robin, Mr Hargreaves and Road Boss Roxy. Oak Street is now Alder Street. With Story ON, Ash speaks for "the travellers" at the river: no Toma or Ama, no new band's greeting or goodbye, and /admin name-daughter refuses with "Story is on: Wren is the daughter". With Story OFF the game is as it was today.
- Follow-ups (not in this card):
  - src/worlds/ai-dudes/agent.ts:134: the agents' fixed system prompt still calls the caravan "a father, his little daughter and their people" whatever the Story setting. That contradicts Wren as a teenager with Story ON. agent.ts is outside Lane B, so this is for FK-129 or a small prompt card: make the line Story-aware (e.g. "the travellers (Ash, Wren and their band)"), or just drop "little".
  - The finale with Story ON now has an empty daughter slot. The story finale card should give Wren a line of her own from the bible.
  - Voices, for the coordinator to tell Sami at check-in: blips are seeded from the townie id. Hori, Robin, Hargreaves and Roxy get new ids in new caravans, and the 7th new resident (Hattie) gets t+hash('Hattie'), so each of them may get a different one of the 9 voices. speech(), tone(), seedOf and the buses are untouched. Townies renamed in a save keep their ids and their voices.
  - Still open elsewhere: openVisit's leader bubble, `problems` and specialist lines with Story ON (FK-129); scene beats still find the band by caravan index (FK-127, FK-045).
