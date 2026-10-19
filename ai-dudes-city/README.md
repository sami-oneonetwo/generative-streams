# AI Dudes: the town

A small town where **every chatter moves in, gets a lot of their own, and is run by their own agent.** Chat isn't classified or queued behind one protagonist: each message goes straight into its chatter's inbox, and their agent answers it, in parallel with everyone else's. What a chatter types appears in their speech bubble word for word; their agent decides what the body does about it.

This is a sibling of `../ai-dudes-journey` (the forest walk), copied from it and turned into a town. It has its own `.env`, its own `data/`, and port 4600 (demo 4610), so the journey on 4500 is untouched. Point the tunnel at 4600, or set `PORT=4500` here once the journey is stopped, to run this world live.

## The town

- **The layout** (`src/shared/city.ts`, the same on the server and the page): a 5 × 5 grid of blocks with named streets between them. Every block holds four 16 m lots, which makes 96 home lots. The middle block is the town square: a paved cross, the fountain, the market stall, the bus stop, and four community lots.
- **Moving in.** A chatter's first message brings them in on the bus. They get the next free lot (nearest the square first), with an address like "7 Maple Street", and walk over to it. The lot's FOR SALE sign becomes their name. When every lot is taken, newcomers rent a flat in someone's apartment block, or a friend can share a lot.
- **Building with a purpose.** Builds go up on your own lot, scaled to fit it, and every build has a kind: `home`, `cafe`, `restaurant`, `bakery`, `bar`, `club`, `shop`, `market`, `workshop`, `apartments`, `gym`, `park`, `library`, `florist`, `venue` or `decor`. The agent names the kind, or the words decide ("a little pizzeria" is a restaurant). Each kind has what a visit does for you (needs), a price, a pose and a length (`VENUES` in `city.ts`).
- **Needs and going out** (`city.ts`). Everyone has food, rest, fun and company, from 0 to 100. Needs run down while their chatter is around. When one is low and nobody has asked them for anything, characters go out on their own to the best place for it, and other people's places are preferred. The visitor pays, the owner earns (`+§5` floats up over the place), and the place's stats count it. Tired means home. Lonely means going to find someone. The mood shows as a diamond on the name tag and over the head: green, amber or red.
- **Coins (§).** Everyone starts with 150. You earn from visitors, from shifts (`work` at any place pays §12), and from a coin a minute of odd jobs while your chatter is around. Nobody goes broke: a place you can't afford gives you a glass of water.
- **Nothing bad happens while you're away.** A character whose chatter has been quiet for 15 minutes potters about their own lot. Their needs fall at a fifth of the rate and never below 35, and their places keep taking visitors. When the chatter comes back, the agent gets a "while you were away" paragraph to react to (visitors, coins, who moved in next door, what the town finished), and the feed says it.
- **Community projects.** `propose` puts one big thing on a free community lot on the square. It's designed first, so the ghost stands there for everyone to see. Then it's paid for (`contribute`) and built (`help`, labour in person-seconds) together; the costs scale with how many people are about. When both bars are full it goes up, everyone who put anything in gets a badge, the proposer gets a host ribbon, and there's a grand opening on the square with confetti. One project at a time. After 40 minutes an unfinished project is shelved and the coins go back.
- **The town's residents.** Mrs Okafor, Old Tom and others arrive off the bus. They're not chatters and they have no agent. They use people's places (and pay), wander, and gossip about what's popular, what's new, and what the town is missing. There are more of them when chat is quiet, and two more for every apartment block.
- **Consequences.** "The town wants" comes from what stands and what went unmet: somewhere to eat, a florist for all the parties, apartments for the newcomers, a café for the morning after the club. A block with two or more places of one sort becomes a district ("Food Street", "Neon Row"), named over the block and in every agent's view. "Busy right now" lists the places with the most recent visits.
- **Other people's things.** You can only build on your own lot and lots you've been given a key to (`share`). You can only edit or remove your own builds. You can't walk into someone else's home. Troublemakers still come by, and `use … fix` repairs what they did.

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
| `DUDES_CALL_ALLOWANCE` | 500 | request-count circuit breaker over both kinds of call |

Messages that arrive while a chatter's agent is busy, or within 2.5 s of its last turn, wait and go into the next turn together. Nothing is dropped except past an 8-message inbox, where the oldest go. When the allowance runs out, inboxes wait; they don't empty.

## Operator (`/admin`)

You can pause or resume the AI, set, ignore or enforce the allowance, mute or unmute a chatter's agent, reset an agent (it keeps its builds), remove a dude and its builds, and remove a build by `#ref` or name. The Dudes panel lists every agent's persona, memory, turn count and last error. "Simulate chat" sends many lines at once, for testing parallel runs.

Kick replies: when the replies toggle is on, each spoken line is mirrored to chat as `@name …`. It's off by default; the bubble over the dude is the reply.

## Kick

Same app credentials as `noodle-shop`, copied in `.env`. Tokens live in `data/`, so this project starts unconnected; connect from `/admin`. The webhook goes to `KICK_WEBHOOK_PUBLIC_URL`, so only the process the tunnel points at receives live chat. Point the tunnel at this world's port to run it live.
