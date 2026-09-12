import { describe, expect, it } from 'vitest';
import {
  BlueprintDecodeError,
  decodeBlueprint,
  extractBlueprintParam,
  getBookPage,
  parseBlueprintDocument,
  type DecodedBlueprint,
} from '../src/blueprint/decode';
import {
  bookJson,
  encodeBlueprintString,
  encodeCompressedText,
  nestedBookJson,
  padWithWhitespace,
  singleBlueprintJson,
} from './fixtures';

function expectDecode(text: string): DecodedBlueprint {
  return decodeBlueprint(text);
}

describe('decodeBlueprint — happy paths', () => {
  it('decodes a single blueprint string', () => {
    const decoded = expectDecode(encodeBlueprintString(singleBlueprintJson()));
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    expect(decoded.blueprint.label).toBe('Test Outpost');
    expect(decoded.blueprint.description).toBe('A small synthetic outpost for tests');
    expect(decoded.blueprint.item).toBe('blueprint');
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
    expect(decoded.raw).toEqual(singleBlueprintJson());
  });

  it('decodes a blueprint book', () => {
    const decoded = expectDecode(encodeBlueprintString(bookJson()));
    expect(decoded.kind).toBe('book');
    if (decoded.kind !== 'book') return;
    expect(decoded.book.label).toBe('Test Book');
    expect(decoded.book.active_index).toBe(0);
    expect(decoded.book.icons).toEqual([
      { signal: { name: 'steel-plate', type: 'item' }, index: 1 },
    ]);
    expect(decoded.book.blueprints).toHaveLength(2);
    expect(decoded.book.blueprints[0]?.blueprint.label).toBe('Page A');
    expect(decoded.book.blueprints[1]?.blueprint.label).toBe('Page B');
    expect(decoded.raw).toEqual(bookJson());
  });

  it('flags nested book pages instead of failing them', () => {
    const decoded = expectDecode(encodeBlueprintString(nestedBookJson()));
    expect(decoded.kind).toBe('book');
    if (decoded.kind !== 'book') return;
    expect(decoded.book.label).toBe('Outer Book');
    expect(decoded.book.blueprints).toHaveLength(2);
    // The nested book page decodes silently as an empty-looking blueprint…
    const nested = decoded.book.blueprints[0];
    expect(nested?.blueprint.label).toBe('Inner Book');
    expect(nested?.blueprint.entities).toHaveLength(0);
    // …but it is flagged so the UI can explain it is not expanded.
    expect(nested?.nestedBook).toBe(true);
    // A plain page is never flagged.
    expect(decoded.book.blueprints[1]?.nestedBook).toBeUndefined();
    expect(decoded.book.blueprints[1]?.blueprint.entities).toHaveLength(1);
    // The raw document still preserves the full nested structure.
    expect(decoded.raw).toEqual(nestedBookJson());
  });

  it('strips all whitespace, including newlines and tabs', () => {
    const padded = padWithWhitespace(encodeBlueprintString(singleBlueprintJson()));
    const decoded = expectDecode(padded);
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    expect(decoded.blueprint.label).toBe('Test Outpost');
  });

  it('inflates zlib-wrapped payloads via the fallback path', () => {
    const wrapped = encodeBlueprintString(singleBlueprintJson(), 'zlib');
    const decoded = expectDecode(wrapped);
    expect(decoded.kind).toBe('blueprint');
  });

  it('extracts the bp parameter from a pasted query URL', () => {
    const payload = encodeBlueprintString(singleBlueprintJson());
    const decoded = expectDecode(`https://example.com/view?bp=${payload}&utm_source=chat`);
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    expect(decoded.blueprint.label).toBe('Test Outpost');
  });

  it('extracts the bp parameter from a pasted hash URL, keeping sel out of the payload', () => {
    const payload = encodeBlueprintString(bookJson());
    const decoded = expectDecode(`https://example.com/index.html#bp=${payload}&sel=1`);
    expect(decoded.kind).toBe('book');
    if (decoded.kind !== 'book') return;
    expect(decoded.book.blueprints).toHaveLength(2);
  });

  it('normalizes missing arrays to empty ones', () => {
    const decoded = expectDecode(
      encodeBlueprintString({ blueprint: { item: 'blueprint', label: 'Empty' } }),
    );
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    expect(decoded.blueprint.entities).toEqual([]);
    expect(decoded.blueprint.tiles).toEqual([]);
    expect(decoded.blueprint.icons).toEqual([]);
    expect(decoded.blueprint.schedules).toEqual([]);
  });

  it('defaults omitted 2.x signal types to item', () => {
    const decoded = expectDecode(
      encodeBlueprintString({
        blueprint: {
          item: 'blueprint',
          label: 'No type',
          icons: [{ signal: { name: 'iron-plate' }, index: 1 }],
        },
      }),
    );
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    expect(decoded.blueprint.icons).toEqual([
      { signal: { name: 'iron-plate', type: 'item' }, index: 1 },
    ]);
  });
});

