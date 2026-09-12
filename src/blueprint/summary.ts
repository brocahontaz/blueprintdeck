import type { BlueprintJson, BlueprintTile } from './decode';
import { getEntitySize } from './sizes';

/**
 * Group blueprint entities into searchable summary rows.
 */

/** Factorio direction values 0..7, clockwise from north. */
export const DIRECTION_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function directionLabel(direction: number): string {
  const normalized = ((Math.trunc(direction) % 8) + 8) % 8;
  return DIRECTION_LABELS[normalized] ?? 'N';
}

/**
 * The most common direction across a row's direction tallies, so
 * direction-dependent sizes can be shown at the orientation the row actually
 * uses. Count ties break toward the lowest direction number; rows without any
 * tallies fall back to 0 (north).
 */
export function dominantDirection(row: EntitySummaryRow): number {
  let best = 0;
  let bestCount = 0;
  for (const tally of row.directions) {
    if (tally.count > bestCount) {
      best = tally.direction;
      bestCount = tally.count;
    }
  }
  return best;
}

export interface DirectionTally {
  direction: number;
  label: string;
  count: number;
}

export interface RecipeTally {
  recipe: string;
  count: number;
}

/** Aggregated chest inventory contents across a row's entities. */
export interface InventoryTally {
  item: string;
  count: number;
}

/** Aggregated module tallies across a row's entities. */
export interface ModuleTally {
  module: string;
  count: number;
}

export interface EntitySummaryRow {
  name: string;
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  directions: DirectionTally[];
  /**
   * Human-readable notes, e.g. "electronic-circuit ×12" per recipe, plus
   * quality, chest contents, module and settings notes when present.
   */
  notes: string[];
  recipes: RecipeTally[];
  /** Distinct quality tiers across the row's entities, sorted asc. */
  qualities: string[];
  /** Chest contents aggregated item × count across the row's entities. */
  inventory: InventoryTally[];
  /** Module tallies aggregated across the row's entities. */
  modules: ModuleTally[];
  /** Compact settings entries across the row's entities, deduped, sorted asc. */
  settings: string[];
}

export interface SummaryTotals {
  entityCount: number;
  entityTypes: number;
  tileCount: number;
  tileTypes: number;
}

export interface BlueprintSummary {
  rows: EntitySummaryRow[];
  /** Per-name tile counts, sorted count desc then name asc. */
  tiles: TileTally[];
  totals: SummaryTotals;
}

export interface TileTally {
  name: string;
  count: number;
}

interface MutableRow {
  name: string;
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  directions: Map<number, number>;
  recipes: Map<string, number>;
  qualities: Set<string>;
  inventory: Map<string, number>;
  modules: Map<string, number>;
  settings: Set<string>;
}

