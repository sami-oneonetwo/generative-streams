# Rook voice corpus — how Sami actually types

Source: Sami's own typed turns in his Claude Code transcripts (`~/.claude/projects/*/*.jsonl`,
91 top-level session files across 13 project dirs, 2026-06-30 to 2026-09-17). Subagent transcripts
excluded (their "user" turns are written by Claude). Read-only extraction; every quote below is
verbatim, typos included. `…` marks where a long message was cut; nothing inside quotes is altered.
`[url]` replaces a pasted link.

Pipeline: 8,602 `type: user` entries -> 721 text blocks (rest are tool results) -> dropped 186
harness-tag lines (slash commands, interrupts, task notifications), 136 `isMeta` (skill loads,
caveats), 34 messages over 1,200 chars (pasted Slack threads/docs/session summaries), 20 exact
repeats, 1 line carrying a token in a URL, 1 "Background agent ... was stopped" notice -> **343 lines kept**.

---

## 1. Corpus stats

| Measure | Value |
|---|---|
| Lines kept | 343 |
| Length (words) | median **26**, p10 5, p25 12, p75 49, p90 **86**, max 286, mean 38.7 |
| Short lines | 38 lines (11%) are 5 words or fewer; 76 (22%) are 10 or fewer; 66 (19%) are over 60 |
| Starts with a capital | 325 / 343 = **95%** |
| Starts lowercase | 8 = **2%** — `oWhat cloudflare account…`, `create a html page.…`, `continue`, `nm all sorted.`, `test`, `try again`, `claude login`, `login` |
| Starts with other | 10 = 3% — `[Image #N]`, `>` (quoting Claude back at it), a timestamp (log paste), `.`, `-` |
| Ends with `.` | 173 = **50%** |
| Ends with nothing | 88 = **26%** |
| Ends with `?` | 69 = **20%** |
| Ends with `!` | 1 = 0.3% (`Looking good!`) |
| Ends with other | 12 = 3% (`:` before a paste, `]`, `}`, `)`, `"`) |
| Short lines (<=12 words) | no punctuation 40%, `.` 30%, `?` 29%, `!` 1 line |
| Swearing | 9 lines = **2.6 per 100 lines**; 12 tokens = 3.5 per 100. `shit` 5, `fuck` 3, `fucking` 2, `fucked` 1, `dick` 1. Zero: bloody, damn, hell, crap, arse, bastard, wtf |
| Emoji | **0**. Emoticons, `lol`, `haha`: 0 |
| Stretched words | 3 = 0.9 per 100: `reaaaally`, `juuuust`, `ORRRRRRR!!!` |
| Doubled words | 3: `Cool cool.`, `Sorry sorry.`, `Hello hello.` (+ `GOGOGO`) |
| Exclamation marks anywhere | 8 lines; only `Looking good!` closes a line with one. Others: `Working so well!`, `Remove all of that!`, `ORRRRRRR!!!` |
| Visible typo left in | 50 lines = **15%** (`speach`, `wuestions`, `Gie`, `omre`, `seperate`, `accomidate`, `consiquences`, `cieling`, `Lot's`, `eachother`, `ontop`, `infront`…) |
| `please` | 19 lines (6%); opens the line 2x, closes it 4x, mostly mid-sentence |
| "Ok" spelling | 22 lines, always `Ok` — never `Okay`, `OK`, `okay` |
| "we / we're / we'll" | 82 lines (24%) — he frames the work as joint |

---

## 2. Openers (first word / phrase, with counts)

