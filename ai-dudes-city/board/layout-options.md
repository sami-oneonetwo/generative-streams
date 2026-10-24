# How the land is laid out: options for Sami

**Decided 2026-10-24: Sami approved A+, with the river moving east (not the east-block variant), and question 3: the band's old camp moves to the town bank.** The layout cards FK-075 to FK-081 and the four Q3 cards are unblocked; M1 keeps the provisional sites in §1 (BOARD.md → Decisions 1 and 2). The options below are kept as the record.

**This was Sami's decision.** The layout scout measured today's town against how it reads on stream and on a phone, and recommends **A+: keep the grid, but turn it to face the river**. The coordinator agrees, with one condition: decide before stream 1, because today the change is free (the live save has 1 claimed lot and 0 builds) and after stream 1 every build persists and restyles through six ages.

**Nothing in M1 waits on this.** M1 uses a provisional story site that fits today's map (§1). **Question 3 (the camp on the town bank) is needed now, whatever the layout:** FK-043, FK-044, FK-056 and FK-132 in M2 wait for it. If Sami picks A+, B or C, only the numbers in `STORY_SITES` (src/shared/storyMap.ts) move, plus the layout cards FK-075 to FK-081, which sit in *Blocked / Needs Sami* on the board.

Evidence, all in `/tmp/fk-shots/layout/`: `stream-auto.png` (live stream view, 1920×1080), `wide-40-river.png` (half-height 40, the widest autoFrame ever goes), `wide-60.png` (the whole town), `phone.png` (all three at 390 pt wide). Framing calculator: `/tmp/fk-layout/frame.mjs` (ports `layoutPlots` and the autoFrame maths). "Half-height" below is the orthographic half-height in metres; a dude is readable on a phone at **16 or less** (about 14 pt tall).

---

## 1. M1 provisional story sites (no decision needed)

Today walkable ground ends at x = 70.5 (`GROUND.bounds` = `CITY_BOUNDS`, src/worlds/ai-dudes/placement.ts:13); the river runs from x = 79.5 to 93.5 (`RIVER.x` 86.5, src/shared/city.ts:40); the band's camp is drawn on the far bank at x ≈ 115.5 (client/dudes/environment.ts:53). The corner blocks are parks with no lots (`isPark`, src/shared/city.ts:37), so a corner park by the river holds a story site with zero effect on anyone's lot.

| `STORY_SITES` key | Provisional point (x, z) | What it is |
|---|---|---|
| `folly` | centre (54, 40), 16×16 m, front faces +Z | The camp plot and the Big Hut cordon, in the **SE corner park** (green 27–63 on both axes). The camp dressing stands here until the cordon goes up. |
| `headMark` | (54, 50.5) | Where the head stands at an Unveiling, between the tarp and the crowd |
| `crowd` | ring centre (54, 50), radius 8–14 m, on the +Z side | Gathering ring for the Unveiling (gold front, red back) |
| `wrenVantage.far` | (97, 30) | Wren's pivot spot on the far bank before the bridge is mended (~44 m from the Folly) |
| `wrenVantage.near` | (69, 20) | After the crossing, on the ring road (~25 m) |
| `wrenFire` | (52, −40), NE corner park | Wren's rally fire after the band crosses (~80 m from the Folly, so "the head is 30+ m away" holds) |
| `redSign` | (67, 6) | Oak under the floating "BRIDGE 3/8" pennant at the town end of the bridge |

Engineering tunes these with one stream shot each in FK-023 and FK-025. Park trees are skipped inside the Folly rect.

---

## 2. Today's layout on stream

**What works**
- **12 m lots are the right size.** One build is about 8–10 m, so at half-height 8–12 one lot fills a third of the frame.
- **The diamond view reads clean.** Orthographic, about 40° down, turned 37° (client/dudes/main.ts:98-105). Sami's de-cluttering passes (one tree per courtyard, no street furniture) were right.
- **Every build faces +Z** (src/worlds/ai-dudes/design.ts:33). The camera sees the +X and +Z faces, so doors always face the stream. Keep this.
- **Walking is free anywhere**, so roads are only paint. Any layout is cheap to draw.

