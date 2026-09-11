# worldstream

A chat-driven, pixel-art living world for livestreaming on Kick. Viewers add,
remove and move things in the scene, the world drifts on its own (time,
weather, ambient events), a resident character called the Wanderer is the
interface between chat and the world, and the stream travels between worlds
by vote, or because the Wanderer leaves on an errand to fetch something from
another world. Four worlds ship: cyberpunk, desert, countryside and castle.

## Run

```
npm install
npm run dev          # packs assets, rebuilds the renderer on change, runs the server on :4400
npm run chat         # mock chat REPL: "alice: !add cat" speaks as alice
```

- OBS: add a **Browser** source, URL `http://localhost:4400/`, 1920x1080, 60 fps. Add `?hud=1` for a debug overlay.
- Sound: the page synthesises music per world with Web Audio (no files). In the Browser source properties tick **Control audio via OBS** so it lands on a mixer track. `?nomusic` disables it, `m` toggles a local mute in a normal browser tab, and the admin page has on/off and volume, which are saved in the world state.
- Operator page: `http://localhost:4400/admin` (localhost only): live state, recent chat with what happened to each line, levers for weather, time, events, travel, drift pause and clearing.

## Chat

Commands work immediately. `!add <thing> [left|right]`, `!remove [mine|last|thing]`,
`!move <thing> left|right`, `!sign "text"`, `!weather rain|clear|fog|storm`,
`!time night|dusk|dawn|day`, `!world <name>` (opens a vote; moderators travel
at once), `!vote`, `!event <name>` (moderators), `!help`.

Plain chat goes to Claude when `nl.mode` in `config/world.config.json` is
`all` or `mention` (mentions of the character's name). The model can only act
through the same commands and the same policy layer (caps, cooldowns,
ownership, sign text filter). It needs `ANTHROPIC_API_KEY` in `.env`.

## Kick

1. Create an app at kick.com/settings/developer (2FA required). Redirect URL:
   `http://localhost:4400/kick/callback`. Enable webhooks and set the webhook
   URL to your public tunnel plus `/kick/webhook`.
2. Put `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` and `KICK_WEBHOOK_PUBLIC_URL` in `.env`.
3. Expose the server: `cloudflared tunnel --url http://localhost:4400` (or any HTTPS tunnel).
4. Start the server and open `http://localhost:4400/kick/login` while logged into Kick.
   Tokens land in `state/kick-tokens.json`; subscriptions to `chat.message.sent`,
   `channel.reward.redemption.updated` and `livestream.status.updated` are created and
   re-checked on every boot. `/kick/status` shows the connection.

Webhooks are verified against Kick's published RSA key and de-duplicated. A
channel-points reward whose title names a world sends the stream there. Set
`kick.botRepliesEnabled` to echo the character's lines into chat as the bot.

## Music

Each world has a theme in `src/web/music.ts`: tempo, scale, chord progression, drum pattern, instrument waves and an ambience bed. The mix follows the state: rain and storms bring rain noise and rumble, night thins the drums and darkens the pad, a busier street thickens the arpeggio, a collapse drops everything to a heartbeat, the blackout is silent, thriving adds a lead line, and travel crossfades between themes.

## Layout

- `src/shared/` state types + pure reducer, command parser, config schema, catalogue and atlas types
- `src/server/` HTTP + WebSocket server, store, policy, interpreter, brain (Claude), tick (drift), Kick module, admin
- `src/web/` Canvas 2D renderer: 480x270 internal, scaled x4, themed backdrops, bitmap font
- `assets/worlds/<world>/` `catalogue.json` (sprites, aliases, ambient events, lines, weather weights), `palette.txt`, `sprites/*.sprite`
- `assets/character/`, `assets/font.txt` shared across worlds (a world can override either)
- `scripts/pack.ts` validates every pixel against the palette and writes `dist/worlds/<world>/atlas.json` + `sheet.png`
- `config/world.config.json` caps, cooldowns, vote threshold, drift speeds, character, language-model settings
- `state/` persisted per-world state and Kick tokens (gitignored)

## Sprites

A sprite is a text grid over single-character palette keys, one file per sprite:

```
name: cat
anchor: bottom
---
.9.9.....9
.999.....9
9e99....99
.99999999.
--
(next frame)
```

`N* row` repeats a row, short rows are padded, and `npm run assets` refuses any
pixel that is not a palette key. Text-bearing sprites (neon signs, holo
screens, graffiti, wood signs) are drawn in code and size to their text.
