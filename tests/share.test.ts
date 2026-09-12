import { describe, expect, it } from 'vitest';
import { decodeBlueprint } from '../src/blueprint/decode';
import {
  buildShareHash,
  copyTextToClipboard,
  parseShareHash,
  replaceHash,
} from '../src/blueprint/share';
import { encodeBlueprintString, singleBlueprintJson } from './fixtures';

describe('buildShareHash', () => {
  it('builds #bp= hashes without a selection', () => {
    expect(buildShareHash('0abc')).toBe('#bp=0abc');
    expect(buildShareHash('0abc', null)).toBe('#bp=0abc');
  });

  it('appends sel for book pages', () => {
    expect(buildShareHash('0abc', 2)).toBe('#bp=0abc&sel=2');
    expect(buildShareHash('0abc', 0)).toBe('#bp=0abc&sel=0');
  });

  it('ignores invalid book indices', () => {
    expect(buildShareHash('0abc', Number.NaN)).toBe('#bp=0abc');
    expect(buildShareHash('0abc', -1)).toBe('#bp=0abc');
  });
});

describe('parseShareHash', () => {
  it('parses bp and sel', () => {
    expect(parseShareHash('#bp=0abc&sel=2')).toEqual({ bp: '0abc', sel: 2 });
    expect(parseShareHash('bp=0abc')).toEqual({ bp: '0abc', sel: null });
  });

  it('handles missing parts', () => {
    expect(parseShareHash('')).toEqual({ bp: null, sel: null });
    expect(parseShareHash('#')).toEqual({ bp: null, sel: null });
    expect(parseShareHash('#bp=0abc')).toEqual({ bp: '0abc', sel: null });
    expect(parseShareHash('#sel=3')).toEqual({ bp: null, sel: 3 });
  });

  it('ignores other parameters and duplicates', () => {
    expect(parseShareHash('#bp=0abc&sel=2&extra=x&sel=9&bp=second')).toEqual({
      bp: '0abc',
      sel: 2,
    });
  });

  it('rejects non-integer or negative sel values', () => {
    expect(parseShareHash('#bp=0abc&sel=oops')).toEqual({ bp: '0abc', sel: null });
    expect(parseShareHash('#bp=0abc&sel=-2')).toEqual({ bp: '0abc', sel: null });
  });
});

describe('share round trip', () => {
  const payloads = ['0abc', '0eNq-', '0eNr_aA.b64url'];

  it('survives build → parse for strings', () => {
    for (const payload of payloads) {
      expect(parseShareHash(buildShareHash(payload))).toEqual({ bp: payload, sel: null });
    }
  });

  it('survives build → parse including the book selection', () => {
    for (const payload of payloads) {
      for (const sel of [0, 1, 42]) {
        const parsed = parseShareHash(buildShareHash(payload, sel));
        expect(parsed).toEqual({ bp: payload, sel });
      }
    }
  });

  it('decodes a payload that traveled through the hash', () => {
    const encoded = encodeBlueprintString(singleBlueprintJson());
    const parsed = parseShareHash(buildShareHash(encoded, 1));
    if (!parsed.bp) throw new Error('expected a bp value');
    const decoded = decodeBlueprint(parsed.bp);
    expect(parsed.sel).toBe(1);
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    expect(decoded.blueprint.label).toBe('Test Outpost');
  });
});

describe('node-environment safety', () => {
  it('replaceHash is a safe no-op without a browser history', () => {
    expect(() => replaceHash('#bp=0abc')).not.toThrow();
    expect(() => replaceHash('')).not.toThrow();
  });

  it('copyTextToClipboard degrades gracefully without a DOM clipboard', async () => {
    await expect(copyTextToClipboard('#bp=0abc')).resolves.toBe(false);
  });
});
