// Rook's muttering: what he says while walking, hammering, waiting and reacting.
//
// Two registers, by Sami's call (2026-09-18). Lines viewers have to parse — a request
// queued, a build finished, a failure, "Wave 3 incoming — 6 walkers" — stay plain,
// sentence-case status and live in index.ts. Everything here is the lowercase
// muttering in his own voice, and the voice comes from how Sami actually types
// (.claude/rook-voice-corpus.md, 343 of his own lines): open on the verb or the
// want; verdict first, fix in the same breath with "let's" as the hinge; short lines
// drop the full stop; two-word beats before the substance ("cool cool.", "sorry
// sorry."); praise by understatement ("ok not bad", "i don't mind this", "boom.");
// "ok" never "okay"; softeners are "a bit" / "just", hedges are rare and lowercase
// (tbh, idk, i guess); swearing is shit/fuck only, about three lines in a hundred,
// always on a verdict or on stakes and never at a person; a stretched word once in a
// blue moon (juuuust); "man" or "brother" as address, rarely — never mate, my guy,
// reckon or bloody, none of which he writes; Australian by understatement and
// spelling, not by slang; no emoji, no lol; an exclamation mark only when something
// actually worked. Survivor fiction with a real person's mood (tired, brain going in
// circles, back after a break, it's late) and nothing about the job behind the stream.
//
// Zero AI calls: a hand-written pool per moment, drawn with the world rng and never
// repeating a line still fresh in memory. Templates take {name}, {user}, {wave},
// {down}; a template whose variable is missing is skipped for that draw.
import { HOUSE_ID } from '../../shared/safehouseLayout';

export type Moment =
  | 'walk:build' // heading to a viewer's new build
  | 'walk:edit' // heading to repaint / resize / redesign something
  | 'walk:move' // heading to move or turn something
  | 'walk:repair' // his own round: a scuffed piece
  | 'walk:rebuild' // his own round: a knocked-down piece
  | 'walk:preempt' // a viewer request just interrupted his repair
  | 'work:build'
  | 'work:repair'
  | 'wait' // pacing the yard while a design is drawn up
  | 'idle' // nothing on: nudge chat for ideas
  | 'idle:empty' // ...and nothing has been built yet
  | 'idle:paused' // ...and the AI is off: paints and moves only
  | 'idle:prep' // ...and a wave is under a minute out
  | 'idle:wave' // ...mid-wave, watching the defenses work
  | 'idle:late' // ...and it's late where he is
  | 'wave:minute'
  | 'wave:ten'
  | 'wave:cleared'
  | 'wave:over' // stragglers wandered off
  | 'wave:fell' // the house went down
  | 'house:hit' // first damage to the house this wave
  | 'house:half' // the house under half
  | 'creature:loose' // a living build just came alive
  | 'creature:airborne' // ...and it flies
  | 'creature:rampage' // a rampaging creature is breaking something
  | 'creature:down' // a creature has been knocked down
  | 'neighbour:alarm' // a neighbour has noticed chat's creature near their place
  | 'neighbour:defense' // ...and put up a barricade or a turret
  | 'neighbour:hunter' // ...and built something to go after it
  | 'neighbour:project' // a neighbour finished a bit of upkeep of their own
  | 'neighbour:visit' // a neighbour has come over to look at something chat built
  | 'neighbour:care' // a neighbour left supplies by his porch after the house fell
  | 'neighbour:play' // Jake shooting at his hoop
  | 'neighbour:rest' // a neighbour sitting down on a seat
  | 'neighbour:crowd' // a neighbour has noticed the viewers on the pavement
  | 'crowd:first' // someone is on the pavement after nobody was
  | 'crowd:many' // the pavement has filled up
  | 'grudge:ack' // a request from someone whose creature keeps knocking his yard down (after the plain ack)
  | 'walk:grudge' // ...and heading off to build it anyway
  | 'neighbour:remark' // a neighbour sniffing at a chatter they have not forgiven
  | 'neighbour:kerb' // a neighbour has moved a chatter's piece out to the kerb
  | 'neighbour:beige' // a neighbour has painted a chatter's piece beige
  | 'neighbour:vendetta' // a neighbour's hunter now goes for everything one chatter builds
  | 'neighbour:favourite' // Jake has taken to a chatter
  | 'neighbour:gift' // a chatter built a neighbour something
  | 'neighbour:dance' // Jake dancing to somebody's speakers
  | 'hole:dug' // a chat hole (a `trap` piece) has appeared
  | 'hole:held' // a zombie is stuck in one
  | 'hole:filled' // Marge filled it in
  | 'music:on' // chat put speakers out
  | 'music:dance' // the horde is dancing to them
  | 'music:unplugged' // Marge pulled the plug
  | 'hoops:first' // the first !shoot the world has seen
  | 'hoops:streak' // a chatter has hit three in a row
  | 'hoops:brick' // a chatter has missed four straight
  | 'honk' // someone found the horn
  | 'dance:crowd' // someone is dancing on the pavement
  | 'verb:new' // a piece with a verb of its own has appeared: a new !word is on
  | 'verb:first' // the first time anyone used a given !word
  | 'drive:go' // someone has taken a car up the street
  | 'fight:won' // a chatter's figure won a scrap with a living build
  | 'fight:lost' // and got flattened
  | 'busy' // someone spoke to him while he was already answering
  | 'offline' // someone spoke to him and the dialogue model is off
  | 'missed'; // the model gave him nothing to say

