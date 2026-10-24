# Motion budget

Sami: "Ensure there is enough moving items in the world to keep it engaging, but don't overdo it." Today the stream reads as a still image: the town has no ambient motion, nothing caps how many chatter-built vehicles and animals move at once, and every build part is its own draw call. This page is the budget every card follows. Owned by the motion auditor; the design lead's hard cap (≤ 8 moving non-person things in a wide shot) is folded in.

Shots: `/tmp/fk-shots/motion/stream-{1,2,3-wide}.png` (1920×1080).

---

## 1. What moves today

**Characters**
- **Chatter dudes** (src/worlds/ai-dudes/sim.ts:272-333). An idle dude picks something new every 6–18 s if awake, every 30–90 s if away. Awake: a 3–9 m stroll (33%), greeting someone (30%), looking at a build (25%), sitting (7%), a quick emote (5%). Away dudes potter on their own lot; at most 4 away dudes on outings (city.ts:624). Walk 2.4 m/s, wander 1.3 m/s (sim.ts:22-23). Needs-driven outings at least 25 s apart (city.ts:568-609).
- **Townsfolk** (city.ts:1080-1268): target `clamp(5 + 2×apartment blocks − awake/2, 2, 14)` (city.ts:1082), so they thin out as chat grows. 1.5 m/s, rest 20–60 s after a visit.
- **Travellers** (city.ts:1113-1164): mostly stand; while stranded they face the town with occasional emotes; quiet during scenes.
- **Troublemakers** (src/worlds/ai-dudes/events.ts:16-25): one every 4–7 min at 4.2 m/s; already held off during parties and scenes (events.ts:561).

**Moving builds** (src/worlds/ai-dudes/movers.ts)
- Roam 1.4, drive 5.5, fly 6.5 m/s, pausing 2–8 s, 0.5–2.5 s, 0–1.5 s (movers.ts:17-32).
- **No limit on how many move at once**; only the rampage cap of 2 monsters (movers.ts:48).
- Pets are just `roam` (blueprint.ts:308): 6–24 m legs anywhere (movers.ts:129-139), not tied to their owner.

**Moving parts:** sway, drift, spin and bob, up to 16 per build (design.ts:34), drawn in client/dudes/objects.ts:101-147; movers bob as they go (objects.ts:549-565).

**Effects:** party confetti 160 pieces (environment.ts:386, 471-489); effects capped at 300 live (effects.ts:39); damage smoke capped at 220 puffs with a new material per puff (objects.ts:577-578); camera shake 0.35× on stream (main.ts:1167-1175).

**Ambient life: none.** The river, the camp hearth and the square's bonfire are merged static meshes. No birds, clouds or day/night (birdsong exists only in audio, audio.ts:216-266).

**Performance:** each build part is its own mesh (primitives.ts:227), up to 160 parts a build (blueprint.ts:29); shadows use a 2048 PCFSoft map (main.ts:116-119); the server ticks every 500 ms (index.ts:2038); people are instanced, so cheap.

## 2. What the stream shows today

The saved world has 1 chatter (Sami), 0 builds, 5 townsfolk and 5 travellers, in Stone. The stream follows the Mayor at about 57 m across (~34 px per metre). Each frame: the Chief standing, 1–3 townsfolk walking at about 50 px/s, nothing else. About 60% of the frame is empty lot or road and the HUD covers about 22%. On a phone it's a still with two ants: **well under budget**.

---

## 3. The budget

### Free play (a typical shot about 50–80 m wide)

