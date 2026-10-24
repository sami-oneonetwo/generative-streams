# FK-021 · Show HUD: gather banner, NOW card, title card, subtitles

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | C · Stream client |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Done (landed 6a7cb53) |
| Owner | lane C agent, 2026-10-24 |
| Depends on | [FK-009](FK-009-sticker-toy-ui-base.md) |
| Unblocks | [FK-022](FK-022-prompt-tiles-and-crowd-shot.md), [FK-025](FK-025-unveiling-v1.md), [FK-026](FK-026-rally-v1.md), [FK-048](FK-048-age-turn-stone.md), [FK-142](FK-142-ribbon-beat-and-card.md), [FK-171](FK-171-ui-sounds.md) |

## Why (what changes for viewers or Sami)

Every gathering says what is happening in four words, and every scene ends by telling chat what to type.

## Scope

- New client/dudes/show.ts driven by `TownView.show`: the GATHER banner (72 px "GATHER: THE UNVEILING 0:25" with a countdown, 54 px premise) in the top strip in place of the Board.
- NOW card: 96 px word + 64 px "type red" chip, centre-lower, 6 s.
- Title card restyle (140 px caps, 10 px ink stroke); subtitle 58 px in the 7vh bar, one line of ≤ 42 characters, speaker chip 54 px in the speaker's colour. HUD fades as the letterbox comes in (0.9 s).
- `?demo=show` cycles the pieces locally.

## Acceptance criteria

