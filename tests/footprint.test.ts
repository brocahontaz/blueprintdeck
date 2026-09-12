import { describe, expect, it } from 'vitest';
import type { BlueprintJson } from '../src/blueprint/decode';
import { computeFootprint, formatFootprintCaveat } from '../src/blueprint/footprint';

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

describe('computeFootprint', () => {
  it('covers the right tile for a 1×1 entity on a half-tile center', () => {
    const result = computeFootprint(blueprint([entity(1, 'transport-belt', 5.5, 1.5)]));
    expect(result.minTileX).toBe(5);
    expect(result.maxTileX).toBe(5);
    expect(result.minTileY).toBe(1);
    expect(result.maxTileY).toBe(1);
    expect(result).toMatchObject({ widthTiles: 1, heightTiles: 1, area: 1, knownCount: 1 });
    expect(result.positionsOnly).toBe(false);
  });

  it('covers tiles 4–6 for a 3×3 entity on an integer center', () => {
    const result = computeFootprint(blueprint([entity(1, 'assembling-machine-1', 5, 2)]));
    expect(result.minTileX).toBe(4);
    expect(result.maxTileX).toBe(6);
    expect(result.minTileY).toBe(1);
    expect(result.maxTileY).toBe(3);
    expect(result).toMatchObject({ widthTiles: 3, heightTiles: 3, area: 9 });
  });

  it('places even-sized entities on integer centers', () => {
    const result = computeFootprint(blueprint([entity(1, 'stone-furnace', 0, 0)]));
    expect(result.minTileX).toBe(-1);
    expect(result.maxTileX).toBe(0);
    expect(result.widthTiles).toBe(2);
  });

  it('unions mixed sizes and counts known/approx/unknown entities', () => {
    const result = computeFootprint(
      blueprint([
        entity(1, 'transport-belt', 0.5, 0.5),
        entity(2, 'assembling-machine-1', 5, 2),
        entity(3, 'assembling-machine-1', 8, 2),
        entity(4, 'mystery-thing', 10.5, 3.5),
      ]),
    );
    expect(result.minTileX).toBe(0);
    expect(result.maxTileX).toBe(9);
    expect(result.minTileY).toBe(0);
    expect(result.maxTileY).toBe(3);
    expect(result.widthTiles).toBe(10);
    expect(result.heightTiles).toBe(4);
    expect(result.area).toBe(40);
    expect(result.knownCount).toBe(3);
    expect(result.approxCount).toBe(0);
    expect(result.unknownCount).toBe(1);
    expect(result.positionsOnly).toBe(false);
  });

  it('handles direction-aware approx sizes', () => {
    const north = computeFootprint(blueprint([entity(1, 'splitter', 1.5, 0.5, 0)]));
    expect([north.widthTiles, north.heightTiles]).toEqual([2, 1]);
    const east = computeFootprint(blueprint([entity(1, 'splitter', 0.5, 1.5, 2)]));
    expect([east.widthTiles, east.heightTiles]).toEqual([1, 2]);
    expect(north.approxCount).toBe(1);
  });

  it('falls back to a positions-only box when all sizes are unknown', () => {
    const result = computeFootprint(
      blueprint([entity(1, 'mystery-a', 3, 4), entity(2, 'mystery-b', 10, 7)]),
    );
    expect(result).toMatchObject({
      widthTiles: 8,
      heightTiles: 4,
      area: 32,
      unknownCount: 2,
      positionsOnly: true,
    });
    expect(result.minTileX).toBe(3);
    expect(result.maxTileX).toBe(10);
  });

  it('falls back to tiles when there are no entities', () => {
    const result = computeFootprint(
      blueprint(
        [],
        [
          { name: 'landfill', position: { x: 2, y: 3 } },
          { name: 'landfill', position: { x: 5, y: 3 } },
        ],
      ),
    );
    expect(result).toMatchObject({
      widthTiles: 4,
      heightTiles: 1,
      area: 4,
      positionsOnly: true,
    });
  });

  it('returns an empty result for empty blueprints', () => {
    const result = computeFootprint(blueprint([]));
    expect(result).toMatchObject({
      widthTiles: 0,
      heightTiles: 0,
      area: 0,
      positionsOnly: true,
      knownCount: 0,
      approxCount: 0,
      unknownCount: 0,
    });
  });
});

describe('formatFootprintCaveat', () => {
  it('explains the empty case', () => {
    expect(formatFootprintCaveat(computeFootprint(blueprint([])))).toBe('No entities to measure.');
  });

  it('explains the positions-only fallback', () => {
    const result = computeFootprint(blueprint([entity(1, 'mystery-a', 3, 4)]));
    expect(formatFootprintCaveat(result)).toBe(
      'Positions-only estimate — no known or approximate entity sizes.',
    );
  });

  it('counts approximate and unknown sizes', () => {
    const result = computeFootprint(
      blueprint([
        entity(1, 'steam-engine', 1.5, 1.5),
        entity(2, 'mystery-a', 20, 20),
        entity(3, 'mystery-b', 21, 20),
      ]),
    );
    expect(formatFootprintCaveat(result)).toBe(
      'Includes 1 approximate size estimate and 2 unknown (assumed 1×1).',
    );
  });

  it('reports all-known datasets', () => {
    const result = computeFootprint(blueprint([entity(1, 'transport-belt', 0.5, 0.5)]));
    expect(formatFootprintCaveat(result)).toBe('All entity sizes are known.');
  });
});