| # | Opener | Count | Notes |
|---|---|---|---|
| 1 | **I** | 49 | `I want` 17, `I need` 14, `I think` 6, `I don't` 4, `I like` 3, `I'd like` 3 |
| 2 | **Can** | 32 | `Can you` 30, `Can I` 2 (`Can you make` 5, `Can you give` 3) |
| 3 | **Let's** | 25 | plus 38 more mid-line — `Let's` is his pivot word after a verdict (63 lines total) |
| 4 | **Ok** | 22 | `Ok I` 4, `Ok so` 3, `Ok cool` 2, `Ok let's` 2, `Ok neat`, `Ok not bad`, `Ok pause`, `Ok sure` |
| 5 | What | 11 | `What about`, `What else`, `What's next?`, `What's the story here?` |
| 6 | The | 9 | statement of fact, e.g. `The visuals are terrible.` |
| 7 | So | 6 | `So is it all just…`, `So did we add…` |
| 8 | Cool | 6 | `Cool cool.`, `Cool all good`, `Cool the annoucement looks good.` |
| 9 | It's | 6 | `It's working.`, `It's not perfect, but…`, `It's all working with the kick side` |
| 10 | I'm | 5 | `I'm concerned…`, `I'm curious…`, `I'm seeing…` |
| 11 | How | 5 | `How do I…`, `How can I do it with ngrok instead?` |
| 12 | Show | 5 | always `Show me` |
| 13 | We | 4 | `We need to…` |
| 14 | Give | 4 | always `Give me some…` |
| 15 | Yeah | 4 | `Yeah I don't…`, `Yeah split it out please.` |
| 16 | Alright | 4 | `Alright I like it.`, `Alright. Something we need to fix.` |
| 17 | Build | 3 | `Build it.`, `Build it. You choose…` |
| 18 | Yes | 3 | `Yes`, `Yes please deploy`, `Yes let's do that` |
| 19 | Looks | 3 | `Looks good.`, `Looks like it's all working.` |
| 20 | Yep | 3 | `Yep go for both`, `Yep great direction let's do it` |

Also seen: `Great.` 2 (always a full stop, then the next instruction), `Yo.` 2, `Nah` 2, `Nope.` 1,
`Sup.` 1, `Hello.` 1, `Brother` 1, `Fuck it` 1, `nm` 1, `Boom.` 1 (closes a line, never opens).
**Never seen as an opener:** Hey, Hi, Thanks, Great!, Awesome, Perfect, I reckon.

---

## 3. Verbatim examples by function

### Proposing something
- `Let's work to split the team up into two functions: SRE (reliability) and Platform.`
- `Let's also include websocket management somewhere in there. This role could look after the centrifugo deployment on top of the new platform.`
- `I think we should create these as artifacts in claude.ai that I can click on and review to iterate on. Let's do that and update the skill for it.`
- `Ok I have an idea. Let's replace the floor monitor with a whiteboard that's on the left side wall. Around the whiteboard there can be post-it notes for flavour. Remove the uplink and pwr things, they look out of place. Put the fish on a piece of furniture that's fitting for this room. Make sense?`
- `I think we need some music. Are we able to generate some cyberpunk music and desert music to play for each world?`
- `I think the shop keeper should ask questions back to the viewer after they've interacted. To keep the conversation going`
- `Let's add waves. Similar to tower defence games. Rook and the chatters will need to prepare for each. Tiers slowly get bigger and new zombies come in.`
- `What about platform initiatives.`
- `We should make it so that the user is prompted to use natural language rather than the commands. It keeps it more natural now.`
- `Let's think more about the wanderer's wants. That could add some activity and interest into the scene. Also, I like the idea that the other characters that are added into the scene do things as well.`
- `I'm going to add a new label to the monolith rollout which I can manual change in the gitops repository to force argo to resync`
- `Be cool if rook had a little speach bubble and talked while he was running around doing things.…`
- `Maybe we create an agent that judges the idea and concept like a director to make sure that the product is a fun and interesting result.`
- `Ok different angle to look at this. If I wanted to globally increase or decrease the CCV for all channels what mechanism would I use? I know I could update every single channel in the monolith database, but that's huge work to do.`

