# FK-001 · Story switch and save contracts

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | A · Show core |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | In progress |
| Owner | lane A agent, 2026-10-24 |
| Depends on | — |
| Unblocks | [FK-002](FK-002-admin-story-dev-panel.md), [FK-009](FK-009-sticker-toy-ui-base.md), [FK-011](FK-011-board-server.md), [FK-012](FK-012-sides.md), [FK-013](FK-013-side-markers.md), [FK-014](FK-014-cast-persists.md), [FK-017](FK-017-show-runtime.md), [FK-020](FK-020-head-prep-at-call.md), [FK-023](FK-023-folly-site-server.md), [FK-024](FK-024-folly-look.md), [FK-027](FK-027-pets-follow-owner.md), [FK-029](FK-029-world-breathes.md), [FK-040](FK-040-perspective-camera.md), [FK-041](FK-041-ortho-near-clip-fallback.md), [FK-049](FK-049-home-through-ages-server.md), [FK-062](FK-062-autoframe-recent-speakers.md), [FK-063](FK-063-ink-outline.md), [FK-067](FK-067-mover-caps.md), [FK-124](FK-124-story-scenes-on-stream.md), [FK-126](FK-126-story-sounds-1.md), [FK-132](FK-132-camp-on-town-side.md) |

## Why (what changes for viewers or Sami)

Everything Finders Keepers adds sits behind one switch that defaults OFF, so merges to main never change the live show until Sami flips it. Every new saved field lands in this one commit, so the lanes never fight over state.ts and the live save keeps booting.

## Scope

