# Design system: "Sticker Toy"

The world is chunky toys and the UI is stickers on the glass: thick ink outlines, hard shadows with no blur, rounded pills, two fonts. Owned by the design lead; every Finders Keepers visual follows this page. All design generation uses **openai/gpt-6-astra** only.

Reference shots: `/tmp/fk-shots/design/stream.png` (1920×1080 `?stream=1`), `stream-wide.png`, `phone.png` (390×844). Mock of every HUD piece: `/fk-hud.html` (FK-005).

---

## 1. Audit of today (2026-10-24)

**Crisp: weak.**
- The stream UI reads as a debug console. It uses four font families: Consolas for tags, feed and invite; Trebuchet for banners; Segoe for bubbles; Georgia for title cards (client/dudes/index.html:3, 7, 11, 12, 43). The 1 px hairline borders (`#9ba48655`) blur out under Kick's compression.
- At the 2.6× stream scale, text breaks the 54 px rule: tags 28 px (index.html:11), feed 30 px, invite 29 px, subtitle speaker 31 px. The letterbox is 11vh per bar (index.html:41); the bible says 7% at most.
- The invite panel takes about 13% of the frame and covers name tags ("Old Tom" hidden behind it). The feed repeats lines, cuts words ("Find the p…") and shows Sami's raw typed lines. On the phone page the "Following everyone" button sits on top of the invite.
- Stone people are brown on brown mud with no outline (design/out/ofinal/outfits-stone.png), so they vanish at phone size. The default frame is mostly empty ground.

**Playful.** The 3D models have charm (the antlered Chief, the mammoth sledge, the wolf-dog sledge "car"). The UI has none.

**Consistent: four breaks that would hurt the story.**
1. The age palette shift muddies the side colours: `restyleColour` (src/shared/ages.ts:194) turns red #B3262E into #9a4a3f and gold #FFC633 into #b89752 in Stone, and does much the same in Wasteland. → FK-064.
2. The head wears red and the band wears gold: the King's red shirt and cape (ages.ts:94), the Mayor's red propeller hat (ages.ts:120), gold traveller tags (index.html:17). Both are the wrong way round for the sides. → FK-064, FK-014.
3. The layout text in the design prompts is out of date: astra's WORLD says 22 m lots (design/astra.ts:136) and every shipped `designDirection` says "5×5 plan, 16 m parcels" (src/shared/ageBibles.json), which goes into every in-game design call (ages.ts:151). The real layout is 12 m lots (src/shared/city.ts:11). → FK-003, FK-070.
4. The board images are out of date: rfinal2/board-life.png and ofinal/outfits-board.png still show the old pastel "Future"; the shipped kits are Wasteland. → FK-004.

**Pipeline:** design/render.mjs:8 and render-outfits.mjs:8 load playwright from ../../noodle-shop, which doesn't exist on this box, and launch `channel:'chrome'`. → FK-003.

**Spend so far:** $171.92 over 697 calls; the revise loops took 68% of it ($116.67 over 479 calls).

| Call | Average cost |
|---|---|
| build | $0.13 |
| element | $0.17 |
| revise | $0.24 |
| critique | $0.52 |
| outfits | $0.59 |
| critique-outfits | $0.25 |

Lesson: cap revise rounds at 2 and let the design gate (§7) decide, not more astra rounds.

---

## 2. Colour

**Story colours are LOCKED.** They skip `restyleColour` and `dressFor` in every age (FK-064).

| Token | Hex | Deep | Use | Text on it |
|---|---|---|---|---|
| RED | `#B3262E` | `#7A1419` | Wren, the red side, her flag, red jobs | Cream only (6.0:1). **Never red text on ink (2.7:1).** |
| GOLD | `#FFC633` | `#A86E00` | The head, the gold side, the Folly, the crown | Ink (11:1) |
| INK | `#1E1914` | | Panels at 92%, outlines | Cream |
| CREAM | `#FFF6E0` | | Text, bubbles, tarp-adjacent UI | Ink |
| DUST | `#8C8577` | | Secondary text only | |

- Red's luminance is 0.11 and gold's is 0.62, so the sides stay apart in greyscale and for colourblind viewers. Always pair colour with the icon: **crown = gold, pennant flag = red**, everywhere (tags, the Board, banners, the NOW card).
- **Cast colours (locked):** Moss `#4E8A3A`, Oak `#E8762B`, Kit `#2F6FD0`, Ash `#6E7680`. Wren is RED.
- In stream mode there are no other UI accents: the green, orange and blue "happening" variants go.
- Gold on mud is only 1.6:1, so **every side mark in the world gets a sticker rim**: 0.1 m cream, then 0.05 m ink.
- Builds avoid `#B3262E` and `#FFC633` as main colours unless the chatter asks (FK-070), so red and gold stay meaningful.

