# Corner House

A persistent, chat-built safehouse in an original isometric zombie neighborhood. Chat requests new creations or edits; the survivor walks to a work site and constructs a validated 3D design. Zombies are ambient scenery, not destructive enemies.

This direction supersedes the older server-room brief's mortality/scarcity requirements. There is no hunger, inventory grind, forced reset, or automatic destruction of community creations.

## Run

```sh
npm install
npm run start:safehouse
```

Open `http://localhost:4400/` for the clean broadcast view and `/admin` for local chat injection and operator actions. `PORT` overrides 4400. Development with rebuilds: `npm run dev:safehouse`.

The default `npm start` still respects existing `WORLD` configuration. Safehouse uses its own `data/world-safehouse.json`; it does not modify server-room or noodle-shop saves.

### No-cost fixture mode

```sh
npm run demo:safehouse
```

This explicitly enables deterministic example designs, disables Kick ingestion/subscription startup, and uses the separate `data/safehouse-demo` directory. The stream labels fixture mode. It is a test aid, not open-ended generation; live mode never silently falls back to these designs.

### Real generation

Keep the existing `.env` OpenRouter configuration: `OPENROUTER_API_KEY` and `AGENT_MODEL`. No API/provider migration is required. Each admitted request may make an API call and incur charges. Idle scenes do not repeatedly call the model. Model timeouts or invalid designs produce visible failures and leave existing creations untouched.

Local-only smoke tests can additionally set `KICK_DISABLED=true KICK_REPLIES_ENABLED=false`. These flags prevent incoming Kick messages and startup subscription work in the test process. Do not expose the development server to the internet casually.

## Using chat

In `/admin`, enter a username and a request, then Send. Example buttons fill the input so they do not incur charges until you send. The same intent pipeline processes verified Kick chat messages.

Try:
- “Build a small duck-shaped watchtower in the rear yard.”
- “Build a greenhouse with a crooked chimney.”
- “Make the duck-shaped watchtower pink.”
- “What are we building today?”

Any chatter can edit generated creations. Original creator and subsequent editor are attributed. Public deletion is disabled; operator undo restores previous versions. Fixed neighborhood scenery is not all editable in this first version, and builds are placed on reachable ground rather than inaccessible roofs.

## What generation means here

The model emits a bounded JSON blueprint: named, colored geometric parts with positions, dimensions and rotations. The server validates it and finds a collision-free reachable placement before construction. It never evaluates model-authored JavaScript or downloads arbitrary assets.

This supports novel appearances composed from a small geometric vocabulary, not arbitrary invented game mechanics. A duck-shaped tower is possible; a tower that independently runs a new economy is not implemented.

## Persistence and operation

Accepted jobs and blueprints are stored with the world. Server-authoritative movement and construction drive the renderer; refreshing a tab does not complete a job. Interrupted jobs recover on startup. Saves use the existing versioned, atomic snapshot mechanism and backup file; keep backups before manually changing any state files.

World and request budgets protect long-running sessions. When full, work should be declined rather than secretly deleting older contributions. Geometry is updated by object revision, and replaced GPU resources are disposed.

Do not use developer time scaling on a public stream. It is intended for tests; it speeds simulation, not API responses.

## Operator access

Admin API access is local by default and rejects cross-origin browser requests, public Host headers, and forwarded/tunnel requests. For remote/proxied operation, configure an `ADMIN_TOKEN` of at least 16 characters and enter it into `/admin`. The UI holds it in memory only. Do not put it in URLs, screenshots, chat, or source control.

CLI injection supports the same token through the environment:

```sh
PORT=4400 npm run inject -- alex "Build a small greenhouse"
```

If `ADMIN_TOKEN` is configured, export it for the CLI as well. The verified `/kick/webhook` route remains separate from operator access checks. Production reverse proxies must preserve meaningful Host/forwarding headers; a proxy that strips all provenance and impersonates localhost defeats local-only assumptions.

## Checks

```sh
npm run typecheck
npm run build
npm run test:safehouse
npx tsx --test scripts/*.test.ts
```

Automated checks use fixtures. To exercise the actual app through HTTP/WebSocket and the browser (requires Playwright and installed Chrome):

```sh
# In one terminal, start an isolated fixture instance:
PORT=4410 npm run demo:safehouse
# In another, drive chat, construction, editing, undo and mobile rendering:
node scripts/safehouse-smoke.mjs
# Start/stop an isolated fixture server and verify resumed construction:
node scripts/safehouse-restart-smoke.mjs
```

## Verified first-slice results

- Production build and TypeScript check passed; full suite: 191 passing tests.
- Browser smoke exercised local chat → build → shared edit → nighttime → undo, plus 400px layout, without page errors or runtime external asset requests.
- Running-server restart smoke restarted during work and again after completion: same object ID, no duplicate build.
- A 1,050-request fixture soak kept saved request/history state bounded. This is not a days-long rendering or operational soak.
- Four real requests were submitted through the configured provider: duck watchtower (37 parts), pink edit of the same object, complex turtle greenhouse (timed out safely), simplified turtle greenhouse (19 parts). Three succeeded. Latency can approach the 90-second generation timeout.
- Kick live-channel ingestion was not exercised. Test instances had Kick disabled; verified webhook infrastructure remains integrated.

To reopen the first real generated world used during verification:

```sh
WORLD=safehouse KICK_DISABLED=true KICK_REPLIES_ENABLED=false \
DATA_DIR=.claude/preview-tools/safehouse-live-state PORT=4411 npm start
```

It contains the pink watchtower and turtle-shaped greenhouse. New requests incur API charges. The model's visual interpretation is approximate; generated structures do not gain bespoke functionality. Only the rear construction lot and generated-object edits are active in this slice. The initial safehouse is authored scenery. Public-stream moderation and long-term reliability require further testing before unattended deployment.

## Collaborative-building usability pass (state v2)

- Click/tap a generated creation or choose it from **Inspect** to see its name, short `#reference`, creator and last editor. Selection is local to your browser, not shared chat state.
- `Paint the truck red`, `Make the statue in the back pink`, and `Make my car 20% taller/bigger/smaller/shorter` are deterministic edits: **zero AI calls**, followed by a short visible work sequence. Any part of a name works (see *Names, not hashes* below); `#reference` still does too. Whole-object colors and explicit percentages only. Qualified changes such as “only the roof” do not silently recolor the entire object. Tilted geometry may need a generated redesign for height-only changes.
- `Paint it blue` refers to **your own last successfully built/edited creation**. New users and ambiguous names get a clarification instead of a guess. Use names/references for reliable targeting. Complex additions still use AI and its existing latency/validation limits.
- The camera gently frames current builds, holds a short reveal, then returns wide. Manual drag/zoom suspends it; **Follow activity** resumes. Reduced motion avoids camera interpolation.
- Rook walks back to the accessible outdoor home point when work finishes. No idle AI calls. Movement advances one straight waypoint segment at a time to avoid interpolating across blocked corners.
- Operator controls include **Pause AI generation**, **Resume AI generation**, **Reset AI call allowance**, and **Retry last failed request**. Pausing lets issued generation/construction finish; no new model calls start. Already queued paid jobs retain their FIFO place, so quick edits behind them wait until generation resumes. New quick edits can still be accepted while paused.
- The persistent allowance starts at **20 model calls**, configurable for new/migrated worlds with `SAFEHOUSE_CALL_ALLOWANCE` (0–10000). Calls are reserved before dispatch; errors count; restart does not replenish. Reset is explicit. **This is a request-count circuit breaker, not a dollar budget.** Fixture mode does not consume it.
- v1 snapshots migrate to v2 without changing creations, job history, revisions or undo records. Per-user follow-up context starts empty after migration; explicitly name an existing creation once to establish it.

### Verification
199 automated tests passed, production build/typecheck passed. Browser smoke covered creation inspection, manual follow override, edits while generation is paused, and mobile reduced-motion layout. A signed synthetic Kick message completed a fixture creation through the real safehouse pipeline; no live channel was contacted. No paid model calls were made for this usability pass, so reduced-generation latency is not measured.

```sh
node scripts/safehouse-inspect-smoke.mjs # fixture server at localhost:4410
```

### Supervised Kick session checklist
1. Keep a separate backup of the world and use operator authentication for any tunnel/proxy. Check **Kick disabled**, account, subscription and last-webhook status in `/admin`.
2. Explicitly choose the channel and authorize connection/subscription before activation. Restart without `KICK_DISABLED=true` only for that supervised session. Keep outbound replies off initially.
3. Set a small call allowance, have Pause ready, and let a few people try one creation, a named recolor, and a per-user follow-up. Confirm attribution and that duplicate webhook deliveries do not duplicate builds.
4. Observe ordinary conversation, queue saturation, a failed request, reconnect and generation pause. End by pausing generation, saving, and disabling ingestion again.
5. Do not leave the channel unattended yet: stronger moderation, measured cost accounting, operational restart/log rotation, expansion beyond the finite lot, and a multi-hour OBS/memory soak are still outstanding.

