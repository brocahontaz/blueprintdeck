import { describe, expect, it } from 'vitest';
import { BlueprintDecodeError, decodeBlueprint } from '../src/blueprint/decode';
import { encodeBlueprintBook, encodeBlueprintPage } from '../src/blueprint/encode';
import { bookJson, encodeBlueprintString, singleBlueprintJson } from './fixtures';

/**
 * Re-encoding: validate through the decode normalizers, serialize the
 * original value losslessly, and produce '0' + base64url(raw DEFLATE(JSON)).
 */

describe('encodeBlueprintPage — round trips', () => {
  it('round trips a representative page back to the same typed fields', () => {
    const page = singleBlueprintJson().blueprint;
    const decoded = decodeBlueprint(encodeBlueprintPage(page));
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    expect(decoded.blueprint.item).toBe('blueprint');
    expect(decoded.blueprint.label).toBe('Test Outpost');
    expect(decoded.blueprint.description).toBe('A small synthetic outpost for tests');
    expect(decoded.blueprint.version).toBeDefined();
    expect(decoded.blueprint.entities).toHaveLength(4);
    expect(decoded.blueprint.entities[0]).toMatchObject({
      entity_number: 1,
      name: 'transport-belt',
      position: { x: 0.5, y: 0.5 },
      direction: 2,
    });
    expect(decoded.blueprint.entities[1]?.recipe).toBe('electronic-circuit');
    expect(decoded.blueprint.tiles).toHaveLength(3);
    expect(decoded.blueprint.icons).toEqual([
      { signal: { name: 'iron-plate', type: 'item' }, index: 1 },
      { signal: { name: 'crude-oil', type: 'fluid' }, index: 2 },
    ]);
  });

  it('preserves unknown fields losslessly through decode + re-encode', () => {
    const page = {
      item: 'blueprint',
      label: 'Lossless',
      last_update: 1726142400,
      entities: [
        {
          entity_number: 1,
          name: 'lamp',
          position: { x: 0, y: 0 },
          control_behavior: { circuit_condition: { constant: 7 } },
        },
      ],
    };
    const before = JSON.stringify({ blueprint: page });
    const encoded = encodeBlueprintPage(page);
    const decoded = decodeBlueprint(encoded);
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    // The raw document survives the decode unchanged…
    expect(JSON.stringify(decoded.raw)).toBe(before);
    // …and re-encoding the decoded page produces the same string.
    expect(JSON.stringify({ blueprint: decoded.raw.blueprint })).toBe(before);
  });

  it('round trips a blueprint book', () => {
    const book = bookJson().blueprint_book;
    const decoded = decodeBlueprint(encodeBlueprintBook(book));
    expect(decoded.kind).toBe('book');
    if (decoded.kind !== 'book') return;
    expect(decoded.book.label).toBe('Test Book');
    expect(decoded.book.active_index).toBe(0);
    expect(decoded.book.blueprints).toHaveLength(2);
    expect(decoded.book.blueprints[0]?.blueprint.label).toBe('Page A');
    expect(decoded.book.blueprints[1]?.blueprint.label).toBe('Page B');
    expect(JSON.stringify(decoded.raw)).toBe(JSON.stringify(bookJson()));
  });

  it('round trips unicode labels', () => {
    const page = { item: 'blueprint', label: 'Náttúra ⚙' };
    const decoded = decodeBlueprint(encodeBlueprintPage(page));
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    expect(decoded.blueprint.label).toBe('Náttúra ⚙');
    expect(JSON.stringify(decoded.raw)).toBe(JSON.stringify({ blueprint: page }));
  });

  it('encodes and decodes a large payload (~3000 entities)', () => {
    const entities = Array.from({ length: 3000 }, (_, i) => ({
      entity_number: i + 1,
      name: 'transport-belt',
      position: { x: (i % 100) + 0.5, y: Math.floor(i / 100) + 0.5 },
    }));
    const page = { item: 'blueprint', label: 'Big', entities };
    const encoded = encodeBlueprintPage(page);
    const decoded = decodeBlueprint(encoded);
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    expect(decoded.blueprint.entities).toHaveLength(3000);
    expect(decoded.blueprint.entities[2999]).toMatchObject({
      entity_number: 3000,
      name: 'transport-belt',
      position: { x: 99.5, y: 29.5 },
    });
  });
});

describe('encodeBlueprintPage — output format', () => {
  it('starts with 0 and contains only base64url characters', () => {
    const encoded = encodeBlueprintPage(singleBlueprintJson().blueprint);
    expect(encoded.startsWith('0')).toBe(true);
    expect(encoded).toMatch(/^[0-9A-Za-z\-_]+$/);
  });

  it('matches the independent fixtures encoder byte for byte', () => {
    const document = singleBlueprintJson();
    expect(encodeBlueprintPage(document.blueprint)).toBe(encodeBlueprintString(document));
  });

  it('does not mutate or reorder the input', () => {
    const page = {
      item: 'blueprint',
      label: 'Frozen',
      entities: [
        { entity_number: 1, name: 'lamp', position: { x: 0, y: 0 }, zzz_extra: { b: 2, a: 1 } },
      ],
    };
    const snapshot = JSON.stringify(page);
    encodeBlueprintPage(page);
    expect(JSON.stringify(page)).toBe(snapshot);
  });
});

describe('encode errors — typed BlueprintDecodeError', () => {
  function expectUnexpectedShape(encode: () => string): void {
    try {
      encode();
    } catch (error) {
      expect(error).toBeInstanceOf(BlueprintDecodeError);
      expect((error as BlueprintDecodeError).kind).toBe('unexpected-shape');
      expect((error as BlueprintDecodeError).message.length).toBeGreaterThan(0);
      return;
    }
    expect.unreachable('expected encode to throw');
  }

  it('rejects an entity missing its position', () => {
    expect.assertions(3);
    expectUnexpectedShape(() =>
      encodeBlueprintPage({
        item: 'blueprint',
        entities: [{ entity_number: 1, name: 'lamp' }],
      }),
    );
  });

  it('rejects a page that is not an object', () => {
    expect.assertions(3);
    expectUnexpectedShape(() => encodeBlueprintPage('not a blueprint'));
  });

  it('rejects a book whose blueprints are not an array', () => {
    expect.assertions(3);
    expectUnexpectedShape(() => encodeBlueprintBook({ item: 'blueprint-book', blueprints: 3 }));
  });
});
