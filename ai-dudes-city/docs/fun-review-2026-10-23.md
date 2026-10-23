# ai-dudes-city — fun review, 2026-10-23

Five reviewers, after the bug/UX fixes landed: phone lurker, active chatter, /play pilot, systems designer, and a simulated playtest (headless, fixture agents, 4 × 2 h runs at 5 and 25 chatters — `scripts/playtest.sim.ts`).
Sizes: S ≈ an hour or two, M ≈ an afternoon, L more. ×N = independently proposed by N reviewers.

## The diagnosis

- **It's a great toy, not yet a game.** Typing feels fantastic for a minute (your words in a bubble at once, a build in your style in ~35 s, nonsense becomes a bit). Then nothing pushes back: every request succeeds the same way, builds are free, coins buy almost nothing, there's no risk, no choice that costs anything, nothing to compete over.
- **No conflict engine.** Every system is cooperative and guaranteed to succeed. Combat, relationships, troublemakers and coins sit in silos — none of them feeds the caravan or each other in a way anyone can see.
- **Payoffs are too far apart.** Big set pieces (opening, age turn, finale) land every 1.5–2 h; a 30-minute phone viewer can miss every one. At 5 chatters, 51–69 of 120 minutes sit inside ≥60 s quiet gaps.
- **The good stuff happens off-camera.** Auto-frame deliberately skips troublemakers and monsters; the crier's best lines go only to Kick chat; pilots look like every other dude, so chat can't react to them.
- **Pacing bugs (measured).** From the Bronze Age on, "Feed N travellers" stalls 31–64+ min (3 of 4 runs never finished it). At realistic pace the six ages take ~6–12 hours of stream.

---

## 0. Pacing fixes first (from the playtest — all S, all tuning)

