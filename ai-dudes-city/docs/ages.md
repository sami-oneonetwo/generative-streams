# Ages: the town grows up

Design plan, agreed in conversation on 2026-10-19. Nothing here is built yet.

## The loop

The town starts in the Stone Age and works its way to the Future. **Each age:**

1. A themed **caravan** camps across the river on the east side of the map.
2. Over **three visits**, its leader brings a **problem** and a **specialist**. The town solves it by building and running things.
3. The last visit's problem is a **Wonder** on the square. When it's built and has done its job once, the age turns.
4. **The wave** rolls out from the Wonder. Every build, resident, road and sky transforms into the next age.
5. The **most-loved build** stays as it was, as a **relic** with a plaque.

Chat sets the pace; nothing runs on a timer. After the Future, Sami resets the world from /admin.

| # | Age | Caravan | Wonder (the bridge to the next age) | The river bridge |
|---|---|---|---|---|
| 0 | Stone | Mammoth herders | The furnace: first bronze tools | Log bridge |
| 1 | Bronze | River traders on barges | The Keep | Stone arch |
| 2 | Medieval | A travelling court: knight, jester, minstrel | The steam engine | Drawbridge gate |
| 3 | Industrial | Railway barons, arriving by train | The power station | Railway viaduct |
| 4 | Modern | A coach of tourists | The launch tower | Motorway bridge |
| 5 | Future | An android delegation | The starship (the finale) | Light bridge |

## Builds transform; they're never rebuilt

A build keeps its owner, lot, name, venue kind and footprint across ages. Only its blueprint changes. Bob's rock skyscraper becomes his brick tower, then his steel one.

- **Each age is a style sheet as data** (`src/shared/ages.ts`):
  - palette and material families (which colours a build's parts map to);
  - ground, road, sky and fog colours;
  - outfits for dudes and residents;
  - the bus (a mammoth sledge, then a horse cart, chariot, steam tram, coach and hover shuttle);
  - what each venue kind is called (café: fire pit, then hearth, tavern, coffee house, café, nutrient bar).
- **Needs, prices and visit lengths don't change between ages.** Only names and looks do.
- **The current age goes into every agent and design prompt.** "Build a skyscraper" in the Stone Age comes out as stacked rock.
- **Restyles run one age ahead.**
  - The build on screen always goes first. Restyling for the next age is a background job on its own lane, run only when no live design is waiting.
  - It's a cheaper call than a design: the existing blueprint plus the next age's style sheet go in, transformed parts come out.
  - An edit throws away a build's pre-made version.
- **Deterministic fallback.** A palette swap through the age's style sheet is instant and free. Anything not restyled when the age turns gets the swap, and the real version replaces it when it's ready.
- **Relics** keep the blueprint from their own age for good.

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

Counts scale with how many chatters are around, so one chatter on a quiet night can still finish a list.

### Example: the Stone Age

- **Arrival.** Herders camp across the river: "We can't reach you." The **log bridge** is the first community build. Once it's up, they walk into town for the first time.
- **Visit 1: somewhere safe.** Fire pits (a food kind) and shelter for 6. Feed 10 travellers.
- **Visit 2: the potter.** "She can teach you to keep food through winter." Build a kiln (the pottery trade), then fire 20 pots, or buy the shortfall. She settles in town.
- **Visit 3: the metalworker.** The **furnace** Wonder goes up on the square. Get ore by digging at a pit (Operate) or buying it. **Milestone:** forge the first bronze tools at the furnace. The wave rolls, and the Bronze Age begins.

## Trades

A build has a **venue kind** (what a visit does for your needs) and, optionally, a **trade** (what it produces). Specialists unlock trades, and Operate asks count shifts at a trade.

A trade carries its history forward. The kiln becomes a pottery, then a ceramics works, then a factory, a plant and a fabricator. The thing someone built in the Stone Age is still theirs, and still earning, in the Future.

## On screen

- **The caravan board:** the current visit's three to five asks with progress bars, and the age's name. Someone dropping in should understand the goal in five seconds.
- **Counters over buildings** that are being operated toward an ask.
- **The wave:** a ring spreading out from the Wonder. Each build swaps as the ring passes it, then the sky, ground and outfits follow.
- **Each visit's review:** when a list is finished the leader says a line, which goes into the town's chronicle.

## Slices

1. **Ages as data, the river, the bridge.**
   - `ages.ts` style sheets for all six ages, with `city.age` in state.
   - The environment draws the age's ground, sky and roads, plus the river and camp east of the ring road.
   - Builds, outfits and the bus take the palette-swap fallback.
   - Every agent and design prompt includes the age.
   - Admin can set the age, to preview every look without playing through.
2. **The caravan and its asks.**
   - Camp, leader and travellers that spend in town.
   - The Build, Operate, Supply and Occasion asks; trades and specialists; buying from the caravan.
   - The caravan board.
   - The Stone Age's full storyline, as data.
3. **The Wonder, the wave and relics.**
   - The Wonder as a community project with an Operate milestone.
   - The transformation wave.
   - Relic choice and plaques.
   - Admin: force the next age, or reset the world.
4. **The restyle pipeline.**
   - A version of each build per age.
   - The background lane, the restyle call, and edits invalidating pre-made versions.
5. **Commissions and the rest of the content.**
   - The `offer` action and judge call, personal requests and reviews.
   - Storylines for Bronze through Future.

## Open questions

- **Relics:** chosen automatically (the most distinct visitors, or `!love`), or a chat vote on the top three before the wave?
- **Commissions:** one per active chatter, or one shared list?
- **Iteration length:** how long a visit's list should take with typical chat (the guess is 20 to 40 minutes).
