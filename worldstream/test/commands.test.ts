import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/shared/commands.js';

describe('parseCommand', () => {
  it('returns null for plain chat', () => {
    expect(parseCommand('hello there')).toBeNull();
    expect(parseCommand('  what is this')).toBeNull();
  });

  it('parses add with multi-word sprites, positions and quoted text', () => {
    expect(parseCommand('!add cat')).toEqual({ kind: 'add', sprite: 'cat', position: undefined, text: undefined });
    expect(parseCommand('!add neon sign left')).toEqual({ kind: 'add', sprite: 'neon sign', position: 'left', text: undefined });
    expect(parseCommand('!add right a ramen stand')).toEqual({ kind: 'add', sprite: 'ramen stand', position: 'right', text: undefined });
    expect(parseCommand('!add neon sign "AJ\'s Ramen" right')).toEqual({ kind: 'add', sprite: 'neon sign', position: 'right', text: "AJ's Ramen" });
    expect(parseCommand('!spawn the drone')).toEqual({ kind: 'add', sprite: 'drone', position: undefined, text: undefined });
  });

  it('does not eat a sprite that happens to be a position word', () => {
    expect(parseCommand('!add left')).toEqual({ kind: 'add', sprite: 'left', position: undefined, text: undefined });
  });

  it('parses remove variants', () => {
    expect(parseCommand('!remove')).toEqual({ kind: 'remove', target: 'mine' });
    expect(parseCommand('!undo')).toEqual({ kind: 'remove', target: 'mine' });
    expect(parseCommand('!remove last')).toEqual({ kind: 'remove', target: 'last' });
    expect(parseCommand('!rm the cat')).toEqual({ kind: 'remove', target: 'cat' });
  });

  it('parses sign, weather, time, world, vote, help', () => {
    expect(parseCommand('!sign "OPEN LATE"')).toEqual({ kind: 'sign', text: 'OPEN LATE' });
    expect(parseCommand('!sign open late')).toEqual({ kind: 'sign', text: 'open late' });
    expect(parseCommand('!sign')).toEqual({ kind: 'sign', text: undefined });
    expect(parseCommand('!weather fog')).toEqual({ kind: 'weather', weather: 'fog' });
    expect(parseCommand('!rain')).toEqual({ kind: 'weather', weather: 'rain' });
    expect(parseCommand('!time dawn')).toEqual({ kind: 'time', preset: 'dawn' });
    expect(parseCommand('!night')).toEqual({ kind: 'time', preset: 'night' });
    expect(parseCommand('!world desert')).toEqual({ kind: 'world', world: 'desert' });
    expect(parseCommand('!vote')).toEqual({ kind: 'vote' });
    expect(parseCommand('!help')).toEqual({ kind: 'help' });
    expect(parseCommand('!event train')).toEqual({ kind: 'event', name: 'train' });
    expect(parseCommand('!event cat cross')).toEqual({ kind: 'event', name: 'cat_cross' });
  });

  it('flags nonsense as unknown', () => {
    expect(parseCommand('!weather lava')).toEqual({ kind: 'unknown', raw: '!weather lava' });
    expect(parseCommand('!dance')).toEqual({ kind: 'unknown', raw: '!dance' });
  });
});

describe('parseCommand: wear', () => {
  it('parses wear, dress and put on', () => {
    expect(parseCommand('!wear top hat')).toEqual({ kind: 'wear', text: 'top hat' });
    expect(parseCommand('!wear a red coat')).toEqual({ kind: 'wear', text: 'red coat' });
    expect(parseCommand('!dress him in a cape')).toEqual({ kind: 'wear', text: 'cape' });
    expect(parseCommand('!put on the sunglasses')).toEqual({ kind: 'wear', text: 'sunglasses' });
    expect(parseCommand('!put cat left')).toEqual({ kind: 'add', sprite: 'cat', position: 'left', text: undefined });
  });
  it('parses taking things off', () => {
    expect(parseCommand('!take off the hat')).toEqual({ kind: 'wear', text: 'hat', off: true });
    expect(parseCommand('!undress')).toEqual({ kind: 'wear', text: 'everything', off: true });
    expect(parseCommand('!take a cat')).toEqual({ kind: 'unknown', raw: '!take a cat' });
  });
});
