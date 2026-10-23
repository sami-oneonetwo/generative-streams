# Ages: the town grows up

Design plan, agreed in conversation on 2026-10-19. Much of it is built now: the ages as data, the river and bridge, the caravan and its asks, the opening, the Wonder on its own spot, the age-turn scene, the arrivals and the finale, and the background restyles (see Slices and "Built 2026-10-23"). Still to build: relics, Supply and Commission asks, the singled-out ask, the ring-shaped wave, per-age signature asks and Operate milestones for Wonders.

## The loop

The town starts in the Stone Age and works its way to the Wasteland (the sixth age, id `future`: a post-apocalyptic town rebuilt from the ruins of the modern one; it was a shiny Future until 2026-10-23). **Each age:**

1. A themed **caravan** camps across the river on the east side of the map.
2. Over **three visits**, its leader brings a **problem** and a **specialist**. The town solves it by building and running things.
3. The last visit's problem is a **Wonder** on the square. When it's built and has done its job once, the age turns.
4. **The wave** rolls out from the Wonder. Every build, resident, road and sky transforms into the next age.
5. The **most-mentioned build** of the age stays as it was, as a **relic** with a plaque (see Relics).

Chat sets the pace; nothing runs on a timer. After the Wasteland, Sami resets the world from /admin.

| # | Age | Caravan | Wonder (the bridge to the next age) | The river bridge |
|---|---|---|---|---|
| 0 | Stone | Mammoth herders | The furnace: first bronze tools | Log bridge |
| 1 | Bronze | River traders on barges | The Keep | Stone arch |
| 2 | Medieval | A travelling court: knight, jester, minstrel | The steam engine | Drawbridge gate |
| 3 | Industrial | Railway barons, arriving by train | The power station | Railway viaduct |
| 4 | Modern | A coach of tourists | The launch tower | Motorway bridge |
| 5 | Wasteland | A scrap convoy | The scrap rocket (the finale) | Scrap bridge |

## Builds transform; they're never rebuilt

A build keeps its owner, lot, name, venue kind and footprint across ages. Only its blueprint changes. Bob's rock skyscraper becomes his brick tower, then his steel one.

