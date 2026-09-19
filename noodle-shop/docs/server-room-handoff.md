# Server-room continuation handoff

Updated 2026-09-09 (third session: the simplification pass). Resume here after reading `interactive-stream-world-brief.md`, especially §5.

---

## THE SIMPLIFICATION PASS (2026-09-09, third session) — READ THIS FIRST

Everything below this section describes the **pre-simplification** world and is
kept only as history. Where the two disagree, this section is current.

The room was built for an audience that reads computers. It has been rewritten
for an audience that does not. **Ray is now Admin**, boxes are **servers**, and
every viewer-facing string is plain English.

### What the world is now

One sentence: **chat flows in, servers carry it, more chat needs more servers,
servers use power, power makes heat.**

- **No jobs.** DELIVERY / AUTH / MOD are gone. Every server does the same one
  thing: carry chat. `jobs.ts` (admission token bucket, the door queue,
  `looksFlaggable`, hand-moderation) is **deleted**, and `WorldModule.receiveMessage`
  is no longer implemented.
- **Two viewer verbs on their own server: `upgrade` and `restart`.** Upgrading
  raises one `level` (0-3): more carried, more watts. Restarting revives a
  server that has died or is struggling, back to full health. `maintain`
  (patch / reboot / clear disk / clean fans) and `retask` are **deleted**.
- **Servers die at random.** New `server-died` event, weighted toward servers
  already struggling — the reason an owner has to be watching. Only they can
  restart it, and the room carries less until they do.
- **Kept, because the user asked for them:** the power budget and breaker, the
  air con and the heat model, health/wear, the board (report/claim), the fish,
  LEGACY-01, the memorial wall, the uptime sign, the quarterly review, the
  outage-deafness behaviour, and the traffic simulation itself.
- **Removed mechanics:** patch level, disk fill, the RAM/SSD/PSU parts list,
  break-ins and infection (`intruder` / `compromised`), and the `disk-full`,
  `job-unstaffed`, `moderate`, `intruder`, `compromised` ticket kinds. `ddos`
  became `junk-traffic`; `box-fault` became `server-down`.
- **Ticket ids are internal.** `job-13`, not `WO-0413`, and they are never
  spoken and never shown. Admin names the problem instead ("the air con"), and
  `claim` matches on description, with "I'll take it" meaning the worst thing up.
  `ticketById` is gone.

### Schema is v6

`serverRoomStateSchema` and `meta.stateVersion` are **6**. Renames: `boxes` →
`servers`, `Box` → `Server`, `chatters[].boxId` → `serverId`,
`incidents.rat.boxId` → `serverId`. Dropped from the schema: `job`,
`patchLevel`, `diskPct`, `upgrades[]`, `compromised`, top-level `admission` and
`moderation`, and `incidents.intruder`. Added: `level`.

`v5ToV6` keeps every server, owner, name, health and lifetime count, turns each
fitted component into one upgrade level, moves the chatter pointer, and clears
the board so the sweep re-raises what is still wrong. `migrateState` now
normalises `servers` → `boxes` at the top so the older steps still work on a
snapshot that has already been renamed.

**Verified against a copy of the real v5 snapshot** (`.preview/step8/migrate.ts`,
run with `DATA_DIR=.preview/step8/data`): Sami's `box-75fcf056` survives with
`level 1` from its one `ram`, 61,935 carried; room totals came through exactly
(272,075.589 delivered / 2,250.4616 dropped); v6 round-trips on a second boot.

### The floor monitor is one fixed page

`screens.ts` exports **only `statusScreen`** — one page, no cycling, no
interlude. `boxScreen`, `roomScreen`, `boardScreen` and `telemetryScreen` are
gone, and with them roughly twenty pages of telemetry.

```
STATUS
THE SERVER ROOM
CHAT      flowing well
SERVERS   4 running
POWER     800 of 2000W
ROOM      22°C, air con on
ADMIN     watching the room
say "give me a server" to help out     <- footer
ALL SYSTEMS ARE GREEN                  <- alerts, rotating every 3.5s
```

**Width is the constraint that bites.** The monitor gives the renderer 280px of
body text, which at the compact 16px monospace is **29 characters** — a 30th
truncates mid-word. `SCREEN_COLS = 29`, `LABEL_COLS = 10`, so a value has 19.
`FOOTER_COLS = 38` because the footer draws at 12px. Every `DOING` phrase must
fit 19; `servers.test.ts` pins that, and "getting the power back" (22) is the
one that already shipped broken once.

### Renderer changes worth knowing

- `infoMonitor.ts` **no longer collapses runs of plain spaces** (only other
  whitespace), because collapsing them turned the aligned label/value table
  into ragged text. It also hides the `N/M` page counter when there is one page.
- Entity kind `box` → `server`. The D/A/M job glyph became **up to three upgrade
  pips** in the same five-pixel vent space; the compromised pink is gone; every
  running server gets a load strip, not just delivery ones.
- `messagePulses.ts` dropped the `props.job === 'DELIVERY'` gate.
- `chatMonitor.ts`: header `IRC / #ops` → `CHAT`; the `[s3]` receipt tag and the
  `EDGE-7 / simulated routes` legend are **deleted** (the pulse animation already
  says which server carried a message); `QUEUE ~Ns EST` → `KEEPING UP` /
  `Ns BEHIND`; the deaf panel says `CHAT IS DOWN` and `nothing is reaching admin`.
- `trafficReadout.ts`: `CHAT · <status>` and `CARRIED` / `LOST`. With no
  capacity it says `340 a min arriving` rather than the glitch-looking
  `340 of 0 a min`.
