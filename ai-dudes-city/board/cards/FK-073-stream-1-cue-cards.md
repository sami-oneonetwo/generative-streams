# FK-073 · Stream 1 cue-card lines

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | product |
| Lane | P · Product / coordinator |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane P agent, 2026-10-24 |
| Depends on | — |
| Unblocks | [FK-074](FK-074-stream-1-rehearsal.md), [FK-145](FK-145-bronze-cue-cards.md) |

## Why (what changes for viewers or Sami)

Three short lines per Mayor slot give Sami something to riff on, and give muted phone viewers a subtitle.

## Scope

- Write the 1/2/3 cue lines for every Stone slot (Intro I8, Unveiling U2 and U4, Crossing, age turn) and the plaque read-out format. Start now (no code dependency): write them into board/lines/stream-1.md, then into story/lines.ts once FK-001 creates it (the coordinator owns the line data).

## Acceptance criteria

- [ ] Every Stone slot has three lines of ≤ 42 characters, in the head's voice (vain, never cruel).

## How to verify

- Read story/lines.ts in review.

## Notes and risks

- The coordinator owns this card.

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24, lane P agent: picked up.
- 2026-10-24, lane P agent: ready for review on fk-p, commit e00c3a6 (not landed on main). The lines are in src/worlds/ai-dudes/story/lines.ts: `CUE_CARDS.stone`, `cueCard(age, slot)` and `plaqueReadout(names, {title, rows})`. 6 new tests are in scripts/story-lines.test.ts. They check that each line has 3 entries of 42 characters or fewer, that the lines are different, that they contain no insults, that line 1 matches the line FK-042/044/045/048 quote, and that the plaque packing works. `npm run typecheck` passes and `npm test` passes 122/122.
  - Slots and lines (line 1 plays when a slot times out):
    - I8: "Hello! Welcome to my town!" / "I'm the Chief. You can tell by the hat." / "The bridge was like that when I got here."
    - Crossing: "Mind the floor. It's new." / "Make yourselves at home. Not that one." / "Oh, a fan! Well, obviously."
    - U2: "Behold! A hut. For me." / "Trust me. It's going to be amazing." / "You may look. Don't touch."
    - U4 (plaque card): "A hut fit for a Chief. One Chief." / "Hold your applause. No, don't. Clap!" / "Yes, the door is small. It's exclusive."
    - Age turn (`ribbon`): "My idea!" / "Bronze! Shiny, like me." / "Next age: a bigger hat."
  - Plaque format: `Built by friends of the Chief:` comes first. The names follow in pledge order, with all-lowercase names capitalised, duplicates and leading `@` removed, and names over 16 characters cut. They are packed into `rows` lines (2 by default) of 42 characters or fewer, and the last line ends with "!" or "and N more!". An empty plaque reads "Built by the Chief, all by himself!". This fits for every age's title.
  - For FK-035 and FK-038: at a timeout, play `card.lines[0]`. `MayorView.show.cue` is `card.lines`. When `card.plaque` is set, also pass `plaqueReadout(folly.plaque, {title: ageStyle(age).head.title})`. The slot ids are `intro-I8`, `crossing`, `unveil-U2`, `unveil-U4` and `ribbon`.
  - I didn't create board/lines/stream-1.md: lane agents may only edit their own card file in board/, so the lines went straight into story/lines.ts, which is where they end up anyway.
  - FK-001 overlap: fk-p creates story/lines.ts before FK-001's empty stub exists. Whichever of the two lands second gets an add/add conflict on that file and should keep fk-p's version.
  - I ran no demo server and took no screenshots: nothing reads these lines until FK-035 and FK-038 land, so to verify, read the file.
- 2026-10-24, lane P agent: review notes applied in 079ebfc: the crossing riff is now "Make yourselves at home. Shoes off." (no turning the band away from their own home, and no gesture a muted viewer can't see), U4's riff is "Hold your applause. Kidding. Clap!", and the ribbon's is "Next age, I'm getting a bigger hat.". Plaque names are now cut at 25 characters instead of 16, so a full Kick username is read out whole (a new test covers this). I left dedupe-by-cut-name alone: names are only cut when they're longer than 25, and real Kick names never are. typecheck passes and npm test passes 122/122.
- 2026-10-24, lane P agent: **landed** on main at 079ebfc (fast-forward from fk-p, on top of e00c3a6). What Sami gets: nothing on screen yet. The Stone cue lines and the plaque read-out are in src/worlds/ai-dudes/story/lines.ts, ready for FK-035 (slot timeouts play line 1) and FK-038 (/mayor shows the card) to read. A 4600 restart or client rebuild changes nothing visible until those cards land.
  - Follow-ups for the coordinator: (1) tick the acceptance box: all five Stone slots have three lines of 42 characters or fewer, and the tests enforce it. (2) board/lines/stream-1.md was never created. The lines live only in story/lines.ts. (3) FK-001 add/add conflict: Lane A's stub list includes story/lines.ts, which now exists on main. FK-001 should drop lines.ts from its stubs, or keep main's version when it rebases.