**What doesn't**
1. **The order lots are handed out spreads chatters apart.** The ranking (src/shared/city.ts:181-188) gives the first four lots to (0,−33), (33,0), (0,33), (−33,0): one on each side of the square, 66 m apart. 3 chatters at home need half-height 24 (a dude is about 9 pt on a phone); the same 3 in one block need about 12. 12 chatters need 29; 32 hit the autoFrame cap of 40, where dudes are 5 pt specks.
2. **The story is at the far edge, on the wrong bank.** The camp is at x = 115.5 on the far bank. The bible puts the band's old camp, the Folly and the cairn on the town bank: Sami stands at their fire while the band is stranded opposite. Any frame with 5 chatters plus the camp needs half-height 37, and the gathering walk from the far lots takes about 40 s at 4.3 m/s against a 25 s cap.
3. **The ground ends at the ring road.** The bank and the camp can't be walked on: the bridge path is laid by hand (src/worlds/ai-dudes/caravan.ts:259) and `GROUND.water` is empty. Gatherings, Wren's vantage point and the cairn all need real ground there.
4. **Most of the town is dead space.** Of the 141×141 m town: roads 31%, corner parks 26%, pavements 9%, home lots only 23%. Free lots aren't drawn (environment.ts:369), so in Stone a home block is a flat green square that looks like a park. With 5 chatters the town looks 90% empty; the only thing pulling the eye is the bonfire.
5. **Capacity is 32 home lots.** At 40 chatters, 8 become renters.
6. **The square can't hold a crowd ring.** Its four 13 m community lots leave a 5 m paved cross round the Wonder (src/shared/city.ts:91-97).
7. **The HUD covers a lot of the frame** at 2.6×: the help panel about 650×415 px top-right, the feed about 780×180 px bottom-left (design-system.md §4 retires both in story mode).

---

## 3. The options

Coordinates in metres; x is east, z is south.

### A+. Keep the grid, face the river (recommended)

```
 x: -67   -22  0  22   45   67|   90      116~~~~river~~~~ 126
z-45 [NW⑧][ N④ ][NE⑤]         | F2 (90,-45)  Wren's fire (100,-20)
z  0 [ W⑥][ SQ ]=BRIDGE LANE==|=CAMP/F1 (94,0)==bridge== Wren vantage (126,4)
z+45 [SW⑦][ S② ][SE③]         | cairn (106,22)  F4 (90,45)
     E① = the block between SQ and the bank (the lane runs through its middle row)
```

- **What changes:** the river moves from x = 86.5 to 116, opening a 36 m River Bank on the town side; the camp moves to the town bank (the far bank is where the band arrives); lots are handed out block by block from the bridge (E, S, SE, N, NE, W, SW, NW; river-side cells first); corner parks become home blocks when the fill order reaches them (62 lots); the E block's middle row becomes **Bridge Lane** from the square to the bridge; only open blocks are drawn.
- **Framing (half-height):**

  | Chatters | A+ | Today |
  |---|---|---|
  | 3 | 18.5 | 37 |
  | 6 | 21.1 | 37 |
  | 10 | 29.8 | 40 (capped) |

  One block on its own is 17.3.
- **Story fit:** the Follies line up along the bank, each facing +Z with its crowd ring on the south side, so eye-level shots look along the open bank and across the water, never through chatter builds. Wren's far-bank vantage is about 32 m from F1. The cairn sits at the water's edge. Gold idles toward the cordon, red toward Wren's fire: the bank is where the sides pull. Bridge Lane is the procession route (the Crossing, the golf cart, Kit, Oak's walk-off).
- **Growing from 5 to 50 chatters:** 5 chatters = one block, the square and the bank: a busy hamlet, not an empty grid. Each block opening is a small moment on stream.
- **Migration:** none. Lot ids and positions stay; Sami's lot stays put; no `LAYOUT` bump. The live band (stranded on today's far bank) is repositioned at boot.
- **Cost:** about 3.5–4 engineer-days (FK-075 to FK-081).

### B. Bridge Street (a linear town)

```
z-24   [ back-street lots: open at 13+ ]
z-10.5 [L][L][L][L][L][L]                      x 24…84
z  0   SQ ════ BRIDGE STREET ════ CAMP/F1 (102,0) ═bridge═ Wren
z+10.5 [L][L][L][L][L][L]
z+24   [ back-street lots ]
```

- **Framing:** 5 chatters 18.3, 8 chatters 20.9, 12 chatters 26.1.
- **Good for:** the best processions and the strongest leading line toward the bridge.
- **Against:** growth stretches it long (beyond 24 chatters the far end is 100+ m from the bridge); the square ends up at the back of town.
- **Cost:** about 3–4 days, plus a new lot generator with new ids and addresses, a rewrite of the ground drawing, and a relayout branch (src/worlds/ai-dudes/relayout.ts:56 assumes the old layout is 1 or 2, so a layout-3 save would be read as 2).

