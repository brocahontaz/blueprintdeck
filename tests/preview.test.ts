import { describe, expect, it } from 'vitest';
import { decodeBlueprint, type BlueprintJson } from '../src/blueprint/decode';
import {
  PREVIEW_MAX_ENTITIES,
  PREVIEW_MAX_TILES,
  buildBlueprintPreview,
  entityCategory,
  type EntityCategory,
} from '../src/blueprint/preview';
import { encodeBlueprintString, singleBlueprintJson } from './fixtures';

/**
 * Preview model tests: category mapping, bounding-box union, ordering,
 * truncation and purity. Bounding-box expectations are hand-computed in the
 * comments.
 */

const decoded = decodeBlueprint(encodeBlueprintString(singleBlueprintJson()));
if (decoded.kind !== 'blueprint') throw new Error('fixture must decode as a blueprint');

function blueprint(
  entities: BlueprintJson['entities'],
  tiles: BlueprintJson['tiles'] = [],
): BlueprintJson {
  return { icons: [], entities, tiles, schedules: [] };
}

function entity(
  entity_number: number,
  name: string,
  x: number,
  y: number,
  direction?: number,
): BlueprintJson['entities'][number] {
  const base = { entity_number, name, position: { x, y } };
  return direction === undefined ? base : { ...base, direction };
}

function tile(name: string, x: number, y: number): BlueprintJson['tiles'][number] {
  return { name, position: { x, y } };
}

/** A row of belts: entity_number i+1 at (i + 0.5, 0.5) → covers tile i. */
function beltLine(count: number): BlueprintJson['entities'] {
  return Array.from({ length: count }, (_, i) => entity(i + 1, 'transport-belt', i + 0.5, 0.5));
}

/** A row of landfill tiles on y = 0: tile i covers exactly cell [i, i+1). */
function tileRow(count: number): BlueprintJson['tiles'] {
  return Array.from({ length: count }, (_, i) => tile('landfill', i, 0));
}

describe('entityCategory', () => {
  it('maps representative exact names for every category', () => {
    const cases: ReadonlyArray<readonly [string, EntityCategory]> = [
      ['transport-belt', 'belt'],
      ['turbo-transport-belt', 'belt'],
      ['burner-inserter', 'inserter'],
      ['bulk-inserter', 'inserter'],
      ['assembling-machine-1', 'machine'],
      ['oil-refinery', 'machine'],
      ['stone-furnace', 'machine'],
      ['electric-mining-drill', 'machine'],
      ['rocket-silo', 'machine'],
      ['recycler', 'machine'],
      ['wooden-chest', 'storage'],
      ['storage-tank', 'storage'],
      ['cargo-landing-pad', 'storage'],
      ['small-electric-pole', 'power'],
      ['substation', 'power'],
      ['nuclear-reactor', 'power'],
      ['steam-engine', 'power'],
      ['lamp', 'power'],
      ['straight-rail', 'rail'],
      ['rail-chain-signal', 'rail'],
      ['locomotive', 'rail'],
      ['artillery-wagon', 'rail'],
      ['pipe', 'pipe'],
      ['pipe-to-ground', 'pipe'],
      ['offshore-pump', 'pipe'],
    ];
    for (const [name, expected] of cases) {
      expect(entityCategory(name)).toBe(expected);
    }
  });

  it('maps unknown names to other', () => {
    expect(entityCategory('mystery-thing')).toBe('other');
  });

  it('falls back to prefixes for names missing from the exact table', () => {
    expect(entityCategory('fast-underground-belt')).toBe('belt');
    expect(entityCategory('turbo-loader')).toBe('belt');
    expect(entityCategory('assembling-machine-4')).toBe('machine');
    expect(entityCategory('logistic-chest-requester')).toBe('storage');
    expect(entityCategory('huge-electric-pole')).toBe('power');
    expect(entityCategory('rail-ramp')).toBe('rail');
    expect(entityCategory('copper-pipe')).toBe('pipe');
  });

  it('prefers exact matches over fallback substring matches', () => {
    // 'heat-pipe' contains 'pipe' but is exactly a power entity.
    expect(entityCategory('heat-pipe')).toBe('power');
    // 'pumpjack' is exactly a machine.
    expect(entityCategory('pumpjack')).toBe('machine');
  });
});