- [ ] A phone shot of each piece is legible.
- [ ] Never more than two text layers during a scene.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- Three shots of /?stream=1&demo=show (`--wait 4000`, `8000`, `12000`) to /tmp/fk-shots/eng-c/fk021-*.png.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24 · lane C agent: picked up (fk-c up to date with main at f210eed; FK-009 and FK-010 landed).
- 2026-10-24 · lane C agent: **ready for review** on branch fk-c at `a36d6bd` (3 commits: bc04328, b93fb70, a36d6bd; rebased on main ed95965, not landed). `npm run typecheck` green; `npm test` 353/353 (13 new in scripts/show-hud.test.ts). Design spend $0.
  - **What's in it:** new client/dudes/show.ts, driven by `TownView.show` (checked by `checkShow`, so a malformed piece blanks at worst) and by the scene's own lines. The **GATHER banner** (ink card 1240 wide in the top strip, gold bell seal, 72 px title shrinking to no less than 54, a 64 px gold countdown pill on the server's clock, the 54 px premise) takes the strip: `body.show-call` fades the Board out, autoFrame and the tags keep under the banner, and the troublemaker banner drops under whichever is lower (`--show-b`). The **NOW card** (ink card centre-lower at 612 px, a cream NOW tab, the 96 px word wrapping rather than shrinking, a 64 px chip in the side's colour with its icon on a cream seal) is up until its `until`; `body.show-now` keeps the Board aside meanwhile, so one text layer shows. In the story look a scene's **title card** (140 px Fredoka caps, a 20 px ink stroke painted under the fill, so 10 px shows; gold when it names the head, cream otherwise; shrinks to 96 then wraps) and its **subtitle** (58 px Nunito in the 7vh bottom bar, one line; the speaker's 54 px chip: gold + crown for the head in any age, red + flag for Wren, the band's own colours, cream for anyone else) replace today's #subtitle. A line over 42 characters is shown in parts of ≤ 42, one after another, each for its share of the line's time (`lineParts`/`partAt`: old caravan lines like the farewells read in full, never cut). `layers()` keeps a scene to two text layers (the subtitle, then the title card, the prompt, the NOW card) and the strip to one thing. In the story look everything at the top fades with the letterbox (0.9 s). Pieces pop in (0.85 → 1.06 → 1); nothing animates at rest; reduced motion: no fades or pops. Out of the story look every piece is taken off the page.
  - **`?demo=show`** cycles locally on the page's own clock, every 20 s: the Call 1.5–6.5 s (cut short at the scene, as a real Call is at 70% arrived), a 4.5 s scene with no shots (the camera holds) with the title card over the head's line, then Wren's line, then the NOW card 11–17 s ("MEND THE BRIDGE · type red"). `?demo=board&demo=show` adds the demo Board so the swap shows. A real `town.show` or scene always wins.
  - **main.ts (+25/−12):** `createShow` on the viewer page only, like the Board (/mayor and /play keep today's subtitles); `showUi.update(town.show, town)` per snapshot; `showUi.frame()` per frame after cinema(); cinema() plays `?demo=show`'s scene when the server has none and hands the line to the show in the story look (today's #subtitle path otherwise, unchanged); autoFrame and the tags' reserve take the banner's rect too. index.html: `#show-*` rules only, plus `body.story` HUD fade 0.9 s and the Board stepping aside.
  - **Tests:** scripts/show-hud.test.ts, 13: `layers()` over all 64 combinations in and out of a scene (never more than two; strip empty in scenes; the Board steps aside for the banner and the NOW card); the countdown; `checkShow`; the speaker and title colours; `lineParts` over every caravan and scene line (parts ≤ 42, nothing lost); **story scenes' literal subtitles ≤ 42 characters** (a guard for FK-025/FK-026's scripts); the demo's timeline at 4/8/12/18.5 s; createShow on a small stand-in DOM (each piece in turn, never more than two up, body classes, cues once a round, the server wins over the demo, pieces go at `until`, Story OFF clears the page); the sheet's sizes and fades; the main.ts wiring. FK-010's board-ui.test.ts (the reserve now includes the banner) and FK-009's sticker-ui.test.ts (`#show-*` may use story tokens; no `#show-` in the markup) updated.
  - **Verified** (shots in /tmp/fk-shots/eng-c/ and /tmp/fk-shots/lane-c/). Both demo slots were taken for the first ~40 min, so I first used a stand-in on 127.0.0.1:4693 (/tmp/fk021-mock/serve.mjs, not committed: serves fk-c's public/ and replays one snapshot read from another lane's demo /ws), then 4613 once a slot freed. Software GL lags 1–3 s behind `--wait`, more on a loaded box (load 5–14 today), so the card's 4/8/12 s shots on 4613 landed on banner/banner/NOW; extra waits caught the rest.
    - 4613: `fk021-8000.png` GATHER banner ("GATHER: THE UNVEILING", "The Chief's secret build", 0:20); `fk021-10000.png` letterbox + "WREN · That was our fire."; `fk021-12000.png` the NOW card.
    - Stand-in, 1920×1080 with evals: `fk021-4000.png` banner (title 71 px there, shrunk to fit: dropping its letter-spacing brought it back to 72, measured on the phone shot as 14.6 px = 72 × 0.203; premise 54, clock 64, fonts Fredoka 600/700 + Nunito 800 loaded, `--show-b` 202px); `fk021-scene.png` letterbox 76 px + gold title card (140 px, stroke 20 px); the earlier frame of the title card with "THE CHIEF · Behold! A hut fit for me. Only me." eval'd `textLayers: [show-title, show-sub]`, two; `fk021-now-seal.png`/the 12 s frame: NOW card, word 96, chip 64; `lane-c/fk021-board-call.png` (`?demo=board&demo=show`): Board opacity 0, banner in its place.
    - Phone (390 px, `--mobile`): `fk021-phone-4000.png` banner legible (14.6 px CSS at 3x = the stream at phone width); `fk021-phone-7600.png` "WREN · That was our fire." legible; `fk021-phone-12000.png` NOW card on one line after the centring fix (it wrapped at `left:50%`). The phone title card: measured 28.4 px CSS with a 4 px stroke (85 device px), the largest text on screen; the shot itself kept landing after it (software GL lag), so there is no PNG of it.
    - Story OFF on 4613 (`lane-c/fk021-off-opening.png`): /admin scene-opening plays with today's subtitle (Trebuchet, 11vh bars), no `#show-` element on the page. The same scene in the story look (`?demo=board`): `#show-sub` "Toma · We've been travelling.", today's #subtitle hidden.
    - Demo server stopped; stand-in stopped. 4600 untouched.
  - **Notes for later cards:**
    1. **Nobody emits `town.show` yet.** FK-017's showView (on main) sends only `scene`; its comment says FK-021 adds the banner, prompt and NOW card, but those need the Call's state (FK-019) and a scene's end (FK-025/FK-026) in Lane A's story/show.ts. The client is ready: `banner {title, premise, until}` for the Call, `now {word, chip: 'type red', side: 'red', until: end + 6000}` after a scene, and a title either as a scene line with `title: true` or as `show.title`.
    2. **FK-022:** `layers()` already budgets `prompt` (after the subtitle and the title card) and `checkShow` passes it through; draw it in show.ts where `on.includes('prompt')`.
    3. **FK-126 / FK-171 (Lane S):** `createShow(doc, reduced, { cue })` calls `cue('banner' | 'now' | 'title')` once each time a piece comes up: the Call bell and the NOW chime are one line in main.ts.
    4. **FK-124:** cinema() now reads `sc.id === DEMO_SCENE.id ? DEMO_SCENE : SCENES[sc.id]`; add `STORY_SCENES[sc.id] ??` there.
    5. **FK-026's rally banner** ("WREN'S FIRE · type coming"): `ShowView.banner` has no side or chip; it needs a small widening in dudesTypes.ts (Lane A), then show.ts draws a red variant.
    6. **Design (FK-005 / FK-030):** the mock's red pennant in a cream seal reads like a ▶ "play" button at stream size (`lane-c/fk021-chip-wren.png` shows it is a flag up close). Worth a look by the design lead.
    7. Story scenes must keep literal subtitle lines ≤ 42 characters (scripts/show-hud.test.ts fails otherwise); a longer `{var}` line is shown in parts.
- 2026-10-24 · lane C agent: **landed 6a7cb53** on main (rebased over FK-078, FK-019, FK-024 and FK-006; one import conflict in main.ts kept FK-078's TOWN_GROUND). typecheck green, `npm test` 404/404. FK-019's `town.show.banner` now drives the GATHER banner on stream once the coordinator rebuilds public/. The stray lane C demo server (up since 09:19) was stopped.
