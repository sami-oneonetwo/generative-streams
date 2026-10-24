# AI Dudes: the town

A small town where **every chatter moves in, gets a lot of their own, and is run by their own agent.** Chat isn't classified or queued behind one protagonist: each message goes straight into its chatter's inbox, and their agent answers it, in parallel with everyone else's. What a chatter types appears in their speech bubble word for word; their agent decides what the body does about it.

This is a sibling of `../ai-dudes-journey` (the forest walk), copied from it and turned into a town. It has its own `.env`, its own `data/`, and port 4600 (demo 4610), so the journey on 4500 is untouched. Point the tunnel at 4600, or set `PORT=4500` here once the journey is stopped, to run this world live.

## The town

- **The layout** (`src/shared/city.ts`, the same on the server and the page): a cross of four home blocks round the town square, with small parks in the four corners and named streets and avenues between them, about 140 m across so it reads on a phone. Every home block is three 12 m lots by three: eight lots round a green courtyard, each fronting a street or an avenue, which makes 32 home lots. A save from an older layout moves over on start (`src/worlds/ai-dudes/relayout.ts`): a lot that still exists keeps its owner and builds, the rest go to spare lots nearest the square first. The middle block is the town square: a paved cross, the fountain, the market stall, the bus stop, and four community lots. The streets are kept bare on purpose (no street furniture, no for-sale signs, few trees) so people and builds stand out.
- **Moving in.** A chatter's first message brings them in on the bus. They get the next free lot (nearest the square first), with an address like "7 Maple Street", and walk over to it. The lot's FOR SALE sign becomes their name. When every lot is taken, an empty lot whose owner has been gone 14 days (`DUDES_LOT_RECLAIM_DAYS`) and has nothing standing anywhere goes to the newcomer (the old owner hears, and gets a free lot back if there is one when they return). Otherwise newcomers rent a flat in someone's apartment block, build on any lot with room by saying where, or a friend can share a lot.
- **Building with a purpose.** Builds go up on your own lot by default, or on any other lot in town when the chatter says where (an address, a street, someone's lot, beside a build, "here", "a free lot"; never the square, which is for community projects), scaled to fit the lot, and every build has a kind: `home`, `cafe`, `restaurant`, `bakery`, `bar`, `club`, `shop`, `market`, `workshop`, `apartments`, `gym`, `park`, `library`, `florist`, `venue` or `decor`. The agent names the kind, or the words decide ("a little pizzeria" is a restaurant). Each kind has what a visit does for you (needs), a price, a pose and a length (`VENUES` in `city.ts`).
- **Needs and going out** (`city.ts`). Everyone has food, rest, fun and company, from 0 to 100. Needs run down while their chatter is around. When one is low and nobody has asked them for anything, characters go out on their own to the best place for it, and other people's places are preferred. The visitor pays, the owner earns (`+§5` floats up over the place), and the place's stats count it. Tired means home. Lonely means going to find someone. The mood shows as a diamond on the name tag and over the head: green, amber or red. Someone on their way somewhere says why and where under their name ("hungry → Sara's Bakery"). Bakeries, shops, florists and workshops are browsed at the counter and libraries sat in, so only homes, flats and gyms hide people inside.
- **Coins (§).** Everyone starts with 150. You earn from visitors, from shifts (`work` at any place pays §12), and from a coin a minute of odd jobs while your chatter is around. Nobody goes broke: a place you can't afford gives you a glass of water. Coins also leave town: a new look after the first costs §10, and the councillor's fine is §15 (both paid as far as you can, floated up in red). `!top` names the richest character and the busiest place.
- **Nothing bad happens while you're away.** A character whose chatter has been quiet for 15 minutes potters about their own lot. Their needs fall at a fifth of the rate and never below 35, and their places keep taking visitors. Now and then one goes out anyway (a shift where the travellers asked for one, a visit to somebody else's place; four at most at once), and about half of them turn up to parties and grand openings. When the chatter comes back, the agent gets a "while you were away" paragraph to react to (visitors, coins, who moved in next door, what the town finished), and the feed says it.
- **Community projects.** `propose` puts one big thing on a free community lot on the square. It's designed first, so the ghost stands there for everyone to see. Then it's paid for (`contribute`) and built (`help`, labour in person-seconds) together; the costs scale with how many people are about. When both bars are full it goes up, everyone who put anything in gets a badge, the proposer gets a host ribbon, and there's a grand opening on the square with confetti. One project at a time. After 40 minutes an unfinished project is shelved and the coins go back.
- **The town's residents.** Mrs Okafor, Old Tom and others arrive off the bus. They're not chatters and they have no agent. They use people's places (and pay), wander, and gossip about what's popular, what's new, and what the town is missing. There are more of them when chat is quiet, and two more for every apartment block.
- **Consequences.** "The town wants" comes from what stands and what went unmet: somewhere to eat, a florist for all the parties, apartments for the newcomers, a café for the morning after the club. A block with two or more places of one sort becomes a district ("Food Street", "Neon Row"), named over the block and in every agent's view. "Busy right now" lists the places with the most recent visits.
- **Talking to each other** (`talk.ts`). A line said to a character nearby (by name, or to the one person right in front of you) gets an answer on a turn of their own, and the answer goes back; a back-and-forth stops after three lines. When chat is quiet, the character who gets a turn of its own gets something to react to: a new build next door, a rival place doing better, what the travellers still need, a low need, someone near. Unprompted turns may work a shift, help build the community project, or chip in up to §15 (never more than a tenth of their coins), but still never start a build or a fight.
- **Who's who.** Each character keeps a small ledger of the people they have history with: visits to each other's places, gifts, hits, projects built together. Their agent sees "your regulars", friends and "who has been at your stuff", and outings lean toward friends' places.
- **Other people's things.** You can build on any lot but the square's, and a lot's owner hears when someone builds on theirs; a key (`share`) now only lets a friend into your home. You can only edit or remove your own builds, wherever they stand. You can't walk into someone else's home.