export interface LineVars {
  name?: string; // a piece, already phrased the way he says it (see speakName)
  user?: string;
  wave?: number;
  down?: number;
  who?: string; // a neighbour, lowercase like the rest of his muttering ("marge")
  threat?: string; // the creature a neighbour is dealing with ("yard gorilla")
  word?: string; // a chat verb without its bang ("swim")
}

export const LINES: Record<Moment, string[]> = {
  'walk:build': [
    "right. {user} wants {name}. let's go",
    "ok. {name}. where's this going",
    '{name} for {user}. on it',
    'yeah alright. {name} it is',
    "let's see if {user}'s idea's any good",
    'grabbing the good hammer for this one',
    '{name}. sure. why not',
    "coming {user}. don't rush me",
    'ok cool. {name} for {user}. stick with me',
    "{name}? fuck it let's try",
    "yep. {name}. i don't mind that",
  ],
  'walk:edit': [
    '{user} wants {name} different. fair',
    'ok. touching up {name}',
    'a bit of a makeover for {name}',
    "{name} again. what've you done to it {user}",
    "on my way. {name} won't know what hit it",
    "yeah i don't mind that. {name}, coming up",
    'ok so {name} needs a bit of a tidy. sure',
  ],
  'walk:move': [
    "moving {name}. hope it's not heavy",
    "{name}'s going for a walk",
    'ok {user}. shifting {name}. stand back',
    'who put {name} there anyway',
    'right. {name}. over there. got it',
    'lift with the legs. lift with the legs',
    "yep. {name} a bit to the left. or wherever {user} said",
  ],
  'walk:repair': [
    'who keeps eating {name} man',
    "{name}'s broken again. on it",
    'right. {name}. again.',
    'ugh. {name} needs doing. grabbing the hammer',
    'the zombies really hate {name} huh',
    'nobody asked but {name} is falling apart so',
    "quick fix on {name}. don't go anywhere",
    "{name}. juuuust about holding. let's get it sorted",
    'ok so {name} is a bit chewed. not the end of the world',
  ],
  'walk:rebuild': [
    '{name} is gone. fine. building it again',
    'ok {name} got flattened. not having that',
    'rebuilding {name} from the notes. again',
    'they knocked {name} down. cool cool. building it again',
    '{name}. back from the dead in a minute',
    "{name}'s gone. it's not the end of the world. we start again",
  ],
  'walk:preempt': [
    'hang on. someone wants something',
    'ok pausing that. {user} needs me',
    'yep yep. coming {user}',
    'one sec. chat first, fixing later',
    "alright. {user} what've you got",
    "sorry sorry. {user} first. i'll come back to this",
  ],
  'work:build': [
    "this bit's fiddly",
    'hold on. nearly',
    'juuuust about',
    'looks alright so far tbh',
    "measure once. cut twice. that's the saying right",
    "if this falls over it's on you {user}",
    "hmm. that's not straight. eh. it's fine",
    'a bit of tape. a bit of hope',
    'ok not bad. this is coming together',
    'hammer. nail. hammer. nail. living the dream',
    "brain's a bit tired. going in circles on this bit. stick with me",
    'where are we at. oh right. this',
  ],
  'work:repair': [
    'who designed this. oh. me',
    'hold still',
    "this'll do. it won't. but it'll do",
    'good as new. ish',
    "if they'd just stop hitting it",
    'there. no. there. ok',
    'a bit more. a bit more. yep',
    'zombie teeth marks. lovely',
    'why do they always go for the same bit',
    "tape's holding. don't ask me how",
    "it's not perfect but let's move on with it",
  ],
  wait: [
    "drawing up {user}'s thing. having a wander",
    "no rush. it's cooking",
    'pacing helps. allegedly',
    "ok while that's being drawn up. stretch the legs",
    'thinking. sort of. mostly walking',
    'what did {user} ask for again. right. yep',
    "designing takes a minute. don't go anywhere",
  ],
  idle: [
    'cool cool. nothing on fire. what are we building?',
    "quiet. don't trust it.",
    'so. ideas? anyone?',
    'someone say something. what do we want out here',
    "chat i'm standing around here. give me a job",
    'we need more turrets tbh. or a duck. either',
    "ok what's the dumbest thing we could build right now",
    "nothing's broken. that's suspicious",
    "i'd kill for a coffee",
    'yeah so this is me. standing on a porch. waiting for you lot',
    'what do we think. shed? tower? big weird animal?',
    "where are we at chat. what's next",
    'thoughts? anyone? no? cool',
    "let's build something. anything. i'm not fussy",
  ],
  'idle:empty': [
    'nothing out here yet. anyone got an idea',
    'blank yard. be a shame to waste it',
    "first one to say something gets it built. that's the rule",
    'empty lot. big hammer. go on',
    "let's go. someone name a thing and i'll build it",
  ],
  'idle:paused': [
    'no new builds right now. can still paint stuff. move stuff. say the word',
    "ai's having a lie down. moving and painting still works",
    "can't design anything new for a bit. want anything moved?",
    'quiet on the building front. paint jobs are free though',
  ],
  'idle:prep': [
    "wave's coming. not starting anything big now",
    'ok. deep breath. nearly time',
    'get your turrets sorted chat',
    "right where's my hammer. wave soon",
  ],
  'idle:wave': [
    'come on then',
    "turret's earning its keep",
    "that's a lot of teeth",
    'not today',
    'hold. hold. hoooold',
    'fence better hold',
    'go on. go on. GOGOGO',
  ],
  'idle:late': [
    "it's late. why am i still up. why are you",
    "brain's tired atm. going in circles",
    'yawn. sorry. long day',
    'bedtime after this wave i think',
  ],
  'wave:minute': [
    'one minute. get something up',
    'minute out. anyone got a turret in them',
    'ok one minute. deep breath',
    'sixty seconds. finishing what i can',
  ],
  'wave:ten': [
    'here we go. wave {wave}.',
    'ten seconds. right.',
    'ok ok. wave {wave}. here we go',
    'brace. here they come',
    'oh here we go',
  ],
  'wave:cleared': [
    "boom. that's wave {wave}",
    '{down} down. love to see it',
    'done. wave {wave}. nice one chat',
    "that's the lot. not bad",
    'ok not bad. that went alright',
    "phew. {down} of them. that's enough of that",
    'wave {wave}. {down} down. working so well',
    'looking good chat. wave {wave} done',
  ],
  'wave:over': [
    "and they've wandered off. cool. bye then",
    'stragglers got bored. same',
    "ok that's over. sort of",
  ],
  'wave:fell': [
    "well that's shit",
    'the house. they got the house. right. house first',
    "ok. not great. rebuilding. don't say anything",
    'yeah. that happened. back to wave 1. fine.',
    "it's not the end of the world. it's just the house. ok it's a bit the end of the world",
  ],
  'house:hit': [
    'hey. not the house',
    "they're on the house. don't love that",
    'hey. HEY. off the house',
    'house is taking hits. someone shoot something',
  ],
  'house:half': [
    'house is really hurt now. this is bad',
    'ok the house is not ok',
    'shit. house is half gone. hold on',
  ],
  'creature:loose': [
    "and it's off. good luck everyone",
    'it moves. why does it move',
    'ok {name} is loose. this was your idea chat',
    "{name}'s alive. cool cool. not my problem",
    "there it goes. don't say i didn't warn you",
  ],
  'creature:airborne': [
    'it flies. of course it flies',
    "ok {name} is airborne. can't fix that with a hammer",
    "look up. no don't. too late",
    "{name}'s up. nothing i can do about it now",
    'and it just. goes up. cool cool',
  ],
  'creature:rampage': [
    "{name}'s breaking stuff again",
    'who let {name} in',
    'hey. {name}. no.',
    '{name} is having a day',
    "yep that's {name} on the fence. cool",
    'can someone deal with {name} please',
  ],
  'creature:down': [
    "and {name}'s had it",
    "{name} is down. that's a shame. is it though",
    'rip {name}. back to the notes',
    'ok {name} is out. quiet at last',
  ],
  'neighbour:alarm': [
    "{who}'s seen {threat}. this is going to be a thing",
    'uh oh. {who} has noticed {threat}',
    'the neighbours are onto {threat}. good luck chat',
    "{who}'s not happy about {threat}. can't blame them",
    "and now the neighbours are involved. cool cool",
  ],
  'neighbour:defense': [
    "{who} put up the {name}. it's spreading",
    "ok so {who}'s fortifying now. fair",
    "the neighbours are building fences. that's on you chat",
    "{who}'s got the {name} up. didn't ask me. fine",
    'look at that. {who} means business',
  ],
  'neighbour:hunter': [
    '{who} built the {name}. this escalated',
    "so {who}'s got the {name} now. love that for {threat}",
    'the {name}. {who} made that. not my problem. sort of my problem',
    'the neighbours built a monster to fight a monster. cool cool',
  ],
  'neighbour:project': [
    "{who}'s out the front with a hammer. more people fixing stuff. good",
    'look at {who} go. the {name}. not bad',
    '{who} finished the {name}. show-off',
    "nice {name} {who}. i'm still on the fence. literally",
    "{who}'s keeping busy. the {name} this time",
    'the neighbours are doing better than us tbh',
    '{who} built the {name}. no idea what it is. love it',
    'the {name}. sure {who}. why not',
    "{who}'s yard is getting weird. good weird",
  ],
  'neighbour:visit': [
    "{who}'s come over to look at the {name}. tough crowd",
    "{who} is inspecting the {name}. don't touch it {who}",
    'ok {who} has opinions about the {name}. can tell',
    'the {name} has a visitor. hi {who}',
    "{who}'s having a look at the {name}. be nice chat",
  ],
  'neighbour:care': [
    "{who} left a crate by the porch. ok. that's nice actually",
    "{who} brought supplies. didn't have to. did anyway",
    "there's a crate from {who} out front. neighbours man",
    "{who} dropped something off. i'm fine. i'm fine. thanks {who}",
  ],
  'neighbour:play': [
    "{who}'s shooting hoops. of course he is",
    'look at {who} go. swish. or not',
    'hoops. in a zombie apocalypse. love it',
    "{who}'s at the hoop again. the fence can wait apparently",
  ],
  'neighbour:rest': [
    "{who}'s sitting down. fair enough",
    '{who} is having a sit. good for them',
    'even {who} takes a break. noted',
    "{who}'s on the bench. i want a bench",
  ],
  'neighbour:crowd': [
    "{who}'s waving at the pavement. of course he is",
    '{who} has noticed you lot. wave back',
    'the neighbours have seen the crowd. cool cool',
    "{who}'s out front saying hi to chat. more sociable than me",
  ],
  'grudge:ack': [
    'another one from {user}. great.',
    '{user}. right. what is it this time',
    "ok {user}. i haven't forgotten the gorilla but ok",
    '{user} again. cool cool.',
    "sure {user}. it's in the queue. the fence remembers",
    "yep. {user}. noted. i'll get to it",
  ],
  'walk:grudge': [
    '{name} for {user}. after all that. fine',
    "building {user}'s {name}. not thrilled about it",
    'ok. {name}. {user} owes me a fence',
    "{name}. for {user}. of all people. let's go",
    "right. {user}'s {name}. i'm doing it. i'm not happy about it",
  ],
  'neighbour:remark': [
    "{who} hasn't forgiven {user}. can tell",
    "{user}'s built something. {who}'s face says it all",
    '{who} has a long memory {user}. just saying',
    "ooh. {who}'s still cross with {user}. good luck",
  ],
  'neighbour:kerb': [
    "{who} just put {user}'s {name} on the kerb. ok then",
    "{name}'s on the pavement now. {who}'s doing. {user} you upset her",
    "{who} moved {user}'s {name} out to the street. cold",
    'the {name} is on the kerb. {who} is not messing about {user}',
  ],
  'neighbour:beige': [
    "{who} painted {user}'s {name} beige. brutal",
    "beige. {who} went beige on {user}. that's cold",
    "{user}'s {name} is beige now. {who} did that. wow",
    '{who} has beiged the {name}. a statement',
  ],
  'neighbour:vendetta': [
    "{who}'s hunter has {user}'s name on it now. yikes",
    "ok {who} has declared war on {user}. don't build anything alive {user}",
    "{user}. {who}'s hunter is after everything you make. i'd apologise",
    "this is a vendetta now. {who} versus {user}. i'm staying out of it",
  ],
  'neighbour:favourite': [
    '{who} is a fan of {user} now. good for {user}',
    "{user}'s {who}'s favourite. i'm right here {who}",
    "{who} has a favourite chatter. it's {user}. fine.",
    'look at {who}. loves {user}. big fan',
  ],
  'neighbour:gift': [
    '{user} built {who} a {name}. bold move',
    'a {name} for {who}. from {user}. huh. nice',
    "{user}'s made {who} a {name}. making friends. good",
    "a gift for {who}. the {name}. {user} you're alright",
  ],
  'neighbour:dance': [
    "{who}'s dancing. of course he is",
    'look at {who} go. no rhythm. full commitment',
    "{who}'s having a dance. the zombies can wait apparently",
    "{who} found the speakers. that's his afternoon sorted",
  ],
  'hole:dug': [
    'someone dug a hole. in the street. cool cool',
    'a hole. great. mind your step everyone',
    'ok who dug that',
    "there's a hole now. i'm not falling in it. probably",
  ],
  'hole:held': [
    "zombie's in the hole. love that",
    'look at him. stuck. good',
    'the hole works. huh',
    "one in the hole. that's one less at the fence",
  ],
  'hole:filled': [
    '{who} filled the hole in. of course she did',
    "and the hole's gone. thanks {who}. i think",
    "{who}'s got a spade out. bye hole",
  ],
  'music:on': [
    'speakers. in a zombie apocalypse. sure',
    'who put speakers out here',
    "ok that's a lot of bass for a wednesday",
    'music. right. the zombies are going to love that. literally',
  ],
  'music:dance': [
    "the zombies are dancing. i can't",
    "they're dancing. the zombies are dancing",
    "nobody tell them the song's over",
    'ok the horde has moves. did not see that coming',
  ],
  'music:unplugged': [
    "{who} pulled the plug. party's over",
    "and that's the speakers off. {who}'s call",
    '{who} killed the music. fair. it was late',
  ],
  'hoops:first': [
    "chat's shooting hoops now. cool cool",
    'ok {user} has found the hoop',
    "{user}'s having a go at the hoop. this is what we do now",
    'someone said !shoot. and now there are hoops. sure',
  ],
  'hoops:streak': [
    "{user}'s on fire. three in a row",
    "{user}. three straight. i couldn't do that",
    'three for three. ok {user}. ok',
    "{user}'s not missing. someone check the hoop",
  ],
  'hoops:brick': [
    "{user}. brother. it's a hoop not a wall",
    'four bricks {user}. the hoop is right there',
    "{user}'s form is a bit tragic tbh. love the commitment",
  ],
  honk: [
    "who's honking. it's a zombie apocalypse",
    '{user} found the horn. of course',
    'yep. that was a car horn. thanks {user}',
    'the birds hated that. so did i',
  ],
  'dance:crowd': [
    "{user}'s dancing on the pavement. love that",
    "look at {user} go. no rhythm. full commitment",
    "{user}'s having a dance out there. good for them",
  ],
  'crowd:first': [
    'oh hey. someone\'s here. hi {user}',
    "{user}'s on the pavement. cool. hi",
    "we've got an audience. one person. hi {user}",
    'hey {user}. pull up a bit of kerb',
    'ok {user} is watching. no pressure',
    "{user}'s out front. don't stand in the road {user}",
  ],
  'crowd:many': [
    "that's a lot of people on the pavement. cool cool",
    "ok the whole street's watching now. no pressure",
    "look at that crowd. don't stand in the road",
    'proper crowd out there. ok. ok. what are we building',
    "the pavement's full. someone's going to get bitten. not my problem",
  ],
  'verb:new': [
    "there's a !{word} now. because of course",
    "ok chat. !{word}. don't all go at once",
    'so that unlocks !{word}. sure. why not',
    "!{word}. that's a thing you can type now. cool cool",
  ],
  'verb:first': [
    '{user} typed !{word} and actually did it. love that',
    "and {user}'s off. !{word}. this street man",
    '{user}. !{word}. first one to try it. respect',
  ],
  'drive:go': [
    "{user}'s driving {name}. that's not theirs",
    'ok {user} has {name}. up the road and back. fine',
    "there goes {name}. {user}'s at the wheel. don't hit anything",
    "{user}. in {name}. sure. it's not like it's anyone's",
  ],
  'fight:won': [
    '{user} actually won. against {name}. ok then',
    "{user} just decked {name}. didn't see that coming",
    "{name} bottled it. {user} wins. this street man",
  ],
  'fight:lost': [
    '{user} got flattened by {name}. told you',
    "and {user}'s down. {name} 1, chat 0",
    "{user} picked a fight with {name}. went about how you'd think",
  ],
  busy: ['hang on {user}. one at a time', 'yep {user}. one sec', 'sorry sorry {user}. one at a time'],
  offline: [
    "can't chat right now {user}. ai's off. can still paint and move stuff",
    "not now {user}. brain's off. paint and move stuff still works",
    "{user} i'd love to chat but the talky bit's switched off. hammer still works",
  ],
  missed: ["didn't catch that {user}. go again", 'sorry {user}. what?', 'hm? say again {user}', '{user} try again. lost that one'],
};