---

## 3. Type

Two self-hosted OFL fonts, served by the app as woff2 (FK-009): **Fredoka 600/700** for display, **Nunito 800** for text. Sizes in px at 1920×1080 (on a 390 px phone, multiply by about 0.2).

| Element | Size |
|---|---|
| Title card | 140, all caps, 10 px ink stroke |
| NOW card | 96 word + 64 "type red" chip |
| RATE IT number | 160 |
| Gather banner | 72 title, 54 premise |
| Board | bar word 64, command chip 54, tally numbers 64 |
| Ticker | 54 |
| Subtitle | 58, one line of ≤ 42 characters, centred in a 7vh (76 px) bar; speaker chip 54 in the speaker's colour |
| Cast and head tags | 54 |
| Chatter tags | **40** (the one deliberate exception to the 54 px rule: a name identifies, it doesn't instruct) |
| Bubbles | 36; amplified Crowd Mic lines 58 |

**Rules:** nothing that has to be read is under 54 px; cards are ≥ 96 px; never more than **two text layers** at once (the subtitle plus one other).

---

## 4. HUD

**Shapes.** Pills (radius = height / 2) for chips, bars and tags; cards with radius 28. A 6 px ink outline and a `0 8px 0 #0006` hard shadow. Pop-in 0.85 → 1.06 → 1 over 300 ms. **Nothing animates at rest** except the ticker's crossfade.

**Stream layout (Story ON).**
- **One top-centre strip, 1240 px wide.** It holds the Board in free play, the GATHER banner during a Call, and nothing during scenes.
- **The Board:** two 96 px pill bars, gold on the left with the crown and the word inside the fill, red on the right with the flag. Under them the rope tug line with a sliding knot: `type gold 7 ━━●━━ 4 type red`. Then the 54 px ticker pill.
- **THE WONDER:** in the last stretch of each age the two bars merge into one 96 px pill, "THE WONDER · type help", gold filling from the left and red from the right by who put in what, grey in between (FK-130, FK-131).
- **Retired on stream in story mode:** the invite panel, the feed and the caravan panel. The `!play` URL becomes a ticker line. (Sami said yes on 2026-10-24: BOARD.md → Decisions 4; he may overrule it after seeing it.)
- autoFrame keeps subjects below the top 250 px while the strip shows, and keeps the lower-right quadrant clear.
- The **NOW card** sits centre-lower for 6 s after every scene.
- **Letterbox:** 7vh bars (76 px at 1080), subtitles inside the bottom bar. The HUD fades as it comes in (0.9 s).
- **Prompt tiles:** RATE IT (one big number, one decimal), red pips at Wren's fire, candles at the grave. Answers are pictures, not text.

---

## 5. World pieces

Drawn by the engine from parameters, with no LLM, so they look the same in every age (FK-024, FK-013).

- **Cordon:** a stake every 2 m, gold rope, swaying gold-and-ink pennants. A 4×1.6 m sign with a gold face: "KEEP OUT. SOMETHING AMAZING."; only the frame material changes with the age.
- **Tarp:** replaces the 0.1 `silhouette` shade (client/dudes/objects.ts:395) with draped cream canvas `#EFE3C2` over the Folly's bounding box, gold rope bands, a giant gold crown stencil. It grows with the Folly timer. At the reveal it drops in 0.4 s with 6 large dust puffs and gold confetti (≤ 24 big pieces).
- **Gold beam:** radius 0.6 m at 20% while the cordon is up; radius 1.6 m at 45% with a 0.4 Hz pulse during a Call.
- **Plaque:** a gold plate with a crown emboss. The names go on the cue card and the plaque card, not in the world.
- **Wren's site sign:** a floating red pennant, 3.2×1.4 m ("BRIDGE 3/4"), bobbing slowly, with Oak standing under it. It is the HUD flag in 3D (FK-125; frame from FK-008).
- **Side disc:** 1.3 m, with the sticker rim. Neutrals get no disc.
- **Outline:** an inverted-hull outline (ink, 60%) on people, pets and cast only. It fixes brown-on-mud (FK-063).

---

## 6. Cast

Each has a **constant silhouette**; only the material changes per age. Fixed-colour outfit kits.

| | Rule | Stone | Bronze | Medieval | Industrial | Modern | Wasteland |
|---|---|---|---|---|---|---|---|
| **Wren** | Top third of her silhouette is red in every age | Teen, scale 0.82 (today 0.56, caravan.ts:99); red hair cord with long tails, red-ochre shoulder hide, bone whistle | Red headband and shawl | Woman at 1.0; big red hood, short cape | Red scarf wound high, cap | Red hoodie, hood up in the pivots | Red bandana, hooded duster |
| **Ash** | Tallest (1.15 / 1.2) | Grey-streaked, cream bandage on the left leg, 2.1 m carved staff, red wrist cord | Same, on his bedroll | (dead) | | | |
| **Moss** | Always seated | Stump | Stool | Bench | Iron chair | Folding chair | Tyre |
| | | Green shawl, a cord in her lap with one bead-knot per Folly | | | | | |
| **Oak** | Scale 1.25, mallet with a 0.35 m head | Orange apron | | | | Hi-vis orange vest | |
| **Kit** | Scale 0.7, plain blue, 0.16 m gold badge | | | Wooden sword | | | Captain of the guard |
| | | From the Crossing on: a tiny blue copy of the Boss's hat | | | | | |
| **The head** | Gold sash in every age; **never any red** | Chief, hat ×1.0 | High Priest ×1.2 | King ×1.4 | Alderman ×1.6 | Mayor ×1.8 | Overseer ×2.0 |

The flashback's stand-in Chief uses the Stone head kit (`headLook`, mayor.ts:51), not MAYOR_LOOK (the Modern look).

---

## 7. Pets

- One per chatter. 0.4–0.9 m tall, at most 1.2 m long (the motion cap allows 1.4 m; design asks for 1.2). The head is at least 40% of the body, the legs stubby, one hero feature (ears, a horn, a tail). 10–24 parts. Tail sway, and a bob when walking.
- Collar in the owner's side colour, cream if neutral.
- Follows 1.2 m behind its owner's left. In a gathering it sits at the owner's feet, facing the anchor, below face height.
- Pets restyle each age like builds; while the restyle is queued an instant no-LLM **age accessory kit** shows: beads, bronze tag, bell, brass tag, LED collar, scrap goggles (FK-051).

---

## 8. In-game design prompt (FK-070)

Changes to src/worlds/ai-dudes/design.ts:31 and src/shared/ageBibles.json, shipped only after an A/B and Sami's yes:
1. Strip the "5×5 / 16 m" layout text from every `designDirection`.
2. Style line: "Toy-like: chunky, slightly exaggerated (roofs, doors, signs about 1.2×); 2–4 main colours plus one accent; a strong roof silhouette that reads from 40° above; at least 25% lightness gap between roof and walls; nothing under 0.12 m; one funny detail."
3. Add: "Avoid `#B3262E` and `#FFC633` as main colours unless asked."
4. A pet branch: `isFor:'pet'` gets the companion spec above and `moves:'follow'`.
5. ENGINE_RULES minimum part thickness 0.06 m → 0.12 m (design/catalogue.ts:224).
6. Keep: every build faces +Z (design.ts:33), so doors face the stream camera.

---

## 9. Review gate (every design card)

Render → one astra `critique-image` (score and problems) → at most **2** revise rounds → the design lead's gate:
- a 20% greyscale "phone" check (390 px);
- 4 main colours at most;
- a silhouette readable at phone size;
- the red/gold rule (story colours only where they mean something);
- one funny detail.

Then Sami gets **one PNG** per card.

**Budget.** Every astra run sets `DESIGN_BUDGET_USD` = spend so far (sum of design/out/spend.jsonl) + the card's ceiling. Programme cap $245 (about $73 new), approved 2026-10-24 (BOARD.md → Decisions 3).

| Milestone | Cards (ceiling) | Total |
|---|---|---|
| M1 | FK-003 $0 · FK-004 $0 (+$0.55) · FK-005 $1.50 · FK-006 $3 · FK-007 $4 · FK-008 $1.50 · FK-030 $0.50 | ~$11 |
| M2 | FK-034 $1.50 · FK-068 $1.50 · FK-070 ~$4.45 (15 builds per arm; ceiling $5) · FK-071 $5 · FK-137 /mayor mock $1 · FK-138 M2 HUD $1.50 · FK-139 review $0.50 | ~$15.50 |
| M3 | FK-085 $4 · FK-086 $4.50 · FK-094 $2 · FK-097 $1.50 · FK-098 $1.50 | ~$13.50 |
| Later | FK-100 $7 · FK-101 $6 · FK-102 $7.50 (+ clubhouse hatch and Launch Tower) · FK-103 $6 · FK-104 $5 | ~$31.50 |
