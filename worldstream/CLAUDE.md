# CLAUDE.md

worldstream is a chat-driven pixel-art world streamed on Kick via an OBS browser source.

## Shape

- World state is plain JSON owned by the server (`src/shared/state.ts`). Every change goes through the pure reducer `apply(state, mutation)`. Never mutate state directly. One persisted file per world in `state/`; the store swaps them on travel.
- Each git branch is a separate world project. The npm `dev`/`start` scripts pin `WORLDSTREAM_STATE_DIR=state/<branch>` so persisted state is isolated per branch. `state/kick-tokens.json` stays shared at the root — refresh tokens rotate on every refresh, so never split it per branch. After switching branches, `npm run dev` re-packs assets, but a stale `dist/` from another branch is loaded silently if you start the server any other way.
- The renderer (`src/web/renderer.ts`) is Canvas 2D at 480x270, scaled x4 with smoothing off. All coordinates are integers in 480x270 space. Layers and parallax live in `src/shared/state.ts`; per-world looks live in the `THEMES` table in the renderer.
- Chat enters through one type, `IncomingChat` (`src/server/ingest.ts`), whether from Kick, the mock REPL or the admin page. `parseCommand` handles the fast path; everything else may go to the brain (`src/server/brain.ts`), which turns Claude tool calls into the same `Command` objects. The policy layer (`src/server/policy.ts`) is deterministic and runs on every proposed change, including anything the model proposes.
- The catalogue (`assets/worlds/<world>/catalogue.json`) is the only list of addable sprites, ambient events, weather weights and line banks. `ctx.catalogue` is a getter for the current world; do not cache it.
- Shared and server code use NodeNext modules: imports need `.js` extensions.
- The Kick integration (`src/server/kick/`) only ever talks to the public API (OAuth 2.1 PKCE, webhooks with RSA signature verification, `POST /public/v1/chat`). Nothing may depend on the unofficial Pusher socket.

## Commands

`npm run dev`, `npm test`, `npm run typecheck`, `npm run assets`, `npm run chat` (REPL: `name: message` sends as that user, `/mod` toggles the moderator badge).

## Editing files

Prefer rewriting a whole small file over regex substitutions; several files in this repo were corrupted by `perl -pi` edits whose patterns contained the delimiter character. When adding a sprite, add it to the catalogue and as `sprites/<name>.sprite`, then run `npm run assets` and look at `dist/worlds/<world>/sheet.png`.