/** Summarize a blueprint's entities and tiles into grouped rows and totals. */
export function summarizeBlueprint(blueprint: BlueprintJson): BlueprintSummary {
  const groups = new Map<string, MutableRow>();
  let entityCount = 0;

  for (const entity of blueprint.entities) {
    entityCount += 1;
    let row = groups.get(entity.name);
    if (!row) {
      row = {
        name: entity.name,
        count: 0,
        minX: entity.position.x,
        maxX: entity.position.x,
        minY: entity.position.y,
        maxY: entity.position.y,
        directions: new Map(),
        recipes: new Map(),
        qualities: new Set(),
        inventory: new Map(),
        modules: new Map(),
        settings: new Set(),
      };
      groups.set(entity.name, row);
    }
    row.count += 1;
    row.minX = Math.min(row.minX, entity.position.x);
    row.maxX = Math.max(row.maxX, entity.position.x);
    row.minY = Math.min(row.minY, entity.position.y);
    row.maxY = Math.max(row.maxY, entity.position.y);
    const direction = Math.trunc(entity.direction ?? 0);
    row.directions.set(direction, (row.directions.get(direction) ?? 0) + 1);
    if (entity.recipe !== undefined) {
      row.recipes.set(entity.recipe, (row.recipes.get(entity.recipe) ?? 0) + 1);
    }
    if (entity.quality !== undefined) {
      row.qualities.add(entity.quality);
    }
    if (entity.inventory !== undefined) {
      // Each filled slot contributes one item occurrence; totals aggregate
      // across every slot and every entity of this type.
      for (const item of Object.values(entity.inventory)) {
        row.inventory.set(item, (row.inventory.get(item) ?? 0) + 1);
      }
    }
    if (entity.modules !== undefined) {
      for (const module of entity.modules) {
        row.modules.set(module, (row.modules.get(module) ?? 0) + 1);
      }
    }
    if (entity.settings !== undefined) {
      for (const [key, value] of Object.entries(entity.settings)) {
        row.settings.add(formatSettingEntry(key, value));
      }
    }
  }

  const rows: EntitySummaryRow[] = [...groups.values()]
    .map((row) => {
      const recipes: RecipeTally[] = [...row.recipes.entries()]
        .map(([recipe, count]) => ({ recipe, count }))
        .sort(compareRecipeTallies);
      const inventory: InventoryTally[] = [...row.inventory.entries()]
        .map(([item, count]) => ({ item, count }))
        .sort(compareItemTallies);
      const modules: ModuleTally[] = [...row.modules.entries()]
        .map(([module, count]) => ({ module, count }))
        .sort(compareModuleTallies);
      const qualities = [...row.qualities].sort(compareStrings);
      const settings = [...row.settings].sort(compareStrings);
      return {
        name: row.name,
        count: row.count,
        minX: row.minX,
        maxX: row.maxX,
        minY: row.minY,
        maxY: row.maxY,
        directions: [...row.directions.entries()]
          .map(([direction, count]) => ({
            direction,
            label: directionLabel(direction),
            count,
          }))
          .sort((a, b) => a.direction - b.direction),
        recipes,
        qualities,
        inventory,
        modules,
        settings,
        notes: [
          ...recipes.map((tally) => formatRecipeNote(tally.recipe, tally.count)),
          ...qualities.map(formatQualityNote),
          ...inventory.map((tally) => formatTallyNote(tally.item, tally.count)),
          ...modules.map((tally) => formatTallyNote(tally.module, tally.count)),
          ...settings,
        ],
      };
    })
    .sort(compareRows);

  const tiles = tallyTiles(blueprint.tiles);

  return {
    rows,
    tiles,
    totals: {
      entityCount,
      entityTypes: rows.length,
      tileCount: blueprint.tiles.length,
      tileTypes: tiles.length,
    },
  };
}

/** Count tile occurrences by name, sorted count desc then name asc. */
export function tallyTiles(tiles: BlueprintTile[]): TileTally[] {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    counts.set(tile.name, (counts.get(tile.name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort(compareTileTallies);
}

function compareTileTallies(a: TileTally, b: TileTally): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.name.localeCompare(b.name);
}

/** Case-insensitive substring filter over row names and notes. */
export function filterSummaryRows(rows: EntitySummaryRow[], query: string): EntitySummaryRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      row.notes.some((note) => note.toLowerCase().includes(needle)),
  );
}

export function formatRecipeNote(recipe: string, count: number): string {
  return formatTallyNote(recipe, count);
}

/** Note text for any named tally (chest contents, modules), e.g. "iron-plate ×3". */
export function formatTallyNote(name: string, count: number): string {
  return `${name} ×${count}`;
}

/** Note text for a quality tier, e.g. "quality: uncommon". */
export function formatQualityNote(quality: string): string {
  return `quality: ${quality}`;
}

/**
 * Compact textual rendering of one entity settings entry: the key plus its
 * value. Values are heterogeneous, so primitives render directly and nested
 * structures render as compact JSON — nothing meaningful is skipped.
 */
