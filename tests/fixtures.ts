import { deflate, deflateRaw } from 'pako';
import { encodeBlueprintVersion } from '../src/blueprint/version';

/**
 * Synthetic blueprint fixtures, built the same way Factorio encodes them:
 * '0' + base64url(raw DEFLATE(JSON)).
 */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export type CompressionMode = 'raw' | 'zlib';

export function encodeBlueprintString(value: unknown, mode: CompressionMode = 'raw'): string {
  return encodeCompressedText(JSON.stringify(value), mode);
}

/** Compress arbitrary text like a blueprint string payload ('0' + base64url). */
export function encodeCompressedText(text: string, mode: CompressionMode = 'raw'): string {
  const bytes = new TextEncoder().encode(text);
  const compressed = mode === 'raw' ? deflateRaw(bytes) : deflate(bytes);
  return `0${toBase64Url(compressed)}`;
}

/** Scatter whitespace through the string like a badly line-wrapped paste. */
export function padWithWhitespace(text: string): string {
  return `  \n\t${text.split('').join(' \n\t')}\r\n  `;
}

export function singleBlueprintJson(): Record<string, unknown> {
  return {
    blueprint: {
      item: 'blueprint',
      label: 'Test Outpost',
      description: 'A small synthetic outpost for tests',
      version: encodeBlueprintVersion(1, 1, 61),
      icons: [
        { signal: { name: 'iron-plate', type: 'item' }, index: 1 },
        { signal: { name: 'crude-oil', type: 'fluid' }, index: 2 },
      ],
      entities: [
        { entity_number: 1, name: 'transport-belt', position: { x: 0.5, y: 0.5 }, direction: 2 },
        {
          entity_number: 2,
          name: 'assembling-machine-1',
          position: { x: 5, y: 2 },
          recipe: 'electronic-circuit',
        },
        {
          entity_number: 3,
          name: 'assembling-machine-1',
          position: { x: 8, y: 2 },
          direction: 4,
          recipe: 'electronic-circuit',
        },
        { entity_number: 4, name: 'mystery-thing', position: { x: 10.5, y: 3.5 } },
      ],
      tiles: [
        { name: 'refined-concrete', position: { x: 0, y: 0 } },
        { name: 'refined-concrete', position: { x: 1, y: 0 } },
        { name: 'stone-path', position: { x: 2, y: 0 } },
      ],
    },
  };
}

export function bookJson(): Record<string, unknown> {
  const pageVersion = encodeBlueprintVersion(1, 1, 55);
  return {
    blueprint_book: {
      item: 'blueprint-book',
      label: 'Test Book',
      description: 'Synthetic book for tests',
      active_index: 0,
      version: encodeBlueprintVersion(1, 1, 61),
      icons: [{ signal: { name: 'steel-plate', type: 'item' }, index: 1 }],
      blueprints: [
        {
          blueprint: {
            item: 'blueprint',
            label: 'Page A',
            description: 'First page',
            version: pageVersion,
            entities: [
              {
                entity_number: 1,
                name: 'transport-belt',
                position: { x: 0.5, y: 0.5 },
                direction: 2,
              },
            ],
          },
        },
        {
          blueprint: {
            item: 'blueprint',
            label: 'Page B',
            version: pageVersion,
            entities: [{ entity_number: 1, name: 'stone-furnace', position: { x: 2, y: 3 } }],
          },
        },
      ],
    },
  };
}

/** A book whose first page is itself a blueprint book (nested, not expanded). */
export function nestedBookJson(): Record<string, unknown> {
  return {
    blueprint_book: {
      item: 'blueprint-book',
      label: 'Outer Book',
      active_index: 0,
      blueprints: [
        {
          blueprint: {
            item: 'blueprint-book',
            label: 'Inner Book',
            blueprints: [
              {
                blueprint: {
                  item: 'blueprint',
                  label: 'Deep page',
                  entities: [{ entity_number: 1, name: 'lamp', position: { x: 0, y: 0 } }],
                },
              },
            ],
          },
        },
        {
          blueprint: {
            item: 'blueprint',
            label: 'Plain page',
            entities: [{ entity_number: 1, name: 'iron-chest', position: { x: 1, y: 1 } }],
          },
        },
      ],
    },
  };
}