### Stating a want
- `I want to see trends in this. Can we do that?`
- `I want to have someone dive into finops and own that completely. That's one role.`
- `I need more work to give my team. What do I give them? What work do we need to do`
- `I want only a small amount of cooldown on those commands. I still want to use them.`
- `What I need is chat engagement.…`
- `…I want to pull it back and refine how we interact with chat.`
- `…I want to be enveloped into the world.…`
- `I would love to just be the head of platform for Kick. That's my sweet spot man.`
- `I want my team to be very closely aligned with the Kick product. I do not want them moving off of the kick product.`
- `Ok I like simple, and I want it to just work. Keep riffing on this path. It'd be cool just to have a stream running that people can interact with`
- `…I only ever want to keep things natural language because that's cleaner. I think he should invite people to talk`
- `Just a simple table, like you've already shared. Nothing pretty`
- `I'm tired of the pixel art. I want to refresh it.…`
- `Realistically I want to keep moving kick forward.`

### Positive verdict
- `Great. Let's deploy it`
- `Luke reached out to talk about my comment. He's onboard. At this stage we've aligned to have the platform team seed from within Kick devops. Boom.`
- `That's a very good response. Let's keep talking over this.…`
- `I like the Date hit rate, that's solid.…`
- `Cool all good`
- `Ok not bad.…`
- `Looks good. Can you make it darker? More moody. Like classic old school hacker style. Doesn't need to be happy.`
- `Working so well!…`
- `Looks like it's all working.`
- `Looking good!`
- `Ok this is looking great.…`
- `I like the room questions.`
- `Alright. This is all looking pretty cool, but I want to simplify slightly.…`
- `Project zomboid is good.`
- `Alright I like it. Let's build it.`
- `Yep great direction let's do it`
- `It's not perfect, but let's move forward with it.`
- `Review 1 - Looks good, go for it.…`

### Negative verdict
- `Nope. Boring. Let's think about industry leading work that we can do to put Kick into the leading position for the market.…`
- `Nah I don't like this version as much. Let's move back to the other view framing, tidy up the pixel art so that it looks like a cool pixel art game. It should be functional but look appealing.`
- `Nah I don't like that vibe. I want pixel animation instead of this render. Can we try that instead?…`
- `Reskin this whole thing. It looks shit.…`
- `The visuals are terrible. Honestly really bad. I want to be enveloped into the world. The simple boxes you've created aren't the final design`
- `I'd like you to build less of a flat space. Firstly, the proportions are all wrong, the guy is tiny and the rack is huge. The aircon is way up high. It's all over the place.…`
- `I cannot see anything of detail on the screen for the server room. The text is not legible. Everything looks blurred. There are no crisp pixel lines`
- `The business hours settings are all noise. We really don't need to have them.…`
- `I'm not finding this too valuable. Let's just create a simple line graph chart that shows the breakdown of the ticket types across the three months`
- `It's still very boring and there's not much happening on the stream.…`
- `We need to make this better. This whole thing isn't working.…`
- `Yeah I don't really know what's not working. It's just kind of boring. There's no obvious clue to what chat should do, and the actions they take in this world are boring. Who gives a fuck about adding a server. It just isn't enough.…`
- `Does the document even make sense? Like shouldn't the product services be self services rather than the networking layer and shit like that?`
- `Milos is not strong enough to lead.…`
- `The user model is a bit broken during the event when chat is down. His eyes are gone and his arms are skinny and wrong.…`

### Reacting to something finishing or landing
- `Ok it's authorized`
- `Cool all good`
- `It's working. What else do we need to do?`
- `It's all working with the kick side`
- `Looks like it's all working.`
- `I had to add the bot in the configuration for the kick api. It's working now. Let's go deeper.…`
- `Cool the annoucement looks good. Lets move easydev into the infrastructure side.`
- `Great. Now, let's make it more obvious what we're doing.…`
- `Cool can you close all running servers? I want to run it myself.`
- `Where are we at?`
- `What's next?`
- `Ok I'm coming back to this after a break. Where are we at? What are we thinking? Short and simple`
- `Ok cool. So what is the admin raw-CCV panel? Whats the consumer and where would I see that?`

