# FK-014 · Cast persists: ids, spawn and the three wipes

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane B agent, 2026-10-24 |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-015](FK-015-cast-ignores-small-talk.md), [FK-016](FK-016-apply-stone-cast-looks.md), [FK-025](FK-025-unveiling-v1.md), [FK-026](FK-026-rally-v1.md), [FK-044](FK-044-intro-now.md), [FK-045](FK-045-crossing-new-cast.md), [FK-046](FK-046-kit-follows-head.md), [FK-048](FK-048-age-turn-stone.md), [FK-056](FK-056-stage-stream-1.md), [FK-060](FK-060-cast-idle-bits.md), [FK-125](FK-125-wren-site-sign.md), [FK-127](FK-127-old-scenes-through-runtime.md), [FK-128](FK-128-cast-renames-and-daughter.md), [FK-173](FK-173-cast-voices.md) |

## Why (what changes for viewers or Sami)

Without this the age turn wipes the cast at the end of stream 1 and the story has no characters.

## Scope

- src/worlds/ai-dudes/story/cast.ts: role → {name, tag, look}: Wren ("Wren"), Ash ("Ash the hunter"), Moss ("Old Moss"), Oak ("Oak the builder"), Kit ("Kit"). Cast townies get `townie.role` and id `cast-<role>` instead of the `${name}:${age}` hash (caravan.ts:166).
- bringTravellers (caravan.ts:159) spawns the cast while Story is ON. The three wipes skip cast: startCaravan (caravan.ts:231), caravan off (caravan.ts:517), town life off (city.ts:1377).
- Ash leaves the cast table from Medieval on.
- Role tags reach the page through `castView()` (FK-001's spread). The renames, Toma / Ama and the daughter clean-up are FK-128.

## Acceptance criteria

- [ ] Story ON: the five show with their role tags.
- [ ] After an off-air `set-age bronze` on $PORT the same five ids are there.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests), including scripts/story-cast.test.ts (Stone → Bronze keeps 5 ids; every wipe skips the cast).

## How to verify

