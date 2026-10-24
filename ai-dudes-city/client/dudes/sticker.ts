// The Sticker Toy look for Finders Keepers (FK-009, board/design-system.md): two fonts, the colour
// tokens, pills and cards with thick ink outlines (all in index.html). `body.story` switches it on
// while Story is ON, or on any `?demo=` page; with it the letterbox slims to 7vh and, on the stream,
// the feed, the invite and the caravan panel step aside for the Board. Story OFF is today's page.

/** The faces the story HUD draws in (client/dudes/fonts, declared in index.html): Fredoka for display, Nunito for text. */
export const STORY_FONTS = ['600 54px Fredoka', '700 54px Fredoka', '800 54px Nunito'] as const;

/** The story look: while Story is ON, and always on a `?demo=` page (it fakes the story's pieces locally). */
export function storyLook(story: boolean | undefined, params: URLSearchParams): boolean {
  return story === true || params.has('demo');
}

type Page = { body: { classList: { toggle(name: string, force: boolean): boolean } }; fonts?: { load(font: string): Promise<unknown> } };
const asked = new WeakSet<object>();
/**
 * Puts the page in (or out of) the story look. The first time it goes in, the fonts start loading,
 * so the Board and the show's cards never flash up in a fallback face first.
 */
export function setStoryLook(on: boolean, page: Page = document): void {
  page.body.classList.toggle('story', on);
  if (!on || asked.has(page)) return;
  asked.add(page);
  for (const font of STORY_FONTS) page.fonts?.load(font).catch(() => undefined);
}