| Layer | Budget | Card |
|---|---|---|
| **The world breathes** (no draw-call cost) | The river surface scrolls; smoke rises from the camp hearth and the square's fire (big, slow puffs); the tarp and pennants sway | FK-029 |
| **Small movers** | 3–6 in frame: chatters, their pets, townsfolk. A chatter and their pet count as one. Above ~12 walkers in frame it clutters | FK-120 thins idling at scale |
| **Big mover** | At most **1** in frame, passing every 60–90 s at ≤ 3 m/s (under ~6% of the frame width per second, which compresses well) | FK-069 |
| **Sky** | **1** bird flock, one at a time, every **60–120 s**, crossing high in 6–10 s | FK-066 |
| **Event motion** | Troublemakers, coin pops, builds going up: on top of the budget | — |
| **Hard cap** | **≤ 8 moving non-person things in any wide shot** (beam pulse, smoke from ≤ 1 in 3 hearths, river, pennants, pets, ≤ 3 roaming vehicles or creatures, one flyer, Oak hammering at Wren's site). Nothing blinks. | all |

### Flavour by age

One big mover, a few small critters and one flyer per age. They belong to the town, not to any chatter: no owner, never in /admin, never blocking anything.

| Age | Big (≤ 3 m/s) | Small | Sky | Cards |
|---|---|---|---|---|
| Stone | Mammoth along the far bank (0.9 m/s) | Goats | Birds | FK-068, FK-069 |
| Bronze | Ox cart on the ring road | Chickens | Gulls over the river | FK-098 |
| Medieval | Horse cart, plus a barge on the river | Dogs | Crows | FK-104 |
| Industrial | Steam tram with smoke puffs | Pigeons on the ground | Pigeons | FK-104 |
| Modern | Bus (only 1–2 chat cars move at a time) | Cats | One drone | FK-104 |
| Wasteland | Scavenger rig trailing dust | Tumbleweed | Vultures circling | FK-104 |

When fewer than 3 walkers are near the action, a critter strolls in.

### Scenes (the camera holds still; bible §6)

| Phase | What moves | Card |
|---|---|---|
| **Call** (25 s before a gathering) | The walk to the gathering *is* the motion, seen in a high wide of everyone converging. The flock bursts up from the gathering spot as a playful cue. The big mover and flyers park. | FK-019, FK-134, FK-066 |
| **Letterbox up** | Chatter-built movers park (cars at the next junction, flyers land); the big mover and the flock leave the frame or hide; townsfolk not in the scene idle in place; the river scrolls at half speed; confetti ≤ 24 large pieces | FK-032 |
| **The reveal (U3)** | Only the tarp, the dust puffs and the build's signature part move | FK-024, FK-032 |
| **Release** | Life comes back staggered over 10 s; dudes leave with staggered idles, never as one block | FK-019, FK-032 |

### Pets (Sami's ask)

- One per chatter (FK-028). It follows its owner (FK-027): about 1.2 m behind-left, along the owner's recent path (no pathfinding), at 1.2× the owner's speed, teleporting with a puff if more than 30 m behind. It **sits** when the owner idles and **sleeps on the lot** when the owner is away, so away chatters' pets add no motion.
- Size cap: ≤ 0.9 m tall, ≤ 1.2 m long (design asks 1.2; the hard motion limit is 1.4), ≤ 24 parts. Pets stay below face height, so in crowd shots they sit at the owner's feet without blocking bubbles (FK-052).
- Pets restyle each age like any build (FK-051).

### Limits at 40 chatters

- Moving at once across the whole town: **drive 3, fly 2, roam 4** (pets and ridden builds excluded). The rest park on their lots and take turns every 3 min; a brand-new build gets a 2-minute debut run so its builder sees it go (FK-067).
- The idle interval stretches as chat grows, so ≤ 35% of dudes walk at once (FK-120).
- Townsfolk already drop to 2 at that size.

### Performance in OBS

- Targets at 40 chatters with full motion: **≤ 1500 draw calls** and **≤ 10 ms** frame time at 1080p (FK-118, FK-119).
- Flocks, smoke and pets cast no shadows.
- Every new motion layer is checked with `?stats=1` (FK-065).

**Baseline numbers** (filled in by FK-065 on a 40-dude demo world on Lane D's port, never the live one):

| Measure | Today | After M1 | After M2 |
|---|---|---|---|
| fps at 1080p | — | — | — |
| draw calls | — | — | — |
| walkers in frame | — | — | — |
| movers moving | — | — | — |

---

## 4. Card map (motion auditor's MO-numbers)

| MO | Card | Milestone |
|---|---|---|
| MO-1 Stats overlay | FK-065 | M2 card, done in M1 (Ready now; Lane D's day-1 warm-up) |
| MO-2 The world breathes | FK-029 | M1 |
| MO-3 Bird flock | FK-066 | M2 (Lane D, or C if D is behind) |
| MO-4 Age-life movers | FK-068 (design), FK-069 (runtime), FK-098, FK-104 | M2 / M3 / Later |
| MO-5 Follow-pets | FK-027, FK-028, FK-049 (keep `moves` on restyle), FK-051, FK-052 | M1 / M2 |
| MO-6 Mover caps and turn-taking | FK-067 | M2 |
| MO-7 Calm during scenes | FK-032 | M2 (first M2 card for Lane D) |
| MO-8 Merge static build parts | FK-118, FK-119 | Later, but **must land before any stream with 20+ chatters** |
| MO-9 Thin idle walking at scale | FK-120 | Later |

All new motion is gated on Story ON at first (BOARD.md ground rules), so the live show only changes when Sami flips the switch.