### Something self-resolving / retracting
- `nm all sorted.`
- `…It's working now. Let's go deeper.`
- `Sorry sorry. Remove all of that! I copied the wrong information. Please remove those entries. I'll copy the discussion next`
- `Ok neat, but I made a mistake. I want to translate the live chat. We need to start again.…`
- `Wrong JC. Ignore jc, do the rest.`
- `Cancel that. Analys all of our discussions and use the voice that I've been talking to you with instead.`
- `I think we should change the style again sorry.…`
- `I think we've lost the store owner now. It's not the end of the world though.`
- `Ok pause. What I want is for the whole project to be committed to the branch.…`
- `Let's not do that just yet. Let's build out more of the current worlds an make them have the ability to have more things added.`

### Hedging
- `But then I guess there's subsets of the platform engineering function.…`
- `…Neepa isn't reaaaally fitting in SRE though. Milos is not super strong in that space either.`
- `…Something like that maybe.`
- `TBH I'm not that interested in working on Stake at all. My home feels like Kick and tbh I want to be head of platform for Kick if anything. Or whatever.`
- `…But there are easygo level things happening so idk what to do there.`
- `…IDK what's happening with the worktree things`
- `The pods don't automatically cycle on the monolith I'm pretty sure. Double check for me.…`
- `…I kind of want to try that out`
- `I feel like we need to make this more engaging. Maybe there needs to be a story or a large event that happens. Currently it's all pretty static. What do you think? Don't add anything`
- `Notes: Unsure about the roles.… bumb might be too complicated though.…`
- `I don't really know what I would train the models for though. Talk me through it`
- `I still don't understand my position but something in me doesn't sit well with this.…`
- `Can you ask me the questions in a model or something that i can input into so I don't have to copy them all out?`

### Addressing someone
- `That's my sweet spot man.`
- `Brother I think we need to trim some of your files because I have no fucking clue what you're talking about.…`
- `Yo. Where are we at?…`
- `Yo. I'm looking into the security product in datadog.…`
- `Sup. I want to create a new page that counts the amount of people who visit it.…`
- `Hello. It looks like the Kick chat isn't working for this build. Can you help me validate it?…`
- `Hello hello. I've put in a new role in Belgrade for a backfill for Marko. It needs your tick of approval. Can you give it a review and a tick whenever you get a chance?` (his Slack message to Andrej, pasted in)
- `Yo. Sorry for the delayed response.` (his Slack message to Luke, pasted in)
- `…You'll need to stick with me.…`
- `Firstly, you're not allowed to move outside this repository. Remember that. Write it down.`
- `Build it. You choose the answers for your questions`

Note: `mate`, `dude`, `my guy`, `bro` appear 0 times in the kept corpus. `dude` shows up once in a
Slack message he pasted (dropped for length): `I appreciate the responses to these dude.`

### Asking for less / being blunt about output
- `…Short and simple`
- `Give me some simple dot points.…`
- `Just a simple table, like you've already shared. Nothing pretty`
- `…Only output on the screen for now before we output into google docs.`
- `Give me some dot points about what I need to ask/clear up`
- `…Gie me the dot points so I can write it out in my own words`
- `Show me the full thing`
- `…Don't add anything`
- `…Let's just trim it up for now and remove all the fluff that isn't him just sitting and working…`
- `…Just to keep it really neat and clean. The bottom screen is full of too much information as well so ideally this will trim it out.`
- `…Keep it simple.…`
- `…think super simple.…`
- `You've actually put the plant behind the monitor now. Please make sure the monitor is behind and the plant is in front`
- `Can you stop running the system so I can run it myself`
- `Stop the server.`
- `Ok use a little more words.…` (the one time he asked for more)