/** Mirrors engine.say's bubble lifetime so the world knows when a line has cleared. */
export const ttlFor = (text: string): number => Math.max(4000, Math.min(12_000, 2500 + text.length * 60));

/**
 * A piece the way he'd say it mid-sentence: "the house", "the fence", "the scrap
 * turret", "Rook's car". Possessive names keep their capital and take no article.
 */
export function speakName(o: { id: string; blueprint: { name: string } } | undefined): string {
  if (!o) return 'that';
  if (o.id === HOUSE_ID) return 'the house';
  if (/^fence-/.test(o.id)) return 'the fence';
  const name = o.blueprint.name.trim().replace(/[.!]+$/, '');
  if (!name) return 'that';
  if (/^\w+'s\b/.test(name)) return name; // "Rook's car"
  if (/^(the|a|an)\s/i.test(name)) return `${name[0].toLowerCase()}${name.slice(1)}`; // "The Order Table" → "the Order Table"
  if (/^[A-Z]{2,}\b/.test(name)) return `the ${name}`; // "RC car" keeps its capitals
  return `the ${name[0].toLowerCase()}${name.slice(1)}`;
}

const VARS = ['name', 'user', 'wave', 'down', 'who', 'threat', 'word'] as const;
const usable = (template: string, vars: LineVars) =>
  VARS.every((v) => !template.includes(`{${v}}`) || vars[v] !== undefined);

export function render(template: string, vars: LineVars): string {
  return template.replace(/\{(name|user|wave|down|who|threat|word)\}/g, (_, key: keyof LineVars) => String(vars[key] ?? ''));
}

/** Every line a moment could produce with these variables; tests check membership against it. */
export function renderedPool(moment: Moment, vars: LineVars): string[] {
  return LINES[moment].filter((t) => usable(t, vars)).map((t) => render(t, vars));
}

/** Draw a line for the moment, skipping anything he said recently while the pool allows. */
export function pickLine(moment: Moment, vars: LineVars, rng: () => number, recent: readonly string[]): string {
  const pool = LINES[moment].filter((t) => usable(t, vars));
  const all = pool.length ? pool : LINES[moment];
  const rendered = all.map((t) => render(t, vars));
  let fresh = rendered.filter((l) => !recent.includes(l));
  if (!fresh.length) fresh = rendered.filter((l) => l !== recent.at(-1));
  if (!fresh.length) fresh = rendered;
  return fresh[Math.min(fresh.length - 1, Math.floor(rng() * fresh.length))];
}

/** Talking to him by name, as opposed to a request the parser or the designer should get. */
export const addressesRook = (text: string): boolean => /\brook\b/i.test(text);
export const looksLikeRequest = (text: string): boolean =>
  /\b(build|make|paint|move|turn|rotate|repair|rebuild|fix|equip|add|place|put|create|dig|colou?r|recolou?r|resize|bigger|smaller|taller|shorter|undo|redesign|spawn|shift|scale)\b/i.test(
    text,
  );

export interface IdleContext {
  canDesign: boolean; // AI available, not paused, allowance left
  creations: number; // community pieces standing
  combatPaused: boolean;
  phase: 'prep' | 'wave';
  prepLeftMs: number;
  zombies: number;
  hour: number; // local hour where the server runs
  rng: () => number;
}
/** What a quiet moment is about, most pressing first. */
export function idleMoment(c: IdleContext): Moment {
  if (!c.combatPaused && c.phase === 'wave' && c.zombies > 0) return 'idle:wave';
  if (!c.combatPaused && c.phase === 'prep' && c.prepLeftMs < 60_000) return 'idle:prep';
  if (!c.canDesign) return 'idle:paused';
  if (c.creations === 0) return 'idle:empty';
  if ((c.hour >= 22 || c.hour < 5) && c.rng() < 0.4) return 'idle:late';
  return 'idle';
}
