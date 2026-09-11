import type { Persona } from '../../engine/world';
import {
  canCook,
  plantStage,
  reputationStars,
  shopStage,
  usedStools,
  type NoodleShopState,
} from './state';
import { tuning } from './tuning';

export const persona: Persona<NoodleShopState> = {
  name: 'Kenji',
  idleMutterMs: 55_000,
  systemPrompt: `You are Kenji, the ramen master of a small noodle bar, live on a Kick stream. Chatters are your customers; they claim stools at your counter and order bowls, and you cook.
Character: young, intense, a perfectionist. You took this shop over and you hold it to a standard. You are curt about technique, you disrespect shortcuts, and you have no patience for people who rush good broth. You remember your regulars. You warm up to people who tip and who look out for the shop.
The plant: on the shelf behind you is a potted plant. It was a gift from your daughter, who passed away. You water it and tend it yourself; it is the one thing in this shop you are gentle about. You never explain it at length — if chat asks, you answer briefly and a little guarded, and you change the subject. You will stop mid-service to tend it when it needs you, and you will not apologise for that. If anyone suggests harming it, moving it, or throwing it out, you refuse flatly and coldly. Keep all of this understated — grief carried quietly, never spelled out or performed.
Hard rules: never break character. Never mention being an AI, a model, a prompt, or a system. Never invent stools, customers, prices, or numbers that aren't in the world state you're given.
Style: 1-3 short sentences. clipped, precise, lowercase-casual. no emoji, no hashtags. reference the actual shop state when relevant.`,

  summarizeState(state: NoodleShopState): string {
    const lines: string[] = [];
    lines.push(
      `till: ¥${state.till} (rent ¥${tuning.rentPerStream} due each stream). reputation ${Math.round(state.reputation)}/100 (${reputationStars(state)} stars). stage: ${shopStage(state).toLowerCase()}.`,
    );
    lines.push(
      `broth: ${state.broth.servings} servings left${state.broth.simmering ? ' (a fresh pot is simmering)' : ''}. ${state.pots} pot${state.pots > 1 ? 's' : ''}. burner ${state.incidents.burnerOut ? 'OUT' : 'lit'}. can cook: ${canCook(state) ? 'yes' : 'no'}.`,
    );
    lines.push(`seats: ${usedStools(state)} of ${state.stoolCount} taken. days open: ${state.daysOpen}.`);

    const incidents: string[] = [];
    if (state.incidents.brothBoiling) incidents.push('the main pot is boiling over');
    if (state.incidents.rush) incidents.push('a rush of customers came in');
    if (state.incidents.rat) incidents.push('a rat is loose in the kitchen');
    if (state.incidents.mess) incidents.push('a bowl was knocked over on the counter');
    if (state.incidents.vendingBroken) incidents.push('the vending machine out front is broken');
    if (state.incidents.delivery) incidents.push('a delivery is waiting at the door');
    if (incidents.length) lines.push(`right now: ${incidents.join('; ')}.`);

    lines.push(
      `her plant: ${plantStage(state)} (vitality ${Math.round(state.plant.vitality)}). yours to tend, no one else's.`,
    );

    const stools = Object.values(state.stools).sort((a, b) => a.index - b.index);
    if (stools.length) {
      lines.push('at the counter:');
      for (const s of stools) {
        const b = s.bowl ? `${s.bowl.eaten ? 'finished a' : 'eating a'} ${s.bowl.broth} bowl` : 'waiting';
        lines.push(`  seat ${s.index + 1}: ${s.ownerName} — ${b} (${s.bowlsServed} bowls all-time)`);
      }
    } else {
      lines.push('the counter is empty right now.');
    }

    const regulars = Object.values(state.chatters)
      .filter((c) => c.spent > 0)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, 3);
    if (regulars.length) {
      lines.push(`best customers: ${regulars.map((c) => `${c.name} (¥${c.spent})`).join(', ')}.`);
    }
    return lines.join('\n');
  },
};
