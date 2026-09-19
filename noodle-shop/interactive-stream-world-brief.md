# Interactive Livestream World — Design Brief

Audience: whoever, or whatever, builds the next world. This document covers what has been built, what each version taught, the principles that fall out of that, and the candidate worlds. Build **The Server Room** (section 5) first.

## 1. What this is

A Kick livestream in which an AI protagonist lives in a 2D side-on world. Viewers talk to the protagonist through chat, and chat changes both the protagonist's behaviour and the state of the world. The stream is the world, the protagonist is the host, and chat is the cast.

## 2. What has been built, and what each version taught

### v1 — Cyberpunk skyline
- Protagonist wandered a 2D cyberpunk skyline. Chat could talk to them.
- Worked: direct conversation with the protagonist. Viewers liked talking to a character who answered.
- Failed: no goal, no loop. Nothing drove conversation and nothing chat said changed anything. The protagonist walked around; that was it.
- Lesson: conversation alone isn't an experience. Talk needs consequences.

### v2 — Noodle shop
- Protagonist was the owner of a single noodle shop. Chat could talk to him about noodles and order a bowl; an avatar walked in, sat down, and was served. Random events (a vending machine flickering and breaking) gave chat something to spot and report, and the shopkeeper went and fixed it. The shopkeeper planted a flag in the world for whatever a chatter asked for.
- Worked: a bounded place; a clear role (shopkeeper); one universally legible verb (order noodles); each request produced something physical in the world (an avatar, a flag); events gave chat a job beyond ordering.
- Failed: no arc. Every order was complete in itself and nothing carried forward. No scarcity: the shopkeeper could serve everyone, so orders were independent and chatters had no reason to care about each other. Nothing could be lost, so nothing was at stake. Fun, but shallow once the novelty wore off.
- Lesson: this is the correct skeleton. It needs an arc, scarcity, and things that can be lost.

### v3 — Rocket builder
- Protagonist was building a rocket. Chat was meant to help or hinder.
- Worked: the idea of a goal, and of chat pushing it forwards or backwards.
- Failed: the goal was legible ("build a rocket") but contributions weren't. Nobody in chat knew what to do to help. Even the designer couldn't list items to put in the world. The domain was too abstract and too broad.
- Lesson: an arc without a legible loop is a stage with no script. If you can't list twenty things to build in five minutes, the domain is wrong.

### Diagnosis
- Skyline: conversation, no loop.
- Noodle shop: loop, no arc.
- Rocket: arc, no loop.
- Target: a legible loop where every action is visibly a brick in an arc, and chatters own things that can grow or be lost.

## 3. What works — principles for a world

Use these as acceptance criteria. If a world idea fails more than one, drop it.

1. **Bounded place.** One room, one shop, one building cross-section. Never an open world. The wider setting is scenery, not play space.
2. **Find the shopkeeper.** The protagonist holds a service role: a job that consists of fielding requests from many people with too little time. For any theme, ask "who is the shopkeeper in this theme?" Cyberpunk failed as a city and works as a building super. Hacking fails as a hacker and works as a sysadmin.
3. **Legible verbs.** Every chatter must know what they can do within thirty seconds of arriving, without instructions. Verbs map to real-world actions everyone already understands: order, water, fix, pay, plug in. Test each verb on someone who has never seen the stream.
4. **The loop.** Request → protagonist acts → a physical, persistent artifact appears or changes in the world. The artifact is the receipt. The flag in v2 was the prototype.
5. **The arc.** A visible goal the protagonist progresses toward. Each loop action is a brick in it. Show progress on screen at all times. Give it a climax and a reset (a season, a deadline, a review) so the stream has a rhythm.
6. **Ownership.** Each chatter has a named thing in the world that persists across streams. Their name is on it. They come back to check on it.
7. **Mortality.** Owned things decay if neglected and can be lost. Stakes exist only if loss is possible. Make decay visible and gradual (healthy → warning → failing → gone) so chat has time to intervene.
8. **Scarcity.** The protagonist's time and the world's resources are finite. Chat must negotiate priority. Chatter-versus-chatter tension is where depth comes from; it's what v2 lacked.
9. **Help or hinder.** Shared resources can be consumed or sabotaged. World state can go down as well as up. Hindering must be possible, visible, and attributed (the protagonist says who did it) so that chat polices itself.
10. **Protagonist agency.** The protagonist has a want of their own that competes with chat's demands, a personality anchor (the shopkeeper talked about noodles), and the right to refuse. Influenced, not puppeted.
11. **Events.** Random breakages and threats that chat notices and reports (the vending machine), now aimed at things people own. Events are the pacing device between requests.
12. **Memory.** The protagonist remembers individuals and their things. Regulars get recognised. Status accrues.
13. **The item list writes itself.** A good domain produces twenty buildable objects and ten events without effort. Use this as the go/no-go test before building anything.

