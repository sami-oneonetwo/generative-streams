# Finders Keepers: the work board

The build board for *Finders Keepers* (docs/story-bible-2026-10-24.md) in **AI Dudes: the town**. Companion docs: [design-system.md](design-system.md) · [layout-options.md](layout-options.md) · [motion-budget.md](motion-budget.md) · [audio-plan.md](audio-plan.md) · helper: [tools/fk-demo.sh](tools/fk-demo.sh). Re-planned 2026-10-24 by the coordinator after the critic's review (24 fixes, all applied; adjustments listed under **Notes** at the end). Updated the same day with Sami's answers (**Decisions**) and a sound lane (**Lane S**).

**186 cards:** M1 43 · M2 73 · M3 29 · Later 41. Lane S (sound) holds 33 of them: FK-126, FK-135, FK-140 and FK-157 to FK-186. One card still waits on Sami (FK-123, optional).

## How to use this board

1. A card moves **Backlog → Ready → In progress → Review → Done**. A card can also sit in **Blocked / Needs Sami**.
2. **Ready** means every card it depends on is Done and its acceptance criteria are clear. When you finish a card, move any card it unblocks from Backlog to Ready if all its other dependencies are Done too. A card whose verify step only says "Plays on `$PORT`" can't become Ready: the coordinator adds a shot list and the exact lines when promoting it.
3. **Pick** the first Ready card in your lane's order (M1: the day plan under **Lanes**; M2: the lane order under it). Write your name and the date in the card's *Owner* row and tell the coordinator, who moves the row here. **Never two people on one card.** If you stop, write where you got to in the card's Log.
4. **Review:** when the acceptance criteria pass on your demo server, say so in the card's Log. The coordinator (the design lead for design cards) checks it on your demo port with a screenshot, then on 4600 at the next check-in, and moves it to *Done*. Engineering cards are Done only when fast-forwarded onto main with typecheck and tests green. Sound cards are reviewed by ear: Sami plays them on :4600/sounds and clicks Approve (agents can't hear).
5. **Blocked / Needs Sami:** cards waiting on a decision only Sami can make. Don't start them.
6. Every card is at most one engineer-day. If one grows, split it into new cards (next free number, same milestone) before carrying on.
7. FK-001 to FK-123 were numbered in milestone order; FK-124 onwards were added after the critic's review and take the next free number. **The milestone and the lane order decide the sequence, not the number.**
8. Lanes edit only their own card files (Owner, Log); the coordinator edits BOARD.md, so lane rebases never conflict on it.

## Ground rules (every card)