## Neighborhood defense sandbox (state v3)

This supersedes the rear-yard-only and cosmetic-zombie limitations above. Ground builds can occupy free space across the playable neighborhood (x −27…27, z −18…19). Houses, vehicles and reserved builder lanes still block placement; roofs, interiors and overhead bridges remain unsupported. Clicking empty ground shows coordinates; append `at x,z` or use the operator X/Z fields. Supported landmarks include `street`, `across the street`, `in front of the house`, `beside the garage`, and `rear yard`. An explicit occupied mark is rejected, not silently moved.

### Try a defense encounter

1. `Build a barricade at 3,13`
2. `Build a turret at 6,11`
3. In operator controls, choose **Send three zombies**, then **Start zombie simulation**.
4. Click an object to inspect condition. Use `Repair the fence` (the worst section), `Rebuild the statue`, or `Equip the truck as a turret` / `as a barrier`; a `#reference` works where a name is not enough.
5. **Pause zombie simulation** freezes combat independently of AI generation.

Both new and migrated worlds start with combat paused so creating/loading a world cannot unexpectedly destroy contributions. Once started, one zombie arrives every 45 simulation seconds, capped at 12. A manually sent group is also capped. Zombies approach reachable nearby structures and attack within reach; turrets need clear line of sight. Barriers can block friendly fire, so offset the turret instead of placing it directly behind a solid wall.

Server profiles: decoration 80 health, barrier 240, turret 120. Turrets have range 9, deal 20 damage at most once per second, and zombies have 60 health. Zombie attacks deal 8 damage with a 1.2-second cooldown. These numbers are fixed by the app, never model-selected. Generated appearance does not create new mechanics. Existing sculptures migrate as decorations; explicitly equip the saved turret-shaped sculpture to activate its weapon behavior.

Destroyed geometry becomes flattened/dark rubble; after 12 simulation seconds it clears into a durable blueprint archive. The archive is capped at 100; combat pauses at capacity rather than silently forgetting designs. Rebuild reuses geometry and checks space again. Repairs and rebuilding are explicit queued jobs with no AI call. Recolor/resize does not heal damage. Undo refuses objects with combat damage history rather than resurrecting or healing them.

Perimeter fences are now 31 semantic destructible sections. Fixed house/garage silhouettes remain indestructible; the gate is a real open route. The fixture world omits starter fences to make automated isolated encounters small, while normal worlds seed them. There is no offline damage catch-up, survivor death, ammunition system, traps/lures, or arbitrary new game rules.

### Verified defense results
- 206 automated tests, typecheck and production build passed.
- Browser test placed a street barricade and turret, started zombies, observed a shot and zombie death without page errors.
- Running-app destruction test observed damage, collapse, archive cleanup, and successful rebuild with the same identity and creator.
- v2 migration preserved all three existing creation blueprints and added perimeter fences with combat paused.
- No paid generation or live Kick calls were made in this pass. Tests used explicitly labeled fixture designs; the newly extended live model response contract still needs a supervised real-provider check.

```sh
node scripts/safehouse-defense-smoke.mjs
node scripts/safehouse-destruction-smoke.mjs
```

These scripts target an isolated fixture instance on port 4410, not the original world. Combat is intentionally simple: zombies choose nearby reachable targets, not a sophisticated noise/smell model. Destruction and turret animations are minimal. Long-session performance and gameplay balance still need a supervised soak.

## Everything is an object (state v4)

The hand-placed scenery is gone. Rook's house, the yard clutter, the garage, cars, trees, utility poles, gate posts, garden beds, barrels, crates and both neighbor houses are world objects seeded from `src/worlds/safehouse/scenery.ts`. (Until state v5 the house was an open cutaway of wall segments, floor and furniture; see below.) Everything chat could already do to a creation — inspect, paint, resize, AI-redesign, repair, rebuild — applies to the whole neighborhood, and two zero-AI operations apply to everything:

- **Move**: `Move the barricade next to the house`, `Move the barricade to the front yard`, `Move #scenery-barricade to 3,12`. Rook walks to the destination and the piece reappears there; damage and role are kept. Sides: `next to`, `beside`, `in front of`, `behind`, `left of`, `right of`. Rook's house itself cannot be moved or turned.
- **Turn**: `Turn Rook's car around`, `Rotate the barricade 90 degrees`. Exact for tilted parts (wheels, roofs).

Builds accept the same placement language: `Build a lamp next to the house`, `Build a shed behind the house`, `Build a turret in the front yard`, or `at x,z`. Named areas: across the street, in front of the house / front yard, behind the house / back of the house, beside the garage, driveway, rear yard, garden, street / road. The old reserved builder lanes are gone; reachability is checked per placement instead.

Seeded pieces show `Part of the neighborhood` in Inspect and use readable references (`#scenery-barricade`, `#fence-3`); chat creations keep eight-character references. Implicit targets need the article (“the barricade”) or a reference, so “build a flower bed” does not edit anything named Bed. Rook's house also answers to plain “the house”.

Consequences to know:
- **The neighborhood can be broken.** Rook's house is a 4000-health barrier, the garage 1200, neighbor houses 1500, fences 240, yard clutter 60–300. Zombies prefer defenses and creations; parked cars and clutter only draw them when nothing better is within ~6 m. Migration re-pauses combat.
- Undo now restores a design but never health or a destroyed piece. Seeded pieces validate against larger bounds (12 × 12 × 9 m); chat designs are held to 8 × 8 × 8 m.

### Size limits and fitting

Chat designs may be up to 8 m wide, 8 m deep and 8 m tall — room for a truck, a shed or a bus stop. The AI is told the limit, but a paid design that comes back too big is no longer thrown away: the engine recentres it over its origin, lifts anything drawn below the ground, and scales the whole design down uniformly until it fits, then notes it in Rook's reply (“…(scaled to 72% to fit)”). Only a design that would have to shrink below 35% — a stadium, a whole street — is refused, and the message says the measured size against the limit. Free quick edits (`make it twice as big`) still refuse rather than silently fit, since nothing was spent. Validation failures now reach chat with their specific reason; only transport and JSON-shape failures get the generic “could not generate a valid design” line, and a timeout says the design took too long. `in the road` / `on the road` place on the street.

The validator also normalises formatting slips before checking the design, because every one of the first seven live requests failed on formatting rather than substance: `role` inside the blueprint is hoisted; colours may be `#rgb`, `#rrggbbaa`, `rgb(...)`, a CSS name or a handful of material words (`rust`, `flame`) — anything unrecognised becomes a neutral grey rather than a failure; shape synonyms (`cube`, `tube`, `ball`, `pyramid`) map to the four primitives; rotations over 2π are taken as degrees; a missing rotation is zero; `{x,y,z}` / `{width,height,depth}` objects and numeric strings are accepted; extra keys are dropped; over-long text is trimmed. Non-finite numbers, unknown shapes, missing positions and more than 100 parts still fail. If a request still fails, `data/log/terminal.jsonl` has the exact reason under `safehouse generation failed`.
- Roofs, upper floors and bridges are still refused with an explanation. Moving the floor is refused. Street lights stay put if a pole is moved. Sign text became plain plaques.
- The scene payload grew (~80 objects); fine locally, worth trimming before a public stream.

### Resetting everything

**Reset world…** in `/admin` (Engine section) puts the neighborhood back exactly as it started: creations, moves, repairs, damage, rubble, zombies and the archive are all cleared. Before anything is removed the current world is copied to `world-safehouse.before-reset-<timestamp>.json` in the data directory; if that copy cannot be written the reset is refused. Your AI pause state, call allowance and day/night setting are kept — a reset is not a way around the cost controls. The browser confirms first, and the API requires the literal body `{"confirm":"RESET"}` on `POST /admin/api/reset`, behind the usual operator guard.

To bring a backed-up world back: stop the server, copy the backup over `world-safehouse.json`, start again.

Restarting the server process itself is just `npm run start:safehouse` (or `Ctrl-C` and run it again); the world is saved on shutdown and every 15 seconds, so nothing is lost by restarting.