- `SceneTraffic.status` values are now viewer-facing sentences:
  `FLOWING WELL | GETTING BUSY | AT THE LIMIT | LOSING MESSAGES | NOTHING GETTING THROUGH`.
- **Art label fix:** the mains panel was labelled `AC`, which chat reads as the
  air conditioning — in a world where "the air con is off" is a core mechanic.
  It now reads `PWR`, and the cooling unit is labelled `AIR CON` (red when broken).
- `hud.ts` board section `RACK` → `SERVERS`. The HUD is still built and still
  never drawn (`main.ts:401` suppresses it when `worldWidth === width`).

### Tests

**125 passing** across scene(+receipts) 31+8, load 22, outage 14, servers 14,
tickets 16, persona 15, dialogue 7, kick 6 — all green in one run, typecheck and
build clean.

`scripts/jobs.test.ts` is **deleted**; `scripts/servers.test.ts` replaces it
(`npm run test:servers`, and `test:jobs` is gone from `package.json`) covering
upgrade/restart, the power refusal and its re-check-on-arrival race, the random
death, the plaque, the fast path, and the status-row width guard.

The `Box` literal was duplicated at nine sites with no shared helper; all nine
are now `Server` literals. **There is still no shared fixture module** — the next
schema change is another nine-site edit.

### Real-renderer verification

`.preview/step8/check.mjs` (13 fixtures + 960×540), `pips.mjs` (upgrade pips are
visually distinct: brightness 89 → 620), `crop.mjs` / `crop2.mjs` (readout, wall
panels, status page). All pass, no browser errors. New preview fixtures:
`upgraded` and `dead-server`.

**A trap for the next renderer check:** the pixel-art `text()` primitive draws
glyphs as rectangles, not `fillText`, so the `fillText` interceptor **cannot see
in-art labels** (`AIR CON`, `PWR`, `UPTIME`, `IN MEMORY`, `HOTEL`, `MAIL`).
Those have to be checked by eye against the crops.

### Live state, and what happened to the dev server

The v5 originals are preserved in **`data/step8-safety/1788915853000/`**
(`pre-shutdown.json`, `final-paused.json` + `.bak` copies). The paused v5 read
**272,075.589 delivered / 2,250.4616 dropped**, Sami's box dark with one `ram`
and 61,935 credited.

**The dev server was stopped for the schema work, but a stale background task
from an earlier session restarted it mid-pass (13:04).** It therefore migrated
the live snapshot to v6 on its own, and has been running the new code on the
real Kick stream since. No harm done and nothing lost — but note the migration
is **one-way**: `persistence.ts:28-33` makes an older build refuse to boot on a
v6 file, so `data/step8-safety/` is the only way back.

Live and healthy at the end of the session: **v6, ~294,700 delivered / 2,250
dropped, `season.outages` 0 and no `lastOutageAt` — the uptime streak survived
the whole pass.** Sami's server is retained, currently off (health 0) at level 3
(two free upgrades from delivery crates), 65,219 credited.

Live model behaviour was observed and is good — `[admin]`, plain language, and
he teaches the verbs unprompted:

> hey dylan. bad timing, the room's carrying nothing right now and chat's doing
> 218 a minute — say give me a server and you'd actually be helping.

One slip was caught and fixed: he was saying "your box". The card now explicitly
forbids "box" for a server. **That fix is untested against a live model** —
watch whether it holds.

### The personality pass (same session, after the simplification)

He came out of the simplification sounding like a monitoring dashboard: every
line about the servers, no jokes, no interest in the people watching. Three
things were causing it, and all three are fixed.

1. **The card was all duty.** `persona.systemPrompt` gains a **TALKING TO CHAT**
   section — he does *not* have to talk about the servers, the state block is
   "reference material, not an agenda", remember people, ask things back, tease
   and be teased, have opinions — plus "when something in here is actually going
   wrong, that wins" so banter can't eat the job. STYLE now asks him to vary his
   openings and not repeat himself (he is given his last 10 lines).
2. **Every unprompted line was forced to be a status report.** `loop.ts` said
   "grounded in the current room state"; it now says "it does not have to be
   about your work" and lets the world's `idleFocus` decide. `idleFocus` keeps
   its deterministic trouble ladder, but a room where nothing is wrong is no
   longer a subject — it returns one of **`IDLE_OPENERS`** (exported, nine
   directions: ask chat something open, follow up on what someone said, his own
   night, the fish, tease a regular, the city, a daft opinion). Picked at random
   so the stream has no predictable rhythm.
3. **The 20s per-user `ask` cooldown was swallowing conversations.** A
   back-and-forth *is* somebody answering within seconds, so the second half of
   every exchange was being dropped silently. Now `tuning.askCooldownMs = 8_000`.
   This is a fairness knob, not a cost one — spend is bounded by
   `DialogueService` (one call in flight, three queued, rest dropped).

`summarizeState` also gains an **`in chat just now:`** line — who has spoken in
the last 15 minutes, flagged `first time here` / `a regular` (10 min / 24 h off
`firstSeen`) and whose server they own. Without it he had usernames in the chat
log and no idea which of them he had met, so everyone got greeted like a
stranger.

**Verified against the real model**, not just asserted: `.preview/step9/banter.ts`
boots a real Engine in a scratch data dir with Kick replies off and runs a
casual conversation plus idle lines. Keep it for future tone checks. Sample:

> cold leftover rice straight from the fridge, standing up, no plate. anything
> that needs a plate at 3am is a lie you're telling yourself.
>
> took you four messages to get there but i respect the journey. now defend your toastie.
>
> right, honest answers only — what are you all meant to be doing right now
> instead of watching me sit here?