| Problem (measured) | Fix | Refs |
|---|---|---|
| **Feed-the-travellers stalls.** Travellers only eat at a food place built *after* the visit opened, one each; Bronze+ asks 1 new place but 4–8 fed. 45-min trim cuts to 2/3 once. | Free travellers visit any food place every 30–60 s (prefer new ones), or cap fed at places-built + 2. Expected: visit 1 → 6–10 min at 5 chatters, 1–4 at 25. | `city.ts:1136-1151`, `caravan.ts:114,136` |
| **Wonder blocked/slow.** Chat projects cost §205–555, only 2 of 9 opened; a failing one blocks the Wonder up to 40 min. | Shelve + refund chat projects when the Wonder visit opens; chat-project cost ≈ `60+10×awake`; a share of each visit payment flows to the open project. | `city.ts:767-769,792`, `projectMs` |
| **Dead air in small towns; idle turns ~never fire.** Gate needs 3 min with no turn; talk/nudges keep everyone under it. Troublemakers fixed 4–7 min, 5 victims, regardless of size. | Idle gate 90 s; troublemaker victims `1+awake/2` (cap 5); favour harmless kinds (thief, decree) under 8 awake. | `index.ts:1018-1021`, `events.ts:18,20` |
| **Repetition.** Leader's "We still need…" ~every 40 s (33–62×/run, same text for 30 min); gossip has no cooldown ("could do with a park" 15–23×). | Remind only when a number changes or every 3 min; 10-min per-line gossip cooldown. | `city.ts:1160-1162,1292` |
| **Economy.** Small towns inflate (mean §150→§337–411); big towns concentrate (Gini 0.51–0.61, one owner §1908). | Price Wonder/projects off town coin total, not awake count; skim very rich owners into the pot. (Section 2's coin sinks do the rest.) | `city.ts:46-75,781` |
| Design budget near-empty ~22 min/run at 25 chatters; restyles compete. | Fine for now; revisit after builds cost coins (fewer design calls). | `budget.ts` |

---

## 1. Make the story land more often (watchability)

**Close every visit with a scene** — S–M. ~10 s: leader walks to the place that did most, names the top helper, confetti; on visit 2 the specialist settles in town; end card "Next: the Furnace". Payoff every ~25 min instead of 1.5–2 h; reuses the scene system. *Lurker's #1.* `shared/scenes.ts` (new `visitDone`), `caravan.ts` `complete()`, names from `crier.ts:179`.

**Frame the trouble** — S. Extend `autoFrame`'s party rule: include the active troublemaker + its target, a rampaging monster, a fresh collapse. Framing only — not the parked director. `client/dudes/main.ts:224-246`.

**Visible impatience** — S. Leader's nag lines as his own bubble on the square, pose escalating: foot-tap → sitting on luggage → asleep; jumps up when someone helps. No fail state. `crier.ts:270-290`, `caravan.ts` ~201.

**Running-gag titles** — S. The world hands out titles that stick until the agent picks a new one: "flattened by a T-rex ×2", "Gary's favourite canvas", "busiest café in town". `events.ts` (decree/vandalise), `movers.ts` rampage, `combat.ts` knockOutNpc, tag at `dudes.ts:1636`.

**Wonder blueprint all age** — M. Ghost/scaffold of the age's Wonder in its spot from the first visit, filling in as asks are met — a goal you can see from the first minute. `proposeWonder`, `leaderProposesWonder` (`caravan.ts:213`), render at `WONDER`.

**The daughter wanders and picks a favourite** — M. Ama strolls between visits, stops at builds with template reactions, picks a favourite per age (seeds the relic). Attachment + a viewer stand-in. `caravan.ts` traveller stroll, candidates like `crier.ts:400`.

---

## 2. Give it stakes and conflict (the "actually a game" part)

**Builds cost coins — on credit** ×2 — S. First build on your own lot free; after that §30–120 by kind/size. Never blocked: you build anyway and carry a **debt** on your tag, paid first from visitor payments and wages. `!top` gains "deepest in debt". Coins finally mean something; shifts, travellers and visiting friends become ways out of debt; fewer $0.10 design calls. *"Kev built a six-storey club in the Stone Age and is §180 under. Chat starts going to Kev's club to bail him out."* `index.ts:747` (charge; refund on failed design), `city.ts` `TOWN`/`pay()`, `Dude.debt` in `state.ts`.

**Café wars / feuds** ×2 — S. Two triggers, both from data already kept:
- *Trade war:* same-kind places (or neighbours) trade the visit lead → crier announces a 15-min war, banner score, owners set price ("make my pizza cheap" / "go upmarket", one field per build); price shifts `bestPlaceFor`; loser gets a SALE sign, winner a sign on the lot.
- *Feud:* A hits B (or B's builds) 3× in 10 min, or warmth < −4 → crossed swords on both tags, "FEUD: @bob vs @sara", score on the KO board; ends with a `greet` handshake (badge) or 20-min timeout. Unprompted turns may taunt, never attack.
*Chatter's #1.* `city.ts` `bestPlaceFor` (:353), `pay` (:511), `warmth`/`tiesForAgent`, `talk.ts` `idleHook` rival block, `crier.ts` new `tickFeud` beside `tickSpotlight` (:400).

**Fork the visits** — M. Visits 1 and 2 open with two rival petitioners (court's feast vs Master Wick's smithy). First ask met wins and settles; the other leaves **for the age** (no jester all Medieval, and the crier keeps mentioning it). Losing-side deeds still count for heroes. Wonder visit stays shared. Chat splits into camps; board is a tug-of-war; Twitch-Plays vote decided by actions. *Systems designer's #1.* `CARAVANS` data (pair problems/specialist), `asksFor`/`openVisit`/`complete`, `caravanView`/board in two columns, `crier.ts` running score per side.

**Raids on the open ask** ×3 — M. Replace the troublemaker clock (when it fits) with a storyteller beat: when an ask is >50 % done, ≥4 chatters around, not in a scene/party, at most once a visit, the age's raiders cross the bridge for the ask itself (knock the project bar back ≤15 % or steal shifts). Dudes, pilots and the Mayor fight; boss with a health bar in the banner; defenders get a "held the gate" deed. Combat finally serves the story; the caravan gets risk; the clip magnet. *"Scavengers hit the Scrap Rocket at 80 %. Nine dudes and the Overseer's rocket launcher drive them off."* `events.ts` new `raid` kind, `combat.ts` (unused `'boss'` target kind), `caravanSaw` decrement, `CRIER.deed` + `defend`, `DAMAGE.civicFloor` stays.

**Troublemakers with grudges** — S–M. Remember who chased each kind off and how many visits; next time it goes for that dude's builds first ("You again, Bob."), escalates on visit 3 (bigger brush, two friends); banner tally "Ochre Ug, 4th visit · 17 builds repainted". `events.ts` `startHappening` (~186), `combat.ts` knockOutNpc, small per-kind record in `state.ts`.

**Projects compete; only the winner is designed** — M. `proposeProject` stops refusing: up to 3 text-only pitches; first to §X (or leader after 5 min) gets the design call and ghost; others refunded. Real vote with a cost; saves Opus calls. `city.ts` `proposeProject`/`contribute`/`townBanner`, design pump in `index.ts`.

**Wonder naming rights** — S. Top coin contributor's name goes on the Wonder ("Dana's Furnace"); banner shows who leads; it survives as a keepsake. Bidding war at the climax; big coin sink once builds cost coins. `contribute`, `completeProject` (`city.ts:999`), `clearWonderSpot`.

---

## 3. Personal hooks for chatters

**Lucky rolls** — S. ~1 build in 12 is **Legendary** (gold sparkle, crier shout, double pull); ~1 punch/bit in 15 **backfires** (slip, upside-down sign). `!lucky` on `!me`. The Marbles-style "same input, different result". `index.ts` ~1030-1050 (build lands), `bits.ts` `startBit`/`hit`, `combat.ts` `startAttack`, `addEffect`.

**Talk of the town → relics** — M. Count chat lines naming a build (one per speaker per build per minute); top 3 on the board; winner gets a plaque and becomes the age's relic (look kept forever). Nightly "Build of the stream" so the payoff isn't 2 h away. A reason to DM friends. `index.ts` `hear` (~1118), `crier.ts` `crierAgeTurned`, `main.ts` board (:843), `badges.ts`.

**`!race`** — M. Every ~20 min (or /admin) a 60 s sign-up; everyone who types `!race` lines up and sprints to the fountain with random speed/stumbles/shortcuts; top 3 win coins + trophy badge. One word to take part, zero model calls — the Marbles moment for a 100-person chat. `crier.ts` `COMMAND`/`crierCommand`, `sim.ts` `walkTo`, a scene, `badges.ts`.

**Errand + streak** — M. One checkable personal errand per stream on `!me` ("get 5 visitors", "work 2 shifts at a neighbour's", "be at a party"); pays coins and builds a cross-stream streak shown on the tag. `crier.ts` `credit`/`commandAnswer`, `Dude` field, `welcomeBack`.

**Singled-out asks** — S–M. The leader names one active chatter (favouring new/quiet ones) for a personal ask on the board under their name; passes on if they go quiet. Already designed in `ages.md`. New ask kind with `who`, `talk.ts` `askHook`, @mention in crier.

**Party score** — S. Parties score by attendance (chatters ×2) and dancers; crier ranks "biggest party of the age"; friends' dudes lean toward going. `city.ts` `throwParty`/`tickParty` (:1060/:1070).

**Neighbourhood teams** — M. The four home blocks are teams; deeds credit your block; the block that wins the age flies its banner. `shared/city.ts` `blockKey`/`districtsOf`, `crier.ts` `credit`.

---

## 4. /play: give pilots something to aim at

**Pilot spotlight** — S. *Do this before any other pilot work.* Distinct ring + "playing" tag on stream; big moments (build felled, monster spawned, tank out, KO streak) get a 4 s callout above the feed. The `piloted` flag already reaches the client (`index.ts:1489`) and is only used for interpolation (`main.ts:1061`). Chat can't react to what it can't see. `dudes.ts` tag, `main.ts` `hud()` (:620), `damage.ts` fell, `combat.ts`.

**Mayhem score + combo** — S–M. Points for damage/felled/KOs/monsters downed (and for fixing/building, so builders compete); hits within ~3 s chain a multiplier on the /play HUD; stream board becomes "Top wreckers / builders tonight". `combat.ts` `score()` (:62), `damageBuild`, `ScoreRow` (`shared/dudesTypes.ts:262`), `player.ts` HUD.

**Chain reactions + front-loaded juice** — S. A collapse does a `blast()` around its footprint (one level of chaining, credited to the feller); non-linear crumble `step = floor(sqrt(1-hp/max)*steps)` so first hits visibly chip; small screen shake on your own rocket landing (/play only). `damage.ts`, `weapons.ts` `blast`, `effects.ts`.

**Rocket KOs launch the victim** — S. Client-only arc + spin before landing flat; victim's /play shows "LAUNCHED 11 m". Getting hit becomes funny instead of a time-out. `combat.ts:80` (add `from`), `effects.ts` ko, `dudes.ts` lie pose.

**WANTED + bounties** — M. Fell 2 builds in 60 s → star over your head on stream and a §bounty; whoever KOs you (pilot, Mayor, a victim's agent nudged "X is wanted, §60") collects. GTA heat; victims get revenge with a payoff; PvP starts itself. `damage.ts` tally, `combat.ts` `knockOut` (:69), `events.ts` nudge.

**Seat missions → badges** — M. On seating, one of ~8 short challenges from the live town (fix 2 neighbours' builds, ram X down with a vehicle, build what the caravan wants, survive 2 min WANTED); permanent tag badge. Avoid visit/work/contribute until "E: interact" exists. `players.ts` Pilot, `index.ts:1251`, `badges.ts`.

**Co-op monster raid** — M. With ≥3 pilots (or /admin) a town-owned kaiju with a big HP bar goes for players' builds; everyone fights; win pays all, crowns top damage. Merge with section 2's raids. `movers.ts:50,206`, `events.ts`, `weapons.ts` per-shooter credit.

**Clock-out recap** — S. End-of-turn card on /play (built, felled, KOs, rank, badge, "join the line again"); feed line "Sam clocked out: 4 felled, #2 tonight"; lifetime stats beside `state.scores`. `play.ts:98`, `players.leave`, `state.ts:806`.

---

## What's already fun — protect it

- Your exact words in a bubble immediately, your agent picks the body; off-menu ideas become bits.
- Builds designed in your persona's style rising in about a minute.
- The model-free needs loop that pays owners `+§5` on screen.
- The set pieces: river opening, age turn, finale. Use them as the template for more, shorter scenes.
- "Nothing bad happens to you while you're away". Keep it while adding stakes, e.g. debt never blocks you and raids only hit open asks.

## Suggested order

1. **Sprint 1, mostly S, about a day:**
   - Section 0 pacing fixes
   - Visit-close scene
   - Frame the trouble
   - Pilot spotlight
   - Builds on credit
   - Café wars and feuds
   - Lucky rolls
   - Running-gag titles

   Then rerun `scripts/playtest.sim.ts` and compare dead air and visit times.
2. **Sprint 2, the conflict engine:**
   - Fork the visits
   - Raids on the open ask (with the kaiju as its /play variant)
   - Wonder naming rights
   - Mayhem score, chain reactions and rocket launches
3. **Sprint 3, reasons to come back:**
   - Talk of the town and relics
   - `!race`
   - Errand and streak
   - Seat missions and WANTED
   - Neighbourhood teams