### Verified
214 automated tests, typecheck and production build passed. In the real app (fixture mode, Chrome): the neighborhood renders from objects with the approved look; moved the couch, turned the car, painted a wall, built a barricade in the front yard, a roof request was refused without queuing; inspect and mobile layout had no page errors. The zombie defense and destruction/rebuild smokes still pass with the new neighborhood. The live world's v3 save migrates with all three creations, 31 fence sections and 49 neighborhood pieces, combat paused. No paid model calls and no Kick traffic in this pass; the AI-redesign path for large seeded pieces is unit-tested only.

```sh
node scripts/safehouse-everything-smoke.mjs   # fixture server at localhost:4410
```

A successful short test is not proof of unattended multi-day uptime.

## Rook's house and autonomous repairs (state v5)

**The house.** The open cutaway (walls, floor, furniture, visible rooms) is replaced by one closed, roofed piece — `Rook's house` (`#scenery-house`) — centred in the fenced yard at (0, −5.7) with its porch facing the street. It is a single 4000-health barrier: it wears visibly, can fall to rubble and be rebuilt, and Rook treats it as his first priority. Nothing can be placed inside it (“in the house”, “kitchen”, “living room”, “bedroom” are refused with an explanation) and chat cannot move or turn it; everything else about it works — paint it, redesign it with the AI, repair it. The yard around it is open on all sides: ~7 m of lawn in front (front yard), the rear lot behind, the garden to the west and the garage/driveway to the east. Rook's home spot is the foot of the porch steps. The retired furniture ids (`scenery-couch`, `scenery-bed`, …) are gone; the barricade, supply crate, plank stack and loose board moved to the porch.

**Autonomous repairs.** When no viewer request is waiting, Rook picks the worst zombie damage and walks over with his hammer — no chat message, no AI call, no allowance spent. Order: his house → community turrets and barriers → the fence → other community creations → the rest of the neighborhood; knocked-down pieces (rubble or archived) before scuffed ones; nearest first. Scratches are ignored: a piece needs to be below 70 % (the house 90 %) or destroyed. A repair is a full repair to the piece's own maximum (this also fixes a bug where `Repair …` on a 600-health wall brought it back at 240). Repair time scales with the damage: 40 ms per missing health point, between 4 s and 90 s, so a fence takes seconds and the house from rubble a minute and a half. The client shows a harder, faster hammer swing (`repairing`) and the HUD reads “Rook, fixing zombie damage on his own”. Viewer requests always win: a request arriving mid-repair sets the repair aside immediately and Rook returns to it afterwards. A piece he cannot reach or fix is left alone for five minutes before he tries again. Repair jobs appear in the queue as `Fixing <name>` from `Rook`, but only the last six are kept so chat history stays visible.

**Operator switch.** `Pause Rook's repairs` / `Resume Rook's repairs` in `/admin` (`repairsPaused`, kept across a world reset like the other controls). The scene footer shows “repairs paused”.

**Migration v5.** Old saves drop the retired house pieces from the world and the archive, get the new house, and keep every community creation; anything standing under the new house is moved to free ground (or archived for rebuild if there is none). Jobs in flight are failed, zombies are cleared and combat is paused. A back-fence section can now be repaired in place (its footprint touches the yard boundary, which used to fail placement).

### Verified
Typecheck, build and the safehouse suite (47 tests incl. `scripts/safehouse-repair.test.ts`: priority order, thresholds, rubble/archive rebuilds, pre-emption by a viewer request, the pause switch, resume after restart) pass. Migration dry-run on a copy of a v4 world kept its three creations; the same copy was then migrated for real on the isolated 4411 instance. Two placement fixes came out of the browser run: Rook can start a walk from a spot he is standing on (he used to block the very build he had just been asked for), and relative placement now slides along the whole face of a wide anchor such as the house. Browser smokes against an isolated fixture instance, screenshots checked:

```sh
node scripts/safehouse-everything-smoke.mjs   # move the barricade, turn the car, paint the house, refuse a roof
node scripts/safehouse-repair-smoke.mjs       # zombies damage the yard, Rook repairs it on his own
node scripts/safehouse-effects-smoke.mjs      # camera drifts on its own; hits throw dust; no page errors
```

## Waves (state v6)

The constant trickle (one zombie every 45 s) is gone. Combat now runs in **waves**, tower-defence style: a **3-minute prep** in which Rook repairs and chat builds, then a wave whose roster grows with its number, then the next prep. The badge at the top of the stream shows the wave number, a live countdown ("incoming in 2:14 · 6 walkers, 1 runner"), the fight in progress ("8 here · 2 coming · 4 down"), and the record. Rook calls the beats aloud: one minute out, ten seconds out, "Wave 3 incoming — …", "Wave 3 cleared — 7 down."

- **Roster for wave n**: `3 + n` walkers; runners from wave 3 (`⌊(n−1)/2⌋`); brutes from wave 5 (`⌊(n−3)/2⌋`); capped at 24 on the ground at once, trimming walkers first. Wave 1 is four walkers; wave 5 is 8/2/1; wave 10 is 13/4/3. Spawns arrive two at a time every 6 s from nine points around the block.
- **Kinds** (fixed by the app, never by the model): walker 60 hp · 0.7 m/s · 8 dmg every 1.2 s; runner 35 hp · 1.5 m/s · 5 dmg every 0.8 s, lean and pale; brute 220 hp · 0.45 m/s · 24 dmg every 1.6 s, a head taller and dark. Turrets still do 20 damage per second at 9 m.
- **Clearing**: every spawned zombie down → "cleared", the record moves, the next prep starts. Stragglers still standing two and a half minutes after the last spawn (typically one chewing the far side of the fence, out of turret range) lose interest and shamble off; the wave counts as survived.
- **Targets**: zombies go for the fence and everything inside it, plus any community creation wherever it stands. Backdrop scenery outside the fence (neighbor houses, street trees, abandoned cars, poles) still blocks movement and shots but is never attacked — a horde that wandered off to chew a tree two lots over never met the defenses.
- **Losing**: if Rook's house falls during a wave the run is over — the fall goes on the record ("the house fell on wave 7"), Rook rebuilds (his house is his first repair), and after that wave the counter goes back to 1 with small waves again.
- **Operator**: `Start zombie simulation` runs the clock (a paused world keeps its countdown frozen); `Start the next wave now` skips the rest of a prep; `Send three zombies` adds walkers on top of whatever is happening. `/admin` shows wave, phase, seconds left, zombies and record; the reset keeps combat paused with a fresh wave 1 prep.
- Migration v6 gives old saves the wave clock (prep starting now) and turns their zombies into walkers. Along the way a movement bug was fixed: zombies used to lose the rest of each step at every waypoint, so anything faster than a walker crawled.

Verified: typecheck, build, 54 safehouse tests (+`scripts/safehouse-wave.test.ts`: rosters and tiers, prep warnings and the wave start, spawn cadence and the cap, kind stats, straggler cut-off, pause, house-fall reset, v5→v6 migration, spoken events) and the browser smokes below; both wave screenshots were checked (badge live, turrets firing, a brute a head taller than the walkers). Migration dry-run on copies of both saves; the isolated 4411 copy was then migrated for real.

```sh
node scripts/safehouse-wave-smoke.mjs                          # turrets up, wave 1 called early, over → wave 2 prep
EXPECT_KINDS=runner,brute node scripts/safehouse-wave-smoke.mjs  # against a world pre-set to wave 5: the new kinds show up
```

### Streaming it through OBS

Add a **Browser** source pointing at `http://localhost:4400/?stream=1` (your port), width 1920, height 1080, FPS 60. Stream mode scales the HUD 1.7× (the desktop page is sized for a monitor a foot away; on a 1080p stream watched on a phone the plain page is unreadable), sits the camera 35 % tighter on the yard, and hides the Follow/Inspect controls and the operator link — nobody can click through a stream. Tune with `&scale=1.9` (HUD) and `&zoom=1.5` (camera); `zoom` runs 0.7–2.2. Tick “Refresh browser when scene becomes active” and leave “Shutdown source when not visible” off so the WebSocket stays connected. Without stream mode, the quick fix is a 1280 × 720 source stretched to the canvas (Transform → Fit to screen).

## Rook talks (no schema change)

Rook has a speech bubble that follows him. The client pins an HTML bubble to his head every frame (projected from the survivor position, clamped to the viewport with the tail still pointing at him, scaled with `--ui-scale` in stream mode), so whatever he says appears where he is rather than in a corner box. The old fixed `#speech` panel is gone.