describe('raw document preservation', () => {
  it('keeps unknown fields the typed projection drops', () => {
    const document = {
      blueprint: {
        item: 'blueprint',
        label: 'Raw keeps everything',
        last_update: 1726142400,
        entities: [
          {
            entity_number: 1,
            name: 'lamp',
            position: { x: 0, y: 0 },
            control_behavior: { circuit_condition: { constant: 7 } },
          },
        ],
      },
    };
    const decoded = expectDecode(encodeBlueprintString(document));
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    // The typed projection drops the unknown fields…
    expect(decoded.blueprint.entities[0]).not.toHaveProperty('control_behavior');
    expect(decoded.blueprint).not.toHaveProperty('last_update');
    // …but the raw document keeps them, losslessly.
    expect(decoded.raw).toEqual(document);
  });

  it('keeps the raw document for books too', () => {
    const decoded = expectDecode(encodeBlueprintString(bookJson()));
    expect(decoded.kind).toBe('book');
    if (decoded.kind !== 'book') return;
    expect(decoded.raw).toEqual(bookJson());
  });
});

describe('entity quality, inventory, modules and settings', () => {
  it('captures the four optional entity attributes losslessly when present', () => {
    const document = {
      blueprint: {
        item: 'blueprint',
        label: 'Attribute outpost',
        entities: [
          {
            entity_number: 1,
            name: 'iron-chest',
            position: { x: 0, y: 0 },
            quality: 'uncommon',
            inventory: { '2': 'copper-cable', '1': 'iron-plate' },
            modules: ['speed-module'],
            settings: { filter: 'iron-ore', min_deliver: 5, enabled: true },
          },
          {
            entity_number: 2,
            name: 'decider-combinator',
            position: { x: 5, y: 0 },
            settings: { conditions: [{ compare_type: 'or', constant: 7 }], output_signal: null },
          },
        ],
      },
    };
    const decoded = expectDecode(encodeBlueprintString(document));
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    const [chest, combinator] = decoded.blueprint.entities;
    expect(chest?.quality).toBe('uncommon');
    // Slot keys, item names and key order are preserved exactly as given.
    expect(chest?.inventory).toEqual({ '2': 'copper-cable', '1': 'iron-plate' });
    expect(chest?.modules).toEqual(['speed-module']);
    expect(chest?.settings).toEqual({ filter: 'iron-ore', min_deliver: 5, enabled: true });
    // Heterogeneous settings values (arrays, objects, null) are kept as given.
    expect(combinator?.settings).toEqual({
      conditions: [{ compare_type: 'or', constant: 7 }],
      output_signal: null,
    });
    // The raw document is still untouched.
    expect(decoded.raw).toEqual(document);
  });

  it('tolerates entities without the optional attributes', () => {
    const decoded = expectDecode(encodeBlueprintString(singleBlueprintJson()));
    expect(decoded.kind).toBe('blueprint');
    if (decoded.kind !== 'blueprint') return;
    for (const entity of decoded.blueprint.entities) {
      expect(entity.quality).toBeUndefined();
      expect(entity.inventory).toBeUndefined();
      expect(entity.modules).toBeUndefined();
      expect(entity.settings).toBeUndefined();
    }
  });
});