That second line is the multi-turn continuity working, and the run also confirmed
the 8s cooldown lets a follow-up land. One iteration was needed: the first draft
ended *every* line on a question, so the `ask` instruction now says a question is
"often the better line — but not every time". After that, 4 of 7 replies ended
open. Trouble still interrupts: a warm tank pulled him straight back to the fish
and the air con.

Tests: **127 passing** (persona 17). New coverage pins the banter permissions in
the card, the `in chat just now` block, and that the quiet-room idle line is
drawn from `IDLE_OPENERS` and actually varies rather than settling into a
catchphrase.

### The pace-and-pressure pass (same session, third iteration)

Two complaints: he wasn't chatting enough, and he was calm while the room fell
over. Both had structural causes, not prompt ones.

**Pace.** Measured before touching anything: a spoken line every ~68s median.
Two throttles — `idleMutterMs` (60s + a flat 0-30s jitter) and, worse, the loop
gated idle chat on `!engine.tasks.current`, so he went **silent for exactly as
long as there was something to watch him do**. Now:

- The `!tasks.current` gate is **gone** from `loop.ts`. A person doing a job
  talks while they do it. `deferMutter()` on every spoken line and
  `mutterInFlight` are what actually stop him talking over himself.
- `idleMutterMs: 26_000`, and `engine.deferMutter()`'s jitter is now
  proportional (`idle + rand * idle/2`) instead of a flat 30s — at a 30s cadence
  a flat half-minute of slop was doubling the gap it was meant to soften.
- Measured after (`.preview/step9/pace.ts`, real loop, real model, 3 min with a
  90s job running): **one line every 45s, median gap 43s, 2 of 4 while mid-job.**
  That was with `idleMutterMs: 30_000`; it was trimmed to 26s afterwards because
  generation latency lands on top of the timer, putting 30s at the ceiling of
  the 30-45s target rather than the middle.
- Also per the user's pick: events every **2-3.5 min** (was 3-5),
  `walkSpeedPxPerSec` **340** (was 240), and the gait/typing animation sped to
  match. **The stride length is the invariant**: 240px/s × 560ms = 134px per
  stride, 340 × 400ms = 136px. Change the walk speed without changing
  `serverRoomProtagonist.ts`'s 100ms frame time and he skates. Job durations
  were deliberately **not** touched.

**Pressure.** He only ever spoke about load once messages were *already being
lost* — there was no "help me" moment while chat could still prevent it. Added:

- **`narratePressure` in `traffic.ts`**, running before `narrateDropSpell`: it
  fires on entering busy/saturated, reminds on `tuning.busyReminderMs` (90s,
  faster than the 5-min drop reminder because the window is still open), and
  credits chat when it lifts. It stays **silent while messages are actually
  being lost** — the drop line owns that moment — and skips its recovery line if
  the drop spell is about to give its own.
- **`someoneToAsk(state, now)` in `state.ts`**: picks a recently-active chatter
  to shout at by name and what to ask them for — a server if they have none, a
  restart if theirs is off, an upgrade otherwise. Prefers someone *without* a
  server, because a new one is worth more than an upgrade and gets another
  person invested. Used by the scripted lines and by `idleFocus`.
- `traffic.busySince` / `lastBusyNoticeAt` added to the schema as **optional**,
  so **no migration and no version bump** — an existing v6 file parses with them
  absent. Confirmed against the live snapshot.
