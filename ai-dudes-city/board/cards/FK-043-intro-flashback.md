# FK-043 · Intro part 1: the sepia flashback (I1–I4)

| | |
|---|---|
| Milestone | M2 Stream 1: Stone |
| Discipline | eng |
| Lane | B · Story and cast |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-033](FK-033-bridge-intact-and-collapse.md), [FK-034](FK-034-intro-art.md), [FK-035](FK-035-holds-and-mayor-slots-server.md), [FK-132](FK-132-camp-on-town-side.md), [FK-135](FK-135-story-sounds-2.md) |
| Unblocks | [FK-044](FK-044-intro-now.md), [FK-112](FK-112-still-fine-turn.md), [FK-116](FK-116-endings.md), [FK-170](FK-170-intro-sound.md) |

## Why (what changes for viewers or Sami)

"Free wood!… Still fine." Chat watches him break the bridge, so every later "it was like that when I got here" is a joke the audience is in on.

## Scope

- I1 title card AI DUDES: THE TOWN over a wide. I2 card EARLIER TODAY, sepia grade (a body CSS class, ≤10-line hook into Lane C) over the empty morning camp at STORY_SITES.camp on the town bank (FK-132), with the log bridge standing.
- I3 low shot: a stand-in Chief townie wearing `headLook` (src/worlds/ai-dudes/mayor.ts:51, export it: Lane E hook) walks in: "Ooh. Free huts." Plants a stick flag in their hearth: "Mine now."
- I4 side-on at the bridge. His hut is one log short: he yanks a log out of the deck (it lifts free and lands on his shoulder): "Free wood!" `creak` (FK-135) "It's fine." He yanks a second and the bridge folds into the river: the collapse beat (FK-033). A beat. "…Still fine." The two logs are FK-034's separate parts; each yank hides the log in the bridge and parents a copy to the stand-in's hand.
- Sami's live Mayor is `forcedHidden` (FK-020) during the flashback.

## Acceptance criteria

- [ ] The flashback plays in about 30 s with the sepia grade and the collapse.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- $PORT: Story (dev) → Stage stream 1 → Play: Intro; shots at I3 and I4.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
