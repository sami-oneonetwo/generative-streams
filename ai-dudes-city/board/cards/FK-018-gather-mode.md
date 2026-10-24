# FK-018 · Gather mode: chat in a scene becomes bubbles and votes

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | A · Show core |
| Size | S (≤ half a day) |
| Status | Done (landed) |
| Owner | lane A agent, 2026-10-24 |
| Depends on | [FK-017](FK-017-show-runtime.md) |
| Unblocks | [FK-025](FK-025-unveiling-v1.md), [FK-026](FK-026-rally-v1.md), [FK-054](FK-054-amplification-gate.md) |

## Why (what changes for viewers or Sami)

Without it 15 lines in a scene fire 15 agent turns: cost and chaos. With it the crowd's own words become the show.

## Scope

- src/worlds/ai-dudes/story/gather.ts `hearInGather()`: show the bubble, parse keywords (1–10, us, coming, red, gold, warn, help).
- Hooked into hear() after the emote-only branch (src/worlds/ai-dudes/index.ts:1163-1167, before the bridge branch at :1176), into the /play say path (index.ts:1339), and pumpAgents (index.ts:335) skips nudge turns while a scene or gathering runs.
- Nothing reaches the inbox, spokeTo, overhear or leaveVisit; party-leave on speech is off.
- **Free building keeps working.** A move or build line typed during a scene is queued: at most one queued agent turn per chatter (their latest non-keyword line wins), replayed after the release, staggered at least 2 s apart. `red` / `gold` / `help` use FK-012's whole-message match.

## Acceptance criteria

- [ ] 15 test lines during a scene → 0 agent calls, votes counted, bubbles shown.
- [ ] "build me a hut" typed during a scene gets built after the release; a chatter who typed three lines gets one queued turn; queued turns start at least 2 s apart.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): play a scene, type in /admin Test chat, check logs/town.log shows no agent turns.

## Notes and risks

- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- 2026-10-24 (lane A agent): picked up.
- 2026-10-24 (lane A agent): **done on fk-a, waiting for review (not landed)**: 7f8ceb5, rebased onto main 994cf64. `npm run typecheck` green; `npm test` 310/310 (9 new in scripts/story-gather-mode.test.ts, plus `queuedLine` in story-save.test.ts's round trip).
  - **When it runs** (`gathering()`, story/gather.ts): Story ON and one of: a story scene playing (`city.story.scene`), the head on his mark (`mayor.lock`, Story (dev) → Gather), or anyone called to a ring (`dude.gather`, FK-019). Story OFF: never, so today's game is unchanged.
  - **hear()** (index.ts): the hook sits after the emote-only branch and before the repeat check and the bridge branch. The line shows as the bubble at once, then goes to `hearInGather()`. Nothing reaches the inbox, overhear, spokeTo, leaveVisit (so a party-goer stays at the party) or pump. A line that isn't a keyword still goes to the Listener, as today. **/play `say`**: the bubble and the history line as today, then gather mode: no overhear, no nudges to named dudes, no feed line, nothing queued (players build with their button). **pumpAgents** starts no nudge turns while a gathering runs, and **idleLife** waits too, so nothing takes a turn of its own. Lines already in an inbox before the Call still run, as the card scopes it.
  - **Keywords** (`keywordOf`) count only as the whole message: trimmed, any case, a trailing `!`/`.` and Kick emotes ignored. The words are a number 1–10 (`7`, `7/10`, `8.5`; not `0`, `11` or `is it a 7`), `us`, `coming`, `warn`, `red`, `gold` and `help`. So "make my house gold" and "help me build a hut" are not keywords. Each counts once per chatter; for RATE IT, each chatter's latest number replaces their last. `gatherTally(state)` returns `{ lines, rate?: { avg, n }, words: { us, coming, warn, red, gold, help: dude ids, first first } }` for FK-022 (the RATE IT tile), FK-026 (comers, us pips), FK-057 (warn) and FK-091 (`lines` = candles). The tally covers one gathering (a scene's `id:at`) and lives in memory (a WeakMap per state): a restart ends the scene anyway. When the gathering ends, the log gets a line like `story: gather mode over (the test scene): 15 lines, none to an agent; RATE IT 5.0 from 2, us 2, coming 1, warn 1, red 1, gold 1, help 1`.
  - **Queued moves and builds**: a line matching `movesOrBuilds()` (build/make/paint/remove/go/visit/follow/ride/give/work/"help me" …; it leans towards yes) is kept as `dude.queuedLine` and the latest one wins. Keyword lines and chit-chat ("lol", "omg it is huge") never replace it. A newcomer's first line is queued too, so their agent meets them after the release. After the release, `takeQueued` hands one chatter's line at a time (oldest first, at least `REPLAY_GAP_MS` = 2 s apart, and only while an agent slot is free) to `replayQueued` in index.ts. That runs the bridge branch, puts the line in the inbox at its original time and starts the turn at once, so the 2 s gap is what spaces the turns. Muting or forgetting a chatter drops their queued line. hear()'s bridge/inbox/party code moved into `toAgent()`, which both paths use.
  - **Save**: one new optional field, `Dude.queuedLine?: { text ≤ 300, at }`, in dudeStoryShape (state.ts +3). There is no new list and no enum change. It survives a restart: the boot's release lets everything go, and the line replays on the first ticks (tested).
  - **FK-012 hook point**: `red`, `gold` and `help` in a gathering are counted here, and FK-012's side join goes in hearInGather's keyword branch (Lane A applies it). `keywordOf`/`wholeWord` give the whole-message rule FK-012 specifies (plus Kick emotes ignored), so FK-012 can import it rather than keep a second copy.
  - **Verified on 4611** (fixtures, Story ON; script /tmp/fk-a/verify018.mjs through /admin/api/chat, the same path as /admin Test chat). The demo log is /tmp/fk-demo-a.log, as the demo script writes it. Before: callsUsed 35, each test- chatter on 1 turn. Then Play: test and 15 lines in 35 ms (test-kev `build me a hut`, `lol`, `7`; `3`, `gold`, `us` ×2, `US!`, `coming`, `red`, `warn`, `help`, chit-chat). 8 s in: callsUsed still 35, turns unchanged, 0 waiting. The log said `gather mode over (the test scene): 15 lines, none to an agent; RATE IT 5.0 from 2, us 2, coming 1, warn 1, red 1, gold 1, help 1; 1 queued for its agent after the release`, then `test-kev's line from the gathering goes on, after the release: "build me a hut"`. kev went to 2 turns (callsUsed 37: his turn plus the hut's design), and a minute later his hut stood. **Stagger** (/tmp/fk-a/stagger018.mjs): kev (3 lines), dana (2 builds) and bo (a move) in a scene got exactly one turn each, first seen 10.2 s, 12.2 s and 14.2 s after the scene began (it is 10 s long). **Bubbles**: during Story (dev) → Gather with test chat running, /tmp/fk-shots/lane-a/fk018-gather-bubbles2.png shows "coming", "omg it is huge" and "US!" in the stream view's bubbles. Turns stayed unchanged (callsUsed only moved for designs of builds queued before). The first shot, fk018-gather-bubbles.png, caught no bubbles: the page loaded before the lines did. FK-020's 5-minute lock cap ended that Gather on its own, and the log summed up 218 lines. Story OFF afterwards, demo stopped, the pre-demo demo-a save restored. No design spend ($0).
  - **For review / Sami**: (1) The queue holds one line per chatter, latest wins (the card's rule). So "build a well" then "paint my well blue" in one scene replays only the paint line. If that bites, a cheap change is to keep the last two lines in the one turn. (2) The `movesOrBuilds` word list decides what waits for the release; anything it misses is a bubble only.
  - Files: src/worlds/ai-dudes/story/gather.ts (A, this card's), src/worlds/ai-dudes/index.ts (A), src/worlds/ai-dudes/state.ts (A, +3), scripts/story-gather-mode.test.ts (new), scripts/story-save.test.ts (A, 2 lines). No other lane's files.
- 2026-10-24 (lane A agent): **landed on main: ed95965** (fast-forward of fk-a: 4f1550f the card, 02b26cb and ed95965 the review notes). `npm run typecheck` green; `npm test` 340/340 (11 in scripts/story-gather-mode.test.ts, 2 of them new).
  - **Review notes applied:** (1) A newcomer whose only words in a scene or gathering are votes (`us`, `7`, `red`) is counted *and* meets their agent after the release: their arrival waits as a world line (`queuedLine.world`, an optional boolean in the same new field; "you arrived in town in the middle of the show and joined the crowd") and reaches the agent as something that happened to them (a nudge, started at once on the 2 s replay stagger), never the vote itself, so FK-012's `red` can join a side without the word going to an agent. Words of their own said later in the gathering replace it. (2) A gathering cut off by a new one before a tick (Gather, `9`, Play: test, `3`) still gets its `gather mode over` log line: tallyOf hands the old tally to tickGather, which closes each with one `closeTally`.
  - **What Sami can see once the coordinator restarts 4600:** with Story ON, play a scene (Story (dev) → Play: test) or Gather and type in Test chat: every line is a bubble at once, votes are counted (`logs/town.log` gets `story: gather mode over (…): N lines, none to an agent; RATE IT …, us …`), no agent turn is taken during it, and a "build me a hut" typed in the scene is built after the release (`story: <name>'s line from the gathering goes on, after the release`). Story OFF: today's game. Server-only (no client rebuild needed).
  - **Follow-ups (not done here):** (a) *Sami to decide:* the queue keeps one line per chatter, latest move or build wins, so "build me a hut" then "go to the café" in one scene replays only the move and the hut is lost unannounced. Cheap options if it bites: keep the last two lines in the one replayed turn, or let a build outrank a plain move. (b) Non-keyword lines in gather mode still feed the Listener's buffer as today, so a busy scene can trigger one Listener call during or just after it (not an agent turn). If "zero calls during a scene" is wanted, hold runListener while `gathering()` is true. (c) *Coordinator:* this card's "How to verify" step says to check logs/town.log for agent turns, but successful turns aren't logged. Reword it to compare `callsUsed` and each dude's `turns` in /admin/api/status before, during and after the scene, plus the `gather mode over … none to an agent` line.