describe('buildBlueprintPreview', () => {
  it('unions entity boxes and tile cells into one bounding box', () => {
    const model = buildBlueprintPreview(decoded.blueprint);
    // Hand-computed from the fixture page:
    // - transport-belt at (0.5, 0.5): 1×1 box → tile (0, 0)
    // - assembling-machine-1 at (5, 2): 3×3 box [3.5, 6.5]² → tiles 4–6 / rows 1–3
    // - assembling-machine-1 at (8, 2): box right edge 9.5 → tiles 7–9
    // - mystery-thing at (10.5, 3.5): unknown → 1×1 box ±0.5 → tile (10, 3)
    // - tiles at x 0, 1, 2 on row 0 → cells [x, x+1)
    // Union: x tiles 0–10, y tiles 0–3.
    expect(model.minX).toBe(0);
    expect(model.minY).toBe(0);
    expect(model.widthTiles).toBe(11);
    expect(model.heightTiles).toBe(4);
    expect(model.entityCount).toBe(4);
    expect(model.tileCount).toBe(3);
    expect(model.truncated).toBe(false);
  });

  it('orders entities by entity_number and normalizes directions', () => {
    const model = buildBlueprintPreview(decoded.blueprint);
    expect(model.entities.map((e) => e.name)).toEqual([
      'transport-belt',
      'assembling-machine-1',
      'assembling-machine-1',
      'mystery-thing',
    ]);
    expect(model.entities[0]).toEqual({
      name: 'transport-belt',
      category: 'belt',
      x: 0.5,
      y: 0.5,
      w: 1,
      h: 1,
      direction: 2,
    });
    // The fixture's first assembler has no direction → 0.
    expect(model.entities[1]).toMatchObject({ category: 'machine', w: 3, h: 3, direction: 0 });
    expect(model.entities[2]).toMatchObject({ direction: 4 });
    expect(model.entities[3]).toMatchObject({ category: 'other', w: 1, h: 1, direction: 0 });
  });

  it('orders tiles by y then x', () => {
    const model = buildBlueprintPreview(
      blueprint([], [tile('a', 2, 1), tile('b', 0, 0), tile('c', 1, 0), tile('d', 0, 1)]),
    );
    expect(model.tiles.map((t) => [t.name, t.x, t.y])).toEqual([
      ['b', 0, 0],
      ['c', 1, 0],
      ['d', 0, 1],
      ['a', 2, 1],
    ]);
  });

  it('normalizes direction values into 0..7', () => {
    const model = buildBlueprintPreview(
      blueprint([
        entity(1, 'transport-belt', 0.5, 0.5, 8), // → 0
        entity(2, 'transport-belt', 1.5, 0.5, -1), // → 7
        entity(3, 'transport-belt', 2.5, 0.5), // absent → 0
      ]),
    );
    expect(model.entities.map((e) => e.direction)).toEqual([0, 7, 0]);
  });

  it('swaps splitter w/h with direction', () => {
    const north = buildBlueprintPreview(blueprint([entity(1, 'splitter', 1.5, 0.5, 0)]));
    expect(north.entities[0]).toMatchObject({ w: 2, h: 1, direction: 0 });
    const east = buildBlueprintPreview(blueprint([entity(1, 'splitter', 1.5, 0.5, 2)]));
    expect(east.entities[0]).toMatchObject({ w: 1, h: 2, direction: 2 });
  });

  it('unknown-size entities contribute a 1×1 box (position ± 0.5)', () => {
    const model = buildBlueprintPreview(blueprint([entity(1, 'mystery-thing', 10.5, 3.5)]));
    expect(model.entities[0]).toMatchObject({ w: 1, h: 1, category: 'other', direction: 0 });
    // Box [10, 11) × [3, 4) → exactly tile (10, 3).
    expect(model.minX).toBe(10);
    expect(model.minY).toBe(3);
    expect(model.widthTiles).toBe(1);
    expect(model.heightTiles).toBe(1);
  });

  it('tiles-only blueprint: bbox from tile cells exactly ([x, x+1))', () => {
    const model = buildBlueprintPreview(
      blueprint([], [tile('landfill', 2, 3), tile('landfill', 5, 3)]),
    );
    expect(model.minX).toBe(2);
    expect(model.minY).toBe(3);
    expect(model.widthTiles).toBe(4); // cells [2,3) … [5,6)
    expect(model.heightTiles).toBe(1);
    expect(model.entityCount).toBe(0);
    expect(model.tileCount).toBe(2);
    expect(model.truncated).toBe(false);
  });

  it('tiles can extend the bounding box past the entities', () => {
    const model = buildBlueprintPreview(
      blueprint([entity(1, 'transport-belt', 0.5, 0.5)], [tile('landfill', 5, 0)]),
    );
    // Belt covers tile 0; the tile at x = 5 covers cell [5, 6) → tile 5.
    expect(model.minX).toBe(0);
    expect(model.widthTiles).toBe(6);
    expect(model.heightTiles).toBe(1);
  });

  it('empty blueprint → zero-size model', () => {
    const model = buildBlueprintPreview(blueprint([], []));
    expect(model).toEqual({
      entities: [],
      tiles: [],
      minX: 0,
      minY: 0,
      widthTiles: 0,
      heightTiles: 0,
      entityCount: 0,
      tileCount: 0,
      truncated: false,
    });
  });

  it('truncates entities past the cap but reports true totals', () => {
    const total = PREVIEW_MAX_ENTITIES + 5;
    const model = buildBlueprintPreview(blueprint(beltLine(total)));
    expect(model.entities).toHaveLength(PREVIEW_MAX_ENTITIES);
    expect(model.entityCount).toBe(total);
    expect(model.truncated).toBe(true);
    // The first PREVIEW_MAX_ENTITIES in entity_number order are kept.
    expect(model.entities[0].x).toBe(0.5);
    expect(model.entities[PREVIEW_MAX_ENTITIES - 1].x).toBe(PREVIEW_MAX_ENTITIES - 0.5);
    // The box describes exactly the kept entities (tiles 0…2999).
    expect(model.minX).toBe(0);
    expect(model.widthTiles).toBe(PREVIEW_MAX_ENTITIES);
  });

  it('truncates tiles past the cap but reports true totals', () => {
    const total = PREVIEW_MAX_TILES + 5;
    const model = buildBlueprintPreview(blueprint([], tileRow(total)));
    expect(model.tiles).toHaveLength(PREVIEW_MAX_TILES);
    expect(model.tileCount).toBe(total);
    expect(model.truncated).toBe(true);
    expect(model.tiles[0].x).toBe(0);
    expect(model.tiles[PREVIEW_MAX_TILES - 1].x).toBe(PREVIEW_MAX_TILES - 1);
    expect(model.widthTiles).toBe(PREVIEW_MAX_TILES);
  });

  it('reports exactly-at-cap lists as not truncated', () => {
    const model = buildBlueprintPreview(
      blueprint(beltLine(PREVIEW_MAX_ENTITIES), tileRow(PREVIEW_MAX_TILES)),
    );
    expect(model.truncated).toBe(false);
    expect(model.entityCount).toBe(PREVIEW_MAX_ENTITIES);
    expect(model.tileCount).toBe(PREVIEW_MAX_TILES);
  });

  it('never mutates the input blueprint (sorting works on copies)', () => {
    const page = blueprint([
      entity(3, 'transport-belt', 5.5, 0.5, 2),
      entity(1, 'transport-belt', 0.5, 0.5),
      entity(2, 'splitter', 2.5, 0.5, 6),
    ]);
    const snapshot = JSON.stringify(page);
    const model = buildBlueprintPreview(page);
    expect(JSON.stringify(page)).toBe(snapshot);
    // Entities follow entity_number order regardless of input order.
    expect(model.entities.map((e) => e.name)).toEqual([
      'transport-belt',
      'splitter',
      'transport-belt',
    ]);
  });
});