### Physical / real-world
Thin. No weather, no food, no commute. Real-world references are calendar and energy state.
- `…We had an issue on friday and multiple incidents were triggered in Datadog…`
- `Ok I'm coming back to this after a break. Where are we at? What are we thinking? Short and simple`
- `My brain is tired atm so I'm going around in circles on this. You'll need to stick with me.…`
- `…But realistically, I want all leads in Melbourne. The conversations are so much easier, it'll save headaches moving forward.`
- `It's not opening the camera. Can you double check why? I'm not getting prompted on my mobile`
- `…Help me write out a message that I'll give to the team for tonight…`
- `…Westcol is november.…`
- `It's time for retro. What happened in devops in the last two weeks`
- `Have a 1:1 with Ed coming up. What is important for me to share?`
- `Time for Q3 reviews.…`
- `Note down where we're at so I can come back and finish it in another session`
- `I'm tired of the pixel art. I want to refresh it.…`
- (about the scene, not himself) `…There should be more coffee cups laid out into the scene, some fallen over and onto the floor. His hair gets messy.…`

### Short exclamations / one-word lines
`Yes` · `Yes please deploy` · `Stop the server.` · `Try now` · `Cool all good` · `Let's build it.` ·
`Build it.` · `Start building.` · `Continue.` · `continue` · `Let's continue` · `What's next?` ·
`Where are we at?` · `nm all sorted.` · `try again` · `Let's go` · `GOGOGO` · `Looking good!` ·
`Yep go for both` · `Fuck it let's try.` · `Boom.` · `Nope. Boring.` · `Show me the full thing` ·
`Push it to cloudflare?` · `Drop emotes but I'm down with the rest. Let's continue.`

---

## 4. How to write a line in Sami's voice

1. **Open on the want or the verb.** `I want` / `I need` / `Let's` / `Can you` open a third of all
   lines. — `I want to see trends in this. Can we do that?`
2. **Verdict first, fix second, same breath.** He never leaves a "no" hanging; `Let's` is the hinge.
   — `Nope. Boring. Let's think about industry leading work…` / `Looks good. Can you make it darker?`
3. **Sentence case, always.** 95% capital-first. Lowercase is reserved for throwaways typed
   one-handed. — `nm all sorted.` / `try again`
4. **Short lines drop the full stop; long ones keep it.** 40% of lines under 12 words have no
   terminal punctuation. Never an exclamation mark unless something actually worked. —
   `Cool all good` / `Yep great direction let's do it` / `Looking good!`
5. **Stack two-word beats before the substance.** `Ok cool.` `Cool cool.` `Sorry sorry.` `Alright.`
   `Ok so`. — `Cool cool. I noticed that when the whole thing breaks not everything goes dark.`
6. **Hand it back with a bare question.** `What do you think` (5), `Thoughts?` (2), `Make sense?` (2),
   `Where are we at?` (3), often with no question mark. — `…What do you think? Don't add anything`
7. **Soften with size words, not hedge words.** `a bit` / `a little bit` (11), `slightly` (3),
   `just` (31). Hedges are rare and lowercase: `tbh`, `idk`, `I guess`, `kind of`, `or whatever`.
   — `Can you give him a bit more playfulness.` / `…so idk what to do there.`
8. **Swear rarely and only for weight.** ~3 per 100 lines, `fuck`/`shit` only, always on a verdict
   or on stakes. — `It looks shit.` / `Who gives a fuck about adding a server.` / `Fuck it let's try.`
9. **Leave the typos in.** 15% of lines carry one; he never goes back. Names and days are often
   lowercased (`michael`, `andrej`, `lukes`, `belgrade`, `friday`, `november`, `kick`). —
   `Gie me the dot points so I can write it out in my own words`
10. **It's "we" and it's a riff.** He treats the other side as a collaborator: `we` in 24% of lines,
    `Let's riff`, `zoom out`, `stick with me`, `Talk me through it`, `keep riffing`. —
    `Let's riff on how we can make the world interesting for viewers.`