- The card gains an **UNDER PRESSURE** section (shout, name people, say what it
  buys, swearing is fine when earned, credit chat when it lifts, "stressed, not
  miserable"), the opening register moved from "tired, deadpan, flat" to wired
  and buzzing, and STYLE now permits capitals and an exclamation mark.
- `idleFocus`'s busy and dropping branches are urgent and name a person.

Verified against the real model (`.preview/step9/stress.ts`, drives the load
gradient with the wave lever):

> we are running out of room, 391 a minute against 540. kaz — say "give me a
> server", i need it.
>
> 2242 a minute coming at us and we can carry 540 — chat's already 25 seconds
> behind and nobody's put their name on it. kaz, sami, one of you say "give me a
> server" before this gets embarrassing.
>
> there. we're back under, and that's because you lot turned up.

Two bugs that run caught: **"1 minutes"** (now a `mins()` helper), and a test
that pinned a phrase present in only one of three randomly-drawn variants —
`load.test.ts` now runs the entry paths 40× and holds *every* variant to the
same contract, which is the class of flake to watch for here since almost every
scripted line is a `pick()`.

Tests: **134 passing** (load 27, persona 20).

### The honest-numbers pass (same session, fourth iteration)

Two asks: show the *real* chat rate rather than a simulated one, and say out loud
what the room is for.

**The displayed load was mostly fiction.** `demandPerMin` was
`regionalFloorPerMin(now) + chatRate + wave` — a simulated regional baseline of
260±100/min on a daily sine curve. Real chat is single or double digits per
minute, so the number on the wall barely moved when somebody typed and mostly
reported a curve nobody could affect. **The floor is gone**:
`demandPerMin = max(0, chatRate) + wave`, and `regionalFloorPerMin`,
`regionFloorMeanPerMin` and `regionFloorSwingPerMin` are deleted.

That forced a **rescale**, because the old capacities were sized against a
~300/min baseline and nothing real would ever have troubled them:

| | was | now |
| --- | --- | --- |
| `adminFallbackPerMin` | 300 | **10** |
| `serverBasePerMin` | 240 | **20** |
| `upgradeCapacityPerMin` | 80 | **10** (level 3 = 50) |
| `backlogDropAt` | 500 | **40** |
| `waveRippleExtraPerMin` | 300 | **20** |
| `wavePeakExtraPerMin` | 900 | **60** |

The scale is the design: Admin alone carries 10/min, so a few people actually
talking already troubles him, one server triples the room, and a full rack of
upgraded ones handles a genuinely busy chat. `load.test.ts` pins that shape
rather than the constants.

Verified end to end with the real pipeline (`.preview/step9/rate.ts`, no API key
so nothing is spent): silent → **0/min**; 6 messages in 12s → **6/min, FLOWING
WELL**; more → **25/min, GETTING BUSY** and he asked *viewer2 by name* for a
server unprompted; more → **46/min, AT THE LIMIT**; everyone stops → back to
**0/min**.

**The goal is now stated flat out.** The floor monitor is **two pages** on a 9s
dwell (was one):

```
GOAL: KEEP CHAT ALIVE            |  HOW YOU HELP
CHAT      28 of 76 a min         |  Help admin keep the chat
SERVERS   4 running              |  alive by building servers.
POWER     800 of 2000W           |  The more you type, the more
ROOM      22°C, air con on       |  work he has to do, and the
ADMIN     watching the room      |  more servers we need.
say "give me a server" to help out  |  say "give me a server" to join in
```

The goal is the status page's **title**, so a viewer who reads one line of that
screen learns what the room is for. The CHAT row became live numbers instead of
a status word — it is the row that moves when somebody types, which is the
causality the whole room exists to show; the word ("FLOWING WELL", "LOSING
MESSAGES") is still on the wall readout, bigger, next to the load bar. With no
capacity it reads `28 in, 0 carried` rather than the glitch-looking `28 of 0`.

Also re-worded `persona.ts`'s WHAT THE ROOM DOES to say it plainly: *their typing
is the load, their servers are the fix.*

**Two traps this pass exposed, for whoever checks the renderer next:**

1. `.preview/step8/check.mjs` sampled one painted frame, so it could not see
   page two at all — and a fixed wait can land on the same page twice, because
   which page is up depends on wall-clock. It now **polls until both pages have
   actually painted** and dedupes the collected rows. A truncated line on page
   two would otherwise have shipped unnoticed (one did: the goal footer).
2. The preview fixtures carried old-scale numbers (`demandPerMin: 340`,
   `backlog: 500`) which read as nonsense against the new capacities. They are
   now realistic and reference `tuning.backlogDropAt` instead of a literal.

Tests: **136 passing** (load 28, scene 24).

### Known gaps after this pass

- Restart fully heals a server. If it proves too cheap the levers are
  `taskRestartMs` and a per-owner cooldown, not a new mechanic.
- **He has no memory across streams.** Continuity comes from the 20 recent chat
  messages and his own last 10 lines, both in-memory, so an inside joke dies at
  restart. `state.chatters` persists names, `firstSeen` and `reports` but nothing
  about what anyone said. Per-chatter notes would be a v7 schema change.
- The 8s ask cooldown is untested under a genuinely busy chat. If he starts
  talking over himself, `DialogueService`'s queue depth (3) is the other knob.
- **The faster cadence has a cost.** A line every ~30-45s is roughly double the
  AGENT_MODEL calls on a quiet stream. `idleMutterMs` is the dial; nothing else
  needs touching to slow him back down.
- The pressure spell's reminder and recovery are only covered by unit tests, not
  by a live run — the scratch stress run only stayed under pressure long enough
  to see the entry lines.
- He can now shout in capitals and swear mildly. Both are deliberate and both
  reach Kick when `KICK_REPLIES_ENABLED=true`, which it currently is not.
- **The lifetime `delivered` counter will now crawl.** It sits at ~310,700,
  almost all of it earned from the simulated baseline that no longer exists.
  Real chat adds tens per minute, not hundreds. The number is honest from here
  on but the two eras are not comparable, and the wall shows it as one total.
- **`traffic.peakDemandPerMin` on the live snapshot is 360**, a leftover from the
  old scale that real chat will not approach. It only surfaces in the
  between-streams quarterly recap ("busiest moment 360 a minute"), where it would
  now be a lie, and it resets itself at the next quarterly review. Left alone
  rather than hand-editing a live snapshot; zero it if a recap is due first.
- With no simulated baseline, a **silent chat means zero load**, so the room is
  never under pressure when nobody is watching. That is honest and it puts the
  recruitment moments where the audience is, but it does mean the load model is
  idle much more of the time than it used to be.
- The `capacity` ticket title still quotes two raw numbers
  ("N a minute in, M carried"). Plain, but numeric.
- `scripts/scene.test.ts:61` still casts its ticket ctx `as never`.
- Persisted `active` tickets can still be stuck after a restart (task closures
  are not persisted) — unchanged from before.
- `report` still attaches to the highest-priority open ticket regardless of what
  was reported — unchanged from before.
- Step 8 proper (recorded-corpus ingest, foreign traffic on the chat monitor,
  upstream notices, the announced seasonal peak) is **still not done**; this pass
  was the simplification the user asked for instead.

---

## Where we stopped (historical, pre-simplification)

**Steps 1–7 are implemented, with the limits below.** Next is step 8 (waves: corpus ingest, foreign rendering, upstream capacity notices, the announced peak).

Verification after step 7: **typecheck and build clean; 123 tests passing** — `outage 14, scene 31, load 21, jobs 14, tickets 16, persona 14, dialogue 7, kick 6`, every suite green in the same run. Two step-6 tests had encoded the old behaviour (chat rows kept flowing with the breaker down) and were updated to keep their original intent plus assert the new suppression: `scripts/scene.test.ts` "chat snapshots contain only bounded recent display fields" and `scripts/receipts.test.ts` "engine freezes receipts at display time".

Real-renderer checks passed for `outage` and `failure` (static panel, the two held lines, `LOAD / NO LINK`, no chat rows or route tags behind the static), for an audible room being unchanged, for the static actually animating, and at a 960×540 viewport. No browser errors. Driver and screenshots: `.preview/step7/check.mjs`, `.preview/step7/*.png` (ignored).

End-to-end was checked against a **real Engine + real loop + the real world module in a scratch data dir** (`.preview/step7/live.ts`, `DATA_DIR=.preview/step7/data`), deliberately **not** the live dev world: tripping that breaker would have burned the uptime streak and bumped `season.outages` in the live snapshot. It proves held-while-deaf, drained-on-return, order preserved, and the log/narration sequence. No live-model behaviour is established by any of this.

All implementation changes remain **uncommitted** on **`design`**, including new files. Do not discard or commit without asking.

Step-6 verification, for the record: typecheck/build clean, 109 tests passing at the time, real-renderer checks for normal/full/empty/failure, busy/backlog/drops, board, receipts, long text, Unicode and noodle-shop fixtures, live receipt arrival and a 960×540 viewport, no browser errors. Evidence in `.preview/step6/` (ignored).

**Hard constraint: operate only inside `/Users/s.alakus/Workspace/worldstream-v2`.** The user allowed one exception for the built-in planning file, not a general exception. `scripts/load.test.ts` now creates its temporary directory under repository-local `.preview/`. Use repository-local `TMPDIR`, npm cache, Playwright browsers/profile for tools. Do not use OS `/tmp` for test or preview artifacts.

## Agreed direction

- Ray's room is fictional **EDGE-7 / the west annex**, an off-the-books chat edge facility that was supposedly decommissioned. Ray keeps it running because people depend on it, and nobody upstream remembers it is load-bearing.
- His private thread is LEGACY-01: protect it, never explain its function or confirm the uplink cable. A past outage and his request to work here are private backstory, not exposition to deliver on demand. Ping and pong remain his softer attachment.
- Chatters own functions: **DELIVERY** (many boxes), **AUTH** (one), **MOD QUEUE** (one). **No emotes.** METRICS, VOD, CACHE and THUMBS are deferred.
- Real local chat drives demand. The user also wants simulated chat from other channels as raids/waves. The brief adds a regional baseline; implementation currently has that baseline and synthetic numeric waves, not foreign-message ingest.
- Floor monitor becomes an actionable ticket board. Claiming stays; **no bump/reprioritise verb**. Ray does physical work; chat spots trouble, claims work and owns functions.
- Keep the setting fictional: do not imply actual Kick infrastructure is down. No real corporate status-page impersonation.

## What is implemented

### 1. Traffic/load

- `src/engine/chatRate.ts`: trailing-minute message-rate meter.
- `WorldCtx.chatRatePerMin`: engine exposes rate divided by dev time scale.
- `src/worlds/server-room/traffic.ts`: numeric demand/capacity, backlog capped at 500, delivered/dropped totals, proportional lifetime per-box delivery credit, capped overload heat/wear, numeric waves and drop-spell narration.
- Capacity: Ray fallback **300/min** plus **240/min × health fraction** per delivery box, ×0.7 when throttled. Regional baseline **260/min ±100**, local daily cycle. Ripple +300/min; peak +900/min. Tunables in `tuning.ts`.
- `scripts/load-sim.ts`: headless no-intervention simulator. Tasks are collected but **never executed**, so its AC-off spiral is not a normal live-engine run with auto-repair.
- Traffic totals are simulated numerical flow. They do **not yet delay/drop displayed local chat**, except the separate AUTH admission hold below. Earlier conversation called them actual message drops too strongly.

### 2. Functions

- `state.ts`: `job` on boxes, singleton/vacancy/capacity helpers; admission and moderation state.
- `intents.ts`: provision assigns requested/needed job at completion. Taken singleton redirects a new box to a needed job, naming the holder. `retask` changes an owned box's job; volunteering without a box provisions one.
- `jobs.ts`: AUTH admission delay through `WorldModule.receiveMessage`, called by `IntentPipeline` before display/classification. First arrival into a clear bucket is immediate; others wait, capped at 15s. Rates 20/min with AUTH, 5/min on Ray.
- MOD uses noise heuristics (links/shouting/repetition), raising hand-moderation work if MOD is absent/down. 8s task, priority 6, 20s cooldown. **This is a gameplay cost, not an actual content filter:** flagged messages still proceed through the normal pipeline.
- Singleton job returns to the pool after a dark-stream threshold; box remains owned. Job appears in telemetry and HUD data. Pixel-art boxes still do not render that job prop.

### 3–4. Tickets and claims

- `tickets.ts`: declarative kind registry, detection sweep, dedupe per kind/subject, automatic closure when a fault clears, work dispatch, board sorting (severity → claim count → age), bounded closed history.
- Kinds include breaker, intruder, compromise, DDoS, cooling, rat, box fault, disk, door, crate, capacity, unstaffed job, moderation and generic upstream notice.
- Sweep is called at end of `tick.ts`. Delivery event now leaves a crate; unpack task comes from board. Hand moderation likewise runs through board.
- `screens.ts`: floor monitor primarily cycles work-order pages, with box/room telemetry interludes. Closed-ticket tail and owner-specific advice. `scene.ts` still calls this combined screen `telemetryScreen`.
- `claim` intent and rewritten `report` intent exist. Claim count affects ordering of undispatched tickets; owner maintenance/provision requests remain direct tasks.
- `EngineView.currentTask.kind` was added to avoid assigning one task's progress to unrelated kinds. This is kind-level matching, not unique ticket/task identity.
- Generic upstream ticket support is scaffolding only. Scheduled capacity notices, upstream requests/rewards and wave deadlines are not implemented.

### 5. Persona

- `persona.ts` rewritten around public duty, private wound, LEGACY-01, jobs, board and fish.
- State summary leads board → traffic → jobs → room → individual boxes → background. Healthy boxes compressed, troubled ones detailed. Optional `now` parameter makes time-dependent text testable.
- Generic `Persona.idleFocus(state)` hook, consumed by `src/engine/loop.ts`. Ray focuses on drops, unclaimed serious work, capacity, staffing, fish; skips active tickets.
- Tests verify prompt strings and summary logic, **not live model outputs**.

### Persistence

Current server-room schema and `serverRoomWorld.meta.stateVersion` are **5**, with chained v1→v5 migrations.

A live `tsx watch` server was running during implementation and reloaded half-edited schemas. It reset the dev snapshot earlier in the session, losing Sami's box and accumulated totals; the backup also rotated. No recovery was attempted. `persistence.ts` was changed to throw `StateVersionError` when a versioned JSON snapshot fails schema validation, preventing that particular silent reset. A later forgotten metadata bump was caught by this guard and fixed. Last verified v4→v5 migration retained **21,625 delivered**; do not assume that is the current on-disk value.

**Before future schema edits:** check whether a watcher is running, preserve state safely inside the repository, and avoid leaving schema/version/migration out of sync. No schema bump is expected for the initial step-6 rendering work.

## Step 6: implementation and limits

- `src/worlds/server-room/display.ts`: pure finite traffic projections plus deterministic capacity-weighted **simulated display receipts**. `WorldModule.displayReceipt` is invoked by `Engine.recordChat` after AUTH admission. Engine display history is bounded to 30 and contains only username/text/optional receipt; nothing is persisted. Receipt target ID and slot label freeze when captured. No extra delivery credit is awarded.
- `scene.ts`: visible traffic panel under chat TV at x1392/y436/w480/h76, uplink at x80/y496/w160/h52, restrained service-wall fibre to LEGACY-01, native DELIVERY load strips and D/A/M box cues. Existing skyline, furniture, tank, monitor geometry and art remain. Essential numbers are in-world; HUD data is also populated but the sidebar remains hidden.
- `chatMonitor.ts`: stable `[sN]`/`[RAY]`/`[NO LINK]` tags, `QUEUE ~Ns EST`, explicitly labelled simulated routes, with reduced row budget for the header. This does **not** delay/drop actual displayed messages according to the numeric load model.
- `messagePulses.ts`: short, bounded receipt pulses following the ceiling/service-wall path; initial history/reconnects don't replay, duplicate snapshots don't duplicate, removed/dark/retasked targets don't receive pulses. Reduced-motion and disconnect suppress animation. At high burst rates only bounded recent receipts can animate; this is not an exhaustive traffic trace.
- `trafficReadout.ts`: live demand/capacity, status-labelled load bar, delivered/dropped. Capacity is derived from current hardware, not a stale tick cache; no-capacity lag/load use `null`, never Infinity. Large totals compact on the wall; full numeric totals are available in cycling telemetry.
- `screens.ts`: traffic telemetry, full job names/owner details and per-box delivery load; explicit ticket ID in claim footer. Empty-board wording now claims only that no orders exist, not that hardware/jobs are healthy.
- No singleton utilisation percentages, region-share denominator, foreign corpus, or outage buffering were invented. Under-capacity demand can read CLEAR while a previous backlog drains; the separate estimated queue header shows that backlog.
- Local fixtures: `load-busy`, `load-backlog`, `load-drops`, `board`, `receipts`, `receipts-live`, `receipts-burst`, alongside previous preview cases. `npm run test:scene` now includes `scripts/receipts.test.ts`.

### State protection and restart on 2026-09-09

With user approval, paused the original development processes after saving validated state copies. Final paused snapshot: `data/step6-safety/1788908800809/final-paused.json`, **254,213.279 delivered / 2,250.462 dropped**, Sami's `box-75fcf056` retained, own delivery credit **61,935.003**. The box was already dark (health 0) before scene edits; it was not repaired/reset.

Immediately before restarting, live snapshot was byte-identical to that paused copy and validated as v5. Restarted `npm run dev` with repository-local temp/cache paths; boot log confirmed loading `world-server-room.json`. Revalidated both current and backup after startup: v5 valid, Sami's box and box credit retained, room totals continued increasing. Live WebSocket on 4400 served the new traffic entity and original box. Development watchers are running; isolated 4401 preview was stopped. Logs: `.preview/step6/dev.log`.

## Step 7: implementation and limits

**No schema change.** `serverRoomStateSchema` and `meta.stateVersion` are untouched at **5**, deliberately: a `tsx watch` dev server was live throughout, and the outage start was already on the record as `uptime.lastOutageAt`. The held buffer is transient engine state.

- `src/engine/world.ts`: `audible?(state)`, `onAudible?(ctx, flood)` and the `ChatFlood` shape on `WorldModule`; `WorldCtx.replay?: { remaining }`.
- `src/engine/intents.ts`: `handle()` split into the gate and `process()`. The gate runs after dedupe, per-user flood control and `chatRate.record` — demand is still measured on arrival, because a held message is traffic the room failed to carry. While `audible()` is false, arrivals go into a bounded FIFO (`HELD_CAP = 200`, oldest dropped and counted), logged once per outage rather than per message. `release()` is idempotent and reentrancy-guarded.
- `release()` order, which matters: the whole flood is displayed in one go → the log line and `onAudible` fire → only the newest `ACT_CAP = 8` are classified and run, sequentially, with `engine.replay.remaining` counting down. Reacting to the flood *after* eight model round trips would be reacting to nothing, and `displayed: true` stops the acted subset being displayed twice.
- On replay, `receiveMessage` still runs (admission and moderation accounting) but its `holdMs` is ignored — the outage was their wait.
- `src/engine/loop.ts`: step 2b drains the buffer when the room can hear again. `src/engine/engine.ts`: the dialogue chat block is retitled `Chat from before the monitor went dead` while deaf, and `ctx.replay` is exposed through `makeCtx`.
- `src/worlds/server-room/outage.ts` (new): `audible` = `roomCapacityPerMin > 0`, `deafSince`/`deafForMs` (only while actually deaf, and only from a real recorded outage), and `onAudible` narration carrying the count, the people and how long it was dark, plus an alert log when the cap lost messages.
- `src/worlds/server-room/intents.ts`: the `ask` intent answers a flood **once**, at its newest message (`ctx.replay.remaining > 0` → seen, logged, not answered). Action intents (provision, claim, report, maintenance) still all run.
- `persona.ts`: a deafness block ahead of traffic in the summary — he cannot see chat, does not know who is waiting, must not invent messages — and a dedicated `idleFocus` branch for talking to a dead screen, separate from the dropping line. Both now use **live** `audible(state)`, not `trafficStatus()`: the cached `traffic.capacityPerMin` is 0 in an unticked snapshot, which was making a fresh boot claim an outage. The traffic line says `not measured yet` in that case instead of the deaf wording.
- `scene.ts`: chat-monitor props gain `deaf` and `deafSince`, and while deaf its `messages`/`receipts` are empty so no stale rows sit behind the static. `screens.ts`: `! CHAT LINK DOWN — ROOM IS DEAF` leads the alerts, and the traffic page footer says arriving chat is held, not lost.
- `client/renderer/chatMonitor.ts`: pure `deafPanel(deafSince, now)` (`NO SIGNAL`, `UPLINK DOWN · m:ss`, `nothing is reaching ray ·`, `your messages are held`; no clock invented when there is no start time, clamped to `99:59`) plus a `props.deaf` branch that skips the row layout entirely. `drawChatMonitorText` now takes `now`.
- `client/renderer/draw/serverRoom.ts`: `staticNoise()` — sparse dark grain plus a slow roll bar inside the screen rect, time quantised to ~5 fps with an integer hash, no RNG state.
- `scripts/preview-scene.ts`: `outage` fixture (breaker tripped, 42 s of dark, chat populated so hidden rows are provable). `failure` also trips the breaker and doubles as a regression view.
- `scripts/outage.test.ts` + `npm run test:outage`.

Limits to state plainly:

- **Deafness is only reachable through a breaker trip.** Ray's 300/min fallback keeps capacity above zero otherwise, so nothing else in the model can make the room deaf today.
- The held buffer does not survive a restart, and is not persisted anywhere.
- The numeric ledger still drops simulated traffic above the 500 backlog cap during an outage. That is the region's traffic, and it is separate from the held local queue, which is delayed rather than dropped below the 200 cap.
- Per-user flood control (3 s) still silently drops a user's rapid repeats while deaf, so not every attempt lands on release.
- Replayed intents can act on a room that has changed since the message was sent. Accepted: the flood is the point.
- The static animates even under `prefers-reduced-motion` — the entity draw path has no reduced-motion signal (only message pulses are gated, in `main.ts`). Low contrast and ~5 fps quantisation mitigate it; they don't remove it.
- The retitled dialogue chat block and the persona's deaf instructions are **untested against a live model**. Nothing guarantees he won't answer a pre-outage line as if it just arrived.
- The `outage`/`failure` fixtures cover the deaf screen; there is no preview fixture for the flood *arriving*, which only exists in the engine tests and the scratch end-to-end run.

## Step 6: original exploration notes (historical)

The notes below describe the pre-step-6 baseline; current implementation above supersedes statements that receipts, tags or readouts do not exist.

Brief scope: **uplink panel and cable into LEGACY-01; shard tags and lag on chat monitor; message pulses; per-box load cues; HUD load/delivered/dropped; region-share sign if backed by a defined metric.** Do not invent region-share percentages and present them as real measured state.

Inspected files:

- `src/shared/sceneTypes.ts`: `SceneChatMessage` currently only `{ username, text }`; entities carry props and optional `SceneScreen`. HUD supports meters/counters/board/queue. There is no per-message box assignment or timestamp in the display contract.
- `src/worlds/server-room/scene.ts`: all scene geometry and server-side entity props. Full-width 1920×1080; server-room worldWidth equals scene width, so **the traditional right-side HUD is not visible**. Merely adding HUD data will not deliver visible meters; put necessary readouts in-world and verify the main renderer path.
- `client/renderer/draw/registry.ts`: `register(kind, fn)` / `drawEntity` dispatch.
- `client/renderer/draw/serverRoom.ts`: `art()` wrapper scales native pixel art ×4; `cached()` layers cache by geometry. New dynamic visuals must not go into geometry-only cached layers.
- `client/renderer/draw/pixelArt.ts`: `P` palette, integer-grid rect/line/text primitives.
- `client/renderer/chatMonitor.ts`: text is an output-resolution overlay; `layoutChat` wraps up to 6 messages, 3 lines each. `drawChatMonitorText` draws `IRC / #ops`, with cached rows keyed by messages reference and available dimensions. Need to account for header/lag/tag space without overflowing.
- `client/renderer/hud.ts`: generic sidebar meters, currently divides value/max without a zero-capacity guard. Inspected only first 70 lines.
- **Still inspect:** `client/renderer/main.ts` for layer order, overlay text passes, scaling, time source and sidebar suppression.

Geometry from existing scene:

- Rack first x72, pitch124, width108, top564, slotH24, gap8. Box slab is **23×6 native pixels**: full job text won't fit there. Use restrained one-pixel load cues and readable job/detail text on monitor overlays instead of cramming type.
- LEGACY-01 at foot of rack1, height56 output pixels.
- Wall chat monitor x1392 y120 w480 h300.
- Floor monitor x1400 y640 w344 h248.
- Fish tank x1464 y516 w216 h124, sitting on floor monitor.
- Keep room composition, skyline, tank and existing pixel art intact. No big sidebar reintroduction without considering the layout.

Actual per-message shard assignment **does not yet exist**. Current delivered credit is proportional numeric accounting. Decide on a consistent routing/receipt representation rather than attaching random labels that falsely imply a tracked route. Bound any new history and keep snapshot serialization finite (lag/utilisation helpers can return Infinity during outages).

Remaining after step 7: **8 waves/corpus ingest and announced seasonal peak**, then the deferred functions (METRICS, then VOD). Do not hook up other live channels or publish outward without the user's permission.

## Known gaps to account for (not all fixed by current tests)

Earlier summaries were too categorical about a few features. Check these before relying on them while continuing:

- `report` currently attaches to the highest-priority open ticket regardless of what was reported. It can credit unrelated reports and existing advisory tickets; repeated reports increment credit. It doesn't detect faults before inspecting the board.
- `claim` description matching is basic substring matching; an unknown explicit target falls back to the worst ticket. There is no numeric/natural-language claim regex fast path added yet. The footer's “I'll take it” cannot know which cycling page the viewer meant.
- Persisted `active` tickets can remain stuck after restart because task closures are not persisted. A partially stabilised box can likewise leave its ticket active after its task ends if it remains red. Unique task linkage/recovery is not implemented.
- Progress matching by task kind can still misattribute two tickets with the same kind. Persona summary says “you're on it” for queued tickets; only renderer distinguishes QUEUED.
- Clearing a fault is sometimes labelled “repaired/blocked” even if it expired or disappeared by another mechanism. Closed-page resolution text does not consistently include claimants despite the brief's credit/blame promise.
- AUTH waiting count derives from an uncapped future reservation clock despite actual waits capped at 15s. Repeated messages from a not-yet-admitted newcomer are not explicitly serialized. The chat rate is recorded **after** per-user flood control, so spam rate does not include all arrivals.
- `jobReleaseAfterDarkStreams` processing increments immediately at an offline boundary even for newly dark boxes. Memorials store delivered counts but **not the former job**; the test named “plaque with the job it ran” doesn't assert a job field.
- The persona's claim that it cannot see chat during an outage is now true (step 7), with the limits listed in that section.
- Several tests use hand-built contexts, some `as never` casts. Passing tests don't guarantee browser legibility or genuine model conversational behaviour.

These are continuation notes, not a request to silently expand step 6 into a full rewrite. Address dependencies that would make the new visuals misleading, and state clearly what remains.

## Verification / resume

Scripts in `package.json`:

```sh
npm run typecheck
npm run test:persona
npm run test:tickets
npm run test:jobs
npm run test:load
npm run test:outage
npm run test:scene
npm run test:dialogue
npm run test:kick
npm run build
```

The persistence test scratch is now repository-local. Use `TMPDIR="$PWD/.preview/step6/tmp" TSX_DISABLE_CACHE=1 npm_config_cache="$PWD/.claude/npm-cache"` for test/preview commands (create that local temporary directory if needed). Avoid rerunning suites twice just to separately extract pass/fail counts.

Playwright needs the repository-local browsers, or it will look in `~/Library/Caches`: `PLAYWRIGHT_BROWSERS_PATH="$PWD/.claude/preview-tools/browsers"`. Both `.claude/preview-tools/browsers` and `.preview/browsers` hold chromium 1243.

For anything that mutates room state end to end (outages included), point a scratch engine at a scratch data dir instead of the live world — `DATA_DIR=.preview/step7/data OPENROUTER_API_KEY= npx tsx .preview/step7/live.ts` is the working pattern. An empty key makes classify/dialogue fail fast and loudly instead of spending tokens.

For visual checking, use the project's `run` skill before launching/screenshotting. `scripts/preview-scene.ts` is an isolated real-renderer preview (no engine/model calls), port 4401. Existing cases include normal/full/empty/failure/screens/chat-live etc.; step-6 load/board/receipt fixtures are listed above. Inspect the skill and running processes rather than starting a second conflicting instance. Load the `dataviz` skill before implementing load meters/bars, per available skill instructions.

### Live state at the end of the step-7 session

The dev server was left running and healthy on 4400, with the Kick chat subscription active, reloaded onto the step-7 code. Both `data/world-server-room.json` and its rotated `.bak` validate as **v5**: **263,036 delivered / 2,250 dropped**, Sami's `box-75fcf056` retained with **61,935** credited, breaker off, `season.outages` 0 and no `lastOutageAt` — the streak is intact, because the outage testing all happened in the scratch dir. Those totals keep climbing while it runs; don't treat them as fixed.

Suggested next-session prompt:

> Read docs/server-room-handoff.md and §5 in interactive-stream-world-brief.md. Continue with step 8 (waves): recorded-corpus ingest, foreign traffic rendering on the chat monitor, upstream capacity notices and the announced season peak. Preserve the uncommitted implementation and existing art, keep all operations inside this repository, and verify state integrity before touching schemas or restarting watchers.