- **Each age is a style sheet as data** (`src/shared/ages.ts`):
  - palette and material families (which colours a build's parts map to);
  - ground, road, sky and fog colours;
  - outfits for dudes and residents;
  - the bus (a mammoth sledge, then a horse cart, chariot, steam tram, coach and armoured scrap bus);
  - what each venue kind is called (café: fire pit, then hearth, tavern, coffee house, café, nutrient bar).
- **Needs, prices and visit lengths don't change between ages.** Only names and looks do.
- **The current age goes into every agent and design prompt.** "Build a skyscraper" in the Stone Age comes out as stacked rock.
- **Restyles run one age ahead.**
  - The build on screen always goes first. Restyling for the next age is a background job on its own lane, run only when no live design is waiting.
  - It's a cheaper call than a design: the existing blueprint plus the next age's style sheet go in, transformed parts come out.
  - An edit throws away a build's pre-made version.
- **Deterministic fallback.** A palette swap through the age's style sheet is instant and free. Anything not restyled when the age turns gets the swap, and the real version replaces it when it's ready.
- **Relics** keep the blueprint from their own age for good.

## Relics: the most-talked-about build

**What counts as a mention:**
- **Chat:** a chatter's message that names a build (by name, or `#ref`, using the same `matchName` the agents use).
- **The town's head:** the same when Sami says it through the Mayor character (see below).

**What doesn't count:**
- Agent speech, because agents would farm it.
- Repeats from the same speaker about the same build within a minute.

**Counting and choosing:**
- Mentions count over the whole age. The board can show a small "talk of the town" top three, so chat knows it's a race.
- When the age turns, the top build becomes the relic. It gets a plaque ("Relic of the Stone Age, built by Bob") and keeps its old look through every later age.
- One relic per age. A tie goes to the build with more distinct people mentioning it.

## The town's head: the Mayor character changes with the age

Sami's character (`mayor.ts`) stays the same figure, walked the same way. Its **title and outfit** come from the age's style sheet:

| Age | Title | Look |
|---|---|---|
| Stone | the Chief | Furs, a bone staff, a feathered headdress |
| Bronze | the High Priest | Robes, a bronze circlet, a sun disc |
| Medieval | the King | Crown, ermine cloak; the travelling court's jester can heckle him |
| Industrial | the Alderman | Top hat, frock coat, chain of office |
| Modern | the Mayor | Suit, sash, a ceremonial pair of scissors for openings |
| Wasteland | the Overseer | A scrap-plate mantle, salvaged radio and a ring of keys (still a nod to the day job) |

**The title appears everywhere the name does:** in speech bubbles, the feed, agent context ("the Chief said…") and what residents say back.

**The head has a role in the loop:**
- The leader of each visit **reports to the head** on the square.
- The head **cuts the ribbon** on the Wonder, which starts the wave.

## The caravan

The caravan **camps across the river all age**. Viewers can always see it, and travellers wander into town, spending at people's places, so owners earn.

**The leader** comes to the square for each visit with a problem and a list of asks. When every ask on the list is met, the leader comes back with the next one. Unmet asks carry over and there's **no fail state**: the caravan grumbles, the leader nags, and its review is harsher.

**Specialists** (a potter, a metalworker, an engineer…) come with each visit. When their problem is solved they **settle as residents for good**: still in town ages later, older, and dressed for the times. They unlock their **trade** for everyone.

### What an ask can be

Every ask is checked by the app, never by a model, except Commission.

| Kind | Example | How it's checked |
|---|---|---|
| **Build** | "Somewhere to eat", "beds for 8" | A place of kind or trade X exists; capacity reaches N |
| **Operate** | "Fire 20 pots at the kiln" | N shifts (`work`) at a place of that trade, shown as a counter over it |
| **Supply** | "Preserved food for the road" | Made by Operate, **or bought from the caravan with coins** (the mine-or-trade choice, and a coin sink) |
| **Occasion** | "Throw us a feast" | A street party with N people there |
| **Commission** | "Make the road fit for heavy wagons" | A dude `offer`s a build; one judge call gives yes or no plus an in-character line (later slice) |

**There is one shared list for the town.** Now and then the leader or a specialist **singles out one active chatter** for a specific build ("Dana, the potter wants a drying rack beside her kiln"):
- **Active** means the chatter's dude is awake and the chatter has written something in the last 5 minutes.
- **The singled-out ask sits on the shared board** under that chatter's name.
- **It's passed on** to another active chatter if the first goes quiet for 10 minutes. Nobody else can complete it in the meantime.
- **The odds favour newer and quieter chatters.** It's a way in for them.
- **At most one is open at a time** (two once eight or more chatters are active).

### Pacing

Pacing is a guess to tune live. With about five active chatters:
- **A visit's list should take about 25 minutes.**
- **An age** (arrival, three visits and the Wonder) **takes about 1.5 to 2 hours.**
- **The full run** of six ages is roughly 10 to 12 hours across several streams.

**Counts scale with how many chatters are around**, so one chatter on a quiet night can still finish a list.

**There's one catch-up rule, and it's still chat-driven:** if a list has been open for 45 minutes, the leader trims the biggest remaining count by a third and says so ("we'll make do with fewer pots"). After that it never changes.

### Example: the Stone Age

- **Arrival.** Herders camp across the river: "We can't reach you." The **log bridge** is the first community build. Once it's up, they walk into town for the first time.
- **Visit 1: somewhere safe.** Fire pits (a food kind) and shelter for 6. Feed 10 travellers.
- **Visit 2: the potter.** "She can teach you to keep food through winter." Build a kiln (the pottery trade), then fire 20 pots, or buy the shortfall. She settles in town.
- **Visit 3: the metalworker.** The **furnace** Wonder goes up on the square. Get ore by digging at a pit (Operate) or buying it. **Milestone:** forge the first bronze tools at the furnace. The wave rolls, and the Bronze Age begins.

## The opening and the daughter (built 2026-10-22)

The story starts at the river. Sami's brief: the stream should play like a show people watch and take part in.

- **Stuck across the river.** A fresh Stone Age town's caravan arrives with the bridge down. The band waits on the far bank, facing the town: Toma (the father, who leads), his small daughter Ama, Old Ura (grey, sitting), Bo the Herder and Tusk. Nothing is on the board yet.
- **The opening** is admin's "Story: play the opening", 34 seconds long:
  1. Letterbox in, HUD and name tags out.
  2. A glide to a wide shot of the band beyond the broken bridge.
  3. A push in that swings round to their faces at a low angle.
  4. Toma steps forward: "Hello." / "We've been travelling." / "We need your help."
  5. The camera holds on the broken bridge: "The bridge is gone. We can't cross."
  6. A pull out to the usual angle, with the town up to the square and the bridge at the right edge.
  7. Back to normal, and the board opens.
- **Where it lives:**
  - The script (shots, subtitles, beats) is `src/shared/scenes.ts`, shared by the server and the page.
  - The server holds `city.scene`, and the page plays it in sync on the stream and on /mayor.
  - The camera gained a tilt (`pitch`) for the close-ups.
- **The bridge ask.**
  - The bridge needs 40% of the chatters who are around, up to 8. Each one puts in one shift: `help` walks them out to the town bank to hammer for 9 s. Distinct helpers count, not every chatter.
  - The bridge visibly fills in, town side first, with logs floating in the gap until it's done.
  - When it's mended, the Crier names the helpers and the crossing plays (15 s): the band walks over and through town to the square. Visit 1 opens about 19 s later.
- **The daughter is the through-line.**
  - She travels with every age's caravan and grows up: about 0.56 scale in Stone, 0.8 in Bronze, adult from Medieval on.
  - Her tag reads "his daughter", then "Toma's daughter, grown", then "once the girl at the river".
  - Admin "Story: name the daughter" renames her for good (`city.daughter`). Chat could pick it later.
  - She has one line each time a later age's caravan walks in, and the last line of the finale (2026-10-23).
  - **Not built yet:** her taking over as leader in a later age (the Wasteland's Road Boss).
- The other ages' caravans arrive as before (no stranding). Admin "play the opening" strands the current age's caravan if it isn't already.
- Tests: `scripts/opening.test.ts`.

## Built 2026-10-23 (review fixes, `docs/review-2026-10-23.md` §2)

- **The Wonder has its own spot** in the middle of the square, where the paths cross (`WONDER` in `shared/city.ts`: about 6.4 m a side, up to 26 m tall). The centrepiece makes way for it (`town.wonder`). The four community lots stay for chat's projects, so a six-age run can't fill the square.
  - When the third visit opens, the leader **proposes the Wonder** (`proposeWonder` in `city.ts`, tagged `project.wonder`); it waits if another project is under way, and is put forward again a minute after its plans fall through. Only that project finishes the Wonder ask; anything else chat builds is just a project.
  - A Wonder **costs more each age** (`wonderCost`: coins ×1.3 per age, labour ×1.2), and isn't shelved after 40 minutes like other projects.
  - When the next age's Wonder goes up (its ghost appears), the old one **moves to a free community lot** as a keepsake if two or more are free; otherwise it is taken down.
  - Wonders and community projects are never restyled: they keep the look of the age they were raised in.
- **The age turns on screen** (`ageTurn` in `shared/scenes.ts`, 30 s): the head declares the Wonder open, the camera pulls out and the town turns into the next age, a title card ("THE BRONZE AGE"), the age's top three on the Crier's board, and the leader's goodbye. The travellers stay through the confetti and then walk back over the bridge to camp. After a 75 s breather the next caravan **walks in from the camp** (`arrival`, 14 s: the leader's greeting and a line from the daughter), and its first visit opens once they're across. Scene lines take words from the server (`scene.vars`, `{age}`, `{heroes}` …); a line that comes out empty is skipped.
- **The finale** (`finale`, 44 s): the last Wonder goes up in fireworks, each age's heroes are read out (`city.heroes`, written at every turn), and the daughter has the last line. Nothing comes after; Sami resets from /admin.
- **"Build" asks count what the town already has.** A town with places to eat needs fewer new ones, and a place of the asked sort that is done up (edited) since the visit opened counts as much as a new one ("Build or do up …"). A restyle doesn't count.
- **Restyles:** the prompt puts the instructions first and the old description last, so the 300-character cut never loses "keep its layout". A restyled build swaps in with a puff of dust and a sparkle.
- Admin "finish this visit" during a turn skips the scene and the breather; during the Wonder visit it finishes the Wonder going up (so it stands) or drops plans still being drawn.
- Tests: `scripts/caravan.test.ts`, `scripts/ages.test.ts`.

## Trades

A build has a **venue kind** (what a visit does for your needs) and, optionally, a **trade** (what it produces). Specialists unlock trades, and Operate asks count shifts at a trade.

A trade carries its history forward. The kiln becomes a pottery, then a ceramics works, then a factory, a plant and a scrapyard. The thing someone built in the Stone Age is still theirs, and still earning, in the Wasteland.

## On screen

- **The caravan board:** the current visit's three to five asks with progress bars, and the age's name. Someone dropping in should understand the goal in five seconds.
- **Counters over buildings** that are being operated toward an ask.
- **The wave:** a ring spreading out from the Wonder. Each build swaps as the ring passes it, then the sky, ground and outfits follow.
- **Each visit's review:** when a list is finished the leader says a line, which goes into the town's chronicle.

## Slices

1. **Ages as data, the river, the bridge.**
   - `ages.ts` style sheets for all six ages, with `city.age` in state.
   - The environment draws the age's ground, sky and roads, plus the river and camp east of the ring road.
   - Builds, outfits, the bus and the head's title and look take the palette-swap fallback.
   - Every agent and design prompt includes the age.
   - Admin can set the age, to preview every look without playing through.
   - **Shipped 2026-10-19.** Notes:
     - `src/shared/ages.ts` holds the style sheets, `restyleColour` and `dressFor`.
     - `city.age` is in the state. Each build carries `age`, the age it was designed in.
     - `ageOf`, `setAge` and `headName` are in `city.ts`.
     - The renderer redraws the scenery when the age changes (`environment.ts`). The river sits at `RIVER` in `shared/city.ts`.
     - The objects layer swaps a build's colours when it's shown in an age other than the one it was designed in.
     - Admin control: "Town: set the age".
     - Saves from before ages open in the Modern age so the live town looks unchanged. A fresh town starts in the Stone Age.
     - Tests: `scripts/ages.test.ts`.
     - **Not yet age-themed:** the troublemakers (Gary the Painter and the rest), the residents' names, and street names. The camp across the river is slice 2.
   - **World fabric rebuilt from the design board (2026-10-20/21).**
     - Designs: gpt-6-astra on OpenRouter, via the harness in `design/` (`design/astra.ts`, renderer `design/board/`). Four critique-and-revise rounds per age plus a cross-age pass; reviewer scores rose from about 6 to about 7–7.5; total spend $148.92.
     - Reference boards: `design/out/rfinal2/` (`board-fabric.png`, `board-life.png`, `board-vignettes.png`).
     - Export to the game: `node design/export.mjs`, written to `src/shared/ageBibles.json` and `client/dudes/agePieces.json`. Ground slabs and kerb strips in pieces are left to the town.
     - The game draws the town from these. The ground textures are `client/dudes/surfaces.ts`, kept calm (Sami's note). The pieces are `client/dudes/pieces.ts`: merged, instanced in 64 m cells, with mirrored geometry baked. The scenery is `client/dudes/environment.ts`.
     - Design notes still open for astra: bridge landings or ramps, the Bronze barge camp's pond, Future road vs pavement contrast, Modern zebras mid-block. The Future is very pale overall, and its community-lot panels are heavy.
     - **People shipped (2026-10-22):** the garment kits per age on the rigged figures. Each age has four everyday kits plus the head's kit and the caravan leader's (`src/shared/outfits.ts`, `src/shared/ageOutfits.json`; `compose()` in `client/dudes/dudes.ts`). They went through 3 astra rounds; the reviewer scores rose from about 4–7 to about 5–8. The board is `design/out/ofinal/outfits-board.png`. The town design notes (bridge landings, the Bronze barge camp, Modern zebras, Future contrast) are revised and exported too. Total astra spend is $166.83.
     - Next: people and outfits (an outfit system on the rigged figures), troublemakers and labels, then per-age restyles of chatters' builds.
2. **The caravan and its asks.**
   - Camp, leader and travellers that spend in town.
   - The Build, Operate, Supply and Occasion asks; trades and specialists; buying from the caravan.
   - The caravan board.
   - The Stone Age's full storyline, as data.
3. **The Wonder, the wave and relics.**
   - The Wonder as a community project with an Operate milestone.
   - The transformation wave.
   - Mention counting, relic choice and plaques.
   - Admin: force the next age, or reset the world.
4. **The restyle pipeline.**
   - A version of each build per age.
   - The background lane, the restyle call, and edits invalidating pre-made versions.
5. **Commissions and the rest of the content.**
   - The `offer` action and judge call, personal requests and reviews.
   - Storylines for Bronze through Future.

## Settled

- **Relics:** the build mentioned most, in chat or by the Mayor character.
- **Asks:** one shared list, with the odd singled-out ask for an active chatter.
- **Pacing:** see Pacing (a guess, to tune live).
- **The head's title and look** follow the age.