describe('parseBlueprintDocument', () => {
  it('validates a parsed document and returns kind, projection and raw', () => {
    const document = singleBlueprintJson();
    const parsed = parseBlueprintDocument(document);
    expect(parsed.kind).toBe('blueprint');
    if (parsed.kind !== 'blueprint') return;
    expect(parsed.blueprint.label).toBe('Test Outpost');
    expect(parsed.raw).toBe(document);
  });

  it('parses book documents with their raw payload', () => {
    const document = bookJson();
    const parsed = parseBlueprintDocument(document);
    expect(parsed.kind).toBe('book');
    if (parsed.kind !== 'book') return;
    expect(parsed.book.label).toBe('Test Book');
    expect(parsed.raw).toBe(document);
  });

  it('throws unexpected-shape for documents that are neither blueprint nor book', () => {
    expect.assertions(2);
    try {
      parseBlueprintDocument({ something: 'else' });
      expect.unreachable('expected parseBlueprintDocument to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BlueprintDecodeError);
      expect((error as BlueprintDecodeError).kind).toBe('unexpected-shape');
    }
  });
});

describe('decodeBlueprint — typed error paths', () => {
  const cases: Array<[input: string, kind: BlueprintDecodeError['kind']]> = [
    ['', 'not-a-blueprint-string'],
    ['   \n  ', 'not-a-blueprint-string'],
    ['hello world', 'not-a-blueprint-string'],
    ['1eNqsomebase64', 'not-a-blueprint-string'],
    ['0!!!!', 'bad-base64'],
    ['0a', 'bad-base64'],
    ['0YWJj', 'bad-deflate'],
    [encodeCompressedText('this is not json'), 'bad-json'],
    [encodeBlueprintString({ foo: 1 }), 'unexpected-shape'],
    [encodeBlueprintString({ blueprint: 'nope' }), 'unexpected-shape'],
    [encodeBlueprintString({ blueprint: { entities: 'not-an-array' } }), 'unexpected-shape'],
    [encodeBlueprintString({ blueprint: { entities: [{ name: 'x' }] } }), 'unexpected-shape'],
    [
      encodeBlueprintString({
        blueprint: {
          entities: [{ entity_number: 1, name: 'x', position: { x: 0, y: 0 }, quality: 5 }],
        },
      }),
      'unexpected-shape',
    ],
    [
      encodeBlueprintString({
        blueprint: {
          entities: [{ entity_number: 1, name: 'x', position: { x: 0, y: 0 }, inventory: 'nope' }],
        },
      }),
      'unexpected-shape',
    ],
    [
      encodeBlueprintString({
        blueprint: {
          entities: [
            { entity_number: 1, name: 'x', position: { x: 0, y: 0 }, inventory: { '1': 5 } },
          ],
        },
      }),
      'unexpected-shape',
    ],
    [
      encodeBlueprintString({
        blueprint: {
          entities: [{ entity_number: 1, name: 'x', position: { x: 0, y: 0 }, modules: 'nope' }],
        },
      }),
      'unexpected-shape',
    ],
    [
      encodeBlueprintString({
        blueprint: {
          entities: [{ entity_number: 1, name: 'x', position: { x: 0, y: 0 }, modules: [5] }],
        },
      }),
      'unexpected-shape',
    ],
    [
      encodeBlueprintString({
        blueprint: {
          entities: [{ entity_number: 1, name: 'x', position: { x: 0, y: 0 }, settings: 'nope' }],
        },
      }),
      'unexpected-shape',
    ],
    [encodeBlueprintString({ blueprint_book: { blueprints: 'nope' } }), 'unexpected-shape'],
    [
      encodeBlueprintString({ blueprint_book: { blueprints: [{ blueprint: null }] } }),
      'unexpected-shape',
    ],
  ];

  for (const [input, kind] of cases) {
    it(`throws ${kind}`, () => {
      expect.assertions(3);
      try {
        decodeBlueprint(input);
        expect.unreachable('expected decodeBlueprint to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(BlueprintDecodeError);
        const decodeError = error as BlueprintDecodeError;
        expect(decodeError.kind).toBe(kind);
        expect(decodeError.message.length).toBeGreaterThan(0);
      }
    });
  }
});

describe('extractBlueprintParam', () => {
  it('finds #bp= before ?bp= when both appear', () => {
    expect(extractBlueprintParam('x#bp=hashvalue&sel=1?bp=queryvalue')).toBe('hashvalue');
  });

  it('returns null when no parameter is present', () => {
    expect(extractBlueprintParam('0eNrnormalstring')).toBeNull();
    expect(extractBlueprintParam('#bp=&sel=1')).toBeNull();
  });
});

describe('getBookPage', () => {
  const decoded = decodeBlueprint(encodeBlueprintString(bookJson()));
  if (decoded.kind !== 'book') throw new Error('fixture must decode as a book');

  it('returns the active page', () => {
    expect(getBookPage(decoded.book, 0)?.label).toBe('Page A');
    expect(getBookPage(decoded.book, 1)?.label).toBe('Page B');
  });

  it('clamps out-of-range indices', () => {
    expect(getBookPage(decoded.book, -5)?.label).toBe('Page A');
    expect(getBookPage(decoded.book, 99)?.label).toBe('Page B');
  });

  it('returns null for empty books', () => {
    expect(getBookPage({ blueprints: [] }, 0)).toBeNull();
  });
});