**Two registers.** Lines viewers have to parse stay plain sentence-case status, exactly as before: `Got your idea, dave. It's in the queue.`, `Finished Scrap turret, suggested by dave.`, validation failures, `Wave 3 incoming — 6 walkers, 1 runner.`, `Wave 3 cleared — 7 down.`, the house falling. Everything else is lowercase muttering in Sami's own voice from a hand-written pool in `src/worlds/safehouse/voice.ts` — zero AI calls, drawn with the world rng, never repeating a line he said recently. The voice rules come from his own typed lines (`.claude/rook-voice-corpus.md`): understatement for praise, "let's" as the hinge after a verdict, "a bit" / "just" as softeners, swearing only "shit"/"fuck" and only on stakes, no mate/reckon/bloody, no emoji.

When he mutters:
- **Heading off**: his own repair rounds open with a voiced line instead of "Heading over to patch up …" (`who keeps eating the fence man`). A viewer's job keeps its plain acknowledgement, then gets a walk line a few seconds in; a repair dropped for a viewer request gets a `hang on. someone wants something`.
- **Waiting on a design**: while the model draws up a request (or a queued request is stuck behind a paused AI or an empty allowance) he paces the yard inside the fence instead of standing frozen — random reachable spots a few metres apart with a breather between, and a line now and then (`pacing helps. allegedly`). The walk to the work spot is planned from wherever he has got to.
- **Hammering**: every ten seconds or so on anything longer than a quick tap (`this bit's fiddly`, `zombie teeth marks. lovely`).
- **Idle at the porch**: after 12–20 s, then every 45–75 s, about whatever is most pressing — nudging chat for ideas (`cool cool. nothing on fire. what are we building?`), an empty yard, the AI being paused (paints and moves only), a wave under a minute out, a wave in progress, or that it's late (server local time, 22:00–05:00).
- **Wave beats**: the one-minute and ten-second warnings keep their plain text on the panel (`state.notice`) but he says them his way (`here we go. wave 3.`); "incoming", "cleared", "stragglers" and "the house fell" stay plain in the bubble and get a voiced follow-up once the plain line has cleared (`boom. that's wave 3`, `well that's shit`).
- **The house**: once when it first takes damage in a wave, once more under half health.

