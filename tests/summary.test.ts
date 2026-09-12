import { describe, expect, it } from 'vitest';
import { decodeBlueprint } from '../src/blueprint/decode';
import { formatEntitySize, getEntitySize } from '../src/blueprint/sizes';
import {
  directionLabel,
  dominantDirection,
  filterSummaryRows,
  formatPositionSpan,
  formatQualityNote,
  formatRecipeNote,
  formatSettingEntry,
  formatTallyNote,
  sortSummaryRows,
  summarizeBlueprint,
  tallyTiles,
  type EntitySummaryRow,
  type SortDirection,
  type SummarySortKey,
} from '../src/blueprint/summary';
import { encodeBlueprintString, singleBlueprintJson } from './fixtures';

const decoded = decodeBlueprint(encodeBlueprintString(singleBlueprintJson()));
if (decoded.kind !== 'blueprint') throw new Error('fixture must decode as a blueprint');
const summary = summarizeBlueprint(decoded.blueprint);

function row(name: string) {
  const found = summary.rows.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`expected a summary row for ${name}`);
  return found;
}

describe('summarizeBlueprint grouping', () => {
  it('groups entities by name with counts', () => {
    expect(summary.rows.map((r) => r.name)).toEqual([
      'assembling-machine-1',
      'mystery-thing',
      'transport-belt',
    ]);
    expect(row('assembling-machine-1').count).toBe(2);
    expect(row('transport-belt').count).toBe(1);
  });

  it('tracks min–max position spans', () => {
    const assembler = row('assembling-machine-1');
    expect(assembler.minX).toBe(5);
    expect(assembler.maxX).toBe(8);
    expect(assembler.minY).toBe(2);
    expect(assembler.maxY).toBe(2);
  });

  it('builds a direction histogram with implicit north and labels', () => {
    expect(row('assembling-machine-1').directions).toEqual([
      { direction: 0, label: 'N', count: 1 },
      { direction: 4, label: 'S', count: 1 },
    ]);
    expect(row('transport-belt').directions).toEqual([{ direction: 2, label: 'E', count: 1 }]);
  });

  it('notes recipe breakdowns', () => {
    const assembler = row('assembling-machine-1');
    expect(assembler.recipes).toEqual([{ recipe: 'electronic-circuit', count: 2 }]);
    expect(assembler.notes).toEqual(['electronic-circuit ×2']);
    expect(row('transport-belt').notes).toEqual([]);
  });

  it('reports totals for entities and tiles', () => {
    expect(summary.totals).toEqual({
      entityCount: 4,
      entityTypes: 3,
      tileCount: 3,
      tileTypes: 2,
    });
  });

  it('includes tile tallies sorted count desc then name asc', () => {
    expect(summary.tiles).toEqual([
      { name: 'refined-concrete', count: 2 },
      { name: 'stone-path', count: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Per-entity attributes: quality, chest inventory, modules, settings
// ---------------------------------------------------------------------------

function summarizeEntities(entities: unknown[]): EntitySummaryRow[] {
  const decoded = decodeBlueprint(
    encodeBlueprintString({ blueprint: { item: 'blueprint', entities } }),
  );
  if (decoded.kind !== 'blueprint') throw new Error('fixture must decode as a blueprint');
  return summarizeBlueprint(decoded.blueprint).rows;
}

function rowByName(rows: EntitySummaryRow[], name: string): EntitySummaryRow {
  const found = rows.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`expected a summary row for ${name}`);
  return found;
}

describe('per-entity attribute tallies', () => {
  const rows = summarizeEntities([
    {
      entity_number: 1,
      name: 'iron-chest',
      position: { x: 0, y: 0 },
      quality: 'uncommon',
      inventory: { '1': 'iron-plate', '2': 'copper-cable' },
      modules: ['speed-module'],
    },
    {
      entity_number: 2,
      name: 'iron-chest',
      position: { x: 1, y: 0 },
      quality: 'common',
      inventory: { '1': 'iron-plate' },
      settings: { filter: 'iron-ore', min_deliver: 5, enabled: true },
    },
    {
      entity_number: 3,
      name: 'decider-combinator',
      position: { x: 5, y: 0 },
      settings: { conditions: [{ compare_type: 'or', constant: 7 }], output_signal: null },
    },
    { entity_number: 4, name: 'transport-belt', position: { x: 9, y: 0 } },
  ]);
  const chest = rowByName(rows, 'iron-chest');
  const combinator = rowByName(rows, 'decider-combinator');
  const belt = rowByName(rows, 'transport-belt');

  it('collects distinct qualities sorted asc', () => {
    expect(chest.qualities).toEqual(['common', 'uncommon']);
    expect(combinator.qualities).toEqual([]);
    expect(belt.qualities).toEqual([]);
  });

  it('aggregates chest inventory item counts across entities of a type', () => {
    expect(chest.inventory).toEqual([
      { item: 'iron-plate', count: 2 },
      { item: 'copper-cable', count: 1 },
    ]);
    expect(combinator.inventory).toEqual([]);
    expect(belt.inventory).toEqual([]);
  });

  it('aggregates module tallies across entities of a type', () => {
    expect(chest.modules).toEqual([{ module: 'speed-module', count: 1 }]);
    expect(combinator.modules).toEqual([]);
    expect(belt.modules).toEqual([]);
  });

  it('formats settings entries textually, including non-primitive values', () => {
    expect(chest.settings).toEqual(['enabled: true', 'filter: iron-ore', 'min_deliver: 5']);
    expect(combinator.settings).toEqual([
      'conditions: [{"compare_type":"or","constant":7}]',
      'output_signal: null',
    ]);
    expect(belt.settings).toEqual([]);
  });

  it('folds the new attributes into notes in a stable order', () => {
    expect(chest.notes).toEqual([
      'quality: common',
      'quality: uncommon',
      'iron-plate ×2',
      'copper-cable ×1',
      'speed-module ×1',
      'enabled: true',
      'filter: iron-ore',
      'min_deliver: 5',
    ]);
    expect(combinator.notes).toEqual([
      'conditions: [{"compare_type":"or","constant":7}]',
      'output_signal: null',
    ]);
    expect(belt.notes).toEqual([]);
  });

  it('keeps the new attributes searchable through the existing notes filter', () => {
    expect(filterSummaryRows(rows, 'SPEED-MODULE')).toEqual([chest]);
    expect(filterSummaryRows(rows, 'uncommon').map((row) => row.name)).toEqual(['iron-chest']);
    expect(filterSummaryRows(rows, 'iron-ore').map((row) => row.name)).toEqual(['iron-chest']);
    expect(filterSummaryRows(rows, 'iron-plate').map((row) => row.name)).toEqual(['iron-chest']);
  });
});

describe('filterSummaryRows', () => {
  it('matches names case-insensitively', () => {
    expect(filterSummaryRows(summary.rows, 'ASSEM')).toHaveLength(1);
    expect(filterSummaryRows(summary.rows, 'assembling-machine-1')[0]?.name).toBe(
      'assembling-machine-1',
    );
  });

  it('matches notes case-insensitively', () => {
    expect(filterSummaryRows(summary.rows, 'ELECTRONIC-CIRCUIT')).toHaveLength(1);
    expect(filterSummaryRows(summary.rows, 'electronic-circuit')[0]?.name).toBe(
      'assembling-machine-1',
    );
  });

  it('returns everything for blank queries and nothing for misses', () => {
    expect(filterSummaryRows(summary.rows, '  ')).toHaveLength(3);
    expect(filterSummaryRows(summary.rows, 'no-such-entity')).toHaveLength(0);
  });
});

describe('formatting helpers', () => {
  it('maps direction numbers 0..7 clockwise', () => {
    expect(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((_, i) => directionLabel(i))).toEqual([
      'N',
      'NE',
      'E',
      'SE',
      'S',
      'SW',
      'W',
      'NW',
    ]);
    expect(directionLabel(8)).toBe('N');
    expect(directionLabel(-1)).toBe('NW');
  });

  it('formats spans compactly', () => {
    expect(formatPositionSpan(row('assembling-machine-1'))).toBe('x 5–8, y 2');
    expect(formatPositionSpan(row('mystery-thing'))).toBe('x 10.5, y 3.5');
  });

  it('formats recipe notes with a multiplication sign', () => {
    expect(formatRecipeNote('electronic-circuit', 12)).toBe('electronic-circuit ×12');
  });

  it('formats tally, quality and settings notes', () => {
    expect(formatTallyNote('iron-plate', 3)).toBe('iron-plate ×3');
    expect(formatQualityNote('legendary')).toBe('quality: legendary');
    expect(formatSettingEntry('filter', 'iron-ore')).toBe('filter: iron-ore');
    expect(formatSettingEntry('min', 5)).toBe('min: 5');
    expect(formatSettingEntry('enabled', false)).toBe('enabled: false');
    expect(formatSettingEntry('output', null)).toBe('output: null');
    expect(formatSettingEntry('conditions', [{ constant: 7 }])).toBe(
      'conditions: [{"constant":7}]',
    );
  });
});

// ---------------------------------------------------------------------------
// sortSummaryRows
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<EntitySummaryRow> & { name: string }): EntitySummaryRow {
  return {
    count: 1,
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
    directions: [],
    notes: [],
    recipes: [],
    qualities: [],
    inventory: [],
    modules: [],
    settings: [],
    ...overrides,
  };
}

function names(rows: EntitySummaryRow[]): string[] {
  return rows.map((row) => row.name);
}

describe('sortSummaryRows', () => {
  it('sorts by name with localeCompare in both directions', () => {
    const rows = [makeRow({ name: 'radar' }), makeRow({ name: 'lamp' }), makeRow({ name: 'belt' })];
    expect(names(sortSummaryRows(rows, 'name', 'asc'))).toEqual(['belt', 'lamp', 'radar']);
    expect(names(sortSummaryRows(rows, 'name', 'desc'))).toEqual(['radar', 'lamp', 'belt']);
  });

  it('sorts by count numerically, breaking count ties by name asc in both directions', () => {
    const rows = [
      makeRow({ name: 'lamp', count: 2 }),
      makeRow({ name: 'radar', count: 5 }),
      makeRow({ name: 'iron-chest', count: 2 }),
      makeRow({ name: 'belt', count: 1 }),
    ];
    expect(names(sortSummaryRows(rows, 'count', 'asc'))).toEqual([
      'belt',
      'iron-chest',
      'lamp',
      'radar',
    ]);
    // Desc reverses the count only: the iron-chest/lamp tie stays name asc.
    expect(names(sortSummaryRows(rows, 'count', 'desc'))).toEqual([
      'radar',
      'iron-chest',
      'lamp',
      'belt',
    ]);
  });

  it('sorts by approximate tile area, always placing unknown sizes last', () => {
    const rows = [
      makeRow({ name: 'mystery-thing' }), // unknown → 1×1?
      makeRow({ name: 'roboport' }), // 4×4 = 16
      makeRow({ name: 'storage-tank' }), // 3×3 = 9
      makeRow({ name: 'splitter' }), // 2×1 = 2
      makeRow({ name: 'transport-belt' }), // 1×1 = 1
    ];
    expect(names(sortSummaryRows(rows, 'size', 'asc'))).toEqual([
      'transport-belt',
      'splitter',
      'storage-tank',
      'roboport',
      'mystery-thing',
    ]);
    // Desc reverses the area only: unknown sizes still sort last.
    expect(names(sortSummaryRows(rows, 'size', 'desc'))).toEqual([
      'roboport',
      'storage-tank',
      'splitter',
      'transport-belt',
      'mystery-thing',
    ]);
  });

  it('breaks equal areas by width asc, then name, regardless of direction', () => {
    const rows = [
      makeRow({ name: 'splitter' }), // 2×1 = 2, w 2
      makeRow({ name: 'straight-rail' }), // 1×2 = 2, w 1
      makeRow({ name: 'storage-tank' }), // 3×3 = 9
    ];
    expect(names(sortSummaryRows(rows, 'size', 'asc'))).toEqual([
      'straight-rail',
      'splitter',
      'storage-tank',
    ]);
    expect(names(sortSummaryRows(rows, 'size', 'desc'))).toEqual([
      'storage-tank',
      'straight-rail',
      'splitter',
    ]);
  });

  it('sorts by position in reading order, reversing both axes for desc', () => {
    const rows = [
      makeRow({ name: 'c', minY: 1, minX: 9 }),
      makeRow({ name: 'a', minY: 0, minX: 5 }),
      makeRow({ name: 'b', minY: 0, minX: 2 }),
    ];
    expect(names(sortSummaryRows(rows, 'position', 'asc'))).toEqual(['b', 'a', 'c']);
    expect(names(sortSummaryRows(rows, 'position', 'desc'))).toEqual(['c', 'a', 'b']);
  });

  it('breaks position ties by name asc in both directions', () => {
    const rows = [
      makeRow({ name: 'zeta', minY: 3, minX: 0 }),
      makeRow({ name: 'alpha', minY: 3, minX: 0 }),
    ];
    expect(names(sortSummaryRows(rows, 'position', 'asc'))).toEqual(['alpha', 'zeta']);
    expect(names(sortSummaryRows(rows, 'position', 'desc'))).toEqual(['alpha', 'zeta']);
  });

  it('breaks size ties among unknown entities by name asc', () => {
    const rows = [makeRow({ name: 'zeta-box' }), makeRow({ name: 'alpha-box' })];
    expect(names(sortSummaryRows(rows, 'size', 'asc'))).toEqual(['alpha-box', 'zeta-box']);
    expect(names(sortSummaryRows(rows, 'size', 'desc'))).toEqual(['alpha-box', 'zeta-box']);
  });

  it('returns a new array and never mutates the input', () => {
    const rows = [makeRow({ name: 'b' }), makeRow({ name: 'a', count: 7 })];
    const snapshot = [...rows];
    const sorted = sortSummaryRows(rows, 'name', 'asc');
    expect(sorted).not.toBe(rows);
    expect(rows).toEqual(snapshot);
    expect(names(sorted)).toEqual(['a', 'b']);
    // The rows themselves are the same objects, not copies.
    expect(sorted[1]).toBe(rows[0]);
  });

  it('covers every supported key/direction combination without surprises', () => {
    const rows = [
      makeRow({ name: 'lamp', count: 2, minY: 0, minX: 0 }),
      makeRow({ name: 'radar', count: 1, minY: 0, minX: 4 }),
    ];
    const keys: SummarySortKey[] = ['name', 'count', 'size', 'position'];
    const directions: SortDirection[] = ['asc', 'desc'];
    for (const key of keys) {
      for (const direction of directions) {
        const sorted = sortSummaryRows(rows, key, direction);
        expect(sorted).toHaveLength(2);
        expect(sorted.every((row) => rows.includes(row))).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// dominantDirection (direction-aware size rendering)
// ---------------------------------------------------------------------------

describe('dominantDirection', () => {
  it('returns the most common direction in a row', () => {
    const row = makeRow({
      name: 'splitter',
      directions: [
        { direction: 0, label: 'N', count: 1 },
        { direction: 2, label: 'E', count: 3 },
      ],
    });
    expect(dominantDirection(row)).toBe(2);
  });

  it('breaks count ties toward the lowest direction number', () => {
    const row = makeRow({
      name: 'splitter',
      directions: [
        { direction: 2, label: 'E', count: 2 },
        { direction: 4, label: 'S', count: 2 },
      ],
    });
    expect(dominantDirection(row)).toBe(2);
  });

  it('falls back to 0 for rows without direction tallies', () => {
    expect(dominantDirection(makeRow({ name: 'lamp' }))).toBe(0);
  });

  it('yields a swapped, direction-aware size at the dominant direction', () => {
    const document = {
      blueprint: {
        item: 'blueprint',
        label: 'Splitter farm',
        entities: [
          { entity_number: 1, name: 'splitter', position: { x: 0, y: 0 } },
          { entity_number: 2, name: 'splitter', position: { x: 2, y: 2 }, direction: 2 },
          { entity_number: 3, name: 'splitter', position: { x: 4, y: 4 }, direction: 2 },
        ],
      },
    };
    const decoded = decodeBlueprint(encodeBlueprintString(document));
    if (decoded.kind !== 'blueprint') throw new Error('fixture must decode as a blueprint');
    const found = summarizeBlueprint(decoded.blueprint).rows.find(
      (candidate) => candidate.name === 'splitter',
    );
    if (!found) throw new Error('expected a splitter row');
    // Two splitters face east (2) and one north (0): the dominant direction
    // is 2, at which splitters swap to 1×2 instead of the 2×1 north size.
    expect(dominantDirection(found)).toBe(2);
    expect(formatEntitySize(getEntitySize(found.name, dominantDirection(found)))).toBe('≈1×2');
    expect(formatEntitySize(getEntitySize(found.name))).toBe('≈2×1');
  });
});

describe('tallyTiles', () => {
  it('counts tiles per name', () => {
    const tiles = [
      { name: 'stone-path', position: { x: 0, y: 0 } },
      { name: 'refined-concrete', position: { x: 1, y: 0 } },
      { name: 'refined-concrete', position: { x: 2, y: 0 } },
      { name: 'stone-path', position: { x: 3, y: 0 } },
      { name: 'refined-concrete', position: { x: 4, y: 0 } },
    ];
    expect(tallyTiles(tiles)).toEqual([
      { name: 'refined-concrete', count: 3 },
      { name: 'stone-path', count: 2 },
    ]);
  });

  it('breaks count ties by name asc', () => {
    const tiles = [
      { name: 'b-tile', position: { x: 0, y: 0 } },
      { name: 'a-tile', position: { x: 1, y: 0 } },
    ];
    expect(tallyTiles(tiles)).toEqual([
      { name: 'a-tile', count: 1 },
      { name: 'b-tile', count: 1 },
    ]);
  });

  it('returns an empty array for an empty tile list', () => {
    expect(tallyTiles([])).toEqual([]);
  });
});