- **Live safety.** 4600 (tmux `town`) is Sami's test world: only he uses it and all its chat is fake (Sami, 2026-10-24), but it is the server he looks at, and its AI calls are real and paid. Everything new sits behind the **Story switch** (`state.ai.story`, FK-001), which defaults to OFF. **Story OFF = today's game, unchanged.** Demos turn Story ON and go back OFF afterwards.
- **Nobody works in the main checkout except the coordinator.** 4600 serves the main checkout's `public/` straight off disk (`express.static('public')`, src/server/http.ts:135), and `npm start` / `npm run demo` rebuild `public/` (scripts/build-client.mjs). One shared tree would push every lane's half-finished client code to 4600's `/`, `/mayor` and `/play`, and break each other's typecheck. Each lane works in its own git worktree with its own demo port and data dir (next section). New client code must still stay inert unless `town.story` (or a `?demo=` / `?persp=` / `?stats=` param) is present, and must check that new server fields exist, because the coordinator's rebuild ships whatever is on main.
- **Saves.** The loader refuses to boot on a schema mismatch (src/engine/persistence.ts:39-57). Never widen a saved enum; new state goes in new optional fields (the list is in FK-001). Every new array has a `.max()` and the code trims to it before saving: a save over a max refuses to boot (persistence.ts:51-57). STATE_VERSION stays 1.
- **Sami's server and tunnel files** (the tunnel lockdown, committed in 958e6fd and running): avoid src/index.ts, src/config.ts, src/server/**, play-worker/**, scripts/tunnel.ts and scripts/server-safety.test.ts unless a card truly needs a small additive change there. Then keep it minimal, keep scripts/server-safety.test.ts green, and never change the tunnel or guard behaviour. No new npm dependencies and no new env vars without the coordinator; script lines in package.json go through the coordinator too. Never touch the tmux `ngrok` session.
- **Commits.** In your worktree on your lane branch: `git add <your own paths>` then `git commit -- <your paths>`. Never `-a`, stash, reset or checkout of other people's work. `nice -n 10 npm run typecheck` and `nice -n 10 npm test` green before landing (Node: `export PATH=$HOME/.local/bin:$PATH`). End commit messages with the `Co-Authored-By` line from the session.
- **Restart rule.** Only the coordinator restarts `town` and rebuilds `public/` on main. 4600 is a test world only Sami uses and all its chat is fake ("don't worry about interruptions", Sami, 2026-10-24), so the coordinator may restart at **any check-in, with no off-air window**; server changes still batch into one restart per check-in where that's easy. Always from a clean main checkout, and **always copy the save first**: `cp data/world-ai-dudes.json data/world-ai-dudes.pre-<card>-<yyyymmdd-hhmm>.json`. Restart: `tmux kill-session -t town`, then `tmux new -d -s town 'cd /home/sami/workspace/generative-streams/ai-dudes-city && npm start 2>&1 | tee -a logs/town.log'`. A client-only check-in is `node scripts/build-client.mjs` in the main checkout, from a clean tree (no restart).
- **Test names on 4600.** Prefer `test-` names (`test-kev`, `test-dana`, `test-bo`, `test-nia`) for test chat on 4600, and clean up afterwards: /admin `remove-build`, `remove-dude`, `release-lot` (worlds/ai-dudes/index.ts:1965, 1947, 1787) for each, or restore the pre-demo save, and finish with Story OFF. It isn't critical (4600 is Sami's test world), but test dudes left behind keep the best lots (the first four in the ranking, src/shared/city.ts:181-188), get restyled at astra cost every age, and stay put under layout A+ (FK-075 keeps existing claims). Pet asks on 4600 are real astra calls (about $0.13 each).
- **Screenshots.** `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs <url> <out.png> --w 1920 --h 1080 --wait 8000` (add `--mobile` for a phone). About 20 s each on a 4-core box shared with the live server: one at a time (the lock makes everyone queue), only the ones you need, saved under /tmp/fk-shots/<your-lane>/. The stream view is `/?stream=1` at 1920×1080, as OBS shoots it.
- **Designs** are generated with **openai/gpt-6-astra only** (Sami's rule), in Lane X's worktree only (design/out/spend.jsonl is tracked, so one writer). $171.92 has already been spent against the default `DESIGN_BUDGET_USD` of 100 (design/astra.ts:29), so every run sets `DESIGN_BUDGET_USD` = spend so far + that card's ceiling. Programme cap **$245** (about $73 of new spend), approved 2026-10-24 (**Decisions** 3).
- **Speech blips are Sami's.** Any change to speech(), tone(), seedOf, the voice or sfx bus gain, the compressor, or anything that mutes, ducks, caps or replaces voices needs a sound-board link and Sami's Approve. Agents never edit the golden file. (The golden file is client/dudes/audio-approved.json, checked by scripts/audio-voice.test.ts from FK-157; only Sami's Approve on :4600/sounds writes it, FK-160, and the coordinator commits it on main.)

## Worktrees and demo servers

| Lane | Worktree | Branch | Demo port (`$PORT`) | Data dir |
|---|---|---|---|---|
| A | /home/sami/workspace/fk-wt/a | fk-a | 4611 | data/demo-a |
| B | /home/sami/workspace/fk-wt/b | fk-b | 4612 | data/demo-b |
| C | /home/sami/workspace/fk-wt/c | fk-c | 4613 | data/demo-c |
| D | /home/sami/workspace/fk-wt/d | fk-d | 4614 | data/demo-d |
| E | /home/sami/workspace/fk-wt/e | fk-e | 4615 | data/demo-e |
| X | /home/sami/workspace/fk-wt/x | fk-x | none (static pages through `file://`) | — |
| S | /home/sami/workspace/fk-wt/s | fk-s | none of its own; `fk-demo.sh s` borrows a slot on 4616 when it needs a server | data/demo-s |
| P | main checkout (board/, 4600) and /home/sami/workspace/fk-wt/p for rehearsals | fk-p | 4610 | data/demo-p |

**Set-up (the coordinator, once, after committing board/ on main; all eight worktrees, s included, exist as of 2026-10-24):**
```
cd /home/sami/workspace/generative-streams
for l in a b c d e x p s; do
  git worktree add -b fk-$l /home/sami/workspace/fk-wt/$l main
  ln -s /home/sami/workspace/generative-streams/ai-dudes-city/node_modules /home/sami/workspace/fk-wt/$l/ai-dudes-city/node_modules
  ln -s /home/sami/workspace/generative-streams/ai-dudes-city/.env /home/sami/workspace/fk-wt/$l/ai-dudes-city/.env
done
```
(The repo root is generative-streams, so each worktree holds the whole repo; work inside its `ai-dudes-city/`.)

**Demo server:** `board/tools/fk-demo.sh <lane>` (stop: `board/tools/fk-demo.sh <lane> stop`). It runs `npm start` under `nice` in tmux `fk-demo-<lane>` with fixtures, Kick off, Kick replies off, your port and your data dir (package.json's `demo` script hard-codes 4610 and data/demo). Lane S has no port of its own: `fk-demo.sh s` runs on 4616 when it needs one. **At most 2 demo servers run at once:** the script takes one of two slot locks and refuses a third; stop yours when you're done. Inject chat with `PORT=$PORT npm run inject -- test-kev red`; /admin → Test chat and Story (dev) work on every demo port.

**Landing a card on main** (typecheck and tests green in your worktree first):
```
cd /home/sami/workspace/fk-wt/<lane>/ai-dudes-city
git rebase main && nice -n 10 npm run typecheck && nice -n 10 npm test
flock /tmp/fk-land.lock git -C /home/sami/workspace/generative-streams merge --ff-only fk-<lane>
```
If the fast-forward fails, main moved: rebase and run again. Landing changes files in the main checkout but nothing goes live: the server has no watch mode and `public/` is rebuilt only by the coordinator.

**Load:** run tests, typecheck and demo servers under `nice -n 10`; one screenshot at a time behind `/tmp/fk-shot.lock`; at most 2 demo servers.

**Where Sami looks: only 4600** ("You can do everything on main and on 4600", Sami, 2026-10-24). Lanes use their demo ports (4611–4616; the coordinator's 4610) for their own testing and screenshots; every check-in for Sami is on 4600.

## Milestones

### M1 · See it
**Goal:** on 4600, Sami flips Story ON and sees the Board, the sides, the five cast, Wren's red site sign with Oak, the Folly under its tarp, a full gathering, an Unveiling (ortho and `?persp=1`), a Rally and pets following their owners; then flips it OFF and today's game is back. He also auditions every cue and the speech blips on :4600/sounds and clicks Approve: the blips he loves are locked by a test from day 1 (FK-157). **About 6–7 working days** (it was 5: the critic showed the old table broke the Ready rule; see Notes). Design spend about $10.50 (FK-003 $0, FK-004 $0, FK-005 ~$1.50, FK-006 ~$3, FK-007 ~$4, FK-008 ~$1.50, FK-030 ~$0.50).

**What Sami sees, in order** (each is a check-in, not a wait for the whole milestone):
1. **Day 1:** fresh design boards with the shipped Wasteland (FK-004); the static HUD mock (FK-005, day 1–2) through `file://`, then at /fk-hud.html on 4600 once the coordinator copies it.
2. **Day 2 (client-only rebuild, no restart):** `/?stream=1&demo=board` on 4600 (FK-009, FK-010); the Stone cast boards to pick from (FK-006). Big Hut boards on day 3 (FK-007).
3. **Day 3 (first restart):** Story ON → the Story (dev) panel, the real Board ("BRIDGE · soon", then the live count after /admin scene-opening), the five cast with role tags, the head snapped to his mark, and `?demo=show` for the gather banner and NOW card.
4. **Day 4 (restart):** red / gold by typing with discs and icons; pets following their owners; the crowd ring (Story (dev) → Gather, with the Call bell); `?demo=folly` for the cordon, tarp, beam and the drop. **:4600/sounds** (FK-159): every cue, the speech blips in all ten voices, a 15-talker crowd and the phone toggle.
5. **Day 5 (restart):** the Folly cordon in the SE corner park; the cast in their Stone looks; Wren's red site sign with Oak under it; **the Unveiling**, on ortho and with `&persp=1`. On /sounds, the **Approve** buttons (FK-160) and the level table, docs/audio-levels.md (FK-161).
6. **Day 6 (restart):** **the Rally**, opening on Wren's whistle (after Play: Crossing through the new runtime); the world breathing; then the full walkthrough (FK-031, day 6–7).

**M1 demo script** (on 4600 at a check-in, FK-031; `test-` names preferred):
1. Copy the save. /admin → Story (dev) → **Story ON**. Open /?stream=1 at 1920×1080 and /mayor.
2. Check the Board ("BIG HUT 0% · type gold" | "BRIDGE · soon"), the tug line, the ticker, the five cast with role tags, Wren's site sign with Oak under it, the river and smoke moving.
3. Eight test names say hello in /admin Test chat. /admin → **scene-opening**: the bridge ask opens and the Board reads "BRIDGE 0/4" (need = ⌈0.4 × awake⌉).
4. test-kev types `red`; test-dana and test-bo type `gold`. Discs and icons appear, the tug line reads 2–1, the ticker says "Test-kev joined red". test-dana types `make my house gold`: a build, not a side switch.
5. test-kev types `get me a pet dog`: the dog trails him. Then `make me a pet cat`: the dog becomes a cat (still one pet). Two real astra calls, about $0.26.
6. With Story ON, test-bo types `build me a hut`: it lands on his lot.
7. Story (dev) → **Raise the cordon**, then **Folly → 100**.
8. Story (dev) → **Play: Unveiling** (then again with `&persp=1`). The Call bell rings and everyone, pets included, walks into the ring, gold in front, red behind; the head is put on his mark; the tarp drops; testers type `7` and `3` → 5.0; test-nia types `build me a hut` mid-scene; Wren: "That was our fire."; the NOW card. After the release test-nia's hut gets built.
9. Story (dev) → **Play: Crossing**, then **Play: Rally** (it opens on Wren's whistle). test-nia types `coming` and walks to the fire; `us` lights a pip and turns her red.
10. **Sound:** open :4600/sounds and click Start. Sami plays every cue (today's, plus Wren's whistle and the Call bell), says a line in each of the nine voices and the Mayor's low voice, and runs the 15-talker crowd with and without the phone toggle; he clicks **Approve** on the voices and on each cue he's happy with (the coordinator commits client/dudes/audio-approved.json) and answers the N-key question (FK-162). Anything he doesn't like becomes a card.
11. **Clean-up:** /admin remove-build, remove-dude and release-lot for every `test-` name (or restore the copy), then **Story OFF**: the caravan panel, feed and invite are back; pets roam; today's game.

### M2 · Stream 1: Stone
**Goal:** Sami can run stream 1 end to end with about six key presses: the sepia Intro, the Crossing (on GO), two Rallies, the Unveiling with hero shots on the perspective camera, the Make Room job driving the old ask engine, THE WONDER bar, the age turn that keeps the cast, and a calm, gently moving world. It is scored: Stone music and beds, the Bell and the gathering murmur, the Unveiling's drumroll (on Tab), reveal and hard cut to Wren, the Rally's whistle, us-plucks and "Meanwhile…", the Intro's old-radio flashback, the UI sounds, and a mix that keeps every voice clear and sits under Sami's mic (the OBS sidechain, FK-175). The "your home through the ages" cards pay off in stream 2 (stream 1 ends on the age turn). Each lane carries about 5–6.5 engineer-days with the layout cards (Lane S about 9.75, so it runs two agents: see the M2 lane order), so M2 is about 7 working days with check-ins. Design spend about $15.45 (FK-034 ~$1.50, FK-068 ~$1.50, FK-070 ~$4.45, FK-071 ~$5, FK-137 ~$1, FK-138 ~$1.50, FK-139 ~$0.50).

**Layout: decided 2026-10-24.** Sami approved A+ with the river moving east, and question 3 (the band's old camp moves to the town bank). FK-043, FK-044, FK-056, FK-132 and the layout cards FK-075 to FK-081 are unblocked; the layout cards go first in each lane's M2 order. Nothing in M1 waits on the layout: M1 keeps its provisional story sites in the SE corner park.

**Cut order if late** (from the bible and PM): FK-046 Kit follows, then FK-060 idle bits, then the tug line (FK-010), then the sepia grade (FK-043). Never cut FK-018 gather mode, FK-014 cast or the perspective camera (if FK-136 / FK-042 slip, ship FK-041's ortho near-clip and finish them before Bronze). Sound: cut FK-172 (phone pass), then FK-173 (cast voices; FK-014's ids already keep them steady), then FK-166 (Stone beds) to early M3; never cut the mix director (FK-163), the Unveiling score (FK-168), the Rally sound (FK-169) or the Intro sound (FK-170).

**M2 demo script** (rehearsal, FK-074): run it in full on the coordinator's demo server (4610), then on 4600 with `test-` names (preferred) and the clean-up, **stopping after step 7 on 4600**: finishing the Wonder turns the 4600 world's age.
1. Story (dev) → **Stage stream 1**.
2. The /mayor lamp shows "GO = INTRO". Press backtick: the flashback sounds like an old recording, the bridge creaks and collapses into silence, and full sound swells in at NOW; at I8 hold Tab and say "Hello! Welcome to my town!" (the music dips under the mic).
3. Eight test names awake (need 4); four different names type `red` → BRIDGE 4/4: the lamp shows "GO = THE CROSSING"; GO; Kit starts following the head.
4. GO Rally 1: it opens on Wren's whistle, each `us` plucks a step higher, "Meanwhile…" cuts hard to the town tune; /mayor keeps its own camera with the ON STREAM chip; a tester's `warn` pings /mayor.
5. GO the Unveiling: the Bell, the walk and the murmur; hold Tab at U4 and read the plaque names over the vamp (the drumroll loops while Tab is held at U2); the reveal lands as one sound; the crowd shot holds while chat talks, with RATE IT ticks; the pivot cuts the music to wind and river under Wren's line; a build typed mid-scene is built after the release.
6. Try the double-backtick cancel gag and the Esc-hold panic.
7. A tester builds a hut: MAKE ROOM moves, and no Mammoth Herders line appears anywhere. MAKE ROOM met → THE WONDER bar fills red and gold by contributor side.
8. (4610 only.) Finish the Wonder, then GO the age turn: the ribbon, the cliffhanger, the standings card, the same cast in Bronze. test-kev's first line in Bronze shows his home card.
9. Clean up the `test-` names (or restore the save); Story OFF.

**Sound sign-off** (on 4600, any time in the rehearsal window): on :4600/sounds Sami A/Bs Stone against Modern, plays the Bell, Unveiling, Rally and Intro chains, the UI sounds and the capped crowd, and approves; the OBS sidechain and loudness check with him (FK-175).

### M3 · Bronze ready
**Goal:** stream 2 can run: automatic rallies with live lines, the Golden Me, the Ask that branches on Sami's answer, the Last Light in both branches, the candle window, SHE WON'T FORGET, the Defection Window, the Verdict, huts or tents, Moss's "Previously" with the top-3 home cards, gold wages. Sound: Bronze music and the gong, the Last Light's muffled party and its 6 s of true silence, candle tones, defection pops and pet voices, each approved by Sami on /sounds. Design spend about $13.50 (FK-085 ~$4, FK-086 ~$4.50, FK-094 ~$2, FK-097 ~$1.50, FK-098 ~$1.50).

**M3 demo script** (FK-099):
1. GO "Previously" (Moss): it ends on the three oldest homes' cards. Leave the demo server idle: a rally fires by itself and names a real chatter.
2. GO the Ask and press 3: the healer's hut jumps 50%.
3. Testers type `red`; finish the hut. GO the Unveiling (the statue rises; the doorway pivot), then the Defection Window: a gold tester crosses (one flip sound).
4. GO the Last Light: the speech, the hard cut and the muffled party, Ash naming the top builder, the six seconds of true silence and the cord, the *ASH* card on a struck bowl, an older Wren at the grave in a Medieval town on a swell into her motif; chat lines light candles, each with a glass tone; SHE WON'T FORGET; the Verdict card.
5. Run it again without the hut and without pressing 3: Ash says only "Live."
6. **Sound sign-off** on :4600/sounds: Bronze music against Stone, the gong, the Last Light chain, the candle tones, the defection flips and the pet voices; Sami approves.

### Later
**Goal:** one age ahead of each stream: the Medieval to Wasteland design packs, beats, red jobs, age turns, cue cards and age music (Medieval, Industrial with Modern's PA call, Wasteland); the Rising with the honest count and the three endings; the trial montage; their sound (the count's speeding drums, a last sound for each ending, each Folly's age motif at the trial, the Friends of the Boss march); performance for 20+ chatter nights (FK-118 must land before any stream with 20 or more chatters); and Wren's own Kick account if Sami wants it. Later cards have placeholder lanes; the coordinator rebalances them at the M3 review. Design spend about $31.50.



## Where it stopped (2026-10-24, wrap-up)

**On main (33 cards):** FK-001 FK-002 FK-003 FK-004 FK-005 FK-006 FK-009 FK-010 FK-011 FK-012 FK-013 FK-014 FK-017 FK-018 FK-019 FK-020 FK-021 FK-023 FK-024 FK-027 FK-065 FK-072 FK-073 FK-075 FK-077 FK-078 FK-127 FK-128 FK-157 FK-158 FK-159 FK-160 FK-162.

**Works on 4600 with Story ON** (/admin header switch, or `story-on`): the cast (Ash, Wren, Old Moss, Oak, Kit) persisting across ages; the Board (Folly in gold vs the red job, tug line, ticker); `red` / `gold` sides with ground discs and crown/flag tags; the Folly site on the River Bank under its tarp with cordon, beam and KEEP OUT sign (`folly-raise`, `folly-progress`); the Bell (`story-gather`): GATHER banner + countdown and everyone walking into a ring; the show HUD (banner, NOW card, title cards, slim letterbox); pets following their owners; chat during a gathering becomes bubbles and votes; old scenes (opening, Crossing, age turn) run through the show runtime. Also: layout A+ (lots fill from the bridge, River Bank, half the square open), `/sounds` sound board with Approve and the speech-blip guard, `?stats=1`, feed dedupe, `/fk-hud.html` mock, fresh design boards (design/out/rfinal3, o4), Stone cast specs (design/spec/cast/stone.json).

**Not built yet (the next slice):** FK-022 RATE IT + crowd shot, FK-124 story scenes on the stream page, FK-007 the Big Hut model (partial work parked in fk-wt/x), FK-016 cast looks in game, then FK-025 the Unveiling and FK-026 the Rally. Parked partial work: FK-079 bank story sites (fk-wt/b, uncommitted). Known issue: troublemaker pop-ups still fire during a gathering (pause them in tickEvents while a story scene/gather runs).

## Fast path (2026-10-24, Sami: "trim the fat… see it come together sooner so we can iterate")

**In scope now — only what gets a working Unveiling + Rally on 4600:** FK-019, FK-021, FK-022, FK-124, FK-024, FK-012, FK-006, FK-007, FK-016, FK-127, then FK-025 (Unveiling) and FK-026 (Rally). Lanes run the lean runner (~/gs-tools/fk-lane-fast.js: build + land with tests green → one audit → one fix round only if blocking); the coordinator does the visual checks at check-ins.

**Deferred until Sami has seen it and reacted:** FK-040/041/136 perspective camera, FK-029 world breathes, FK-028 one pet per chatter, FK-125 Wren's site sign, FK-008 camp dressing, FK-034 intro art, FK-068 age-life design, FK-076 Bridge Lane, FK-079 bank story sites, FK-015, FK-160/161 sound Approve + offline render, FK-030 design review, FK-031 formal demo, and all M2+ cards. They stay on the board; nothing is deleted.

## Columns

### Ready
| Card | Title | Milestone | Lane | Discipline | Size | Depends on | Owner |
|---|---|---|---|---|---|---|---|
| [FK-005](cards/FK-005-hud-sticker-kit-mock.md) | HUD sticker-kit mock (static page) | M1 | X | design | S | — | — |
| [FK-157](cards/FK-157-speech-blip-guard.md) | Speech-blip guard, approval file and board rule | M1 | S | sound | S | — | — |
| [FK-075](cards/FK-075-layout-fill-by-block.md) | Layout A+: hand out lots block by block from the bridge | M2 | E | eng | S | — | — |
| [FK-077](cards/FK-077-layout-open-square-half.md) | Layout A+: keep half the square open | M2 | E | eng | S | — | — |
| [FK-078](cards/FK-078-river-bank-ground.md) | Layout A+: the River Bank (move the river, extend the ground) | M2 | A | eng | M | — | — |
| [FK-145](cards/FK-145-bronze-cue-cards.md) | Bronze cue cards and line banks | M3 | P | product | S | FK-073 | — |
| [FK-120](cards/FK-120-idle-thinning.md) | Thin out idle walking at scale | Later | A | eng | S | — | — |

FK-075, FK-077 and FK-078 became Ready with Sami's layout decision (2026-10-24), but they edit files Lane B holds in M1 (src/shared/city.ts and placement.ts; FK-077 needs a hook into city.ts): each starts only when file ownership allows, and never ahead of an M1 card or the M1 critical path (see the cards and the M1 day plan). FK-157 is Lane S's first card, on day 1.

### Backlog
| Card | Title | Milestone | Lane | Discipline | Size | Depends on | Owner |
|---|---|---|---|---|---|---|---|
| [FK-002](cards/FK-002-admin-story-dev-panel.md) | /admin "Story (dev)" panel | M1 | A | eng | S | FK-001 | — |
| [FK-004](cards/FK-004-fresh-design-boards.md) | Fresh design boards for Sami | M1 | X | design | S | FK-003 | — |
| [FK-006](cards/FK-006-stone-cast-looks.md) | Stone cast looks (Wren, Ash, Moss, Oak, Kit, the Chief) | M1 | X | design | M | FK-003 | — |
| [FK-007](cards/FK-007-the-big-hut.md) | THE BIG HUT: the Stone Folly blueprint | M1 | X | design | M | FK-003 | — |
| [FK-008](cards/FK-008-camp-and-rally-fire-dressing.md) | Camp and rally-fire dressing | M1 | X | design | S | FK-003 | — |
| [FK-009](cards/FK-009-sticker-toy-ui-base.md) | Sticker Toy UI base: fonts, tokens, slim letterbox | M1 | C | eng | S | FK-001 | — |
| [FK-010](cards/FK-010-board-client.md) | The Board on stream (client) + ?demo=board | M1 | C | eng | M | FK-009 | — |
| [FK-011](cards/FK-011-board-server.md) | The Board data (server) | M1 | E | eng | M | FK-001 | — |
| [FK-012](cards/FK-012-sides.md) | Sides: red, gold and help on the fast path | M1 | E | eng | M | FK-001 | — |
| [FK-013](cards/FK-013-side-markers.md) | Side markers: ground disc and crown or flag | M1 | D | eng | S | FK-001 | — |
| [FK-014](cards/FK-014-cast-persists.md) | Cast persists: ids, spawn and the three wipes | M1 | B | eng | S | FK-001 | — |
| [FK-015](cards/FK-015-cast-ignores-small-talk.md) | The cast ignores the head's small talk | M1 | E | eng | XS | FK-014 | — |
| [FK-016](cards/FK-016-apply-stone-cast-looks.md) | Apply the Stone cast looks | M1 | D | eng | S | FK-006, FK-014 | — |
| [FK-017](cards/FK-017-show-runtime.md) | Show runtime: scenes tick on their own | M1 | A | eng | M | FK-001 | — |
| [FK-018](cards/FK-018-gather-mode.md) | Gather mode: chat in a scene becomes bubbles and votes | M1 | A | eng | S | FK-017 | — |
| [FK-019](cards/FK-019-gather-visits.md) | The Bell: everyone walks into a ring | M1 | A | eng | M | FK-017 | — |
| [FK-020](cards/FK-020-head-prep-at-call.md) | Head prep at the Call | M1 | E | eng | S | FK-001 | — |
| [FK-021](cards/FK-021-show-hud.md) | Show HUD: gather banner, NOW card, title card, subtitles | M1 | C | eng | M | FK-009 | — |
| [FK-022](cards/FK-022-prompt-tiles-and-crowd-shot.md) | RATE IT, pips and the crowd shot | M1 | C | eng | S | FK-021 | — |
| [FK-023](cards/FK-023-folly-site-server.md) | The Folly site (server) | M1 | B | eng | M | FK-001 | — |
| [FK-024](cards/FK-024-folly-look.md) | Folly look: cordon, tarp, sign, beam and the drop | M1 | D | eng | M | FK-001 | — |
| [FK-025](cards/FK-025-unveiling-v1.md) | The Unveiling v1 (ortho camera) | M1 | B | eng | M | FK-014, FK-018, FK-019, FK-020, FK-021, FK-022, FK-023, FK-024, FK-124 | — |
| [FK-026](cards/FK-026-rally-v1.md) | Wren's Rally v1 | M1 | B | eng | M | FK-012, FK-014, FK-018, FK-019, FK-021, FK-022, FK-124, FK-126, FK-127 | — |
| [FK-027](cards/FK-027-pets-follow-owner.md) | Pets follow their owner | M1 | D | eng | M | FK-001 | — |
| [FK-028](cards/FK-028-one-pet-per-chatter.md) | One pet per chatter | M1 | A | eng | S | FK-027 | — |
| [FK-029](cards/FK-029-world-breathes.md) | The world breathes | M1 | C | eng | S | FK-001 | — |
| [FK-030](cards/FK-030-story-world-kit-review.md) | Design review: story pieces in the game | M1 | X | design | S | FK-013, FK-016, FK-024, FK-125 | — |
| [FK-031](cards/FK-031-m1-demo.md) | M1 demo: the restart and Sami's walkthrough | M1 | P | product | S | FK-002, FK-010, FK-011, FK-012, FK-013, FK-016, FK-025, FK-026, FK-028, FK-029, FK-030, FK-040, FK-124, FK-125, FK-126, FK-127, FK-128, FK-157, FK-158, FK-159, FK-160, FK-161, FK-162 | — |
| [FK-040](cards/FK-040-perspective-camera.md) | Perspective cinema camera 1: the camera and ?persp=1 | M1 | C | eng | M | FK-001 | — |
| [FK-124](cards/FK-124-story-scenes-on-stream.md) | Story scenes play on the stream page | M1 | C | eng | S | FK-001, FK-017 | — |
| [FK-125](cards/FK-125-wren-site-sign.md) | Wren's site sign, with Oak standing under it | M1 | D | eng | S | FK-011, FK-014 | — |
| [FK-126](cards/FK-126-story-sounds-1.md) | Story sounds 1: Wren's whistle and the Call bell | M1 | S | sound | XS | FK-001, FK-157 | — |
| [FK-127](cards/FK-127-old-scenes-through-runtime.md) | Old scenes through the show runtime: opening, Crossing, age turn | M1 | A | eng | S | FK-014, FK-017 | — |
| [FK-128](cards/FK-128-cast-renames-and-daughter.md) | Cast renames and the daughter clean-up | M1 | B | eng | S | FK-014 | — |
| [FK-158](cards/FK-158-injectable-audio-context.md) | Injectable AudioContext and random in createAudio | M1 | S | sound | S | FK-157 | — |
| [FK-159](cards/FK-159-sound-board.md) | Sound board v1 at /sounds | M1 | S | sound | M | FK-158 | — |
| [FK-160](cards/FK-160-sound-approve-and-fingerprints.md) | Approve on /sounds, and cue fingerprints | M1 | S | sound | S | FK-159 | — |
| [FK-161](cards/FK-161-offline-render-and-levels.md) | Offline render, audio:check and the baseline level table | M1 | S | sound | M | FK-158 | — |
| [FK-162](cards/FK-162-voice-bus-split.md) | Voice bus split, and the N-key question | M1 | S | sound | S | FK-157 | — |
| [FK-032](cards/FK-032-calm-during-scenes.md) | Calm during scenes | M2 | D | eng | S | FK-017 | — |
| [FK-033](cards/FK-033-bridge-intact-and-collapse.md) | Bridge intact, then the collapse beat | M2 | B | eng | S | FK-017 | — |
| [FK-034](cards/FK-034-intro-art.md) | Intro art: yankable bridge logs, the Chief stand-in, flashback cards | M2 | X | design | S | FK-003 | — |
| [FK-035](cards/FK-035-holds-and-mayor-slots-server.md) | Holds and Mayor slots (server) | M2 | A | eng | M | FK-017 | — |
| [FK-036](cards/FK-036-holds-client.md) | Holds on the stream client | M2 | C | eng | S | FK-035 | — |
| [FK-037](cards/FK-037-beat-queue.md) | Beat queue: armed beats, GO, the cancel gag, panic | M2 | A | eng | M | FK-035 | — |
| [FK-038](cards/FK-038-mayor-show-strip.md) | /mayor strip, lamp, cue cards and ON STREAM chip | M2 | E | eng | M | FK-037, FK-137 | — |
| [FK-039](cards/FK-039-show-keys.md) | Show keys: backtick GO, Tab, 1/2/3, Esc-hold panic | M2 | E | eng | S | FK-038 | — |
| [FK-041](cards/FK-041-ortho-near-clip-fallback.md) | Ortho near-clip fallback per shot | M2 | C | eng | S | FK-001 | — |
| [FK-042](cards/FK-042-hero-shots.md) | Hero shots: U2/U4 Mayor slots, U6 crowd, U7 over Wren's shoulder | M2 | C | eng | M | FK-025, FK-035, FK-040, FK-136 | — |
| [FK-043](cards/FK-043-intro-flashback.md) | Intro part 1: the sepia flashback (I1–I4) | M2 | B | eng | M | FK-033, FK-034, FK-035, FK-132, FK-135 | — |
| [FK-044](cards/FK-044-intro-now.md) | Intro part 2: "NOW" (I5–I11) | M2 | B | eng | M | FK-014, FK-020, FK-023, FK-040, FK-041, FK-043, FK-132 | — |
| [FK-045](cards/FK-045-crossing-new-cast.md) | The Crossing with the new cast | M2 | B | eng | S | FK-014, FK-017, FK-038, FK-127, FK-133 | — |
| [FK-046](cards/FK-046-kit-follows-head.md) | Kit follows the head and copies his poses | M2 | B | eng | S | FK-014 | — |
| [FK-047](cards/FK-047-red-job-make-room.md) | Red job: "Make room" (any hut counts) | M2 | E | eng | S | FK-011, FK-012, FK-129 | — |
| [FK-048](cards/FK-048-age-turn-stone.md) | Stone age turn: ribbon, cliffhanger, standings, same cast | M2 | B | eng | M | FK-012, FK-014, FK-017, FK-021, FK-035 | — |
| [FK-049](cards/FK-049-home-through-ages-server.md) | Your home through the ages (server) | M2 | A | eng | S | FK-001 | — |
| [FK-050](cards/FK-050-home-through-ages-card.md) | Your home through the ages (card and camera) | M2 | C | eng | S | FK-009, FK-048, FK-049 | — |
| [FK-051](cards/FK-051-pets-age-with-world.md) | Pets age with the world | M2 | D | eng | S | FK-027, FK-049 | — |
| [FK-052](cards/FK-052-pets-in-the-ring.md) | Pets stand beside their owner in the ring | M2 | D | eng | S | FK-019, FK-027 | — |
| [FK-053](cards/FK-053-crowd-hold-rules.md) | Crowd-shot hold rules and the thin-crowd skip | M2 | A | eng | S | FK-022, FK-035 | — |
| [FK-054](cards/FK-054-amplification-gate.md) | Crowd Mic amplification gate | M2 | A | eng | M | FK-018 | — |
| [FK-055](cards/FK-055-big-bubbles.md) | Big bubbles for amplified lines | M2 | D | eng | S | FK-022, FK-040, FK-054 | — |
| [FK-056](cards/FK-056-stage-stream-1.md) | "Stage stream 1" button | M2 | A | eng | S | FK-014, FK-023, FK-033, FK-132 | — |
| [FK-057](cards/FK-057-stream-only-rallies.md) | Stream-only rallies, warn pings and the scatter | M2 | B | eng | S | FK-026, FK-038 | — |
| [FK-058](cards/FK-058-autopilot-and-safety-drawer.md) | Autopilot and the safety drawer | M2 | E | eng | S | FK-038 | — |
| [FK-059](cards/FK-059-crier-premise.md) | Crier: the premise on join, every 5 minutes, and a post at each Call | M2 | E | eng | S | FK-012, FK-017 | — |
| [FK-060](cards/FK-060-cast-idle-bits.md) | Cast idle bits and name-checks | M2 | P | eng | S | FK-014 | — |
| [FK-061](cards/FK-061-head-walks-to-mark.md) | The head walks to his mark (replaces the snap) | M2 | E | eng | S | FK-020 | — |
| [FK-062](cards/FK-062-autoframe-recent-speakers.md) | autoFrame frames recent speakers | M2 | C | eng | S | FK-001 | — |
| [FK-063](cards/FK-063-ink-outline.md) | Ink outline on people, pets and cast | M2 | D | eng | S | FK-001 | — |
| [FK-064](cards/FK-064-story-colours-and-head-kit.md) | Lock story colours; the head wears gold, never red | M2 | D | eng | S | FK-006 | — |
| [FK-066](cards/FK-066-bird-flock.md) | Bird flock | M2 | D | eng | S | FK-029 | — |
| [FK-067](cards/FK-067-mover-caps.md) | Mover caps and turn-taking | M2 | D | eng | S | FK-001 | — |
| [FK-068](cards/FK-068-stone-life-design.md) | Stone age-life designs: mammoth and goats | M2 | X | design | S | FK-003 | — |
| [FK-069](cards/FK-069-age-life-movers.md) | Age-life movers (town-owned) | M2 | D | eng | M | FK-032, FK-068 | — |
| [FK-070](cards/FK-070-design-prompt-tuning.md) | In-game design prompt tuning, with an A/B | M2 | X | design | M | FK-003 | — |
| [FK-071](cards/FK-071-pet-designs.md) | Pet designs and age accessory kits | M2 | X | design | S | FK-003 | — |
| [FK-074](cards/FK-074-stream-1-rehearsal.md) | Stream 1 rehearsal and go/no-go | M2 | P | product | S | FK-032, FK-037, FK-038, FK-039, FK-042, FK-044, FK-045, FK-047, FK-048, FK-050, FK-051, FK-052, FK-053, FK-054, FK-056, FK-057, FK-058, FK-059, FK-064, FK-073, FK-129, FK-130, FK-131, FK-132, FK-133, FK-134, FK-135, FK-136, FK-139, FK-163, FK-164, FK-165, FK-167, FK-168, FK-169, FK-170, FK-171, FK-174, FK-175 | — |
| [FK-076](cards/FK-076-layout-bridge-lane.md) | Layout A+: Bridge Lane | M2 | E | eng | S | FK-075 | — |
| [FK-079](cards/FK-079-river-bank-story-sites.md) | Layout A+: story sites on the bank | M2 | B | eng | M | FK-078 | — |
| [FK-080](cards/FK-080-draw-open-blocks.md) | Layout A+: draw only the blocks that are open | M2 | C | eng | M | FK-075 | — |
| [FK-081](cards/FK-081-parks-become-blocks.md) | Layout A+: corner parks become home blocks in fill order | M2 | E | eng | S | FK-080 | — |
| [FK-129](cards/FK-129-story-jobs-drive-asks.md) | Story jobs drive the caravan ask engine | M2 | E | eng | S | FK-011, FK-012 | — |
| [FK-130](cards/FK-130-wonder-bar-server.md) | THE WONDER bar (server): red and gold by who put in what | M2 | E | eng | S | FK-011, FK-012, FK-129 | — |
| [FK-131](cards/FK-131-wonder-bar-client.md) | THE WONDER bar (client) | M2 | C | eng | S | FK-010, FK-130 | — |
| [FK-132](cards/FK-132-camp-on-town-side.md) | The band's camp on the town side | M2 | D | eng | M | FK-001, FK-008, FK-034 | — |
| [FK-133](cards/FK-133-stream-1-beats.md) | Stream-1 beat list and arming rules | M2 | A | eng | S | FK-037 | — |
| [FK-134](cards/FK-134-walk-shot.md) | The walk shot: a high wide of everyone converging | M2 | C | eng | S | FK-019, FK-124 | — |
| [FK-135](cards/FK-135-story-sounds-2.md) | Story sounds 2: the creak and the U7 music drop | M2 | S | sound | XS | FK-126, FK-160 | — |
| [FK-136](cards/FK-136-perspective-camera-2.md) | Perspective cinema camera 2: fog, shadows and shot tuning | M2 | C | eng | S | FK-040 | — |
| [FK-137](cards/FK-137-mayor-screen-design.md) | /mayor operator screen design | M2 | X | design | S | FK-005 | — |
| [FK-138](cards/FK-138-hud-design-m2.md) | M2 HUD design: standings, VERDICT, rally banner, turncoat pop-up | M2 | X | design | S | FK-005 | — |
| [FK-139](cards/FK-139-design-review-m2.md) | M2 design review on 4600 | M2 | X | design | S | FK-038, FK-042, FK-050, FK-055, FK-063, FK-064, FK-069, FK-131, FK-132, FK-136, FK-137, FK-138 | — |
| [FK-163](cards/FK-163-mix-director.md) | Mix director: scenes, the Mayor slot, and no feed sounds mid-scene | M2 | S | sound | M | FK-017, FK-035, FK-124, FK-160, FK-162 | — |
| [FK-164](cards/FK-164-scene-cue-track.md) | Scene cue track: sounds on exact moments, once, through holds | M2 | S | sound | S | FK-017, FK-035, FK-124, FK-160 | — |
| [FK-165](cards/FK-165-age-music-stone.md) | Age music: the Stone style and the restyle crossfade | M2 | S | sound | M | FK-158, FK-160, FK-161 | — |
| [FK-166](cards/FK-166-stone-ambience.md) | Stone ambience: the river, the fire, and birds by age | M2 | S | sound | S | FK-165 | — |
| [FK-167](cards/FK-167-bell-walk-murmur.md) | The Bell, the gathering walk and the murmur | M2 | S | sound | M | FK-019, FK-126, FK-163 | — |
| [FK-168](cards/FK-168-unveiling-score.md) | The Unveiling score | M2 | S | sound | M | FK-022, FK-023, FK-024, FK-025, FK-035, FK-135, FK-164 | — |
| [FK-169](cards/FK-169-rally-sound.md) | Rally sound: the whistle, the fire, the us-plucks, Meanwhile and the scatter | M2 | S | sound | M | FK-026, FK-057, FK-126, FK-164 | — |
| [FK-170](cards/FK-170-intro-sound.md) | Intro sound: the old-radio flashback and NOW | M2 | S | sound | M | FK-033, FK-043, FK-044, FK-135, FK-164 | — |
| [FK-171](cards/FK-171-ui-sounds.md) | UI sounds: the NOW card, Board milestones and the side pop | M2 | S | sound | S | FK-010, FK-012, FK-021, FK-160, FK-162 | — |
| [FK-172](cards/FK-172-phone-pass.md) | Phone pass: a highpass, a limiter, and something above 300 Hz in every cue | M2 | S | sound | S | FK-160, FK-161 | — |
| [FK-173](cards/FK-173-cast-voices.md) | Cast voices Sami picks by ear | M2 | S | sound | S | FK-014, FK-128, FK-157, FK-160 | — |
| [FK-174](cards/FK-174-crowd-voice-cap.md) | Crowd voice cap | M2 | S | sound | S | FK-022, FK-159, FK-160 | — |
| [FK-175](cards/FK-175-obs-sidechain-loudness.md) | OBS sidechain and the loudness check, with Sami | M2 | S | sound | S | FK-161 | — |
| [FK-082](cards/FK-082-auto-rallies.md) | Automatic rallies | M3 | A | eng | M | FK-026, FK-037 | — |
| [FK-083](cards/FK-083-rally-live-facts.md) | Rally lines with live facts | M3 | B | eng | S | FK-082 | — |
| [FK-084](cards/FK-084-red-jobs-healer-herbs.md) | Bronze red jobs: the healer's hut, then herbs | M3 | E | eng | S | FK-047 | — |
| [FK-085](cards/FK-085-golden-me.md) | THE GOLDEN ME: the Bronze Folly | M3 | X | design | M | FK-003 | — |
| [FK-086](cards/FK-086-bronze-cast-and-adult-wren.md) | Bronze cast looks and adult Wren | M3 | X | design | M | FK-006 | — |
| [FK-087](cards/FK-087-golden-me-in-game.md) | The Golden Me in the game | M3 | B | eng | S | FK-023, FK-085 | — |
| [FK-088](cards/FK-088-the-ask.md) | The Ask (Sami's answer branches the story) | M3 | B | eng | M | FK-035, FK-039, FK-084 | — |
| [FK-089](cards/FK-089-last-light-1.md) | The Last Light 1: the Keep ribbon and the deathbed (L1–L3) | M3 | B | eng | M | FK-042, FK-088 | — |
| [FK-090](cards/FK-090-last-light-2.md) | The Last Light 2: the cord, ASH, and the age over the grave (L4–L6) | M3 | B | eng | M | FK-086, FK-089, FK-097 | — |
| [FK-091](cards/FK-091-candle-window.md) | The candle window | M3 | C | eng | S | FK-022, FK-090, FK-097 | — |
| [FK-092](cards/FK-092-defection-window.md) | The Defection Window and one switch per age | M3 | B | eng | S | FK-012, FK-025 | — |
| [FK-093](cards/FK-093-verdict.md) | The Verdict 1: red handprints or a gold wing on the Folly | M3 | D | eng | S | FK-012, FK-023, FK-094, FK-141 | — |
| [FK-094](cards/FK-094-verdict-variants-design.md) | Verdict variants: the gold wing and red handprints | M3 | X | design | S | FK-007 | — |
| [FK-095](cards/FK-095-moss-previously.md) | Moss's "Previously…" | M3 | B | eng | S | FK-035 | — |
| [FK-096](cards/FK-096-gold-shifts-wages.md) | Gold shifts and wages | M3 | B | eng | S | FK-023 | — |
| [FK-097](cards/FK-097-red-job-props.md) | Red-job examples and grave props | M3 | X | design | S | FK-003 | — |
| [FK-098](cards/FK-098-bronze-life.md) | Bronze age-life designs: ox cart, chickens, gulls | M3 | X | design | S | FK-069 | — |
| [FK-099](cards/FK-099-bronze-rehearsal.md) | Bronze rehearsal | M3 | P | product | S | FK-082, FK-083, FK-087, FK-088, FK-089, FK-090, FK-091, FK-092, FK-093, FK-095, FK-096, FK-140, FK-141, FK-142, FK-143, FK-144, FK-145, FK-176, FK-177, FK-178, FK-179 | — |
| [FK-140](cards/FK-140-story-sounds-3.md) | Story sounds 3: the muffled party and sirens | M3 | S | sound | XS | FK-135 | — |
| [FK-141](cards/FK-141-verdict-decision.md) | The Verdict 2: the call, Kit's badge, the plaza spot, the card | M3 | E | eng | S | FK-012, FK-023, FK-048 | — |
| [FK-142](cards/FK-142-ribbon-beat-and-card.md) | Reusable ribbon beat and the SHE WON'T FORGET card | M3 | B | eng | S | FK-021, FK-048 | — |
| [FK-143](cards/FK-143-huts-or-tents.md) | Huts or tents: the band sleeps where chat made room | M3 | E | eng | S | FK-047 | — |
| [FK-144](cards/FK-144-moss-knots-kit-hat.md) | Moss's knots and Kit's little blue hat | M3 | D | eng | S | FK-016, FK-141 | — |
| [FK-176](cards/FK-176-bronze-music-gong.md) | Bronze music and the gong | M3 | S | sound | M | FK-165 | — |
| [FK-177](cards/FK-177-last-light-sound.md) | The Last Light sound | M3 | S | sound | M | FK-089, FK-090, FK-140, FK-163 | — |
| [FK-178](cards/FK-178-candle-tones.md) | Candle tones | M3 | S | sound | S | FK-091, FK-163 | — |
| [FK-179](cards/FK-179-defection-pops.md) | Defection pops | M3 | S | sound | S | FK-092, FK-171 | — |
| [FK-180](cards/FK-180-pet-voices.md) | Pet voices | M3 | S | sound | M | FK-027, FK-159, FK-163 | — |
| [FK-100](cards/FK-100-medieval-design-pack.md) | Medieval design pack: Royal Moat, cast, Ash's cairn | Later | X | design | M | FK-003 | — |
| [FK-101](cards/FK-101-industrial-design-pack.md) | Industrial design pack: Bust Works, bust prop, cast | Later | X | design | M | FK-003 | — |
| [FK-102](cards/FK-102-modern-design-pack.md) | Modern design pack: Golf Course, cart, 18th flag, cast | Later | X | design | M | FK-003 | — |
| [FK-103](cards/FK-103-wasteland-design-pack.md) | Wasteland design pack: One Seat, cast | Later | X | design | M | FK-003 | — |
| [FK-104](cards/FK-104-later-age-life-design.md) | Age-life designs, Medieval to Wasteland | Later | X | design | S | FK-069 | — |
| [FK-105](cards/FK-105-cairn-red-job.md) | Ash's cairn: the Medieval red shift | Later | E | eng | S | FK-047, FK-100 | — |
| [FK-106](cards/FK-106-the-knot.md) | Medieval beat: The Knot | Later | B | eng | S | FK-057, FK-105 | — |
| [FK-107](cards/FK-107-drawbridge-unveiling.md) | Medieval Unveiling: the drawbridge traps the front row | Later | B | eng | M | FK-042, FK-100 | — |
| [FK-108](cards/FK-108-busts-on-lots.md) | Industrial: a bust lands on every lot | Later | D | eng | M | FK-101 | — |
| [FK-109](cards/FK-109-he-finds-out-and-the-offer.md) | Industrial beat: He Finds Out | Later | B | eng | S | FK-057, FK-061 | — |
| [FK-110](cards/FK-110-golf-cart.md) | Modern Unveiling: the cart through the ring | Later | B | eng | S | FK-042, FK-102 | — |
| [FK-111](cards/FK-111-kits-badge.md) | Modern beat: Kit's Badge | Later | B | eng | S | FK-046, FK-110 | — |
| [FK-112](cards/FK-112-still-fine-turn.md) | Modern turn: "Still Fine" 1, the rod and the boom | Later | B | eng | S | FK-043, FK-102, FK-140 | — |
| [FK-113](cards/FK-113-wren-signs-on-lots.md) | Modern red job: Wren signs on lots | Later | E | eng | S | FK-047 | — |
| [FK-114](cards/FK-114-rising-staging.md) | The Rising 1: staging and ONE SEAT (C1–C2) | Later | B | eng | S | FK-042, FK-103 | — |
| [FK-115](cards/FK-115-rising-count.md) | The Rising 2: the honest count and the sides lower third (C7) | Later | C | eng | M | FK-114 | — |
| [FK-116](cards/FK-116-endings.md) | The Rising 3: endings A and C | Later | B | eng | S | FK-039, FK-043, FK-115 | — |
| [FK-117](cards/FK-117-trial-montage.md) | The trial montage | Later | C | eng | S | FK-093, FK-114 | — |
| [FK-118](cards/FK-118-merge-static-parts-1.md) | Performance 1: merge static build parts | Later | D | eng | M | FK-065 | — |
| [FK-119](cards/FK-119-merge-static-parts-2.md) | Performance 2: smoke material and verification | Later | D | eng | S | FK-118 | — |
| [FK-121](cards/FK-121-depth-of-field.md) | Depth of field for hero shots | Later | C | eng | M | FK-040, FK-136 | — |
| [FK-122](cards/FK-122-tally-carry-over.md) | Tally carry-over across streams | Later | A | eng | S | FK-092 | — |
| [FK-146](cards/FK-146-red-jobs-hall-workshops.md) | Red jobs: the stone hall (Medieval) and workshops (Industrial) | Later | E | eng | S | FK-105, FK-129 | — |
| [FK-147](cards/FK-147-medieval-cast-bits.md) | Medieval cast bits: Oak won't haul for the King; Sir Kit | Later | B | eng | S | FK-038, FK-100 | — |
| [FK-148](cards/FK-148-medieval-age-turn.md) | Medieval age turn: the Steam Engine ribbon and Wren on the palace wall | Later | B | eng | S | FK-100, FK-142 | — |
| [FK-149](cards/FK-149-industrial-age-turn.md) | Industrial age turn: every window lit but the camp's | Later | B | eng | S | FK-101, FK-142 | — |
| [FK-150](cards/FK-150-wasteland-gold.md) | Wasteland gold: the Overseer cordons the rocket pad | Later | B | eng | S | FK-023, FK-103 | — |
| [FK-151](cards/FK-151-names-on-wren-builds.md) | Your name on Wren's builds, and the finale roll | Later | E | eng | S | FK-047 | — |
| [FK-152](cards/FK-152-later-cue-cards.md) | Cue cards and line banks: Medieval to Wasteland | Later | P | product | S | FK-145 | — |
| [FK-153](cards/FK-153-the-offer.md) | Industrial beat: The Offer | Later | B | eng | S | FK-109 | — |
| [FK-154](cards/FK-154-still-fine-2.md) | Modern turn: "Still Fine" 2, the rust and the hatch | Later | B | eng | S | FK-112, FK-140 | — |
| [FK-155](cards/FK-155-rising-trial-speech.md) | The Rising 1b: Friends of the Boss, Wren's speech, Sami's defence (C4–C6) | Later | B | eng | S | FK-114 | — |
| [FK-156](cards/FK-156-ending-b.md) | The Rising 3b: ending B, he abdicates | Later | E | eng | S | FK-039, FK-088, FK-115 | — |
| [FK-181](cards/FK-181-medieval-music.md) | Medieval music and the church bell | Later | S | sound | M | FK-165 | — |
| [FK-182](cards/FK-182-industrial-music.md) | Industrial music and the factory whistle (and Modern's PA call) | Later | S | sound | M | FK-165 | — |
| [FK-183](cards/FK-183-wasteland-music.md) | Wasteland music and the clanged pipe | Later | S | sound | M | FK-165 | — |
| [FK-184](cards/FK-184-rising-sound-1.md) | The Rising sound 1: staging and the count | Later | S | sound | M | FK-114, FK-115, FK-164, FK-171 | — |
| [FK-185](cards/FK-185-rising-sound-2.md) | The Rising sound 2: the three endings | Later | S | sound | M | FK-116, FK-156, FK-184 | — |
| [FK-186](cards/FK-186-trial-motifs-march.md) | Trial motifs and the Friends of the Boss march | Later | S | sound | S | FK-117, FK-155, FK-164, FK-176, FK-181, FK-182, FK-183 | — |

### In progress
| Card | Title | Milestone | Lane | Discipline | Size | Depends on | Owner |
|---|---|---|---|---|---|---|---|
| [FK-001](cards/FK-001-story-switch-and-contracts.md) | Story switch and save contracts | M1 | A | eng | M | — | lane A agent, 2026-10-24 |
| [FK-003](cards/FK-003-design-pipeline-repair.md) | Design pipeline repair | M1 | X | design | S | — | lane X agent, 2026-10-24 |

### Review
| Card | Title | Milestone | Lane | Discipline | Size | Depends on | Owner |
|---|---|---|---|---|---|---|---|
| [FK-065](cards/FK-065-stats-overlay.md) | Stats overlay (?stats=1) | M2 | D | eng | S | — | lane D agent, 2026-10-24 |

### Done
| Card | Title | Milestone | Lane | Discipline | Size | Depends on | Owner |
|---|---|---|---|---|---|---|---|
| [FK-072](cards/FK-072-feed-dedupe.md) | Feed dedupe | M2 | C | eng | XS | — | lane C agent, 2026-10-24 |
| [FK-073](cards/FK-073-stream-1-cue-cards.md) | Stream 1 cue-card lines | M2 | P | product | S | — | lane P agent, 2026-10-24 |

### Blocked / Needs Sami
| Card | Title | Milestone | Lane | Discipline | Size | Depends on | Owner |
|---|---|---|---|---|---|---|---|
| [FK-123](cards/FK-123-wren-kick-account.md) | Wren's own Kick account (Appendix C, smallest version) | Later | E | eng | M | Sami: optional | — |

## Lanes

Five engineering lanes, one sound lane, one design lane and the coordinator run in parallel. A lane is one agent at a time, in its own worktree (except Lane S in M2, which runs a second agent: see the M2 lane order). **Each hotspot file has exactly one owning lane.** Anyone else who needs a change there files a *hook request* of 10 lines or fewer in the card's Log (and pings the owner); the owner applies it the same day. New files belong to the lane that creates them. FK-001 is the one exception: on day 1 it wires the view spreads and the `{t:'show'}` MayorInput into Lane B's city.ts and Lane E's mayor.ts, once, so nobody needs those files for views again.

| Lane | Focus | Owns exclusively |
|---|---|---|
| **A · Show core** | Story switch and contracts, the show runtime, gathering, holds, beat queue, Crowd Mic gate, home spotlights, admin | src/worlds/ai-dudes/{index.ts, sim.ts, state.ts}, src/shared/{dudesTypes.ts, scenes.ts}, src/worlds/ai-dudes/story/{view,show,spotlight,gather,beats,crowd}.ts, client/admin/*; after M1 also src/worlds/ai-dudes/placement.ts (FK-078) |
| **B · Story and cast** | Cast, Folly site, story scenes, rallies, the Intro, age turns | src/worlds/ai-dudes/{caravan.ts, city.ts, crier.ts, talk.ts, damage.ts}, src/shared/{storyMap.ts, storyScenes.ts}, src/worlds/ai-dudes/story/{cast,folly}.ts; in M1 also src/shared/city.ts, placement.ts and relayout.ts (handed over after M1) |
| **C · Stream client** | UI base, Board, show HUD, prompt tiles, cameras and shots, holds client, river and smoke; the sound trigger call sites in main.ts (Lane S's hook requests) | client/dudes/{main.ts, index.html, environment.ts, effects.ts}, new client/dudes/{board,show,camera}.ts, src/shared/storyShots.ts, client/dudes/fonts/*, scripts/build-client.mjs |
| **D · World look** | Side markers, Folly look, cast looks, pets, the camp, Wren's sign, outlines, story colours, movers, birds, stats overlay | client/dudes/{dudes.ts, objects.ts, primitives.ts}, new client/dudes/{storyProps,camp,life,stats}.ts, src/worlds/ai-dudes/{movers.ts, blueprint.ts, fixtures.ts}, src/shared/ages.ts |
| **E · Operator and jobs** | Head prep, /mayor strip and keys, autopilot, Board data, sides, red jobs and the ask engine, THE WONDER, crier story lines; layout grid cards after M1 | src/worlds/ai-dudes/mayor.ts, client/dudes/operator.ts, src/worlds/ai-dudes/story/{board,sides,jobs,crierStory}.ts; after M1 also src/shared/city.ts and src/worlds/ai-dudes/relayout.ts |
| **S · Sound** | The speech-blip guard, the sound board (/sounds) and Approve, the offline render and level checks, the mix director and scene cues, age music and beds, story scoring, UI and pet sounds, the OBS check | client/dudes/audio.ts (from Lane C), client/dudes/audio-approved.json (written only by Sami's Approve), new client/sounds/**, scripts/audio-*.{ts,mjs} and scripts/audio-*.test.ts, docs/audio-levels.md, and the new files it creates (e.g. client/dudes/{mix,cues,music,voices}.ts, src/worlds/ai-dudes/audioApproval.ts) |
| **X · Design** | Pipeline, boards, HUD and /mayor mocks, cast, Follies, props, prompt tuning, design reviews | design/** (astra.ts, render*.mjs, catalogue.ts, spec/**, hud/**, out/spend.jsonl), src/shared/ageBibles.json, src/worlds/ai-dudes/design.ts |
| **P · Coordinator** | Board, worktrees, demos, restarts, Sami; the line data and idle bits (FK-060, FK-073, FK-145, FK-152) | board/**, src/worlds/ai-dudes/story/{lines,idle}.ts |

**Lane S · Sound** (added 2026-10-24). Sami: "The audio and music is very important in all of this. Please ensure the team have sufficient resources to keep this working. The noises as people speak right now are fantastic and I love them." The audio lead's audit and plan are in [audio-plan.md](audio-plan.md): FK-157 to FK-186 are its cards A1–A27, and the story sound cards FK-126, FK-135 and FK-140 moved here from Lane C. Lane C keeps the trigger call sites in main.ts, so Lane S files hook requests of 10 lines or fewer there like everyone else. Every S card is reviewed by ear: after the coordinator's rebuild, Sami plays it on :4600/sounds and clicks Approve. Agents can't hear, so they prove their work with tests (the voice golden, cue fingerprints, mix tables), the offline render and docs/audio-levels.md. The speech-blip rule (Ground rules) binds every lane, not only S.

**Known hook requests** (the owner applies them):
- into index.ts (A): the side words in hear() and the newcomer branch (FK-012); `name-daughter` refuses with Story ON (FK-128); pausing troublemakers during scenes at tickEvents (index.ts:2050); the restyle order (FK-049 is A's own); `wonder-open` and every other Story (dev) button.
- into sim.ts (A): the STORY_SITES rects in reserved() (FK-023). Into scenes.ts (A): the shot re-check (FK-079).
- into caravan.ts (B): the story guard in tickCaravan (FK-127); `storyOpenVisit` at the top of openVisit (FK-129); the bridge path (FK-078). Into crier.ts (B): FK-059's join, premise and Call posts; the side reply export (FK-012). Into city.ts (B): townsfolk freeze (FK-032). Into story/cast.ts (B): Oak under the sign (FK-125), idle-bit positions (FK-060).
- into main.ts (C): skip cinema() for streamOnly on /mayor (FK-057), the sepia class (FK-043), park trees off the Folly plot (FK-023), mount storyProps (FK-125) and stats (FK-065). Into environment.ts (C): hide the far-bank camp while Story is ON (FK-132), the bridge lane (FK-076), far-bank trees (FK-079).
- into dudes.ts (D): overlayPass through the active camera (FK-040), landed before FK-055 changes the same function.
- for Lane S: into main.ts (C): the shot `sound` and the Call-banner bell (FK-126; after FK-021 lands, before FK-026), one call each for the mix director (FK-163) and the cue track (FK-164), the approved cast voice table in seedOf (FK-173), and the UI sound triggers in board.ts / show.ts (FK-171). Into scripts/build-client.mjs (C): the /sounds entry and page (FK-159). Into index.ts (A): the `audio-approve` admin action (FK-160). Into scenes.ts (A): the shot `sound` / `sounds` field (FK-126, FK-164). Into operator.ts (E): a voice key, only if Sami asks for one (FK-162). package.json (coordinator): the `audio:check` script line (FK-161).
- into mayor.ts (E): export headLook (FK-043); restyles keep `moves` / `creature` / `follows` and append `past` (FK-049, at mayor.ts:411-414). Into shared/city.ts (E, after M1): RIVER (FK-078).

**M1 day plan** (each card starts only when its dependencies are Done; drafts against FK-001's field list are fine before it lands):

| Lane | Day 1 | Day 2 | Day 3 | Day 4 | Day 5 | Day 6 |
|---|---|---|---|---|---|---|
| A | FK-001 | FK-002, FK-017 | FK-017, FK-018 | FK-019 | FK-127, FK-028 | hooks, support |
| B | drafts (cast table, Folly constants) | FK-014 | FK-023 | FK-128, prep FK-025's scene data | **FK-025 Unveiling** | **FK-026 Rally** |
| C | FK-009 | FK-010 | FK-021 (+ S's build-client hook) | FK-022, FK-124 (+ FK-126's trigger hook) | FK-040 (`?persp=1`) | FK-029, S's hooks |
| D | FK-065 | FK-013, FK-027 | FK-027 (+ fixture pets) | FK-024 (+ `?demo=folly`) | FK-016, FK-125 | polish from FK-030 |
| E | drafts (Board data) | FK-020, FK-011 | FK-011, FK-012 | FK-012, FK-015 | layout: FK-075, FK-077 if file ownership allows (else M2: FK-129, unit tests first) | M2: FK-129 (unit tests first, then the demo check), FK-047 |
| S | FK-157 (the guard, first), FK-158 | FK-162; FK-126 once FK-001 lands | FK-159 (/sounds) | FK-160 (Approve), FK-161 | FK-161 | Sami's audition on /sounds (FK-031), fixes |
| X | FK-003, FK-004, FK-005 page | FK-005 critique, FK-006 | FK-007, FK-008 | (Sami picks), FK-137 | FK-030 | FK-030, FK-138 |
| P | commit board/, worktrees, check-ins, FK-073 | client-only check-in | first restart | restart | restart | restart, FK-031 (day 6–7) |

Critical path: FK-001 (day 1) → FK-017 (day 3) → FK-019 (day 4) → FK-025 (day 5) → FK-026 (day 6) → FK-031 (day 6–7). FK-025 also needs FK-022 and FK-124 (Lane C, day 4) and FK-024 (Lane D, day 4). Lane S runs beside it from day 1, off the critical path: FK-126, which FK-026 needs on day 6, lands on day 2, and FK-031 needs the six M1 sound cards (done by day 5).

**Layout cards in M1:** none of M1 waits on the layout, and M1 keeps its provisional SE-corner-park story sites. Lane E is lightly loaded in M1, so it may start FK-075 and FK-077 as soon as their dependencies and file ownership allow (Lane B hands over src/shared/city.ts once its M1 edits there have landed, or a ≤10-line hook), as long as that never delays the M1 critical path. FK-078 waits for Lane A's M1 cards.

**M2 lane order** (engineer-days in brackets). The layout cards go **first** in each lane (Sami approved A+ on 2026-10-24), because every story site moves with them:
- **A** [6]: layout FK-078 → FK-035 (next: it unblocks B, C and S) → FK-037 → FK-133 → FK-053 → FK-054 → FK-056 → FK-049.
- **B** [6]: layout FK-079 (as soon as FK-078 lands; FK-033 meanwhile) → FK-033 → FK-043 → FK-044 → FK-045 → FK-048 → FK-046 → FK-057.
- **C** [5.75]: layout FK-080 (as soon as FK-075 lands) → FK-136 → FK-041 → FK-036 → FK-042 → FK-134 → FK-131 → FK-050 → FK-062 → FK-072; plus Lane S's trigger hooks.
- **D** [6]: FK-032 → FK-052 → FK-051 → FK-132 → FK-055 → FK-063 → FK-064 → FK-067 → FK-069 → FK-066 (C may take FK-066 if D is behind).
- **E** [6.5]: layout FK-075 → FK-077 → FK-076 → FK-081 (after FK-080; FK-129 meanwhile) → FK-129 → FK-047 → FK-130 → FK-059 → FK-038 → FK-039 → FK-058 → FK-061. FK-075 and FK-077 may already be done in M1.
- **S** [9.75, on two agents]: **S**, scenes and mix [6.25]: FK-135 → FK-171 → FK-163 → FK-164 → FK-167 → FK-168 → FK-170 → FK-169. **S2**, music and voices [3.5]: FK-165 → FK-166 → FK-173 → FK-174 → FK-172 → FK-175 (with Sami).
- **X**: FK-034, FK-137, FK-138, FK-068, FK-070, FK-071, then FK-139 before the rehearsal.
- **P**: FK-073, FK-060, FK-074.

**Sound gets two agents in M2.** Sami asked that the team have sufficient resources to keep the audio working, and Lane S carries about 9.75 engineer-days in M2 against M2's ~7. So at the start of M2 the coordinator starts a second Lane S agent, **S2**, in its own worktree (/home/sami/workspace/fk-wt/s2, branch fk-s2, no port, set up like the others), on the music-and-voices track; the first agent keeps the scenes-and-mix track and owns audio.ts. S2 puts its code in new files (client/dudes/music.ts, voices.ts) and asks S for hooks of 10 lines or fewer in audio.ts, so the two never edit the same file on the same day; never two agents on one card. If S2 can't start, S runs one queue (FK-135 → FK-171 → FK-165 → FK-163 → FK-164 → FK-167 → FK-168 → FK-174 → FK-170 → FK-169 → FK-175 → FK-166 → FK-173 → FK-172) and the sound cut order under M2 applies.

**M3 lane order** (Lane S; the other lanes' M3 orders are set at the M2 review):
- **S** [4.25]: FK-140 → FK-176 → FK-177 → FK-178 → FK-179 → FK-180. **Later:** FK-181 → FK-182 → FK-183 → FK-184 → FK-185 → FK-186 (rebalanced at the M3 review like every Later card).

## Decisions

Sami's answers, recorded by the coordinator on 2026-10-24.

1. **Layout question 3 (the camp): DECIDED 2026-10-24: yes.** The band's old camp moves to the town bank of the river (while Story is ON the far-bank camp is hidden, FK-132). FK-043, FK-044, FK-056 and FK-132 are unblocked and in Backlog.
2. **How the land is laid out: DECIDED 2026-10-24: A+ approved, with the river moving east** (not the east-block variant; [layout-options.md](layout-options.md)). The layout cards FK-075 to FK-081 are unblocked: FK-075, FK-077 and FK-078 have no card dependencies and are Ready (gated by file ownership, see the note under Ready); FK-076, FK-079, FK-080 and FK-081 are in Backlog. M1 keeps its provisional SE-corner-park story sites, because nothing in M1 waits on the layout. In M2 the layout cards go first in each lane's order, because every story site moves with them (FK-079 moves `STORY_SITES` to the River Bank). A lane that is lightly loaded in M1 (Lane E) may start its layout cards as soon as their dependencies and file ownership allow, as long as that never delays the M1 critical path.
3. **Design spend: DECIDED 2026-10-24: a programme cap of $245 is approved**, by the overseer on Sami's behalf (Sami asked for the astra design work). That is $70.95 of new spend on top of $171.92 = $242.87 planned (M1 ~$10.50, M2 ~$15.45, M3 ~$13.50, Later ~$31.50), about $40 of it before stream 2. Each run still raises `DESIGN_BUDGET_USD` only to spend-so-far + that card's ceiling.
4. **The stream HUD in story mode: DECIDED 2026-10-24: yes.** With Story ON the Board and its ticker replace the invite panel, the feed and the caravan panel on stream, and the !play line moves to the ticker (FK-009, FK-010, FK-011). Sami may overrule it after seeing it.
5. **Restarts: DECIDED 2026-10-24.** Sami: 4600 is a test world only he uses and all its chat is fake ("don't worry about interruptions"). The coordinator may restart `town` at any check-in, with no off-air window, and still copies the save first; `test-` names and the clean-up are preferred but not critical (Ground rules → Restart rule, Test names). Only the coordinator restarts `town` and rebuilds `public/` on main.
6. **Demo ports: DECIDED 2026-10-24.** Sami looks only at 4600 ("You can do everything on main and on 4600"). Lanes use their demo ports (4611–4616) for their own testing; every check-in for Sami is on 4600.
7. **Tunnel files: DECIDED 2026-10-24.** They are committed (958e6fd) and running. "Hands off" is relaxed to "avoid unless a card truly needs a small additive change", with scripts/server-safety.test.ts green and the tunnel and guard behaviour never changed; still no new npm dependencies or env vars without the coordinator (Ground rules).
8. **Sound: DECIDED 2026-10-24: a sound lane.** Sami: "The audio and music is very important in all of this. Please ensure the team have sufficient resources to keep this working. The noises as people speak right now are fantastic and I love them." Lane S owns audio.ts and the sound board; the speech-blip rule protects the blips (Ground rules); every sound card is reviewed by Sami's ear on :4600/sounds and his Approve; Lane S gets a second agent in M2 (Lanes → M2 lane order).
9. **Later, optional: STILL OPEN.** Wren's own Kick account (FK-123, Appendix C), only if Sami wants to create the account. It stays in *Blocked / Needs Sami*.

**Decided by the coordinator unless you object:**
- **The Crossing waits for your GO** like every other story beat (it has your "Mind the floor. It's new." line); on Autopilot it fires 60 s after it arms. Story OFF keeps today's automatic Crossing (FK-133).
- **Home cards:** your home is spotlighted on your first line in a new age, and the top 3 after Moss's "Previously". Not at the age turn, because stream 1 ends there and viewers have gone (FK-049, FK-050).
- A second pet request turns your pet into the new ask (still one pet, never refused).
- Name clashes renamed: townie "Wren", Minstrel Wren, Ashur the Boatman, Mr Ashby, Road Boss Mara, and Oak Street → Alder Street.
- The head never wears red (the King's shirt and cape, the Mayor's propeller hat) and wears a gold sash in every age; story red and gold no longer drift with the age palette.
- Chatter name tags are 40 px on stream, the one exception to the 54 px rule (a name identifies, it doesn't instruct). Fonts: Fredoka and Nunito.
- In M1 the head is snapped to his mark at a Call; from M2 he walks there.
- The stream-1 Folly fills on its 40-minute timer only; `gold` sets your side and puts your name on the plaque (gold shifts and wages come in Bronze, FK-096).
- The in-game design prompt changes (FK-070) ship only after you see the A/B board.

## Conflicts resolved

| Topic | Reports said | Decision |
|---|---|---|
| Hold mechanics | Bible: push `sc.at`, no protocol change. Eng: the client keys scenes by `${id}:${at}` (main.ts:716), so that re-seeds every shot. | Eng (code facts): `shift` + `heldAt` fields, client maths in FK-036. |
| Where story coordinates live | PM: `STORY_SITES`. Eng: server `story/geo.ts`. Scout: `src/shared/storyMap.ts`. | `STORY_SITES` in **src/shared/storyMap.ts**: the client draws the camp and cordon too, so it must be shared. |
| The Folly plot | PM/bible: "a riverside plot in reserved()". Eng: reserved() (sim.ts:34) is in-progress build rects, not a plot registry. Scout: add story rects to reserved(). | Both: the plot is modelled on wonderLot (shared/city.ts:105), and the STORY_SITES rects also join reserved() while Story is ON so off-lot builds can't land there (FK-023). |
| Layout before M1? | Eng: the layout decision must land in the day-1 contracts. PM: only the Folly waits on it. | Neither blocks M1: it uses a provisional site in the SE corner park. Sami answered Q3 (yes, the camp moves to the town bank) and approved A+ with the river moving east on 2026-10-24. |
| Bridge "intact" | PM: an `intact` state in drawBridge. Eng: the client already draws it whole when `bridge` is absent; it's a server flag. | Eng: `city.story.bridgeIntact` (FK-033). |
| Second pet request | PM: refuse ("You already have Rex"). Eng/motion: replace. | Replace (FK-028): the toy must always work. |
| Pet follow distance | Eng 1.6 m at 1.2×; design 1.2 m behind-left; motion: along the owner's path. | Design's 1.2 m behind-left, motion's breadcrumb path, eng's 1.2× speed and 30 m teleport (FK-027). |
| How pets age | Sami: restyled per age like builds. Design: no-LLM accessory kits. | Restyled like builds (FK-049 keeps `moves`/`creature`/`follows` through the restyle at mayor.ts:411-414); the accessory kit is the instant fallback (FK-051). |
| Pet data field | Eng `creature.follows`; motion `o.pet = {owner}`. | `creature.follows` (FK-001). |
| Head to his mark | Bible/PM: auto-walk. Eng: the server can only snap him today. | Snap in M1 (FK-020), walk in M2 (FK-061). |
| Amplification moderation | Eng: a fail-closed wrapper passed in through the world's options. | That would edit src/index.ts (Sami's file): import src/llm/moderate.ts directly in story/crowd.ts with its own timeout (FK-054). |
| Bird cadence | Motion: every 45–90 s. Design: every ~2 min. | Every 60–120 s (Sami: "don't overdo it"); full budget in motion-budget.md. |
| Card sizes | PM's M was ~1 day; eng's and the bible's M was "a few days". | Every card ≤ 1 engineer-day; the perspective camera, Intro, Last Light, Rising, show runtime, cast, Verdict, Still Fine and Industrial beats are split. |
| Design budget | PM 195, eng ≥ 190, motion 185, design 240 cap. | One rule: per run, spend so far + the card's ceiling; programme cap $245 after the critic's additions (approved 2026-10-24). |
| The tunnel files | Brief: uncommitted. Repo: committed in 958e6fd ("not rolled out"). | Committed and running. Relaxed 2026-10-24: avoid them unless a card truly needs a small additive change; scripts/server-safety.test.ts stays green; never change the tunnel or guard behaviour (Ground rules). |
| One tree or many | First plan: all lanes in the main checkout, one demo port. Critic: that ships half-finished client code live. | One worktree, port and data dir per lane; only the coordinator builds `public/` in the main checkout. |
| How story scenes reach the page | Critic: Lane A widens the type, Lane B emits through townView, Lane C reads a registry. | FK-001 widens the type and spreads `storyTownView` once; FK-017's `showView` emits; FK-124 reads `STORY_SCENES`. Lane B's city.ts is untouched. |
| Side words | First plan: `red`/`gold` in crierCommand. Critic: `COMMAND` only matches `!` commands (crier.ts:298). | Whole-message match in hear() and the newcomer branch (FK-012). |
| Who owns sound | First plan: Lane C (audio.ts) with three small sound cards. Audio lead: a sound lane, a guard on the blips and a sound board, because agents can't hear. | Lane S owns audio.ts and every sound card (FK-126, FK-135, FK-140 moved; FK-157 to FK-186 added); Lane C keeps the trigger call sites in main.ts (hooks of 10 lines or fewer). |
| How /sounds is served | Audio lead: a local-only route in src/server/http.ts. Ground rules: avoid src/server/**. | A static page: build-client.mjs (Lane C hook) writes public/sounds/index.html, which the existing `express.static` serves; Approve is an admin action through /admin/api's operator guard (Lane A hook into index.ts). |
| The U7 drop | FK-135: duck every game sound to silence. Audio lead: hard-cut the music to wind and river; her line plays dry. | The audio lead: voices are never ducked (speech-blip rule), so FK-135's drop cuts music and effects only. |

## Notes

The critic's 24 fixes are all applied; none is rejected. Where a fix was applied differently from how it was written:
- **Fix 2:** no Lane B card for emitting the scene: FK-001's one-time `storyTownView` spread plus FK-017's `showView` do it, so the new card (FK-124) is Lane C only.
- **Fix 3:** THE WONDER is two cards (FK-130 server in Lane E, FK-131 client in Lane C), one per owning lane.
- **Fix 8:** FK-076 and FK-078 also left Lane B, because they edit the files handed over after M1. placement.ts goes to Lane A with FK-078 rather than to Lane E, which would otherwise carry about 8 days with the layout. FK-059 went to Lane E (new file story/crierStory.ts); FK-060 went to the coordinator, who owns the line data. FK-084, FK-105 and FK-113 followed story/jobs.ts to Lane E.
- **Fix 10:** FK-040 is split: the camera and `?persp=1` moved to M1 (Lane C, day 5); the refit is FK-136 in M2.
- **Fix 15:** the crier's Kick post at each Call is folded into FK-059 rather than a card of its own. Sounds are three cards by milestone (FK-126 M1, FK-135 M2, FK-140 M3); all three moved to Lane S on 2026-10-24, next to the audio lead's 30 cards.
- **Fix 18:** FK-093 kept the look (Lane D) and FK-141 took the decision (Lane E).
- **Fix 23:** FK-070 runs 15 builds per arm and stays inside its $5 ceiling, rather than raising it to $9.
- **M1 now takes 6–7 working days, not 5** (fix 9): the Unveiling lands on day 5 and the Rally on day 6, because FK-019, FK-022, FK-024 and FK-124 only finish on day 4. Sami has been told in the summary.