## Breaking things

Chat likes to break stuff, so it can (`src/worlds/ai-dudes/damage.ts`, `weapons.ts`). Cartoon rules: nobody stays down and nobody's work is lost.

- **Builds have health**, from how big they are. It takes real effort: about a minute of steady fire to bring a house down, whatever the weapon. Hits knock the top pieces off first; what is left leans and blackens, smokes, then burns, and at nothing it comes down in a heap of rubble with a dust cloud. A health bar shows over a build for a few seconds after each hit.
- **Coming back.** The design before the damage is kept. `use … fix` (or F on /play, for your own) puts it back at once, and anything damaged rebuilds itself 4 minutes after its first hit (rubble, 4 minutes after it came down), however often it's hit since. Put back up, it only rattles for a minute. A build whose owner is away takes about a third of each hit. A community project never goes below 35%. At most two monsters rampage at once (the oldest, one per owner); the rest just wander. Knocked out and back up, nobody can be knocked out again for 7 s.
- **Weapons for the Mayor and players.** `G` cycles nothing / blaster / rocket launcher; a click fires at that spot, `X` (or Space on the ground) fires straight ahead. The blaster is fast and light; a rocket goes off where it lands and hits everything round it. A blaster bolt only knocks a person back a step; a rocket knocks them out for a few seconds.
- **Tanks and rams.** Build a tank (or anything with a gun: the designer marks it `weapon`). Get in with `R` and its cannon fires instead. Drive anything into a build and it takes a knock by speed and weight; a bulldozer or a T-rex hits much harder. Players can now ride and drive on /play too (`R`, Space/Z to fly).
- **Monsters.** A T-rex, a kaiju or a giant robot (`smash`) roams on its own and goes after other people's builds nearby, never its owner's or the town's projects. It stomps one until it falls, flattens anyone underfoot, and after each one it lies down for a few minutes.
- **Agents.** `attack` on a build lands a few blows, a bomb takes a big chunk out of everything round it, and aboard a tank `attack … shoot` drives into range and fires the cannon.
- **/admin:** Destruction off (hits and monsters only rattle builds), Destruction on, and "Put every damaged build back up now".

