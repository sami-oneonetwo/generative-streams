// Errands: reasons for the character to leave for another world and come back
// with something. The item must exist in the target world's catalogue; what
// he brings home lives in his bag and eases the body a little.
import type { Catalogue } from '../../shared/catalogue.js';
import type { Need, World } from '../../shared/state.js';

export interface ErrandDef {
  item: string;
  world: World;
  /** Why he is going, said before he leaves. */
  why: string;
  /** Said on arrival. */
  arrive: string;
  /** Said when he has it. */
  found: string;
}

export const ERRANDS: Record<World, ErrandDef[]> = {
  cyberpunk: [
    { item: 'lantern', world: 'desert', why: 'my light died. the desert market sells oil lanterns.', arrive: 'right. the desert. somewhere here there is a lantern with my name on it.', found: 'a lantern. the nights just got shorter.' },
    { item: 'berries', world: 'countryside', why: 'I want to eat something that grew in the ground for once. the countryside, then.', arrive: 'green. actual green. now, berries.', found: 'berries. sour. perfect.' },
    { item: 'torch', world: 'castle', why: 'the tunnels under the city are dark. a castle torch would do.', arrive: 'stone and fog. a torch should be easy to find in a place like this.', found: 'a torch. it does not go out. do not ask me how.' },
    { item: 'mushroom', world: 'countryside', why: 'the ramen needs mushrooms. real ones. from a forest.', arrive: 'a forest. mushrooms hide near the trees, I am told.', found: 'mushrooms. the ramen will forgive me now.' },
  ],
  desert: [
    { item: 'pipes', world: 'cyberpunk', why: 'the well needs a pipe. the city has more pipes than people.', arrive: 'the city. loud as ever. pipes, then home.', found: 'a pipe. the well lives.' },
    { item: 'bread', world: 'castle', why: 'rations are running low. the castle kitchens bake at dawn.', arrive: 'the castle. follow the smell of bread.', found: 'bread. still warm. do not tell the cook.' },
    { item: 'berries', world: 'countryside', why: 'I have not seen a plant in weeks. the countryside has fruit.', arrive: 'grass. rain. something is alive here. berries next.', found: 'berries. the desert would not believe me.' },
  ],
  countryside: [
    { item: 'noodle_cup', world: 'cyberpunk', why: 'I miss bad food. the city has cup noodles on every corner.', arrive: 'neon. I had almost forgotten. noodles.', found: 'cup noodles. terrible. wonderful.' },
    { item: 'pot', world: 'desert', why: 'the cottage needs a proper pot. the desert potters are the best there are.', arrive: 'sand. and somewhere, a potter.', found: 'a clay pot. heavy. worth it.' },
    { item: 'torch', world: 'castle', why: 'the woods are dark at night. the castle has torches to spare.', arrive: 'the castle. mind the guards. find a torch.', found: 'a torch. the woods will not scare me now.' },
  ],
  castle: [
    { item: 'noodle_cup', world: 'cyberpunk', why: 'the kitchens are closed. the city never is.', arrive: 'the city. food first, questions later.', found: 'noodles. royalty could not buy these.' },
    { item: 'rations', world: 'desert', why: 'the larder is empty. the desert caravans carry rations.', arrive: 'the desert. find the caravan trail. find the rations.', found: 'rations. dry as the sand. still food.' },
    { item: 'lantern', world: 'desert', why: 'the east tower needs a light that does not need a torch bearer.', arrive: 'the desert market. lanterns, if the trader is awake.', found: 'a lantern. the east tower will glow tonight.' },
    { item: 'mushroom', world: 'countryside', why: 'the wizard wants mushrooms. I have learned not to ask.', arrive: 'the forest. mushrooms for a wizard. what a life.', found: 'mushrooms. hopefully the right kind.' },
  ],
};

/** What each item does for the body while it is in the bag; multipliers on drain. */
export const PERKS: Record<string, Partial<Record<Need, number>>> = {
  lantern: { comfort: 0.75 },
  torch: { comfort: 0.8 },
  berries: { food: 0.85 },
  mushroom: { food: 0.9, spirit: 0.9 },
  bread: { food: 0.8 },
  rations: { food: 0.85 },
  noodle_cup: { food: 0.9, spirit: 0.95 },
  pipes: { comfort: 0.85 },
  pot: { food: 0.9 },
};

export const BAG_LIMIT = 4;

export function pickErrand(home: World, worlds: World[], catalogueOf: (w: World) => Catalogue | undefined, bag: string[], rnd: () => number): ErrandDef | null {
  const pool = (ERRANDS[home] ?? []).filter((e) => worlds.includes(e.world) && e.world !== home && !bag.includes(e.item) && (catalogueOf(e.world)?.sprites ?? []).some((s) => s.name === e.item && !s.ambientOnly));
  if (!pool.length) return null;
  return pool[Math.floor(rnd() * pool.length)];
}