### C. Ring village

```
        ring 2 (r≈37, 12 lots, west ¾)
      ring 1 (r≈21, 7 lots)
   ( GREEN r≈13 + Wonder pad )  — east arc: camp, Folly row — ~~river x≈60~~
```

- **Framing:** 5–8 chatters 21.6 with the Folly in frame; rings 1 and 2 together 31.
- **Good for:** the Green is the ideal place for the Bell, the Rising and town-wide shots.
- **Against:** builds can't rotate, so square lots on a circle look ragged; addresses change ("4 Hearth Ring").
- **Cost:** about 4–5 days: the riskiest against stream 1's budget.

### Keep today's map

- **Framing:** 3 chatters 37; story sites stay in the corner parks (§1).
- **Cost:** none now. The scattered first lots and the empty-looking town stay; after stream 1 any change costs a migration.

### Rejected: red and gold quarters

Lots persist across all six streams, but sides switch every age and in the Defection Window, so a turncoat would live in the wrong quarter. Sides show through the ground disc and tag icon (and Wren signs on lots in Modern); a compact block-by-block fill makes "the map is the tally" readable in one wide shot anyway.

---

## 4. Comparison

| | Today | **A+** | B | C |
|---|---|---|---|---|
| Half-height, 3–5 chatters | 37 | **18.5–19** | 18.3 | 21.6 |
| Half-height, 10–12 chatters | 40 (cap) | **29.8** | 26.1 | 31 |
| Story sites on open water | No (far bank) | **Yes** | Yes (one end) | Yes (east arc) |
| Crowd room | Square too tight | Bank + open half-square | Street | The Green |
| Migration | — | **None** | New ids, relayout branch | New ids, new addresses |
| Engineer-days | 0 | **3.5–4** | 3–4 + relayout | 4–5 |
| Capacity | 32 | 62 | grows long | 19 in two rings, more rings later |

---

## 5. A+ (approved 2026-10-24): the cards

Unblocked on 2026-10-24 (FK-075, FK-077 and FK-078 Ready; the rest in Backlog); they go first in M2, because every story site moves with them. Lanes after the critic's review: FK-075, FK-076, FK-077 and FK-081 in Lane E (which holds src/shared/city.ts after M1), FK-078 in Lane A (placement.ts), FK-079 in Lane B, FK-080 in Lane C; about 5 engineer-days in all, at most 2 in any lane.

| Card | What | Size |
|---|---|---|
| FK-075 | Hand out lots block by block from the bridge (explicit block order, river-side cells first; existing claims stay) | S |
| FK-076 | Bridge Lane: skip q1_0_±1_0 (both unclaimed), draw a 12 m lane from the square to the bridge | S |
| FK-077 | Keep half the square open: community projects never pick q0_0_1_±1 (a 20×39 m gathering space) | S |
| FK-078 | The River Bank: river to x = 116, ground bounds east to ~106 plus a far-bank landing, river as water, live band repositioned | M |
| FK-079 | Story sites on the bank: `STORY_SITES` moved (the camp, drawn by FK-132, follows), far-bank trees, every scene shot re-checked | M |
| FK-080 | Draw only open blocks; the next block opens at 75% full; a marker on the next free lot | M |
| FK-081 | Corner parks become home blocks in fill order (62 lots) | S |

Separately, and needed whatever the layout: **FK-062** makes autoFrame frame the chatters who spoke in the last 90 s and lowers the cap from 40 to 32. Layout alone can't keep 20+ chatters readable in one frame.

**Folly blueprint rules under A+:** front faces +Z with the river behind on the right; at least 30 m clear to the south for the crowd; footprint up to 24×24 m; the Medieval Royal Moat must straddle Bridge Lane so its drawbridge cuts the camp off.

---

## 6. Questions for Sami (all three answered on 2026-10-24: A+; the river moves east; yes, the camp moves to the town bank)

1. **A+, B, C, or keep today's map?** (Recommendation: A+, before stream 1.)
2. **Move the river east (A+), or turn the east block into the bank instead?** The scout measured the second version at half-height 26.4 for 5 chatters, against 18.9 for A+.
3. **Needed now: confirm the band's old camp moves to the town bank.** The bible implies it (Sami stands at their fire across the river from the band); it reverses today's far-bank camp.
