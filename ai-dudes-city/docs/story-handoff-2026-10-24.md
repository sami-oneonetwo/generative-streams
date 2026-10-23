# Story + cinematic broadcast — handoff, 2026-10-24

Start here in the next session. This file holds Sami's own words, unedited, then the new idea about a cinematic broadcast with a control panel, then pointers to everything the teams produced.

Related docs:
- `docs/story-2026-10-24.md`: the full story plan from the five-person story team (arc, characters, scenes, mechanics, open decisions).
- `docs/fun-review-2026-10-23.md`: the game-mechanics fun review and sprint plan.
- `docs/review-2026-10-23.md`: the bug/UX review. Its fixes all landed on 2026-10-23.
- `docs/ages.md`: the ages design.
- `scripts/playtest.sim.ts`: the headless pacing sim (fixture agents, no model calls).

---

## 1. Sami's original story pitch (verbatim)

> I'm building a game. It's broadcast on a live stream where the chatters are placed in the world as characters. When they speak or ask to do things in chat they do it in the game world.
> It's a town, with a square in the centre. Each Chatter gets a lot of land that they can build on. The world progresses through the ages. Starting at the stone age in the age with woolie mammoths and such. As chatters complete tasks the world progresses through the ages. Bronze, medieval, modern, futuristic.
> In the town in the mayor. In other ages they're called the king. But they're the town leader. This mayor is played by me. I manually control the mayors character and run around the world as him. I speak through him which he says out in the world. This provides the stream an interactive element that they can interact with. I can guide the actions and control what the stream sees.
> What I'm working on now is a story. A game mechanic that brings it all together.   This is where I'm not fleshed out yet, but work with me here. I start the stream and people start to join. The world is new to them and they're able to build all sorts of building and items and vehicals. They interact with the world and one another. As the chief (chief is the mayors name in the stone age) I go around stimulating conversation with the chatters. I build things with them, and provide some form or narrative friction and fun. If someone builds a house I might go up and say that's nothing and build a more grand house next to them. A little bit silly and even slightly conferentational in a fun way. Then at random a cutscene apears. It shows that there's a river out far east of the map where no one has yet visited. On the other side of that river is a group of travellers. It's a mix of men and woman young and old. The camera zooms in to the leader of the group and it shows him and his daughter (or son, I'm not sure) and the leader says something along the lines of "we've travelled far to be here, heard great things, came for help and refuge". The leader looks like he's had to battle things to get there and may be injured. The camera zooms out and it shows a broken bridge.
> The camera goes back to normal and the chatters now have an action as part of the story to fix the bridge and bring the people over. When they do the travellers gather in the square.
> This is where I'm at and I have some thoughts about where to move forward. I want the daughter (or son) to become a thread across the ages. So chat has things they need to do to progress the world. It might be that the leader gets sick and they need to build a hospital or medical stuff to help. The daughter is very active in the world talking to people and starts to question the chief. Once the chatters have done enough actions the world progresses to the next ages. Here the travellers have aged. Each age progression they age. So the leader is now an older man and he's nursing his injury. He looks poor and sickly. The daughter is becoming more aware of the mayors shortcomings and starts to question his authority (although quietly to chatters without getting the mayor to know too much). But the daughter doesn't trust the mayor. Then maybe a cut scene and the leader (the daughters father) dies from his injury right before the age progresses. The age progresses and the daughter is mourning over a grave, older as a woman now, the cuyscene zooms out from her mourning and shows the world in the new age again.
> This is the storyline and how I want things to progress. I'm the end the daughter over throws the mayor and becomes the leader of the whole town. There is conflict with her and the mayor through the ages that grows and grows into some form of battle or scene that shows an overthrow of the mayor.
> This is it. Give me your thoughts.

Context the pitch doesn't mention: the built ages are Stone → Bronze → Medieval → Industrial → Modern → **Wasteland**. The sixth age was made post-apocalyptic on 2026-10-23; its head is the Overseer. The bridge opening, crossing, age-turn scene and finale already exist.

## 2. Sami's follow-up: the cinematic broadcast and a control panel (verbatim)

> Let's note all of this down because I want to start the discussion in a different session. Note down what I've said originally, but I want you to note down my message about the story. I'd also like to build this as a cinematic world that is broadcast to the audience. The camera should follow the mayor sometimes. Like, maybe the mayor needs to provide some context to everyone and goes over to the bridge to talk to the people across the other side, maybe all chatters move with him and the camera pans to him in front with a crowd of people behind him. I'm imagining a control panel that I use to operate the whole thing. Let's note that down as something to build in. I'll take this up in a new session.

### What this means (notes for building it; nothing is designed or built yet)

**This is Sami's own take on the "director" parked on 2026-09-20.** The camera is operated by him, not ranked automatically by the world. Build what he describes; don't bring back an automatic beat-ranker.

The pieces he described:
- **A cinematic broadcast.** The stream should feel like a film of the world, not a fixed overview.
- **The camera sometimes follows the Mayor.** He can hand the shot to his own character, for example walking him to the bridge to give context.
- **A rally / procession.** When the Mayor goes somewhere to address people (e.g. the travellers across the river), the chatters' dudes gather and move with him. The camera frames the Mayor in front with a crowd behind him.
- **A control panel** that Sami uses to operate the whole show: camera, scenes, story beats, crowd moves, and so on.

Ideas to explore next session (suggestions only, for Sami to shape):

**Camera modes on the panel:**
- **Town:** today's auto-frame.
- **Follow Mayor:** chase cam on his character.
- **Rally shot:** Mayor in front, crowd behind, low angle.
- **Fixed marks:** the bridge, the square, the camp, the grave, the Wonder.
- **Follow a dude:** follow a chatter or pilot.
- **Scene:** the existing cutscenes take over.

Transitions should be smooth pans or cuts, with a "back to town" button.

**Crowd commands:**
- "Rally to me": nearby, or awake, dudes walk to and follow the Mayor and form up behind him.
- "Gather at X".
- "Disperse".

These need no model calls (sim-driven walking). A chatter's own commands should still win, so nobody is trapped.

**Story controls:**
- Trigger, hold or skip scenes and story beats.
- See the next beat and its trigger, plus suggested in-character lines (the "cue card" idea from the story team).
- Story levers from `docs/story-2026-10-24.md`: decree, tax, give, promise ledger, concede, jump to the Rising.

**Speech:** type the Mayor's line from the panel. Optionally a "live line" slot inside scenes, so his words appear as the Chief's subtitle during a cutscene.

**Show controls:** these already exist in /admin today (AI budget, weapons switch, cancel designs, send home, clear bubbles). Fold the show-critical ones into the same panel so there's one screen to run the stream from.

**Phone readability:** shots must still read at phone size. Keep the crowd shot tight and the subtitles large.

**What exists to build on** (verify before relying on it):
- Scenes are data (`src/shared/scenes.ts`, `src/worlds/ai-dudes/scenes.ts`) with camera beats. Examples: `opening`, `crossing`, `ageTurn`, `arrival`, `finale`.
- Sami drives the Mayor through the operator client (`client/dudes/operator.ts`) over `/ws/mayor`, which already accepts camera moves like `{t:'move', cx, cz, half}`.
- The stream camera auto-frames awake chatters in `client/dudes/main.ts` (`autoFrame`).
- /admin (`client/admin/`, `src/server/admin.ts`) has scene triggers and show tools.
- The sim can walk dudes to points (`sim.ts` `walkTo` / `sendDude`) and has party gathering logic.

---

## 3. Where the story stands (summary of `docs/story-2026-10-24.md`)

- **Working title:** *The Girl at the River.*
- **Theme:** who the town belongs to: the builders, or the one who cuts the ribbon.
- **Characters:**
  - **Ama** (the daughter): red is her colour in every age.
  - **Toma** (the father): his wound comes from the Chief's own comic "Great Hunt", which is the hidden secret.
  - **Old Ura, Bo, Tusk:** recurring travellers. Tusk is the Chief's guard whose choice turns the overthrow.
  - **Sami's Chief:** a comic heel, never cruel. He calls her "small one", always builds bigger, tells the Great Hunt, and won't give up his hat.
- **Arc:**
  1. **Stone:** the bridge, and the Chief's Promise ("next age there'll be room").
  2. **Bronze:** the fever and the healer's hut. Toma dies during the Wonder party.
  3. **Medieval:** the grave and the first challenge.
  4. **Industrial:** proof of the Hunt is dredged from the river.
  5. **Modern:** a rigged election, then the collapse.
  6. **Wasteland:** a mirror of the opening, then **the Rising** (a playable climax with Sami as the boss), then the overthrow scene ("Keep the hat. Give me the key." / "…Small one." / "Not any more.").
- **Chat's role:**
  - Sides are built from actions, with a red mark for Ama's side.
  - Ama whispers to chatters, which is visible to everyone, and stops when the Chief walks near.
  - Grievances are logged automatically from Sami's own heel play and read back at the climax.
  - Some visits are forked between the Chief's ask and Ama's.
  - A Ledger of named deeds.
- **Episodes:** four, two of them announced in advance as event streams ("The Last Winter", "The Reckoning"). Each opens with a "Previously…" card and ends on a cliffhanger.
- **Decisions still open for Sami:**
  1. Can the overthrow fail (the exile ending)?
  2. When Toma dies (recommended: the Bronze→Medieval turn).
  3. Camp vs living in town (recommended: Toma at a camp that never restyles, Ama crosses daily).
  4. The secret: the Great Hunt, or the Chief cutting the bridge.
  5. The Chief's fate afterwards.
  6. How the next run ties back.
  7. Whether chat names the daughter.
- **Code gap:** today a new travellers' leader comes each age, and Ama's Medieval line says her father is already gone. Toma and Ama must persist across ages.
- **Smallest test for a stream:**
  - The Stone Age only.
  - Toma bandaged, and the Chief makes the Promise.
  - "Sit with Toma" as an ask.
  - The whisper and cut-off gag.
  - A red pledge mark on tags.
  - A cliffhanger card at the end.

## 4. Suggested first questions for the new session

1. Answer the open story decisions (section 3).
2. Shape the control panel. Is it one screen or tabs? Does it extend /admin, the operator view, or a new page? What are the must-have buttons for the first stream?
3. Decide the first build slice. Likely the camera modes plus a "rally to me" crowd move plus the story test above, so the bridge speech moment can be staged on the next stream.
