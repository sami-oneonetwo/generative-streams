# AI Dudes

A forest path where **every chatter gets a dude, every dude is run by that chatter's own agent, and everyone walks it together.** Chat isn't classified or queued behind one protagonist: each message goes straight into its chatter's inbox, and their agent answers it. Agents run in parallel. Builds are designed in parallel. Every dude walks over and puts up its own build at the same time as everyone else.

Built on the same engine as the safehouse world (`../noodle-shop`): the engine, Kick ingestion, the OpenRouter client, admin and persistence are copied, and blueprint validation and the object renderer are adapted from the safehouse. Nothing is shared at runtime. This project has its own `.env`, its own `data/`, and port 4500.

## The journey

Everyone walks together down an endless forest path (`src/shared/trail.ts`: the same seeded trail and trees on the server and the page). The group's anchor, the camp, moves on at 1.5 m/s. The walkable window is the glade from 70 m behind the camp to 50 m ahead, 22 m either side of the path. Each character keeps up at its own loose spot in the crowd whenever it isn't doing something else. Builds left standing fall behind and are gone; anything being driven or ridden comes along. Nobody awake means nobody walks.

- **Chat is the character.** What a chatter types appears in their bubble straight away, word for word. Their agent decides what the body does about it: "what is this" means explore, "I want a fight" means shove someone, "nice one bob" means a high five. Direct requests still work. The agent speaks for itself only on turns of its own, reacting to the world. New actions: `explore`, `greet` (highfive / handshake / hug), `follow`, `shove` (attack `with: shove`), `stop`, `chop` (an edge tree becomes a log you own), `show badges`, `help` / `hinder`, `use … fire`.
- **Challenges** (`challenge.ts`, `boss.ts`) come every 300–450 m, alternating:
  - **The river** is 10 m of water across the glade. To get over: ride or drive something that floats or flies (`abilities` on the design, or guessed from its name) to "across"; swim (40 % make it); or build a bridge or freeze the river together (`help`). A project needs at least 3 people, and `hinder` undoes it, capped. It ends when everyone awake is across; after 10 min the stragglers are ferried over. Everyone who crossed or helped for at least 5 s gets the water droplet.
  - **The boss** (the Moss Troll, the Iron Boar, Old Gnarl) has 30 + 25 × awake HP. Every 6 s it slams anyone within about 6 m, knocking them out for 20 s. It takes damage from attacks, from manned weapon builds (`use … fire`, 3 per shot), from traps it walks into (15 and a stun), and from rams (5, which throws the driver off). Everyone who hurt it earns its face. After 12 min it wanders off and nobody earns anything.
- **Collectables** sit on name tags as small icons with counts. Past 4 kinds, the tag shows the 3 newest and "+N"; `show badges` opens them all for 15 s.
- **The end of the path is yours** (`landmark.ts`, /admin):
  - "Getting close" (describe it, or `default`) designs the landmark and puts it 100 m ahead as a dark shape in the mist. Challenges stop.
  - "You've made it" brings it into view and reveals it, and everyone there gets a star.
  - "Set off again" starts the next leg.
- **Other admin controls:** pause or resume the walk, start the next challenge now (`river` / `boss`), and end a challenge now.

## The Builder

`npm run builder` runs separately from the world. The Listener's most wanted `needs-feature` wish becomes a headless Claude Code run in a sandbox copy of the app (`../.wish-proposals/<id>/work`). It runs typecheck and tests there, then writes a patch (`data/builder/<id>.patch`) and a report (`data/builder/<id>.md`), both listed in /admin. No git, and nothing is applied; you read it and run `patch -p1 < data/builder/<id>.patch` yourself. It only runs while `data/builder/enabled` exists, does at most 6 attempts a day, and has a $5 budget per attempt (`BUILDER_*` env). `BUILDER_DRY_RUN=1` does everything except the Claude call.

## Run

```sh
npm install
npm run dev          # tsx watch + client rebuilds, http://localhost:4500 (admin: /admin)
npm start            # one build, then the server
npm run demo         # fixture agents and designs (no AI, no Kick) on :4510, data in data/demo
npm test             # world tests, no model calls
npm run inject -- alex "hi! build me a crooked lighthouse"
```

`/?stream=1` is the OBS view.

## How a chatter's agent works

- **Identity.** Each dude is keyed by the chatter's `userId` (`kick:<id>`), which is stable across streams. The record (`state.dudes`) persists: persona, title, look, memory, the last 14 lines of conversation, an inbox of unanswered messages, and position. A dude whose chatter has been quiet for 15 minutes naps where it stands.
- **Built from their personality.** On the first turn the agent invents a persona, a title and a look from the username and the first messages. It refines them later as it learns. `remember` keeps up to 16 short facts.
- **One turn = one model call** (`src/worlds/ai-dudes/agent.ts`). The input is the dude's record, its builds, nearby dudes and builds, what it overheard other dudes say within 10 m, and every message since its last turn (batched). The output is JSON in a closed grammar: `say`, up to three `actions` (build / edit / remove / move / emote), `persona`, `title`, `look`, `remember`. The parser is forgiving: a bad piece is dropped, never the whole turn.
- **What it can't do.** It can't touch another chatter's builds or dude. It can't run code. Every number belongs to the app. It's capped at 5 builds standing, 3 jobs in flight, and 300 builds in the whole field.
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

Same app credentials as `noodle-shop`, copied in `.env`. Tokens live in `data/`, so this project starts unconnected; connect from `/admin`. The webhook goes to `KICK_WEBHOOK_PUBLIC_URL`, so only the process the tunnel points at receives live chat. Point the tunnel at port 4500 to run this world live.