## 4. What doesn't work — anti-patterns

- Open worlds and broad settings with nothing to do (v1).
- Abstract goals where "helping" has no obvious action (v3).
- Interactions that are complete in themselves and carry nothing forward (v2).
- Infinite capacity: the protagonist can serve everyone, so nobody competes (v2).
- Immortal ownership: nothing can be lost, so nothing matters (v2).
- A protagonist with no wants, who does whatever the last message said.
- Verbs that require domain knowledge to discover.

## 5. Build first: The Server Room

Revised after the first build pass. The room, racks, boxes, power, heat, decay, events, seasons and LEGACY-01 all stand. What changed: **boxes now have jobs, the room now has demand, and a work-order board gives chat a role it can see.** Everything below supersedes the earlier §5.

### 5.1 Premise

A single server room, off the books. It is an edge facility head office believes was decommissioned years ago. It wasn't. It still carries a slice of live chat traffic for its region — including the chat this stream is running on.

**The room carries the chat you are typing into.** That is the premise, and every mechanic hangs off it. Chatters own the machines that run the pipeline. Ray keeps them alive. If the room drops, chat drops.

Why this world: the visual carries the legibility — a wall of named boxes with lights, green good, red bad, dark dead. The domain produces objects and events endlessly. Hindering is natural (hog the power, unplug something, or just talk too much). Scarcity is physical (slots, watts, heat). And the premise makes the audience diegetic: **chat is the load, the capacity, and the alerting system at the same time.**

### 5.2 The protagonist

Ray. Sole sysadmin. Tired, competent, dry. Loves the machines and talks about them like pets. Protective. Argues with chat about priorities. Remembers regulars and their boxes ("your box again, Dave"). Refuses obviously destructive requests; can be talked into risky ones if chat makes a case. Never silent for long — narrates what he's doing and why while walking between tasks.

Three layers, in order of how openly he'll discuss them:

- **Public duty.** Nobody upstream knows this facility is load-bearing. If Ray lets it die, a chunk of a region's chat goes dark and no one up the chain can even locate the fault. The room is his because nobody else remembers it exists.
- **Private want: LEGACY-01.** The ancient box in the sealed compartment at the foot of rack 1. Nobody knows what it runs. It has never been rebooted. It is *why the room is still on the network at all* — Ray doesn't know what it does, but he knows that the last time he unplugged something next to it, the uplink light went out. He will protect it over any chatter's box and deflect every question about it.
- **The wound.** He asked for this posting after the outage that got the facility written off. The uptime sign on the wall is not a score, it's a sobriety chip. He will not say this.

The friction, which is the point: chat wants capacity → capacity wants watts and slots → LEGACY-01 hoards 200 W and a compartment he will not reclaim → chat eventually works out that killing it frees real headroom → Ray refuses and **cannot explain why.** He reads as stubborn. He is right. Never resolve it.

Tell this with art, not dialogue: **the uplink fibre runs down the wall and into the sealed compartment.** Let chat find the cable.

The fish tank stays. Two fish, ping and pong, on top of the telemetry monitor, no chiller, so they ride room temperature and suffer before the servers throttle. Ray notices the fish before he notices the boxes and is embarrassed about it. They are the room's early-warning system and its only softness.

### 5.3 The world (scene)

2D side-on cross-section, dark, cool-toned, monospace throughout. Room tint shifts warmer as temperature rises.