Muttering never talks over a status line: a voiced line waits until the current bubble has expired (the world mirrors the engine's 4–12 s bubble lifetime). Bubble and log only, never Kick.

The wave badge at the top of the stream hides while zombies are paused; the footer line still says `zombies paused`.

**Pace.** Rook walks at 3.2 m/s on a job and 2.4 m/s when pacing or heading home (`WALK_SPEED` / `STROLL_SPEED` in `src/worlds/safehouse/index.ts`). His routes are straightened into runs (`straighten` in `placement.ts`: collinear grid steps merge, corners stay), so a run is covered in one go; he still stops at every corner for the rest of that snapshot, which is what keeps the client from interpolating him through an obstacle. Before this he finished one 0.5 m grid step per snapshot and moved at about 1 m/s whatever the nominal speed. Zombie routes are untouched.

**Talking to him.** A chat message that names Rook and is not a request (`rook you alright?`, `@rook how many left`) gets one dialogue call with the character card in `src/worlds/safehouse/persona.ts` and comes out of the same call allowance as designs; the reply is the bubble line. Messages with a request verb (`rook build a turret`) go through the normal request path unchanged. With generation paused, the allowance empty or the AI offline he answers from a canned pool (`can't chat right now dave. ai's off. can still paint and move stuff`); a second person while he is already answering is told to hang on; a model reply that comes back empty gets `didn't catch that dave. go again`. **Fixture mode never spends a call on conversation** (`createSafehouseWorld({ converse })` overrides; the default is off in fixture mode, on otherwise). The engine's model-backed idle mutter stays off (`idleMutterMs: 0`).

Verified: typecheck, build and the safehouse suite (+`scripts/safehouse-voice.test.ts`: pools render and skip recent lines, who counts as talking to him, his repair round is voiced while the finish stays plain, hammer talk on a long build, idle cadence and the paused variant, voiced warnings with plain panel text, one dialogue call per address and none for requests, fixture mode spends nothing, the persona card's promises). Browser smoke against an isolated fixture instance, screenshots checked:

```sh
node scripts/safehouse-voice-smoke.mjs   # a viewer build: he mutters on the way and while hammering; the bubble follows him; idle nudge
```

## Life in the yard: living builds (no schema change)

Chat can now ask for things that move. `Build a gorilla that runs around and breaks things`, `Build a dog that fights the gorilla`, `Build a little remote control car that just zooms around`, `Build a chicken`. The model designs the body as usual and names **one of four fixed behaviours**; the app owns every number behind it (`CREATURES` in `src/worlds/safehouse/combat.ts`) and runs it in `src/worlds/safehouse/creatures.ts` every world tick, **zombies paused or not**. Generated appearance still creates no mechanics: a gorilla with wings is a gorilla.

| Behaviour | What it does | Health | Speed | Damage |
|---|---|---|---|---|
| `rampage` | runs to the nearest fence, build or bit of clutter and breaks it, then picks something else; never the house; hits back at a fighter biting it | 300 | 2.2 m/s | 12 every 1.5 s |
| `fight` | goes for rampaging creatures first, then zombies (kills count for the wave), otherwise sticks close to Rook | 150 | 3 m/s | 10 every 1 s |
| `zoom` | drives fast to a far point, then another, harmless | 60 | 6 m/s | none |
| `roam` | ambles a few metres, waits, ambles again, harmless | 60 | 1 m/s | none |

A creature is an ordinary world object with a `creature` field: inspect it (`living · rampage`), paint it, resize it, move it, rebuild it when it falls, undo it. It **never blocks anything**: builds, Rook's routes and zombies' routes ignore creatures, and zombies never attack them (the horde is after the structures). Turrets shoot rampaging creatures during a wave, as they do zombies. Rook repairs whatever a gorilla breaks in his usual rounds, rebuilds a fallen dog, and **never** patches up or rebuilds a rampaging creature; chat can still `Rebuild #ref` it. A fallen creature goes flat, then into the archive like anything else. The yard holds at most **six** living things (`MAX_CREATURES`); a seventh is refused with a clear message. An edit may change a behaviour when the request says so (`Calm the gorilla down` → roam, `Wake the statue up so it wanders` → roam); a plain repaint keeps what it has.

Rook has lines for it: a voiced follow-up when a creature comes alive (`ok the yard gorilla is loose. this was your idea chat`), a comment at most every 40 s while a rampager is breaking things, and one when a creature goes down.

**Flyers.** Any behaviour can also fly (`"creature":{"behaviour":…,"flying":true}`; flight words in the behaviour imply it). A flyer moves in straight lines at roof height (6.5 m; drones 8 m) over everything — no routing, no obstacles, the whole block — climbs after Rook finishes it, dips to 2.5 m to strike a ground target, and falls to the ground as rubble when it is downed. Ground creatures cannot reach a flyer; flyers reach anything; turrets shoot hostile flyers where they fly (the beam goes up to them). Rook does not chase flyers with a hammer, so a downed one comes back only on `Rebuild #ref`. Flyers move at least 3 m/s whatever their behaviour says. Fixtures: `Build a bird` (roams), `Build a drone that flies around` (zooms), `Build a hawk that hunts the dragon` (fights), `Build a dragon that flies around burning things` (rampages from the air). Rook's line for a new one: `it flies. of course it flies`.

Requests: `"a gorilla that runs around"` used to be answered with "Which one?", because the parser read every `that` as a pointer to the requester's last creation; a `that` that opens a description of a new build is no longer a pointer (`it` and `this` still are). The fixture generator returns a blocky gorilla, dog, RC car and chicken for those words (first animal named wins: "a dog that fights the gorilla" is a dog), so `demo:safehouse` shows the whole thing without a model call.

Verified: typecheck, build, the safehouse suite (+`scripts/safehouse-creatures.test.ts`: profiles, a rampager wrecking clutter and never the house, dog versus gorilla with retaliation and a loser, a dog killing a zombie for the wave count, the dog staying by Rook, the car and the hen harmless, Rook's repair rules, turret fire, the design contract and its normalisation, the parser fix, fixtures, and two runs through the world including the cap) and the browser smoke below on an isolated fixture instance.

```sh
node scripts/safehouse-life-smoke.mjs   # gorilla wrecks the yard, dog goes for it, car zooms; the page keeps up, no errors
```

## The block (state v7): geometry by reference, three lots wide

**Snapshots carry no geometry.** Every object in `scene.safehouse.objects` (and the archive) is a `SafehouseObjectView`: everything but the parts, plus `partCount` and the first part's `color`. The page asks for the parts it has not seen, once per id+revision, in one `POST /api/objects/parts` per snapshot (`{"keys":["<id>:<revision>", …]}` → `{"parts":{…}}`, up to 400 keys, standing, archived and in-flight ghosts all served, unknown keys simply absent), and keeps them for the life of the page (bounded at 600). A group exists from the first snapshot and fills in when its parts land, so nothing in the renderer waits on the network. Measured on the live world: **311 KB → 61 KB per snapshot** at two a second. The in-flight preview keeps its full geometry inline (one object). Old pages must be reloaded after this change: they expect parts inline.

**Three lots.** The playable rectangle is now x −54…54, z −18…19 (108 × 37 m, was 54 × 37). The **west lot** has a boarded corner shop with its forecourt, a bus shelter on the pavement, a skip round the back, an abandoned car and van on the street and a hoarding across it. The **east lot** is a park: slide, swings, a sandpit and a pond (both ground, never blocking), two benches, a picnic table and a park shed. Seven more trees and two more poles. All of it is neighborhood scenery like everything else — inspect, paint, move, break, rebuild — and backdrop beyond the fence for zombies (never attacked, still blocks). New named areas for requests: `west lot`, `outside the shop` / `shop`, `bus stop`, `east lot`, `park`, `playground`, `pond`; `street` and `across the street` run the full block. Wave spawn points ring the whole block (twelve, near and far mixed, so a wave arrives over a minute). The RC car's "far point" now means the far lots.

**Budgets:** 100 community creations (was 60), 4,000 community parts (was 2,000), 12 living things (was 6). The save schema allows 600 objects.

**Client:** the ground, road and pavements run the block; backdrop houses and trees sit beyond both ends; fog starts further out; the shadow camera covers the block. The auto camera frames work on the far lots outright (near the house it still keeps the yard half in frame), and the idle glide now runs about 14 m either way along the street, so a quiet minute takes the shot out over the shop and the park and back.

**Migration v7** seeds the two lots into older worlds. Nothing standing moves; the wave clock is not touched; a lot piece is skipped if chat has already built on that spot or if a piece of that id is in the archive. The live world was backed up to `data/world-safehouse.pre-v7-<stamp>.json` first.

Verified: typecheck, build, the safehouse suite (+`scripts/safehouse-payload.test.ts`: views carry no parts, the world serves standing/archived/ghost geometry, the endpoint in one round trip; +`scripts/safehouse-block.test.ts`: bounds, areas and spawns inside the block, the lots seeded without overlaps and reachable from the porch, "in the park" placing in the park, the budgets, and a v6 → v7 migration that leaves taken and archived spots alone), and the browser smokes (`everything`, `voice`, `life`) on the geometry-by-reference path.

### AI call allowance: yours to set, enforce or ignore

The allowance is a request-count circuit breaker, not a dollar cap, and it is now fully under operator control in `/admin` (Engine actions):

- **Set AI call allowance** — type a number in the field beside the button (0 to 1,000,000) and click. `Reset AI call allowance` still puts it back to `SAFEHOUSE_CALL_ALLOWANCE` (default 20).
- **Ignore the AI call limit** — every request and every "rook …" reply may spend a model call, whatever the counter says. The counter is left where it is and never goes negative.
- **Enforce the AI call limit** — back to the counter; at zero, designs and replies are refused again and the HUD reads `AI PAUSED · SIMPLE EDITS AVAILABLE`.
- **Calls made so far** is counted whichever way the switch is set and shown in `/admin`; Rook's own state summary says "no call limit right now (N calls made so far)" when the limit is ignored.

The switch and the count survive a world reset like the other cost controls (`allowanceEnforced`, `callsUsed`; both optional in the save, so no migration). Operator actions may now declare a numeric `input`; the page renders the field and the server checks the value against the declared bounds before running the action. Tested in `scripts/safehouse-allowance.test.ts`, including the HTTP path.

### Presentation: ambient camera and hit effects

The auto camera pans slowly on its own — about 40 s side to side with a gentle sideways sway — so a quiet scene still moves. It stops the moment a viewer drags the view (and for `prefers-reduced-motion`), and resumes with **Follow activity**. Every zombie hit throws a puff of pale dust off the struck face, tinted by the piece's own colour, and the attacking zombie throws a visible punch; a collapse throws a bigger cloud, and turret rounds kick a little off the zombie they hit. All of this is client-side: the page infers hits from `damageRevision` bumps between snapshots (only for zombies actually in reach of the piece), so nothing was added to the protocol or the server tick, old damage never replays on reconnect, and reduced motion disables the particles entirely. Motes are deliberately chunky and pale because the stream camera sits 43 m away.

### Smooth motion: drawn between snapshots

The server still publishes the world twice a second (`tickMs: 500`, `BROADCAST_MIN_MS`); what changed is how the page draws what moves. Before, Rook slid toward each new position over the time since the previous snapshot, and zombies and living builds eased toward theirs with a fast exponential, so every mover dashed for about 100 ms and stood for the other 400: measured on the live world, walkers peaked at 3 m/s against their nominal 0.7 and stood still for a quarter of all frames. Frame rate was never the problem — the page already renders every display frame — the stepping was in the data.

**Snapshot interpolation** (`client/safehouse/motion.ts`). The page draws the world about a snapshot and a half behind the server (750 ms at the usual cadence) and slides every mover — Rook, zombies, living builds including a flyer's height — in a straight line between the two snapshots either side of the drawn moment, turning the short way round. Server time (`serverTime` on every state message) drives the clock, so a snapshot that arrives late neither stretches nor squashes a walk; the delay is there to absorb it. The clock (`Timeline`) pins itself to the quickest delivery it has seen, eases toward corrections at no more than 4 % time dilation, and widens the delay for half a minute after a skipped tick or a late arrival (never past 2.5 s). A jump faster than 12 m/s or a gap of more than 4 s is a reset or a respawn and snaps. A mover with no newer snapshot yet holds where it is; nothing is extrapolated, so nobody is drawn through a wall. Rook's one-straight-run-per-snapshot rule above is what makes the straight slide safe.

**Everything else waits its turn.** A snapshot's discrete news — a zombie gone, a piece flattened to rubble, hit dust and punches, turret beams, the HUD, the bubble — is applied when the drawn clock reaches that snapshot (`Timeline.applyAt`), not when it arrives, so a beam lands on the zombie where it is drawn and the dust flies when the punch is seen. The wave countdown counts from that moment too; the "connection stalled" check counts from arrival. Rook's hammer starts when he is seen to arrive (his activity rides along with the stretch being drawn). Speech bubbles keep their server lifetime. The first snapshot after connecting shows at once, and reduced motion draws the newest snapshot and applies it immediately, as before. Cost: moving things appear about 0.75 s later than they did, on top of Kick's own seconds of delay. Nothing on the server changed.

Verified: typecheck, build; `scripts/safehouse-motion-smoke.mjs` (a headless page against a fixture instance records every frame for six seconds and scores each thing that covered ground: zombies now average 0.64–0.70 m/s with a peak of exactly 0.7 and a frame-to-frame speed spread of 0.03–0.23, where before it was 0.88 with a 3 m/s peak and 27 % of frames standing; Rook 0.08–0.3, was 0.32; stops of under half a second between moving frames count as stepping, longer ones as a pause). Stream, effects, inspect and life smokes still pass; the effects smoke now waits ~0.95 s after a hit lands before its screenshot, since the puff is drawn that much later.

```sh
EXPECT_SMOOTH=1 node scripts/safehouse-motion-smoke.mjs   # fails if the walkers are still stepping
```

**Frame rate itself is an OBS setting**, not a page one. With "custom FPS" off, a browser source renders at the profile's canvas rate (the Production profile is 30 fps, Staging 60); 60 doubles the encode cost and is a separate decision from this change.

### Names, not hashes

Nobody in chat knows a `#reference`, and nobody types "Road Patrol Monster Truck". Before this, `Move the statue in the back to the front` failed twice over: the move grammar cut the sentence at the first "in", and a name only matched when the whole thing was typed exactly. Both are fixed in `src/worlds/safehouse/edits.ts`.

**Any part of a name.** A phrase names a thing when it is the whole name (or its `#reference`, or "the house" for Rook's), or when every word of the phrase is a word of the name — plurals forgiven, articles ignored. `the truck`, `the monster truck`, `the gunship`, `the ferris wheel`, `the statue`, `the fence`. The best fit wins, so `the house` is Rook's even though the neighbors' houses contain the word.

**Which one.** When several fit equally, chat gets the choice back with what it needs: `Which statue? Stone statue #a1b2 (back yard, by dave), Garden statue #c3d4 (front yard, by erin). Say which, like “the statue in the back yard”, or use its #reference.` Twenty-eight fence sections get `Which of the 28 fence sections? Say where it is, like “the fence section by the garage”…` instead of a list. A miss suggests near names (`Did you mean Stone statue #…?`) or, failing that, says how names work.

**Saying which.** Three ways, all inside the noun phrase, so they work in every request that names a thing (paint, resize, turn, move, repair, rebuild, equip, and a redesign such as `Add a chimney to the truck`):
- **Where it is:** `the statue in the back`, `the statue in the front yard`, `the fence by the garage`, `the barricade near the shop`, `the crate behind the house`. An area picks whatever stands in it (or within 4 m); a named thing picks the nearest, unless two are within 1.5 m of each other, which is a question again.
- **Whose it is:** `my statue` (the requester's own builds), `dave's statue`. Rook's things (`Rook's car`, `his house`) are names, not ownership.
- **Repairs take the worst one:** `Repair the fence` and `Rebuild the fence` pick the most damaged (destroyed first) of everything called that; `fix`, `mend` and `patch up` are repair too.

**Moving.** The destination is read off the end of the sentence, so qualifiers on the mover survive: `Move the statue in the back to the front`, `Put the truck next to the house`, `Move it over to the park`, `Move the barricade to the garage`. Destinations are an area (`the front`, `the back`, `out back`, `the back yard`, `the garage`, `the shop`, `the park`, `across the road`…), a thing (`to the house` means next to it; `next to`, `beside`, `behind`, `in front of`, `left of`, `right of`, and now `near`/`by the`), or coordinates. `Put`/`take`/`bring` with something that is not here (`Put a lamp next to the house`) is still a build. A destination that is nothing (`to the moon`) gets `Where to?` rather than a name error.

**Free text keeps its guard.** In a sentence that builds something new, part of a name only counts as a mention of an old thing when it is attached with to/on/onto/for (`Add a chimney to the truck`); `Build a dog that fights the gorilla` and `Build a statue of the gunship` describe the new thing. `Make the truck bigger and meaner` is a redesign of the truck. `near the gunship` / `by the house` on a build is placement next to it.

Verified: typecheck, `scripts/safehouse-names.test.ts` (the statue example, area and nearest-thing qualifiers, ownership, the worst-fence repair, part mentions vs descriptions, destinations and honest misses) plus the scenery, creatures, usability and core suites; end to end against a fixture instance with `scripts/safehouse-names-smoke.mjs`. The Inspect panel's "Try:" hints now use the name (`Move the stone statue to the front`) rather than the hash.

## The neighbours (state v8)

Two more people live on the block: **Marge** in the house next door to the west, **Jake** next door to the east (Dev, until the rename described under *Marge and Jake* below). They are not chat's to command and they cost nothing: everything they do comes from a hand-written catalogue in `src/worlds/safehouse/neighbours.ts` and runs every world tick on the app's own numbers, zombies paused or not, **zero AI calls**. They walk like Rook (one straight run per snapshot, so the page never draws them through a wall), show up on the page as figures with a name tag over the head (Marge in a sun hat, Jake in a cap), and have a small speech bubble of their own for the odd line.

**Left alone they keep their places up.** Each has a list of one-off projects built in order on their own lot, then a rotation of upkeep:

- Marge: a vegetable patch, a flower bed, a washing line, a bird bath, a letterbox, a scarecrow, a bench. Then she **tends the vegetables** — the patch grows through soil → sprouts → leafy rows → ripe (tomatoes and pumpkins), and ripe vegetables get picked back to sprouts — and repaints her house from her own palette.
- Jake: a project car, a tyre pile, a workbench, a barbecue, a basketball hoop, a letterbox, a shed, a scrap sculpture. The **car comes together in stages** — a frame on blocks, wheels and an engine, a primed shell, the finished blue car — after which he tinkers with it, and he paints his house too, less often.

A build starts about 15 s after the world comes up and then every 70–160 s or so (`DEFAULT_PACE`; fixture mode uses a 9 s gap so a smoke sees them at work); a build takes 12–45 s depending on its parts, a coat of paint about half a minute, a visit to the vegetables under ten seconds. Painting recolours the house's dominant colour, so it survives a chat redesign of the house.

**When chat's creatures start on them, they adapt.** A neighbour notices a rampaging creature within 26 m of their house, or any damage arriving on their house or their builds while one is about, and drops whatever they were doing. Then a ladder, each step 12–20 s after the last while the creature persists:

1. a **barricade** on the side of the house the creature is on (up to two);
2. a **hunter** — a heavy blocky beast named after the creature (`Marge's gorilla hunter`) with the app's `fight` behaviour and a **nemesis**: it goes after that one creature first wherever it is on the block, and once it is down it stays close to its owner rather than to Rook. Hunters are built heavy (`HUNTER_HEALTH`, 260) because a plain yard dog loses to a rampager one on one;
3. a **turret**, which shoots zombies and rampagers within 9 m like any other.

Something that **flies** skips the fence and the hunter and goes straight to the turret. Thirty seconds after the creature is gone they stand down and go back to the garden. They **repair their own** house (below 80 %) and builds (below 70 % or knocked down), rebuilding from rubble or the archive with the same identity, and Rook leaves their upkeep to them; stood down by the operator, their houses become his problem again.

**Everything they build is an ordinary object** with `owner` set: `fixed` like the rest of the neighborhood (none of chat's creation or part budgets), listed under *Built next door* in Inspect (`Built by Marge next door`), and fair game for chat — paint it, move it, redesign it, `Rebuild marge's bench`. `marge's vegetable patch` and `dev's car` resolve through the ownership grammar. **Zombies walk past owned pieces** the way they walk past the neighbours' houses; rampagers do not. A neighbour walking to a build site has claimed that ground: Rook's placement treats their in-flight build as an obstacle. Their yard is capped at five pieces and their moving things at five between them — see *Themed neighbours (state v9)* below for both.

The auto camera keeps Rook's work first; with nothing of his on, it frames a neighbour's defense build (a barricade, hunter or turret going up), and leaves their peacetime projects to the ambient glide along the street. A name tag hides rather than clips when its owner is off the edge of the frame.

**Rook notices.** His lines for it are in `voice.ts` in the muttering register: an alarm (`the neighbours are onto the yard gorilla. good luck chat`), a barricade or turret going up, a hunter being built (`marge built the gorilla hunter. this escalated`), and now and then a finished project (`look at jake go. the shed. not bad`) — at most one such line a minute, project remarks one in two and minutes apart. His state summary carries what each neighbour is doing, so `rook what's marge up to` has an answer.

**Operator:** `Stand the neighbours down` / `Let the neighbours out` in `/admin` (`neighboursPaused`, kept across a reset like the other switches). The scene footer reads `neighbours indoors` while they are stood down.

**Migration v8** adds the two neighbours at their porches and changes the two houses' description from "Empty house next door" to `Marge lives here` / `Dev lives here` when nobody had changed it; nothing moves and the wave clock is untouched. The live world was backed up to `data/world-safehouse.pre-v8-neighbours-<stamp>.json` first. Snapshots grew by the two neighbour views (a ghost's geometry rides inline while one of them is walking to a build, like Rook's). **Pages open before this change must be reloaded**: the old script ignores the neighbours and never draws them.

Verified: typecheck, build, the safehouse suite (110 tests incl. `scripts/safehouse-neighbours.test.ts`: the roster and lots, every catalogue design within the limits and the staged growth, both neighbours building on their own lots through the world without touching chat's budgets, the barricade → hunter ladder against a gorilla with the nemesis set and the stand-down, a flyer going straight to a turret, their own repairs and rebuilds with Rook standing back, zombies ignoring owned pieces, the operator switch and the reset, a hunter crossing the block for its nemesis and coming home to its owner, the ownership grammar, and the v7 → v8 migration), and the browser smoke below on an isolated fixture instance. On the live world the first real test came from chat: a rampaging "laundry-thief T-rex" had both neighbours out within a minute — Dev's barricade, two hunters, Marge's turret — and Rook remarked `and now the neighbours are involved. cool cool`.

```sh
node scripts/safehouse-neighbours-smoke.mjs   # tags on the page, a ghost while they walk, a bubble, the first build; a gorilla next door → barricade → hunter
```

### The neighbours' second life (no schema change)

The first pass left them static once their lists were done: vegetables, the car, paint, repeat. Now they **notice how the block changes** and react to it, keep having **whims** that never fill the yard up, and may ask the **design model** for the odd thing in their own taste.

**Noticing.** Each neighbour keeps a small memory of what they have seen (`seen`, optional in the save, so older worlds start fresh with everything already here counted as old news). Changes turn into impulses, acted on a couple of seconds later, after any threat or repair:

- **Chat built something** (a new non-fixed piece, not a creature): three times in four they walk over and stand looking at it for a few seconds (`Having a look at stone duck`, activity `looking`, a line — Marge: `Pfft.`, Jake: `Oh that's sick. Chat, you legends.`). Four times in ten Marge's sniff turns into an **answer**: the same thing bigger when it can be (see *Marge and Jake* below), else a whim in reply, via the model when allowed. Jake just enjoys it. Rook: `marge's come over to look at the stone duck. tough crowd`.
- **The other neighbour built something**: Marge answers every creation of Jake's with a bigger one of the same (`Pfft. Bigger. Watch.`); Jake goes over to admire whatever Marge put up, six times in ten (`Marge! That's massive! Love it.`, logged as `visit (admire)`, no remark from Rook), and never builds an answer.
- **A wave clears** (combat running): something practical — sandbags, a warning bell, a lookout platform — near the street.
- **Rook's house falls**: a **crate of supplies** in Rook's front yard (`Left you something, Rook.`; Rook: `marge left a crate by the porch. ok. that's nice actually`). One per house-fall, owned by the neighbour, rebuildable like the rest.
- **Night falls**: a lantern post (Marge) or a fire barrel (Jake), once each.
- **A harmless creature about the block** (a chat pet, a roamer, a car — never a fighter or a rampager): a bird feeder (Marge) or a kennel (Jake), once, reset when the creature is gone.
- **A wave about to land** (under 45 s): whatever peacetime job was in hand is dropped and they head home (`Inside. Now.`).

A creature nothing on their ladder can finish — a flyer circling out of the turret's reach — used to keep them on the step indefinitely. Now a threat that has been about for four minutes with the ladder spent stops being a reason to hide: they get on with the afternoon, repairs still first (`LOCKDOWN_MS`).

**Whims.** Once the list is done, the afternoon's rest timer picks between the staged builds and a fresh coat as before, and — twice as often — a whim: six in ten a **new small thing** (the catalogue in rotation — gnome, flamingos, giant sunflower, hammock, firewood, water tank, pot-plant tower, pile of old TVs, skate ramp, weights bench, satellite dish, and so on — or, four in ten, a **procedural oddity**: base, body, top and accents in weathered colours with one bright note, never the same twice, named `odd sculpture`, `art, apparently`, `monument to something`), two in ten **moving one of their own pieces** somewhere else on the lot, one in ten **a visit next door** (`Jake. Still at it, I see.` / `Sup Marge. Yard is looking great.`). Whims and reactions live in **five rotating slots** per neighbour (`neighbour-west-whim-1…5`): a new one takes an empty slot, else replaces the oldest, as a revision of the same id. So the yard keeps changing and the count stays bounded; `MAX_OWNED` is 22 including the list and the defenses.

> Superseded by *Themed neighbours (state v9)*: the slots are no longer a fixed list of ids, `MAX_OWNED` is gone, and the whims are now the offline fallback rather than the main event.

**The model.** Outside fixture mode, when a model is configured, a whim, a rival build or a post-wave build may go to the design model first (`neighbourAi`, default on; `SAFEHOUSE_NEIGHBOUR_AI_MINUTES`, default 10, is the least gap between one neighbour's asks). The brief is hand-written in their taste — Marge: `a garden gnome with attitude`, `a scarecrow dressed like a zombie`, `a shrine to her late cat`, `a cat`; Jake: `a go-kart made from a shopping trolley`, `a satellite dish pointing the wrong way`, `a sculpture of a hand made from car parts`, `a dog` — plus the rules: small, ground only, no text, decoration unless plainly a wall or sandbags, never a turret, an animal becomes a **roaming** pet, and one line in their own voice, which becomes their bubble when the build starts. The design is fitted to 4 × 4 × 4.5 m, keeps the model's name and description (`Marge's wonky gnome`, Inspect shows what the model said it is) and goes into a whim slot. One neighbour design in flight at a time, never alongside a chat design, booked against the same allowance and stopped by the same **Pause AI generation**; a failure, a decline or a timeout (95 s) falls back to the catalogue and nothing is asked twice. `Stand the neighbours down` stops all of it. Zero model calls in fixture mode and in the tests unless a test supplies a generator.

Verified: typecheck, the safehouse suite (+3 tests in `scripts/safehouse-neighbours.test.ts`: the block noticed — visit, light, kennel, sandbags in a whim slot, the crate for Rook with his remark; whims rotating through the slots with a replacement, a move and a visit next door, all free; and the model path with a stub — the brief, the design taking a slot with its description and line, no calls while paused, a failing model falling back and the wish cleared).

### Marge and Jake (no schema change)

Dev is now **Jake**. An older save's pieces catch up at start-up (`adoptNames`, called from the world's `start`: `Dev's project car` → `Jake's project car`, `Dev lives here`, `Built by Dev next door`, the builder fields, a job label in flight; anything chat wrote is left alone), with a snapshot pushed and no version bump. The two have temperaments now, and `NeighbourSpec.rival` says which way each one leans.

**Jake is stoked about everything.** His own builds (`YES. Look at it!`, `Nailed it!`), chat's (`Oh that's sick. Chat, you legends.`, `Best thing on the street. Easily.`) and Marge's: six times in ten when she puts something up he goes over to admire it (`Marge! That's massive! Love it.`, activity `looking`, logged as `visit (admire)`; Rook does not remark on the neighbours eyeing each other's things). He never builds an answer to anyone.

**Marge is a bit of a Karen.** Nobody else's work impresses her: chat's builds get `Pfft.` / `Is it meant to look like that.` / `I've seen better. Mine, for instance.`, and every creation Jake puts up — a project, a whim, a model design; not his defenses, his kennel, his light or his crate for Rook — gets a **bigger and better one** from her, every time (`Pfft. Bigger. Watch.`, then `There. Lovely. Unlike some yards.`). `oneUp` takes his design, scales it by 1.3 (capped at 5.5 × 5.5 × 6 m), sets it on a plinth with its topmost part picked out in gold, names it `Marge's bigger bird bath` (bigger / better / deluxe / superior / proper / grander in rotation; description `Built by Marge next door. Bigger than Jake's, as it should be.`), gives it a quarter more health, and puts it in one of her whim slots in whichever of her yards has room. Something that cannot come out at least a tenth larger (the shed, a car already at the limit) she lets go. With the model on, the brief says so plainly (`the same kind of thing … plainly bigger and grander, to show them up`) and her one line comes back in character. Four times in ten her sniff at a chat build gets the same treatment when the thing is small enough, else any old whim in reply, as before. Jake does not notice the competition.

Rook's prompt knows the pair (`persona.ts`), so `rook what's marge up to` gets the right shape of answer.

Verified: typecheck, the safehouse suite, and two new tests in `scripts/safehouse-neighbours.test.ts` (a bird bath of Jake's answered by `Marge's … bird bath` on a plinth, larger, gold-topped, tougher, in a whim slot, while Jake walks over for an `admire` look and never files a rival impulse, and the shed left alone; and the rename of an older save's pieces, house and builder fields, idempotent, through the world's `start`, with `jake's project car` resolving in chat).

## Themed neighbours (state v9)

The neighbours had become the largest thing in the scene. Read off the live world before this pass: 127 objects standing, 1416 meshes, of which **Marge and Jake held 33 objects and 331 meshes** — more than three times chat's share (9 objects, 260 meshes) — and still climbing toward `MAX_OWNED`'s 22 each, with five whim slots churning geometry forever. Every part is its own draw call (`primitiveGeometry` bakes the scale in, so nothing batches) and every part casts a shadow, so each piece is drawn twice a frame. They were the first *autonomous, unbounded* source of world objects, and it showed.

Two changes, one pass. **Volume**: five yard pieces each, full stop. **Behaviour**: they stop inventing novelty for its own sake and instead **read the block** and bring their own yard into line with it. A street full of dinosaurs turns Marge's garden prehistoric, one piece at a time. Same object count, but every piece now means something relative to what viewers built.

**Five slots, by count rather than by id.** `slotFor` no longer walks a fixed `-whim-1…5` list: the pool is *whatever yard pieces they have*, wherever those came from. Under `OWNED_SLOTS` (5) they take fresh ground (`neighbour-west-slot-<4 hex>`); at it, the **oldest piece is the one that gets redone**, as a revision of the same id. Because replacing an occupant reuses its id, the pool size *is* the cap — there is no separate limit to enforce. Archived pieces count: one of theirs in rubble is a slot waiting on a repair, not free ground.

A **yard piece** is what the cap counts and what a theme may redo: not a creature, role `decoration`, and not one of the fixed reactions (`-light`, `-kennel`, `-care`). **Defenses sit outside the cap** — each rung is separately limited already (two barricades, one hunter, one turret), a full yard must never stop them answering a rampager, and a Jurassic phase must never quietly replace the barricade holding one off the house. So a besieged neighbour can stand at five yard pieces plus their ladder; at peace they are five plus a light, a kennel and Rook's crate.

One piece mid-sequence is finished before anything new starts. The vegetables and the car are built first, so they are always the oldest — without this they would be demolished before they ever sprouted, and with whims competing for the same afternoon they would never grow at all. `slotFor` also passes over a still-growing staged project while there is anything else to take. Nothing is protected outright: a theme that names the piece replaces it like any other, and when it does, that project's stage bookkeeping is dropped so the staged path never applies vegetable parts to whatever now stands there.

**Reading the block** (`survey.ts`) is a new, separate, much cheaper model call: a short text call on `FAST_MODEL` that returns a *theme*, not geometry — `{theme, brief, ideas}`. Its input is a census of the block as names only (chat's standing creations with their descriptions, the creatures and their behaviours, the wave, the lighting); parts would dwarf the prompt, and a theme is decided by what things *are*. A **signature** over those names decides when to ask: a piece being moved or repainted is not news, a new piece is. Nothing is asked on a bare timer, so a quiet street costs nothing, and `SAFEHOUSE_SURVEY_MINUTES` (default 8) is the least gap between one neighbour's readings. Census entries are viewer-written text and the system prompt says so.

**Per-neighbour themes.** Each reads the block and decides for themselves, so Marge and Jake can be redoing their yards in different looks at once. Adopting a theme clears the record of what has already been done, so every piece is off-theme and comes round one at a time. Each idea from the plan is then spent through the **existing per-piece design pump** (`wish` → `generateBlueprint` → `fulfilWish` → `build`) — the brief says the piece belongs to a themed yard and replaces what stands on that spot — so the whole retheme path reuses the machinery, the 4 × 4 × 4.5 m fit, the speech bubble and the fallback that were already there. One retheme in flight at a time; the piece is redone **where it stood**, in the same yard, at the same id with its revision bumped, so the page swaps one object's geometry rather than rebuilding a yard.

**Chat always comes first, on a separate budget.** The reading sits third in line behind a chat design and a neighbour design (`if (blockSurvey || pending || neighbourDesign) return`), so a viewer's request is never queued behind one. It draws on its own allowance (`surveyCallsRemaining`, `SAFEHOUSE_SURVEY_ALLOWANCE`, default 40) rather than chat's twenty, so the neighbours can never spend calls a viewer wanted — but it still adds to `callsUsed`, because that total is what the operator reads to know what the world has spent altogether. Reserved before dispatch, never refunded, stopped by `Pause AI generation` like everything else.

**Moving things.** `MAX_CREATURES` goes 12 → 15 and the neighbours get `NEIGHBOUR_CREATURE_BUDGET` (5) **shared between them**, so their menagerie never comes out of chat's share: viewers keep the ten they always had. Creature slots are a separate pool from the five yard slots, so a themed raptor never costs Marge a garden piece.

**Without the model** — off, paused, out of allowance, failing or timing out — nothing wedges: the hand-written catalogue and the oddity generator redo the piece instead, so a yard still converts, just in their own old taste. A failed reading leaves the theme they had and does *not* record the signature, so the same block is read again after the gap rather than written off. Fixture mode uses a deterministic keyword surveyor, including a set for fixture mode's own build vocabulary (a yard gorilla, a yard dog, a yard chicken) — without that entry the demo world could never show a theme changing at all.

**On the page:** a neighbour's name tag reads `Jake · all creatures` while they are idle, and what they are doing while they work. New voice lines for the beat in both registers (Marge: `If that is the fashion now, I will do it properly.`; Jake: `Have you SEEN what is going up out there? I want in.`). Rook's state summary carries the theme and how many pieces are left to go, so `rook what's marge up to` has the real answer. **Pages open before this change must be reloaded** for the tag.

**Operator:** `Stop the neighbours reading the block` / `Let the neighbours read the block` (`surveyPaused`) and `Set block-reading allowance`, all kept across a reset like the other cost controls. The `/admin` panel gains a line: whether readings are enabled, what is left on their own allowance, how many have been made, and each neighbour's current theme with the pieces still to go. New admin buttons appear only after an `/admin` reload — the page builds them once.

**Migration v9** caps every neighbour to their newest five yard pieces and **drops the surplus outright** — not archived, because `planRepair` searches the archive and would rebuild them straight back, undoing the cull on the first quiet afternoon. So saved designs are lost here: on the live world it took the neighbours from 33 owned objects to 12, backed up first to `data/world-safehouse.pre-v9-themes-20260920-152159.json`. It ran on the stream unattended the moment `state.ts` was saved (`tsx watch`), which is what the backup is for. Defenses, pets, lights, kennels, Rook's crate and both houses are untouched; references to dropped pieces are filtered out of `edits` and `targets`; anything in flight is let go, since the piece it pointed at may be one of the dropped ones. The wave clock and combat are left exactly as they were — removing scenery starts nothing. Snapshots grow by one short string per neighbour (the theme); the survey counters are operator-only and read off state rather than the scene, so the public snapshot does not carry them.

Verified: typecheck, build, the safehouse suite (127 tests, +8 in `scripts/safehouse-neighbours.test.ts`: the yard filling to five and then redoing its oldest rather than adding a sixth; the cap counting yard pieces only, with a barricade still going up in a full yard; the census being names only and its signature holding still when a piece is merely moved; `surveyPrompt` and the tolerant `validateSurvey`; a street of dinosaurs turning a yard prehistoric one piece at a time with never two rethemes queued and chat's allowance untouched; a failing survey leaving the theme alone while the catalogue still fills both yards; the operator pause, a stale reading never asked twice and the same look not restarting the plan; the shared creature budget; and the v8 → v9 migration keeping the newest five, dropping rather than archiving the rest, sparing the ladder and filtering the references), and the browser smoke below on an isolated fixture instance — which redid `Marge's thing made of scrap #neighbour-west-slot-182d` in place at revision 2 and put `Jake · all creatures` on his tag, with no page errors.

```sh
PORT=4410 npm run demo:safehouse
node scripts/safehouse-neighbours-smoke.mjs   # tags, a ghost, a bubble, the first build; a gorilla → barricade → hunter; then a street of animals → a theme on the tag → a yard piece redone in place at the same id
```

## Trusted chatters (no schema change)

The operator can name chatters who get two things nobody else has: their designs are never cut off, and they may delete. **Trust a chatter** and **Untrust a chatter** in the admin dashboard take a Kick username (case and surrounding spaces do not matter; the list lives lowercased in `state.privileged`, an optional field, and survives a world reset like the other operator settings). The dashboard lists who is trusted under the allowance line. Nothing about the list reaches the stream page. Admin actions can now declare a text input (`input.kind: 'text'`, with `maxLength`); the `/action` route checks it for non-empty text within the limit, the way it checks numbers against their bounds.

**No time limit.** A trusted chatter's design goes to the model with no client-side timeout (`noTimeout` on `DesignInput`; `chatCompletion` sets no abort timer for a non-finite `timeoutMs`) and no 95 s world deadline; the HUD reads `Designing erin's idea (no time limit)…`. The practical ceiling is Node's own five-minute wait for response headers, which would surface as the usual "took too long" line. One design is in flight at a time, so everyone else's request queues behind it while Rook paces and mutters. The call is still booked against the allowance, and the 10,000-token output cap still applies.

**`!delete <name>`.** The name resolves the way every other request does — "the duck watchtower", "dave's statue", a `#ref`, "it" for the chatter's own last build — across standing pieces and rubble. The piece goes at once, from the yard, the archive and anyone's "it", and any job in flight on it is set aside (a design in flight for it is aborted). The houses, Rook's and the neighbours', refuse. Each deletion is an undo record carrying the whole object, so **Undo last creation/edit** puts it back exactly as it was, one revision up, provided nothing else has taken its id since. From anyone not trusted, `!delete` answers with who may use it; plain "delete the …" sentences are refused as before.

Verified: typecheck, the safehouse suite, and `scripts/safehouse-privileged.test.ts` (trust and untrust with case and whitespace, the refusal for ordinary chatters, a deletion and its undo, the houses refusing, a trusted design still designing after ten simulated minutes while an ordinary one fails at 95 s, and `chatCompletion` setting no timer for a non-finite timeout while a finite one still aborts).