- `state.ai.story?: boolean` (default off) next to `ai.caravan` / `ai.townLife` in src/worlds/ai-dudes/state.ts; `TownView.story?: true` so clients know.
- New OPTIONAL zod fields only. The loader refuses to boot on a schema mismatch (src/engine/persistence.ts:39-57); zod drops unknown keys, so optional fields survive a rollback, a widened saved enum does not. Fields: `city.story?: { scene?: {id: string, at, shift, heldAt?, beat, vars}, bridgeIntact?, folly?: {age, pct, startedAt, plaque: string[]}, cue?, sideLog?, verdicts?: {age, side}[], helped?: boolean, choices?: Record<string, string> }`, `dude.side?: 'red'|'gold'`, `dude.sideAge?`, `dude.seenAge?` (the last age the chatter spoke in, for FK-049's home spotlight), `dude.gather?: {slot, face, until}`, `townie.role?: string`, `object.folly?: string`, `object.past?: {age, name}[]`, `creature.follows?: string`. New scene ids are `z.string()` inside `city.story.scene`, never added to the saved `city.scene.id` enum. STATE_VERSION stays 1.
- Optional view types in src/shared/dudesTypes.ts: `TownView.board`, `TownView.show` (banner / prompt / now / title), `TownView.spotlight`, `DudeView.side`, `MayorView.show`, `MayorView.lock`. View types are not saved, so they may widen: `TownView.scene.id` becomes `string` so story scene ids reach the page (FK-124).
- **Save guards.** Every new array gets a zod `.max()` (plaque 40, sideLog 50, past 6, cue 20, verdicts 6; `choices` ≤ 20 keys) and the code trims to it before every save: a save over a max makes the next boot refuse to start (src/engine/persistence.ts:51-57).
- **Boot clean-up** (Story ON or OFF): end any running `city.story.scene`, clear every `dude.gather`, clear the Mayor's `lock` and `forcedHidden`. A crash mid-scene never boots into a frozen town.
- **View wiring, once.** `...storyTownView(state)` at the end of `townView` (src/worlds/ai-dudes/city.ts:1389, after `scene`, so a story scene overrides the caravan's), `...storyDudeView(d)` in `dudeView` (index.ts:1452), `...storyMayorView(state)` in `mayorView` (mayor.ts:541). All three come from new src/worlds/ai-dudes/story/view.ts, which spreads each lane's stub: `showView` (A, show.ts), `spotlightView` (A, spotlight.ts), `castView` and `follyView` (B), `boardView` and `sidesView` (E). Each stub returns `{}` until its card fills it, so no lane ever edits another lane's file for its view.
- **One MayorInput variant** `{t:'show', k: string, …}` (type at mayor.ts:61, parser at mayor.ts:109) handed to `onShowInput()` in story/beats.ts. FK-035 and FK-037 add their sub-kinds there and never edit mayor.ts.
- This card is the only one allowed to touch Lane B's city.ts and Lane E's mayor.ts outside a hook request, once, on day 1, before those lanes start.
- New src/shared/storyMap.ts exporting `STORY_SITES` with the provisional M1 numbers from board/layout-options.md §1 (Folly plot, `camp` (the same SE corner park; the hearth at the plot's front edge), head mark, crowd anchor, Wren's fire, Wren's vantage far/near, red sign). Every lane reads coordinates only from here.
- New src/shared/storyScenes.ts exporting `STORY_SCENES`, holding only a `test` scene (three shots, 10 s, one subtitle) for FK-017 and FK-124; Lane B owns the file from then on.
- Empty module stubs src/worlds/ai-dudes/story/{view,show,spotlight,gather,beats,crowd,cast,sides,board,folly,lines,jobs}.ts so every lane owns a file from day 1.
- scripts/story-save.test.ts: parses scripts/fixtures/world-ai-dudes.live-2026-10-23.json plus a copy of today's data/world-ai-dudes.json (save it as scripts/fixtures/world-ai-dudes.live-2026-10-24.json); round-trips a save with every new field set; an enum-freeze test that fails if any saved enum (Visit.why, effects.kind at state.ts:788, city.scene.id, ask kinds, EMOTES) gains or loses a value.

## Acceptance criteria

- [ ] Story OFF (the default) on /?stream=1: no `body.story` class; `#feed`, `.invite` and `#caravan` visible; no Board element (`#board`) in the DOM; no page errors in the shot tool's output. (A pixel compare with an old shot means nothing on a live, moving world.)
- [ ] A save with every new array over its max is trimmed before saving and boots; a save with a running story scene, a `gather` and a Mayor lock boots with the scene ended, no `gather` and no lock.
- [ ] The live save boots after an off-air restart (no schema error in logs/town.log).
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- `nice -n 10 npm run typecheck && nice -n 10 npm test`.
- On your demo server booted from a copy of the live save (copy /home/sami/workspace/generative-streams/ai-dudes-city/data/world-ai-dudes.json into data/demo-a/ first): `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-a/fk001.png --w 1920 --h 1080 --wait 8000 --eval "JSON.stringify({story: document.body.classList.contains('story'), feed: !!document.querySelector('#feed')?.offsetParent, caravan: !!document.querySelector('#caravan')?.offsetParent, board: !!document.querySelector('#board')})"`. Read the eval line, the page errors and the PNG.
- The coordinator repeats the same check on 4600 after the next off-air restart.

## Notes and risks

- First commit of the programme: land it by the end of day 1 (it grew: save guards, boot clean-up and the view wiring). Other lanes draft against the field list above before it merges.
- No new env vars: src/config.ts is Sami's tunnel file.
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- 2026-10-24 lane A agent: picked up.
- 2026-10-24 lane A agent: implemented on fk-a, commit 5fee145 (not on main). Typecheck green; `npm test` 127/127 (116 existing + 11 in scripts/story-save.test.ts). Contracts, as built:
  - `state.ai.story?` (OFF unless true; `storyOn(state)` in state.ts). Saved, all optional: `city.story` {scene {id: string, at, shift, heldAt?, beat, vars}, bridgeIntact, folly {age, pct, startedAt, plaque}, cue [{id, state: string, at?}], sideLog [{at, id, name, side, from?}], verdicts [{age, side}], helped, choices}; `dude.side/sideAge/seenAge/gather {slot: point, face, until}`; `townie.role`; `object.folly`, `object.past [{age, name}]`, `creature.follows`; `mayor.lock {at, facing, since}`, `mayor.forcedHidden`. Also `object.silhouette` (FK-023's tarp flag was never in the ai-dudes save, so it would have vanished at a restart). Cue states and scene ids are strings, not saved enums. Caps in `STORY_CAPS` (plaque 40, sideLog 50, past 6, cue 20, verdicts 6, choices 20 keys).
  - Save guard: `trimStory()` runs before every save via a new optional `WorldModule.beforeSave` (plaque keeps its first names, logs keep their newest, names clipped; a list loses only entries that won't load; any other bad field is dropped with an alert in the log rather than saved).
  - Boot: `releaseShow()` (story/show.ts) ends `city.story.scene`, clears every `gather`, the Mayor's `lock` and `forcedHidden`, Story on or off; FK-002's Story OFF and FK-017's panic exit should call the same function.
  - Views: `TownView.story/board/show/spotlight/cast/folly`, `scene.id: string` (+ `shift`, `heldAt`), `DudeView.side`, `MayorView.show/lock`; one spread each via story/view.ts, all gated on Story ON. Stub owners: show, spotlight (A); cast, folly (B); board + `mayorStripView` for MayorView.show, sides (E). `MayorView.lock` is wired straight from `mayor.lock` (FK-020 only has to set it). `{t:'show', k}` → `onShowInput()` in story/beats.ts (`ShowInput` type lives there; A extends it).
  - `STORY_SITES` / `STORY_RECTS` in src/shared/storyMap.ts (layout-options.md §1 numbers; camp hearth at the plot's front edge (54, 48)); `STORY_SCENES.test` in src/shared/storyScenes.ts (uses the existing `Scene` type, now `id: string`; `SCENES` can be indexed by any string, so client/dudes/main.ts compiles unchanged). Fixture scripts/fixtures/world-ai-dudes.live-2026-10-24.json (copy of today's live save, scrubbed like the 10-23 one).
  - Outside lane A, as this card allows: city.ts (+3 lines: import, spread) and mayor.ts (+11: imports, the variant, its case, the spread). Unowned files, marked `// hook FK-001`: src/engine/world.ts (+1, `beforeSave?`), src/engine/engine.ts (+1, calls it in `save()`), src/shared/objectTypes.ts (+5, `follows`, `folly`, `past` types).