Standing elements: **racks** (start with one of 8 slots, room for three), **boxes**, **status LEDs** (green / amber / red / dark / compromised), **desk and terminal** with the scrolling event log, **cooling unit** with temperature readout, **power panel** with breaker and live wattage against budget, **cable tray** along the ceiling (the rat's path), **door** (deliveries, dust), **uptime sign** ("DAYS SINCE LAST OUTAGE"), **memorial wall**, **fish tank**.

New, and all of it load-bearing for the premise:

- **Uplink panel.** Fibre entering the room, lit while the room is carrying traffic, dark on outage. Physical proof the room is part of something. Cabled into the LEGACY-01 compartment.
- **Work-order board** — the floor monitor, repurposed. The room's ticket queue on a CRT. See §5.9. This is the single biggest visual change and the main thing a new viewer reads.
- **Chat monitor**, extended: each line tagged with the box that handled it (`[s3]`), a lag readout when there's a backlog, and foreign traffic rendered differently during a wave (dimmer, tagged with its origin node, visibly burying the locals).
- **Boxes**, extended: a function label (`DELIVERY` / `AUTH` / `MOD`) and a load bar alongside the owner name.
- **Message pulses.** Every message travels as a spark from the chat monitor down to the box that handled it. Roughly 200 free receipts an hour, and the clearest possible statement of what the room is for.
- **Region share sign** on the wall: `CARRYING 3.1% OF REGION WEST`. The number grows with the room. This is the arc's headline.

### 5.4 Chatter ownership: functions

A chatter owns one box, and **the box runs one named function in the pipeline.** You don't own a server, you own the mod queue. This is what gives chat a role: not a health bar with your name on it, but a job the room needs doing.

Ship three:

| Function | Provides | On death, chat sees | Critical when |
|---|---|---|---|
| **DELIVERY** | message capacity, msg/min (many allowed) | backlog grows, chat monitor visibly lags, messages start dropping | always |
| **AUTH** | admits new arrivals | new viewers' messages held — "6 waiting to join" | raids and waves |
| **MOD QUEUE** | filters flagged messages automatically | Ray hand-moderates, which **eats his task time** | always |

MOD QUEUE is the one to get right. A dead mod box taxes the only resource nothing else can touch — Ray's hands — so its owner matters to everyone even when the room is otherwise green.

Deferred, in the order I'd add them: **METRICS** (dies → the work-order board goes blind and chat has to work off Ray's word alone), **VOD** (dies → the REC light goes out, nothing from this stream is kept), **CACHE** (multiplies delivery capacity), **THUMBS** (preview tile, discovery, slow burn). METRICS is the best of these and should be second wave, not first — chat has to trust the board before losing it means anything.

Rules:

- One box per chatter. One box per function, **except DELIVERY**, which takes as many as the room can carry.
- Functions are therefore scarce and named. Exactly one human is the auth person. Status accrues; §3.12.
- **Provisioning is the tutorial.** "give me a box" → Ray assigns the job the room actually needs, says what it does, and says how to change it. As built: **capacity beats capability** — if the room is struggling to carry what's arriving, it's delivery whatever else is unstaffed; otherwise the first unstaffed singleton; otherwise delivery, which always wants more.
- **A named singleton is first come first served.** Ask for auth when someone has it and Ray tells you who, and puts you on what's short instead. That refusal is how "exactly one person is the auth person" stays true.
- **Volunteering costs one message.** "I'll take the mod queue" from someone with no box is a request for a box on the mod queue, not a mistake — it provisions.
- **Cold start.** On stream one there are no chatter boxes, so Ray runs every function himself on taped-together hardware at a hard capacity penalty. Chatters *take over* from him. He is visibly grateful, which is a good beat for a man who doesn't say thank you easily.
- **Fallback, not brick.** When a chatter's box dies, its function falls back to Ray's old hardware at a penalty. Failure degrades; it never dead-ends the world.
- **Succession.** A dark box still owns its job — it's still theirs, and nobody else may claim it — but only for one stream. After a whole stream down, the job goes back in the pool and anyone can take it; the box stays theirs. Otherwise a singleton could sit unstaffed for three streams waiting on one absent owner, with chat unable to do anything about it. Decommission then frees the slot as before, and the plaque records the job: `kaz's box · AUTH · 402 days · 1.2M messages`.

Per-box fields as before (`health`, `patch_level`, `temperature`, `disk`, `power_draw`, `upgrades`, `compromised`, `uptime_days`) plus `function` and a lifetime `delivered` count. The lifetime count is what brings people back and what makes a plaque land.

### 5.5 Verbs

| Intent | Example messages | What happens |
|---|---|---|
| **Provision** | "give me a box", "I'll run auth", "I want one" | If a slot and the watts are free, Ray asks what it runs (or takes the function you named), walks to the rack, installs it with your name on it. Rack full → he says so and asks chat what to give up. |
| **Maintain** | "patch my box", "reboot mine", "clear my disk", "clean my fans" | Task queued. Restores patch level, health, disk, or temperature. Owner only. |
| **Upgrade** | "more RAM", "give me an SSD", "second PSU" | Task queued if the budget and heat allow. Raises draw. Ray warns when it pushes the room near the limit. |
| **Report** | "slot 3 is red", "something's beeping", "auth is backed up" | **Raises a work order with your name welded to it.** Correct → credit on the board. Bogus → the board closes it `NO FAULT FOUND — raised by <you>`. |
| **Retask** | "make mine auth", "switch my box to delivery", "I'll take the mod queue" | Moves your own box to another job, if it's free. Refused for a singleton somebody holds — including one whose box is merely dark, until it's been dark a stream. This is the verb succession runs on. |
| **Claim** | "I'll take 413", "put me on the AC", "413 is mine" | You don't do the work; Ray does. You own the outcome, and **claims are the priority signal** (see §5.9). |
| **Ask / Talk** | anything conversational | Ray answers in character against real room state. |
| **Hinder** | "unplug Dave's box", "turn off the AC", "space heater", "prop the door" | Allowed, costly, always attributed. Refuses outright destruction of another chatter's box and anything near LEGACY-01 or the fish. Complies with reckless-but-survivable while naming who asked. |

Deliberately **not** shipping a `bump` / reprioritise verb. It's a verb too many and the negotiation it enables happens anyway: claims are the vote, and when two work orders genuinely conflict Ray asks chat in plain language and picks. Keep the argument in English, keep the agency with Ray.

New form of hindering, free with the load model: **talking is load.** Spam is mechanically a DDoS, and the engine knows who's generating it, so Ray can call it: *"kaz, you're forty percent of my traffic right now. breathe."*

Rules: only the owner (or Ray, unprompted) maintains or upgrades a box. Anyone can report anything. Unknown intent falls back to Ask — never fail silently. Every completed task produces a visible change in the scene, a line in the terminal log, and a resolution on the board. Moderate all free text before display.

### 5.6 Scarcity

Five hard limits, all on screen.

1. **Rack slots.** 8 to start. A full rack forces negotiation.
2. **Power budget.** 2000 W. Exceeding it trips the breaker; everything goes dark until Ray resets it and sheds load.
3. **Cooling.** Temperature rises with total draw and falls with cooling capacity. Throttle at 30 °C, fail at 38 °C.
4. **Ray's time.** One task at a time from a visible queue, each with a walk and a work duration. A dead MOD QUEUE spends this resource directly.
5. **Capability versus capacity.** Every non-delivery function costs a slot and its watts and returns a *capability* rather than headroom. This is the new one and it's the best argument in the room:

   > Do we run VOD, or do we survive Friday?

   Nobody's box is under attack. Chat is deciding what kind of room this is, out loud, with names attached.

### 5.7 The load model

```
demand   = regionalFloor(t) + localChat(smoothed msg/min) + wave(t)
capacity = Ray's fallback + Σ (delivery box capacity × health × throttle) × cacheBonus
```

**The regional floor is the important part.** This is an edge node for a region, not a private box for one stream, so the room sits around half load with three people in chat. Quiet chat still has stakes, the room still matters, and local chat is the *volatile spike on top* rather than the whole load. Give the floor a gentle daily curve so no two streams feel the same.

**Local chat is real chat.** Message rate straight off the live feed.

**Waves are rerouted traffic**, which is diegetically perfect: upstream shunts another node's crowd through you because that node fell over. *"upstream's rerouting the westcol crowd through us. node 3 is on the floor. we're it."* The wave is simulated chat piped in from other channels, rendered as foreign traffic on the chat monitor — dimmer, tagged `via NODE-3`, unreplyable — visibly burying the locals. Your own message arrives late, behind a flood of strangers. The stakes stop being a number and become *our chat is being drowned out.*

It also makes upstream work orders literally true: "capacity notice, +40% Friday" becomes a promise the world keeps.

The failure gradient — the thing the original design lacked, because breaker-or-nothing is too binary:

| State | Chat sees |
|---|---|
| under 70% utilisation | boxes cruising, messages instant |
| 70–90% | load bars amber, Ray starts asking for boxes |
| over 100% | **backlog** grows; the monitor shows how many seconds behind chat is |
| backlog over threshold | **messages drop.** The counter ticks. Overloaded boxes run hot and lose health |
| sustained | boxes die → capacity falls → cascade |
| zero capacity | **the room goes deaf** |

**Deafness is the best moment in the design.** On outage Ray cannot see chat: the monitor goes to static, he keeps talking to a dead screen (*"say something. anything. …right."*), and incoming intents buffer unprocessed until the breaker resets, then land all at once and he reacts to the flood. Outages stop being a number that decrements and become something the audience is inside.

Rules that keep it fair:

- **New arrivals are delayed, never dropped.** Admission delay caps at ~15 s even with AUTH down, and Ray narrates the wait. A first-time chatter's first message always lands.
- Nothing unannounced may kill a box outright. Small waves are pacing; big ones get an upstream work order a stream or two ahead, because **chat's preparation is the game.**

### 5.8 Mortality and decay

Unchanged in shape: health decays while live, faster at low patch level, high temperature, full disk, or when compromised; slower but nonzero offline; green → amber → red → dark; a dark box revivable by reboot within a grace period; dark for three streams → decommissioned, slot freed, name on the memorial wall.

Now with consequences that read: a dying box is a *function* degrading, so its owner's neglect is legible to everyone in a specific way. And **compromise** still spreads to unpatched neighbours, which is how one chatter's neglect becomes everyone's problem and why chat nags each other to patch.

### 5.9 Work orders — the board

The floor monitor becomes the room's ticket queue. It converts the invisible task queue and the report verb into a shared, glanceable, actionable list, and it's what a new viewer reads to understand their options in ten seconds.

```
WORK ORDERS                          EDGE-7 / WEST ANNEX
─────────────────────────────────────────────────────────
WO-0413  SEV2  AC-1 fan fault              OPEN
               raised by SENSOR            unclaimed  4m