- On your lane's demo server (`$PORT`; it changes the age, so never on 4600): Story ON, `set-age bronze`, check the same five ids; one shot of the five with role tags: `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-b/fk014.png --w 1920 --h 1080 --wait 8000` (Read the PNG).

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 lane B agent: picked up.
- 2026-10-24 lane B agent: implemented on fk-b, commits 250ffa5 and 24f51ea (rebased onto main cd66f0b; not landed, waits for review). Typecheck green; `npm test` 183: 182 pass, 0 fail, 1 todo (FK-157's NaN-gain test, waiting on FK-158). 8 of them are new, in scripts/story-cast.test.ts. As built:
  - src/worlds/ai-dudes/story/cast.ts: `CAST` (role → name, tag, look, scale by age, dress) in caravan order Ash, Wren, Moss, Oak, Kit (STRANDED order: the leader at the front, the daughter beside him, the elder sitting). Tags: "Ash the hunter", "Wren", "Old Moss", "Oak the builder", "Kit". Scales are design/story.ts's (Wren 0.82 → 0.9 → 1; Ash 1.15 / 1.2; Oak 1.25; Kit 0.7). The looks are stand-ins in the locked cast colours until FK-016. `castIn(age)` drops Ash from Medieval on, and then Wren leads (`leader`). Exports for later cards: `castTownie(state, role)` (FK-127: find the cast by role), `castArrival` (FK-016's look hook), `keepsCast`, `castId`, `castView` (`town.cast` = [{id, role, tag}]).
  - caravan.ts: with Story ON `bringTravellers` brings the age's cast under `cast-<role>` ids instead of the `name:age` hash. A new caravan (`startCaravan`) puts the same townie objects back on their marks: never a wipe and respawn. The three wipes go through `sendTravellersHome` / `keepsCast`: startCaravan, caravan off, and (city.ts) town life off all keep the cast while Story is ON. With Story OFF they clear everyone as today. `nameDaughter` never renames a cast member.
  - Beyond the card, so Story OFF stays today's game without FK-002 needing a hook: in tickCaravan the band follows the switch (`bandFollowsStory`). Story ON swaps the caravan's band for the cast, and Story OFF brings today's band back. Each newcomer takes over where the one before stood or was walking. So FK-002's story-on / story-off need no extra call.
  - city.ts: with Story ON a cast townie's tag is their role, with no "leader of the travellers" title, and Wren wears the daughter's kit even when she leads. On the square the cast wait on five spots of their own (the caravan's 3 spots stacked Oak on Ash and Kit on Wren, tags and all). Story OFF views are byte-identical: FK-001's story-save test still passes.
  - Verified on 4612 (a fresh Stone world seeded with Story ON): the five came in stranded on the far bank as `cast-ash/wren/moss/oak/kit`; after `set-age bronze` the save holds the same five ids (and the same townies, Wren at 0.9, Ash at 1.2, now in town) with no River Trader beside them. They were still there after a server restart. Shot /tmp/fk-shots/lane-b/fk014.png (copy at /tmp/fk-shots/eng-b/fk014.png): all five role tags read clearly on /?stream=1 at 1920×1080 ("Ash the hunter" with the leader's "!"), next to test-kev and test-dana. The old HUD panels are still there until FK-009/FK-010 land. Booted again with Story OFF: today's River Traders band (Captain Nebet, Ama, Ashur, Mina) was back where the cast stood, with no cast and no schema errors. Demo server stopped; data/demo-b left with Story OFF. **Acceptance criteria pass on 4612.**
  - For FK-128 (still open): the opening's subtitles and caravanView still name Toma (`{leader}`), the Stone leader's waiting lines ("The little one is cold"), the arrival scene's daughter vars and the caravan board text are today's. For FK-127 / FK-045: scene beats still find travellers by index (0 Ash, 1 Wren, 2 Moss sits, 3 Oak, 4 Kit in Stone and Bronze; from Medieval on 0 is Wren). Use `castTownie` by role.
- 2026-10-24 lane B agent: **landed on main at 6fc351b** (fk-b rebased onto 3e354da: 08c86a5, 3d963f2, 6fc351b). Typecheck green; `npm test` 200: 199 pass, 0 fail, 1 todo (FK-157's NaN-gain test, waiting on FK-158). **What Sami sees after the coordinator restarts 4600:** with Story ON (Story (dev) panel), the caravan's band is Ash, Wren, Old Moss, Oak and Kit, with their roles on their tags ("Ash the hunter", "Oak the builder"…). The same five stay through an age turn, `caravan-restart`, caravan off/on and town life off/on. Story OFF is today's game (Toma's band, no cast). No client rebuild needed; the tags come through the server's view.
  - Review notes applied (6fc351b): (1) "feed the travellers" now matches the paying townie by id, not name, so a resident Wren's meal no longer counts as the band's (`pay(…, townie)` → `caravanSaw('serve', …, t.id)`). (2) If Story is switched on during Bronze's breather (today's band 4, the cast 5), the cast member with nobody to take over from (Kit) waits at the camp on STRANDED, not at the gate. (3) The Story OFF test now covers the `caravan-restart` wipe: only today's hashed band, no cast. There are 2 new tests in scripts/story-cast.test.ts (breather and serve-by-id). The breather test fails without the fix.
  - **Follow-ups for the coordinator:**
    - **FK-128 (name clash):** a resident "Wren" (TOWNIE_NAMES' 7th entry) can already be in town when Story goes ON. This happens with 7+ residents wanted, or with Story ON and the caravan off, then on. Two "Wren" tags then show. FK-128's rename of "Wren" in TOWNIE_NAMES stops new ones. It also needs to rename a resident Wren already in a save (e.g. while Story is ON, any non-cast townie with a cast name gets the next free TOWNIE_NAME). The serve-count half is fixed here.
    - **FK-128 scope (or FK-127/FK-045/a new card):** add the leftovers: Toma in the opening's subtitles and in caravanView, "The little one is cold", the arrival scene's daughter vars, the caravan board text, and the ticker and crier lines that still name today's band and leader with Story ON ("The Mammoth Herders are stuck across…", "Captain Nebet of the River Traders…"). FK-009 hides the old caravan panel, but nothing scheduled fixes the ticker and crier.
    - **Cast tag style (owner to decide; FK-064 / FK-009):** the cast tags still use today's gold traveller pill (client/dudes/index.html:17 `.tag.traveller`), because townieViews sends `traveller: true`. That includes Wren's, but the design system says Wren is RED, and gold now also reads as "gold side" next to FK-013's crowns. The tags are 28.6 px against the 54 px the design system sets for cast tags. Fix with either a ≤10-line hook into lane C/D's tag code (a neutral cream and ink pill, or each member's locked cast colour), or a follow-up card next to FK-009 / FK-064. The size belongs with FK-009's type pass.