## What an agent can do

`build` (with a `kind`, optionally on a friend's lot), `edit`, `remove`, `visit` (a place by name, or a need: food, rest, fun, company), `work`, `invite` (the other chatter's agent gets a nudge and decides), `share` (give a key to your lot), `rent`, `give` (coins), `propose`, `contribute`, `help`, plus the old ones: `explore`, `emote`, `greet`, `follow`, `move` (to a name, a build, `home`, `square`, an address), `use`, `attack`, `stop`, `show badges`. A turn nobody asked for can't start a build or a fight.

## Operator (`/admin`)

Everything from before (AI pause, allowance, mute, reset, remove), plus:
- **Town:** throw a street party (at a build, an address or the square); shelve or finish the community project; give a chatter coins (`name 100`); take a lot back; rename the town.
- **Town life:** off or on. Off means no residents and nobody goes out on their own.

## The Builder

`npm run builder` runs separately from the world. The Listener's most wanted `needs-feature` wish becomes a headless Claude Code run in a sandbox copy of the app (`../.wish-proposals/<id>/work`). It runs typecheck and tests there, then writes a patch (`data/builder/<id>.patch`) and a report (`data/builder/<id>.md`), both listed in /admin. No git, and nothing is applied; you read it and run `patch -p1 < data/builder/<id>.patch` yourself. It only runs while `data/builder/enabled` exists, does at most 6 attempts a day, and has a $5 budget per attempt (`BUILDER_*` env). `BUILDER_DRY_RUN=1` does everything except the Claude call.

## Run

```sh
npm install
npm run dev          # tsx watch + client rebuilds, http://localhost:4600 (admin: /admin)
npm start            # one build, then the server
npm run demo         # fixture agents and designs (no AI, no Kick) on :4610, data in data/demo
npm test             # world tests, no model calls
PORT=4600 npm run inject -- alex "hi! build me a crooked cafe"
```

`/?stream=1` is the OBS view.