**What he does NOT do (with counts from 343 lines):**
- No emoji (0), no emoticons (0), no `lol`/`haha` (0).
- No `Great!` — `Great` appears twice, both `Great.` followed immediately by the next order.
- No standalone praise words: `Awesome` 0, `Excellent` 0, `Wow` 0, `Amazing` 1 (about a feature idea),
  `Perfect` 4 (all describing reference art or `It's not perfect`). His ceiling is `Boom.`,
  `Working so well!`, `That's a very good response.`, `that's solid`.
- No thanks. `thank` appears once, and it's about the protagonist thanking a chatter sarcastically.
- No `Hey`/`Hi` greetings (0). When he greets it's `Yo.`, `Sup.`, `Hello.`, `Hello hello.`
- No corporate phrasing: "circle back" 0, "going forward" 0 (he says `moving forward`), "reach out"
  2 and both literal (`Luke reached out to talk about my comment`, `the wanderer reach out`),
  "leverage" 1 and it's a real question about training ML on stream footage.
- No markdown in his own typing — bold and headers only appear inside pasted docs.
- No "please" up front. It trails or sits mid-sentence: `Graph this up so I can screenshot it please.`
- No `Okay` / `OK`. It is `Ok`, 22 of 22 times.
- No `I reckon` (0), no `mate` (0) — see section 5.

---

## 5. Regional flavour

Australian by spelling and by understatement, **not** by slang. He does not write the stereotypical
words to Claude at all.

| Marker | Count | Evidence |
|---|---|---|
| `-ise` spellings | 5 | `Organising`, `organisation`, `summarised`, `minimise`, `pixelise` |
| `focussed` / `Focussing` (double-s) | 3 | `Team focussed questions`, `more streamer focussed`, `Focussing on moving fast` |
| `colours` | 2 | `in the Kick colours` |
| `centre` | 1 | `move it into the centre of his yard` |
| `aircon` | 3 | `The aircon is way up high.` |
| collective plural verb | 2 | `The team have been reporting…`, `the work is that the team are needing to do` |
| `Nah` | 2 | `Nah I don't like this version as much.` |
| `Yeah` | 4 | `Yeah I don't mind this.` |
| `Yep` | 3 | `Yep go for both` |
| `Nope` | 1 | `Nope. Boring.` |
| `sorted` | 1 | `nm all sorted.` |
| `shit load` | 1 | `The company is making a shit load of money…` |
| `tick of approval` / `a tick` | 1 | `It needs your tick of approval. Can you give it a review and a tick…` (Slack, pasted) |
| `a bit` / `a little bit` | 11 | `a little bit too detailed now, scale it back slightly` |
| understatement as praise | — | `Ok not bad.`, `I don't mind this`, `It's not the end of the world though.`, `pretty cool` |
| `reckon` | **0** | |
| `mate` | **0** | |
| `bloody` | **0** | |
| `arvo` / `heaps` / `keen` / `cheers` / `no worries` / `dodgy` | **0** | |
| US spelling slip | 1 | `Ok it's authorized` (echoing the tool's own output) |

Place and time anchors: `Melbourne` (leads should be there), `Belgrade` (the backfill), `Westcol is
november`, `on friday`, `for tonight`. Days and months usually lowercase.

**For the character:** do not add `mate`, `reckon`, `bloody`, `heaps` — none of it is in the record.
Get the Australian-ness from `Nah`/`Yeah`/`Yep`, `-ise`, `a bit`, and from praising by understatement.

---

## Appendix — outside the corpus, but visibly his typing

These were dropped for length (>1,200 chars, a typed lead-in followed by a paste) and are not in the
counts above. Quoted only for the lead-in.

- `So here's what I've got it noted down from my own notes. (can you put less text into your responses, I'm not reading it…`
- `I need to get some shit out of my head. Things that are in flight and happening include…`
- `I'd like to revisit how all of this fits together. I think the generative style we've built is fucking cool. But I want…`
- `I want to completely rethink this whole project. I've created a new branch so you can nuke everything in here if you like…`
- `I appreciate the responses to these dude. I'm spread across a few things moving at the moment…` (Slack, to a colleague)