export function formatSettingEntry(key: string, value: unknown): string {
  return `${key}: ${formatSettingValue(value)}`;
}

function formatSettingValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    // Unserializable values cannot occur for JSON-decoded blueprints; stay safe.
    return '[unserializable]';
  }
}

/** Compact "x 5–8, y 2" style span for a summary row. */
export function formatPositionSpan(row: EntitySummaryRow): string {
  const formatAxis = (min: number, max: number): string =>
    min === max ? `${min}` : `${min}–${max}`;
  return `x ${formatAxis(row.minX, row.maxX)}, y ${formatAxis(row.minY, row.maxY)}`;
}

// ---------------------------------------------------------------------------
// Sortable row ordering
// ---------------------------------------------------------------------------

export type SummarySortKey = 'name' | 'count' | 'size' | 'position';
export type SortDirection = 'asc' | 'desc';

/**
 * Return the rows ordered by `key` in `direction`, as a NEW array; the input
 * is never mutated.
 *
 * Per key:
 * - 'name': alphabetical (localeCompare).
 * - 'count': numeric.
 * - 'size': approximate tile area (w × h from getEntitySize). Rows with
 *   unknown sizes always sort last regardless of direction. Ties break by
 *   width (ascending), then name.
 * - 'position': reading order (minY, then minX).
 *
 * Descending reverses only the primary comparison; tie-breakers stay
 * ascending by name (and by width for 'size').
 */
export function sortSummaryRows(
  rows: EntitySummaryRow[],
  key: SummarySortKey,
  direction: SortDirection,
): EntitySummaryRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => compareSummaryRows(a, b, key, direction));
  return sorted;
}

function compareSummaryRows(
  a: EntitySummaryRow,
  b: EntitySummaryRow,
  key: SummarySortKey,
  direction: SortDirection,
): number {
  // Descending reverses the primary comparison only, never the tie-breakers.
  const flip = direction === 'desc' ? -1 : 1;
  switch (key) {
    case 'name':
      return flip * a.name.localeCompare(b.name);
    case 'count':
      return flip * (a.count - b.count) || compareByTieBreak(a, b);
    case 'size':
      return compareBySize(a, b, flip);
    case 'position':
      if (a.minY !== b.minY) return flip * (a.minY - b.minY);
      if (a.minX !== b.minX) return flip * (a.minX - b.minX);
      return compareByTieBreak(a, b);
  }
}

/** Final tie-breaker for every key: name ascending. */
function compareByTieBreak(a: EntitySummaryRow, b: EntitySummaryRow): number {
  return a.name.localeCompare(b.name);
}

/**
 * Compare by approximate tile area. Unknown sizes always sort last regardless
 * of direction; equal areas break by width (ascending), then name.
 */
function compareBySize(a: EntitySummaryRow, b: EntitySummaryRow, flip: number): number {
  const sizeA = getEntitySize(a.name);
  const sizeB = getEntitySize(b.name);
  if (sizeA.unknown !== sizeB.unknown) return sizeA.unknown ? 1 : -1;
  if (sizeA.w * sizeA.h !== sizeB.w * sizeB.h) {
    return flip * (sizeA.w * sizeA.h - sizeB.w * sizeB.h);
  }
  if (sizeA.w !== sizeB.w) return sizeA.w - sizeB.w;
  return compareByTieBreak(a, b);
}

function compareRows(a: EntitySummaryRow, b: EntitySummaryRow): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.name.localeCompare(b.name);
}

function compareRecipeTallies(a: RecipeTally, b: RecipeTally): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.recipe.localeCompare(b.recipe);
}

function compareItemTallies(a: InventoryTally, b: InventoryTally): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.item.localeCompare(b.item);
}

function compareModuleTallies(a: ModuleTally, b: ModuleTally): number {
  if (b.count !== a.count) return b.count - a.count;
  return a.module.localeCompare(b.module);
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}
