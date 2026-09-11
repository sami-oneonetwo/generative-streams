import { describe, expect, it } from 'vitest';
import { apply, initialState } from '../src/shared/state.js';
import { applyWear, characterKeys, describeOutfit, findItem, itemKeys, resolveWear, type Wardrobe } from '../src/shared/wardrobe.js';

const frame = (rows: string[]) => ({ w: rows[0].length, h: rows.length, rows });
const wardrobe: Wardrobe = {
  keys: { K: '#000000', R: '#ff0000', X: '' },
  items: [
    { name: 'top_hat', slot: 'head', aliases: ['tophat', 'fancy hat'], tags: ['hat', 'fancy'], frame: frame(['XXX', 'XXX']), dx: 2, dy: -2, tint: 'black' },
    { name: 'crown', slot: 'head', aliases: ['king'], tags: ['hat', 'royal'], frame: frame(['R.R']), dx: 3, dy: -1 },
    { name: 'sunglasses', slot: 'face', aliases: ['shades', 'glasses'], tags: ['face'], frame: frame(['KKKK']), dx: 4, dy: 3 },
    { name: 'cape', slot: 'back', aliases: ['cloak'], tags: ['back'], frame: frame(['XX', 'XX']), dx: -1, dy: 7, behind: true, tint: 'red' },
  ],
};
const rnd = () => 0;

describe('resolveWear', () => {
  it('recolours a garment from "colour slot" in either order', () => {
    expect(resolveWear(wardrobe, 'red coat')).toEqual({ kind: 'colour', slot: 'coat', colour: 'red' });
    expect(resolveWear(wardrobe, 'coat red')).toEqual({ kind: 'colour', slot: 'coat', colour: 'red' });
    expect(resolveWear(wardrobe, 'a blue jacket please')).toEqual({ kind: 'colour', slot: 'coat', colour: 'blue' });
    expect(resolveWear(wardrobe, 'scarlet shoes')).toEqual({ kind: 'colour', slot: 'boots', colour: 'red' });
  });
  it('finds items by name, alias, head noun and tag', () => {
    expect(resolveWear(wardrobe, 'top hat', false, rnd)).toMatchObject({ kind: 'item', item: { name: 'top_hat' } });
    expect(resolveWear(wardrobe, 'the fancy hat', false, rnd)).toMatchObject({ kind: 'item', item: { name: 'top_hat' } });
    expect(resolveWear(wardrobe, 'shades', false, rnd)).toMatchObject({ kind: 'item', item: { name: 'sunglasses' } });
    expect(resolveWear(wardrobe, 'a hat', false, rnd)).toMatchObject({ kind: 'item', item: { name: 'top_hat' } });
    expect(findItem(wardrobe, 'hat', () => 0.9)?.name).toBe('crown');
  });
  it('tints only tintable items', () => {
    expect(resolveWear(wardrobe, 'green cape', false, rnd)).toMatchObject({ kind: 'item', item: { name: 'cape' }, colour: 'green' });
    expect(resolveWear(wardrobe, 'green sunglasses', false, rnd)).toMatchObject({ kind: 'item', item: { name: 'sunglasses' }, colour: undefined });
  });
  it('handles removals, resets and a bare colour', () => {
    expect(resolveWear(wardrobe, 'hat', true, rnd)).toEqual({ kind: 'remove', slot: 'head' });
    expect(resolveWear(wardrobe, 'no scarf')).toEqual({ kind: 'remove', slot: 'scarf' });
    expect(resolveWear(wardrobe, 'glasses', true, rnd)).toEqual({ kind: 'remove', slot: 'face' });
    expect(resolveWear(wardrobe, 'nothing')).toEqual({ kind: 'remove', slot: 'all' });
    expect(resolveWear(wardrobe, 'everything', true)).toEqual({ kind: 'remove', slot: 'all' });
    expect(resolveWear(wardrobe, 'purple')).toEqual({ kind: 'colour', slot: 'coat', colour: 'purple' });
    expect(resolveWear(wardrobe, 'a tuxedo')).toEqual({ kind: 'unknown', text: 'a tuxedo' });
    expect(resolveWear(wardrobe, 'coat')).toEqual({ kind: 'unknown', text: 'coat' });
  });
});

describe('applyWear and describeOutfit', () => {
  it('layers changes and returns the same reference when nothing changes', () => {
    const a = applyWear(undefined, { kind: 'colour', slot: 'coat', colour: 'red' });
    expect(a).toEqual({ colours: { coat: 'red' } });
    expect(applyWear(a, { kind: 'colour', slot: 'coat', colour: 'red' })).toBe(a);
    const b = applyWear(a, { kind: 'item', item: wardrobe.items[0] });
    expect(b?.items).toEqual({ head: { name: 'top_hat' } });
    const c = applyWear(b, { kind: 'item', item: wardrobe.items[1] });
    expect(c?.items).toEqual({ head: { name: 'crown' } });
    expect(describeOutfit(c)).toBe('red coat, crown');
    expect(applyWear(c, { kind: 'remove', slot: 'scarf' })?.colours).toEqual({ coat: 'red', scarf: 'none' });
    expect(applyWear(c, { kind: 'remove', slot: 'head' })).toEqual({ colours: { coat: 'red' } });
    expect(applyWear(c, { kind: 'remove', slot: 'all' })).toBeUndefined();
    expect(applyWear(undefined, { kind: 'remove', slot: 'all' })).toBeUndefined();
    expect(describeOutfit(undefined)).toBe('his usual clothes');
  });
  it('swaps garment keys and hides a removed scarf', () => {
    const base = { '9': '#2a2a44', a: '#3d3d5c', h: '#ff2bd6', '8': '#1a1a2e', t: '#e0c9a6' };
    expect(characterKeys(base, undefined)).toBe(base);
    const k = characterKeys(base, { colours: { coat: 'red', scarf: 'none' } });
    expect(k['9']).toBe('#ff3b3b');
    expect(k.h).toBe('');
    expect(k.t).toBe('#e0c9a6');
    expect(itemKeys(wardrobe, wardrobe.items[3], undefined).X).toBe('#ff3b3b');
    expect(itemKeys(wardrobe, wardrobe.items[3], 'blue').X).toBe('#4f7cff');
  });
});

describe('dress mutation', () => {
  it('sets, replaces and clears the outfit, skipping no-ops', () => {
    const s0 = initialState('cyberpunk');
    const s1 = apply(s0, { type: 'dress', outfit: { colours: { coat: 'red' } } });
    expect(s1.version).toBe(s0.version + 1);
    expect(s1.character.outfit).toEqual({ colours: { coat: 'red' } });
    expect(apply(s1, { type: 'dress', outfit: { colours: { coat: 'red' } } })).toBe(s1);
    const s2 = apply(s1, { type: 'dress', outfit: undefined });
    expect(s2.character.outfit).toBeUndefined();
    expect(apply(s2, { type: 'dress', outfit: undefined })).toBe(s2);
  });
});
