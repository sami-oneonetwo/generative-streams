# AI Dudes

An empty field where **every chatter gets a dude, and every dude is run by that chatter's own agent.** Chat isn't classified or queued behind one protagonist: each message goes straight into its chatter's inbox, and their agent answers it. Agents run in parallel. Builds are designed in parallel. Every dude walks over and puts up its own build at the same time as everyone else.

Built on the same engine as the safehouse world (`../noodle-shop`): the engine, Kick ingestion, the OpenRouter client, admin and persistence are copied, and blueprint validation and the object renderer are adapted from the safehouse. Nothing is shared at runtime. This project has its own `.env`, its own `data/`, and port 4500.

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