WO-0412  SEV1  delivery s3 dropping (kaz)  IN PROGRESS
               raised by mireille          ray  ▓▓▓░ 68%
WO-0411  SEV3  disk full — slot 6          CLAIMED
               raised by SENSOR            benji  11m
WO-0409  ---   capacity notice: +40% Fri   OPEN
               raised by UPSTREAM          due 2 streams
─────────────────────────────────────────────────────────
WO-0408  closed: NO FAULT FOUND — raised by tomcat99
```

Ticket fields: id, severity, title, subject (box / job / room system), raised-by, claimed-by, opened-at, optional due-at, state, resolution line. As built the state machine is `OPEN → QUEUED → IN PROGRESS → RESOLVED` (plus `EXPIRED` and `NO FAULT FOUND`), with **CLAIMED** an overlay rather than a state — a ticket can be claimed at any point, and claiming doesn't change whether Ray has started. Two distinctions the board has to keep straight: *queued* means Ray has the work in hand but hasn't started it, and only the one task he is actually on shows a progress bar.

**Tickets are declarative, and that's the load-bearing decision.** Each kind knows how to detect whether its own fault is still present, and how (if at all) Ray fixes it. So the board self-corrects: a fault nobody reported gets raised by the sweep, a fault that clears on its own closes its own ticket with a resolution, and there is no parallel bookkeeping to drift out of sync with the room. It also means events mostly needed no changes — an event sets room state, and the sweep notices.

**Some kinds are advisory**, because Ray genuinely cannot fix them: a full disk, a dark box, chat capacity, an unstaffed job. Those sit on the board naming who has to act (`benji: say "clear my disk"`). That nagging is the point, and it's what turns the load model and the job vacancies into things a viewer can see and answer.

**The board is Ray's queue.** He works it worst-first — severity, then the claim vote, then age — one or two items in hand at a time. Owner requests (patch, upgrade, retask, provision) stay direct tasks and are deliberately *not* tickets: the board is for things chat can spot and negotiate, and your own patch request isn't something chat votes on.

Three sources:

1. **SENSOR.** Events auto-raise tickets. Chat no longer has to catch a log line scrolling past — the board shows the work. Gentler onboarding, and the terminal log survives as the *cue* for people who want to be first to spot it.
2. **Chat.** Reporting *is* raising a ticket, and your name stays on it permanently. Because the sweep has usually already raised whatever is genuinely wrong, a correct report doesn't duplicate it — the reporter is credited and added to the existing ticket, so one fault is one ticket with every spotter's name on it. Only a report with nothing behind it raises its own, and that one closes publicly as `NO FAULT FOUND — raised by <you>`. Ray's time is the scarce resource, and that receipt is better social pressure than any counter.
3. **UPSTREAM.** Scheduled work orders from up the chain — the voice from outside the room the world currently lacks entirely. Capacity notices ahead of a wave. Compliance deadlines ("all boxes at patch ≥ 80 by end of stream"). Migrations. External pressure, a deadline chat can organise around, and something for Ray to resent out loud.

**Claiming.** "I'll take 413." You aren't doing the work; Ray is. Claiming means you're the one who told him to, you're on the hook, and the credit or the blame is yours in the resolution line. Claims double as the priority signal: a ticket with three claimants outranks one with none, and when two genuinely conflict Ray asks — *"kaz's delivery box is dead and the AC's failing. one of them waits. talk to me."* — then picks and says why.

**Chat can also raise tickets upstream**: "ray, ask them for more power." It goes up the chain and resolves two or three streams later when a crate arrives at the door. Latency as a mechanic, paid off by persistence that already exists.

Never print moderated content on the board. A hand-moderation order reads `hand-moderating (mod queue down)` and nothing else.

### 5.10 Events

Roll on a timer, weighted toward whatever the room is currently weak at. Every event now **raises a work order** in addition to leaving its cue in the log.

Existing table stands: intruder probing, DDoS, power flicker, rat in the cable tray, AC failure, disk full, delivery at the door, LEGACY-01 noise, door left open.

Add:

| Event | Cue | If ignored | Fix |
|---|---|---|---|
| **Traffic wave** | Upstream notice, then foreign messages flooding the chat monitor | Backlog, dropped messages, boxes cook | More delivery capacity, before it lands |
| **Node failover** | An upstream ticket: another node is down, permanent share increase | The room runs hotter forever | Grow, or hand the share back and lose region share |

### 5.11 The arc

- **Primary score: messages delivered.** Cumulative, large, satisfying, and every person in chat contributes to it by existing. Its shadow, **dropped**, is the number nobody wants to see move.
- **The streak:** days since last outage, on the wall, unchanged.
- **Region share:** the headline sign. Growth is re-scaled to the premise — the room isn't getting bigger for its own sake, it's carrying more of the network. Closet → room → floor becomes 3% → 6% → 10%. Ray gets prouder. Stakes rise with the number.
- **Season climax: the announced wave.** Upstream names the number and the date, chat gets two or three streams to prepare — more delivery boxes, more watts, second AC unit — and then the peak arrives. The room holds or it doesn't, and the uptime sign tells the truth afterwards. A clean quarter earns hardware; outages cost.
- **The private thread:** LEGACY-01, unexplained, occasionally emitting a clue, defended over chat's requests. Never resolved.

### 5.12 HUD / overlay

Rack board (every box, owner, function, status). **Load meter: demand against capacity**, with the backlog seconds when there is one. Power meter. Temperature gauge with threshold marks. **DELIVERED / DROPPED** counters. Uptime counter. Region share. Task queue: what Ray is doing, what's next, who asked. Event log. Pinned onboarding line, rewritten for the premise:

> This chat runs on these servers. Type "give me a box" to run one.

### 5.13 Simulation

- World tick every few seconds: heat, power, health, disk, load, backlog; roll for events.
- Persist full state between streams; apply offline decay at stream start and have Ray narrate what changed overnight.
- Task queue FIFO with Ray's overrides; every task has a walk time and a work time.
- Intent classification on every local message with a confidence threshold, falling back to conversation.
- **Foreign wave traffic never reaches the intent classifier or Ray's dialogue.** It is load, not requests — one flag at ingest.
- **Foreign text is on screen, so it goes through the same moderation path as box names.** Consider rendering a sampled subset with a `+340 more` counter: safer, cheaper, and it reads as heavier than showing everything.
- Prefer a recorded corpus over live cross-channel ingest for waves in v1 — controllable volume, pre-moderable, repeatable for tuning. Live ingest later, if ever.

### 5.14 Guardrails

This streams on the platform it depicts, so keep the platform real and the facility unmistakably fictional and Ray's own: EDGE-7, the west annex. The upstream voice is `UPSTREAM` / `OPS`, never a named corporate office issuing orders. When the room fails, it must read as *this room's* fault and never as a claim that the platform is down — no status-page imagery, no service-wide language. Cheap to get right now, awkward to retrofit.

### 5.15 Build order

1. ~~**Load model.**~~ *Built.* `traffic` state, capacity from delivery boxes, demand from real chat plus regional floor, backlog and drop resolution, overload heat and health drain. This is the whole design — get the curve right here and the rest is presentation.
2. ~~**Functions.**~~ *Built.* `job` on the box, the three v1 jobs, Ray's cold-start fallback, provisioning as the tutorial, vacancy and succession, `delivered` per box.
3. ~~**Work-order board.**~~ *Built.* Tickets in state; the floor monitor rewritten; telemetry demoted to the interlude the monitor already supports. Events raise tickets (mostly for free — the sweep notices state).
4. ~~**Claim verb**~~ *Built.* Credit and blame in resolution lines, claims as priority signal.
5. ~~**Ray's brief update.**~~ *Built.* One deliberate rewrite of the character card rather than the paragraph-per-feature accretion it had become: the public duty and the wound are in it now (both with a standing instruction never to explain the wound), LEGACY-01 is reframed as the reason the room is still on the network, and the uplink cable is named as the thing he must never confirm.

   Two things worth keeping in mind for the next world. **The state summary is written for salience, not completeness** — it goes board, traffic, jobs, room, boxes, then settled background, because it's injected into every dialogue call and the model reads the top of it hardest. Detail is spent only where something is wrong: a healthy box gets `[DELIVERY] ok (health 100)`, a failing one gets `RED, DISK FULL, UNPATCHED — health 25, patch 10, disk 100%`. Every box still gets a line, because an owner asking "how's mine?" has to be answerable and the card forbids guessing. That restructure cut the summary by a quarter while the card grew by the same, so the per-call cost came out flat.

   And **the protagonist decides what they're chewing on**, not the engine: a persona-level `idleFocus(state)` hint is appended to the idle-line instruction, so an unclaimed SEV2 outranks a nudge about an unstaffed job, and a room dropping messages outranks everything. It deliberately skips work he has already started — grumbling that nobody claimed the fault he's currently fixing is nonsense.
6. **Scene work:** uplink panel into the compartment, shard tags and lag on the chat monitor, load bars and message pulses, HUD load meter and delivered/dropped.
7. ~~**Deafness on outage.**~~ *Built.* Static monitor, Ray talking to nobody, held messages landing at once.

   The gate is a world-level `audible(state)` — zero carrying capacity, which today means the breaker — and the engine holds arrivals behind it rather than the world doing its own bookkeeping. Held, not dropped: a bounded 200-deep queue, and everything in it reaches the screen. Two things fell out of building it that the design hadn't said. **Order is the whole beat:** the flood hits the screen in one go, *then* he reacts to the size of it, *then* the newest few are answered — reacting after eight sequential model round trips is reacting to nothing. And **a flood is answered once**, at its newest message: the engine tells the world how much of the replay is still behind each message, so the conversational intent stays quiet for the rest instead of posting eight brush-offs in a row.

   The static screen carries `NO SIGNAL`, how long it has been dark, and *your messages are held* — Ray can't read any of it, but a viewer typing into a dead room needs to know the stream isn't broken. That is the one deliberate crack in the fiction here.
8. **Waves.** Corpus ingest, foreign rendering, upstream capacity notices, the announced season peak.
9. Second-wave functions: METRICS, then VOD.

### 5.16 Starting numbers

Tune live. Existing numbers stand (8 slots; 2000 W; 150 W base draw; RAM +50 W, SSD +20 W, PSU +100 W; health −3/hr at green doubling per band, ×3 overheating, ×5 compromised, −4/day offline; patch −5/hr, vulnerable below 30; disk +3%/hr; throttle 30 °C, fail 38 °C; events every 3–5 min; walk 5–10 s, patch 20 s, reboot 15 s, upgrade 45 s, repair 60 s; decommission after 3 dark streams).

New. These are the values the load model shipped with, after tuning against `npm run sim:load`:

- **Delivery capacity:** 240 msg/min per box at full health, scaling linearly with health, ×0.7 while the room is throttling, 0 when dark.
- **Ray's fallback:** 300 msg/min, and it never improves. Sized to carry a quiet morning alone and visibly fail an evening, so a cold-start room is urgent without being a wipe — a viewer's first "give me a box" has to be able to land. At zero boxes the room drops about a third of arrivals; one box takes it to ~85% utilisation and zero drops.
- **Regional floor:** 260 msg/min mean, daily curve 160–360, peaking around 21:00 local. Raised from a first pass at 120: at that level a three-box room idled at 40% utilisation all stream and nothing was ever at stake.
- **Backlog:** accumulates at `demand − capacity`; drops messages above 500 queued; lag shown as `backlog / capacity` in seconds. At a typical capacity that cap is roughly 35 s of lag before anything is actually lost.
- **Overload damage:** above 90% utilisation, extra heat and health decay proportional to the overshoot, capped at 1.0 so a huge wave can't instantly kill the rack. 20 health/hr at full overload.
- **Overload heat is absorbed by a working AC** — the unit is sized for the room. The compounding case is overload *plus* a cooling failure: throttling cuts capacity, which raises utilisation, which adds heat. In simulation a two-box room sitting at 70% reached 136% and a death spiral without demand changing at all. That interaction is the most dangerous thing in the model and it wasn't designed, it emerged.
- **Drop announcements:** Ray announces a dropping spell starting, reminds on a 5-minute timer that backs off as the spell drags, and — the part that closes the loop — says when the room catches up.
- **AUTH:** admits 20 new chatters/min; with auth down, admission falls to Ray's 5/min. A token bucket, so the first arrival into a clear room walks straight in and the queue only builds behind them. Holds cap at 15 s however long the queue gets — **delayed, never dropped**, and only ever for someone the room has never seen before. How many are at the door is derived from how far ahead the bucket runs, so a restart leaves nothing stale.
- **MOD QUEUE:** while down, each flagged message enqueues an 8 s hand-moderation task at priority 6 — above routine maintenance, below a tripped breaker — one at a time and no more than one per 20 s, so a noisy chat can't bury Ray. The flag test is deliberately **content-agnostic**: link spam, sustained shouting, character runs, and messages built from almost no distinct words. It decides whether the queue has work; it never judges what a message says, and the message itself is never logged or shown on the board. The LLM moderation path stays reserved for text the room is about to put on a screen.
- **Waves:** +300 msg/min for an unannounced ripple (a scare: a three-box room hits 85% and loses nothing), +900 for an announced season peak. Measured threshold for a peak: four boxes drops ~7% of arrivals, five holds at 98% utilisation, six is comfortable at 85%. So a peak costs five or six delivery boxes and is not survivable while also running every capability.

### 5.17 Open decisions

- Whether a chatter can ever own more than one box (function scarcity argues no for now).
- Whether wave traffic renders in full or sampled with a counter.
- ~~Whether the deaf-outage buffer replays fully or sampled.~~ **Decided:** neither. Everything held is displayed, so nothing a viewer typed disappears, and only the newest eight are classified and run as intents — a full replay is one classifier call per held message and answers a room that has moved on.
- Exact shape of the regional floor curve.
- When credits arrive, if ever — capability-versus-capacity may be enough forever.
- Whether LEGACY-01 is ever explained. Current answer: no.

## 6. Other candidate worlds

### 6.1 The Apartment Block (cyberpunk)
- Shopkeeper: the building super of one apartment block. The megacity is the view out the windows; the v1 skyline becomes scenery.
- Ownership: a chatter moves in and their window lights up with their name. Tenants can decorate.
- Verbs: report breakages (plumbing, power, elevator), pay rent, request repairs, complain about neighbours.
- Scarcity: the super fixes a limited number of things per night; one shared power grid.
- Mortality: skipped rent leads to eviction and the window goes dark. Floods and fires damage units.
- Hinder: skip rent, throw parties, run a rogue power tap that browns out a floor.
- Events: elevator breaks, water main bursts, gang shakedown, corp inspector, blackout.
- Arc: the corp wants to condemn the building; buy it before they do. Rent collected is progress.
- Protagonist want: their own unit, and the tenants who've been there longest.
- Strength: the most legible verbs of any concept (everyone has had a landlord), the strongest visual (a wall of lit, named windows), and it reuses existing art.

### 6.2 The Familiar Nursery (wizardry)
- Shopkeeper: a wizard in a tower who hatches and raises familiars for chat.
- Ownership: a chatter is handed an egg; it hatches into their named creature and grows across streams.
- Verbs: feed, train, name, play with, ask the wizard to teach it something.
- Scarcity: the wizard's mana and hours per day; only so many creatures fed and trained.
- Mortality: neglected creatures sicken, run away, or get eaten by a bigger one.
- Hinder: feed a rival's creature the wrong thing, let it loose, provoke it.
- Events: a creature sets fire to the library, an escape, an inspector from the Archmage, a storm.
- Arc: the wizard's thesis is due to the Archmage and the creatures keep interrupting it. Seasonal exams for the familiars.
- Strength: the garden's proven mechanics with far more personality per owned object.

### 6.3 The Garden / Homestead
- Shopkeeper: a gardener tending one plot.
- Ownership: a chatter plants a seed; it becomes their named plant, growing in real time across streams.
- Verbs: plant, water, weed, cover, pull, harvest.
- Scarcity: the gardener's hours; water in the barrel.
- Mortality: plants wilt and die when unwatered; pests; frost.
- Hinder: lobby to pull a rival's plant, hog the water.
- Arc: the season, ending in a harvest. The protagonist's own want is a prize pumpkin for the fair.
- Strength: the most universally legible verbs there are, and natural retention ("come back and see how it's grown").

### 6.4 Noodle Shop v2
- The v2 shop with an economy and stakes: rent due each stream, orders are cash, cash buys upgrades chat votes on, regulars get a named stool, and the shop can grow into a restaurant or go under.
- Strength: the loop is already proven. Weakness: the least new.

## 7. Decisions still open

Server-room specifics now live in §5.17. Open across all worlds:

- Protagonist voice: text only, or TTS.
- Exact offline decay rate. Err gentle at first.
- How far the protagonist goes on hinder requests before refusing.