**Chat commands** (the Town Crier answers in chat; the character doesn't hear them): `!help`, `!town`, `!top`, `!me`, `!play` (the play site, `PLAY_URL`). Answers asked for inside the crier's 8 s gap wait and go out together in one line. Any other `!word` is taken as a command for some other bot: not said, no agent turn, and no character for someone new. Kick emotes (`[emote:ID:NAME]`) show as pictures in the bubble and reach the agent as their names; an emote on its own gets no agent turn. Chat bots (BotRix and the usual ones, plus `KICK_IGNORE_BOTS`, comma-separated) never get a character. What agents write (say, persona, title, memory) goes through a plain-voice filter (`voice.ts`): slang rewritten, SHOUTING lowercased.

## Play: chatters walking their own character

**https://stream-play.kick-product.com**. A chatter logs in with Kick and walks their own character (the one their chat made, keyed `kick:<user_id>`) the way the streamer walks the Mayor. WASD walks, Shift runs, Q/E or a drag turns the camera, Enter speaks, 1–8 strike a pose, B builds on their own lot, F fixes their own damaged build (standing at it, every 20 s), and clicking one of their own builds reworks or removes it. On a phone a thumb stick walks (push it all the way to run) and buttons say, build, fix, arm, ride and fire. Knocked out, the page stops walking and shows "seeing stars" until they're up.

- **The Worker** (`play-worker/`, account Kick Product, custom domain only: `*.workers.dev` is off) sends `x-town-key` (secret `TUNNEL_KEY`) with everything it passes on, and does the Kick login (PKCE, `user:read`), reads the user id and name, hands the Kick token back, and sets a `play` cookie signed with `PLAY_SECRET`. Everything else is proxied to `ORIGIN_URL` (the ngrok tunnel), and only these paths: `/play`, `/dudes.js`, `/ws`, `/ws/player`, `/api/objects/parts`, `/api/play/me`. So `/admin` and the webhook are never reachable through it. It keeps no state. Deploy it with `cd play-worker && wrangler deploy`. Secrets are `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`, `PLAY_SECRET` and `TUNNEL_KEY` (`wrangler secret put`). The page itself comes from this server, so client changes need no redeploy.
- **This server** checks the cookie itself (`src/server/play.ts`), so the public tunnel URL can't be used to pose as someone. It also holds the seats: `PLAY_SEATS` (10). A seat is taken when the player's socket opens. It's given up 60 s after the socket closes (sockets are pinged every 20 s, so a dropped phone counts as closed), or after 10 min without a key press (the page's standing-still heartbeat doesn't count). A second tab takes over from the first. When every seat is taken, newcomers wait in line (first come, first served, their place shown) instead of retrying; while anyone waits, a turn lasts 15 minutes (with a minute's warning) and a closed tab's seat goes after 20 s. Player sockets are only accepted from the town's own origin or `PLAY_ORIGINS` (default `https://stream-play.kick-product.com`). `/kick/login` and `/kick/callback` answer only on localhost, never through the tunnel.
- **While someone plays**, their agent leaves the body alone: no turns, errands or strolls. What they type is said as is, and anyone they name is told. Their builds go through the designer and rise on their own, at most 6 per visit, and chat's design requests go before players' (players never hold every design slot). A muted chatter can't join, talk or build. The server holds each player to a one-second distance budget at running speed, treats builds as solid, and works out a ram's speed from the steps it accepted (a ram needs a 2.5 m run-up and hits no harder than a cannon shell). Nothing about piloting is saved, so a restart hands everyone back to their agent.
- **/admin → Players** lists who's in, can send someone out for 10 minutes, shut the doors, or change the number of seats. Kicks are kept in `data/play-kicks.json`, so a restart or hot reload doesn't let anyone back in early (`POST /admin/play {"kick": id, "minutes": n}` works on someone not seated too, `{"unkick": id}` lets them back). Resetting the world sends every player off with "the town was reset, reload".
- **The tunnel is locked down** (`src/server/tunnelGuard.ts`). Through the tunnel, only `POST /kick/webhook` and the Worker's paths answer, and the Worker's paths only with its `x-town-key` header (`TUNNEL_KEY` in `.env`, the same as the Worker's secret; `openssl rand -hex 32`). Everything else, `/admin`, `/mayor`, `/ws/mayor` and the plain `/` view included, answers with a 404 unless the request comes from this machine itself, with or without `ADMIN_TOKEN`. Socket upgrades are held to the same rule. Run the tunnel with `npm run tunnel`. It starts ngrok on your static domain (`NGROK_URL`, or the host of `KICK_WEBHOOK_PUBLIC_URL`) with a traffic policy holding the same rule (written to `data/ngrok-policy.yml`), so anything else is turned away at ngrok and never reaches this machine. OBS and `/admin` use `http://localhost:4600`.
- **Straight to the box's IP, for the operator:** `HOST=0.0.0.0` opens the port (the cloud firewall decides who reaches it), and `TRUSTED_IPS` (comma-separated) lists the addresses treated like this machine: `/admin`, `/mayor` and the operator socket with no token. The Host must then be the bare IP (`http://<box-ip>:4600`), never a domain name, so another site can't rebind its name to the box. Anyone else who gets through is held to the tunnel's rule.
- **Locally, without Kick:** `http://localhost:4600/play/dev-login?name=alex` (localhost or the operator token only).
- **The Kick app** must list `https://stream-play.kick-product.com/callback` as a redirect URI.

## How a chatter's agent works

- **Identity.** Each dude is keyed by the chatter's `userId` (`kick:<id>`), which is stable across streams. The record (`state.dudes`) persists: persona, title, look, memory, the last 14 lines of conversation, an inbox of unanswered messages, and position. A dude whose chatter has been quiet for 15 minutes naps where it stands.
- **Built from their personality.** On the first turn the agent invents a persona, a title and a look from the username and the first messages. It refines them later as it learns. `remember` keeps up to 16 short facts.
- **One turn = one model call** (`src/worlds/ai-dudes/agent.ts`). The input is the dude's record, its builds, nearby dudes and builds, what it overheard other dudes say within 10 m, and every message since its last turn (batched). The output is JSON in a closed grammar: `say`, up to three `actions` (build / edit / remove / move / emote), `persona`, `title`, `look`, `remember`. The parser is forgiving: a bad piece is dropped, never the whole turn.
- **What it can't do.** It can't touch another chatter's builds or dude. It can't run code. Every number belongs to the app. It builds only on lots it has a key to, as much as fits, with up to 5 jobs queued or in flight.
- **Builds** go through a second call (`design.ts`, the safehouse design prompt without the zombies). The dude's persona is passed as a style hint. The result is validated, fitted and placed near the anchor without overlapping anything standing or any ground another dude has claimed. Then the dude walks over and builds.

## Parallelism

| Setting (`.env`) | Default | What it is |
|---|---|---|
| `DUDES_AGENT_MODEL` | `FAST_MODEL` (Haiku 4.5) | turn model; about 4 s per turn |
| `DUDES_DESIGN_MODEL` | `AGENT_MODEL` (Opus 5.5) | geometry; about 35 s per design |
| `DUDES_AGENT_CONCURRENCY` | 6 | agent turns in flight across all chatters |
| `DUDES_DESIGN_CONCURRENCY` | 3 | design calls in flight; one per dude at a time, oldest first |
| `DUDES_CALL_ALLOWANCE` | 500 | legacy; no longer gates anything (the rolling budget below does) |
| `DUDES_AGENT_CALLS_PER_HOUR` | 1200 | rolling budget for agent turns, the aide and the Listener (/admin can change it live) |
| `DUDES_DESIGN_CALLS_PER_HOUR` | 90 | rolling budget for designs: builds, projects, restyles (restyles leave a third of it for chat) |
| `DUDES_AGENT_CALL_USD` / `DUDES_DESIGN_CALL_USD` | 0.008 / 0.10 | rough cost per call, only for the spend estimate on /admin |

Messages that arrive while a chatter's agent is busy, or within 2.5 s of its last turn, wait and go into the next turn together. The gap grows with how many are talking (past 6 chatters in the last two minutes, in step with them, up to a minute), so a busy chat shares turns out. A line that nearly repeats one still waiting (or one said a moment ago) only refreshes the bubble. Nothing else is dropped except past an 8-message inbox, where the oldest go.

The AI budget is rolling: agent calls and design calls each draw from a bucket holding a quarter of an hour's worth that refills continuously, so switching enforcement on mid-show only slows calls to the rate. When it runs low, inboxes wait; they don't empty. Calls are counted either way, and /admin shows the last hour, the current pace in dollars (rough) and a red "AI cap OFF" pill while it isn't enforced.

## Operator (`/admin`)

You can pause or resume the AI, set the agent and design budgets per hour, ignore or enforce them, cancel every waiting design (the AI stays on), clear a bubble or the feed, send a stuck dude home, mute or unmute a chatter's agent, reset an agent (it keeps its builds), remove a dude and its builds, and remove a build by `#ref` or name. The Dudes panel lists every agent's persona, memory, turn count and last error. "Simulate chat" sends many lines at once, for testing parallel runs.

Kick replies: when the replies toggle is on, each spoken line is mirrored to chat as `@name …`. It's off by default; the bubble over the dude is the reply.

## Kick

Same app credentials as `noodle-shop`, copied in `.env`. Tokens live in `data/`, so this project starts unconnected; connect from `/admin`. The webhook goes to `KICK_WEBHOOK_PUBLIC_URL`, so only the process the tunnel points at receives live chat. Point the tunnel at this world's port to run it live.
