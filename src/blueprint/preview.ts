import type { BlueprintJson, BlueprintTile } from './decode';
import { getEntitySize } from './sizes';

/**
 * Render model for the symbolic 2D grid preview (see src/ui).
 *
 * Coordinate conventions, matching the blueprint string format:
 * - Entity positions are tile-center coordinates; the preview draws each
 *   entity as a w×h tile rectangle centered on (x, y).
 * - Tile positions are tile-corner coordinates: the tile at {x, y} covers the
 *   cell [x, x+1) × [y, y+1).
 *
 * The bounding box is the union of every entity box ([x−w/2, x+w/2), reduced
 * to covered tiles with footprint.ts's epsilon-guarded ceil(min)…
 * ceil(max)−1 rule) and every tile cell, over the entities and tiles that
 * made it into the model (post-truncation), so the box always describes
 * exactly what the preview will draw.
 */

/** Coarse bucket used by the preview to pick a symbol per entity. */
export type EntityCategory =
  'belt' | 'inserter' | 'machine' | 'storage' | 'power' | 'rail' | 'pipe' | 'other';

export interface PreviewEntity {
  name: string;
  category: EntityCategory;
  /** Center in tile coordinates. */
  x: number;
  y: number;
  /** Footprint in tiles (orientation-aware, from getEntitySize). */
  w: number;
  h: number;
  /** Normalized direction 0..7 (absent direction → 0). */
  direction: number;
}

export interface PreviewTile {
  name: string;
  /** Tile-corner coordinates (same as blueprint JSON). */
  x: number;
  y: number;
}

export interface BlueprintPreviewModel {
  entities: PreviewEntity[];
  tiles: PreviewTile[];
  /** Bounding box in tile coordinates covering all modelled entities and tiles. */
  minX: number;
  minY: number;
  widthTiles: number;
  heightTiles: number;
  /** True totals, even when the lists above were truncated. */
  entityCount: number;
  tileCount: number;
  /** True when either list was cut to its cap. */
  truncated: boolean;
}

/**
 * Hard caps that keep huge blueprints renderable: when a list exceeds its
 * cap, the first N items in sorted order are kept and `truncated` is set.
 */
export const PREVIEW_MAX_ENTITIES = 3000;
export const PREVIEW_MAX_TILES = 8000;

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------

/**
 * Exact prototype names per category, checked before the fallback pass.
 * Wildcard families from the game (assembling-machine-*, logistic-chest-*,
 * *-underground-belt, *-loader, *-electric-pole) are deliberately not
 * enumerated here — the prefix fallback below covers them.
 */
const CATEGORY_NAMES: ReadonlyArray<readonly [EntityCategory, readonly string[]]> = [
  [
    'belt',
    ['transport-belt', 'fast-transport-belt', 'express-transport-belt', 'turbo-transport-belt'],
  ],
  [
    'inserter',
    [
      'burner-inserter',
      'long-handed-inserter',
      'fast-inserter',
      'filter-inserter',
      'stack-inserter',
      'bulk-inserter',
    ],
  ],
  [
    'machine',
    [
      'oil-refinery',
      'chemical-plant',
      'centrifuge',
      'electric-mining-drill',
      'burner-mining-drill',
      'stone-furnace',
      'steel-furnace',
      'electric-furnace',
      'lab',
      'radar',
      'rocket-silo',
      'beacon',
      'pumpjack',
      'foundry',
      'biochamber',
      'electromagnetic-plant',
      'cryogenic-plant',
      'crusher',
      'recycler',
    ],
  ],
  ['storage', ['wooden-chest', 'iron-chest', 'steel-chest', 'storage-tank', 'cargo-landing-pad']],
  [
    'power',
    [
      'substation',
      'power-switch',
      'accumulator',
      'solar-panel',
      'nuclear-reactor',
      'boiler',
      'steam-engine',
      'steam-turbine',
      'heat-exchanger',
      'heat-pipe',
      'lamp',
    ],
  ],
  [
    'rail',
    [
      'straight-rail',
      'curved-rail',
      'train-stop',
      'rail-signal',
      'rail-chain-signal',
      'locomotive',
      'cargo-wagon',
      'fluid-wagon',
      'artillery-wagon',
    ],
  ],
  ['pipe', ['pipe', 'pipe-to-ground', 'pump', 'offshore-pump']],
];

const EXACT_CATEGORY: ReadonlyMap<string, EntityCategory> = new Map(
  CATEGORY_NAMES.flatMap(([category, names]) =>
    names.map((name): [string, EntityCategory] => [name, category]),
  ),
);

/**
 * Ordered fallback rules for prototype names missing from the exact table;
 * the first match wins and anything unmatched is 'other'.
 */
const CATEGORY_FALLBACKS: ReadonlyArray<
  readonly [match: (name: string) => boolean, category: EntityCategory]
> = [
  // Anything containing 'belt' (e.g. *-underground-belt, modded belt tiers).
  [(name) => name.includes('belt'), 'belt'],
  // Loaders: 'loader', 'fast-loader', 'express-loader', 'loader-1x1', …
  [(name) => name.startsWith('loader') || name.endsWith('-loader'), 'belt'],
  [(name) => name.includes('inserter'), 'inserter'],
  [(name) => name.startsWith('assembling-machine'), 'machine'],
  [(name) => name.startsWith('logistic-chest'), 'storage'],
  [(name) => name.endsWith('-electric-pole'), 'power'],
  [(name) => name.includes('rail'), 'rail'],
  [(name) => name.includes('pipe'), 'pipe'],
];

/**
 * Map a prototype name to its preview category: exact table first, then the
 * ordered fallback pass, then 'other' for unknown names. Exact matches beat
 * fallbacks, so e.g. 'heat-pipe' stays 'power' despite containing 'pipe'.
 */
export function entityCategory(name: string): EntityCategory {
  const exact = EXACT_CATEGORY.get(name);
  if (exact) return exact;
  for (const [match, category] of CATEGORY_FALLBACKS) {
    if (match(name)) return category;
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Preview model
// ---------------------------------------------------------------------------

/** Normalize a raw blueprint direction (absent → 0) into 0..7. */
function normalizeDirection(direction: number | undefined): number {
  return direction === undefined ? 0 : ((Math.trunc(direction) % 8) + 8) % 8;
}

/** Reading order for tiles: top-to-bottom, then left-to-right. */
function compareTilePosition(a: BlueprintTile, b: BlueprintTile): number {
  return a.position.y - b.position.y || a.position.x - b.position.x;
}

/** Tiles t with min <= t < max, i.e. ceil(min)…ceil(max) − 1 (see footprint.ts). */
function tileRange(min: number, max: number): { start: number; end: number } {
  // Epsilon guard: boxes ending exactly on a tile boundary must not spill
  // into the next tile. Math.ceil can return -0; normalize it to +0.
  const start = Math.ceil(min - 1e-9);
  const end = Math.ceil(max - 1e-9) - 1;
  return { start: start === 0 ? 0 : start, end: end === 0 ? 0 : end };
}

/** Bounding box over a model's entities and tiles, in tile coordinates. */
function previewBounds(
  entities: readonly PreviewEntity[],
  tiles: readonly PreviewTile[],
): Pick<BlueprintPreviewModel, 'minX' | 'minY' | 'widthTiles' | 'heightTiles'> {
  if (entities.length === 0 && tiles.length === 0) {
    return { minX: 0, minY: 0, widthTiles: 0, heightTiles: 0 };
  }
  let minTileX = Number.POSITIVE_INFINITY;
  let maxTileX = Number.NEGATIVE_INFINITY;
  let minTileY = Number.POSITIVE_INFINITY;
  let maxTileY = Number.NEGATIVE_INFINITY;

  const include = (minX: number, maxX: number, minY: number, maxY: number): void => {
    const x = tileRange(minX, maxX);
    const y = tileRange(minY, maxY);
    minTileX = Math.min(minTileX, x.start);
    maxTileX = Math.max(maxTileX, x.end);
    minTileY = Math.min(minTileY, y.start);
    maxTileY = Math.max(maxTileY, y.end);
  };

  for (const entity of entities) {
    // getEntitySize already falls back to 1×1 for unknown names, so an
    // unknown-size entity contributes a 1×1 box (position ± 0.5).
    include(
      entity.x - entity.w / 2,
      entity.x + entity.w / 2,
      entity.y - entity.h / 2,
      entity.y + entity.h / 2,
    );
  }
  for (const tile of tiles) {
    // A tile covers exactly its own cell [x, x+1) × [y, y+1).
    include(tile.x, tile.x + 1, tile.y, tile.y + 1);
  }

  return {
    minX: minTileX,
    minY: minTileY,
    widthTiles: Math.max(maxTileX - minTileX + 1, 1),
    heightTiles: Math.max(maxTileY - minTileY + 1, 1),
  };
}

/**
 * Build the preview model for one blueprint page.
 *
 * - Entities are ordered by `entity_number` ascending — the blueprint's own
 *   numbering; PreviewEntity carries no number, so the source list is ordered
 *   (on a copy) before mapping. Tiles are ordered by y, then x.
 * - `entityCount`/`tileCount` always report the true totals; when either
 *   exceeds its cap, the arrays keep the first N in sorted order and
 *   `truncated` is true.
 * - The input blueprint is never mutated.
 */
export function buildBlueprintPreview(blueprint: BlueprintJson): BlueprintPreviewModel {
  const sortedEntities = [...blueprint.entities].sort((a, b) => a.entity_number - b.entity_number);
  const sortedTiles = [...blueprint.tiles].sort(compareTilePosition);

  const entityCount = sortedEntities.length;
  const tileCount = sortedTiles.length;

  const entities: PreviewEntity[] = [];
  for (const source of sortedEntities.slice(0, PREVIEW_MAX_ENTITIES)) {
    const direction = normalizeDirection(source.direction);
    const size = getEntitySize(source.name, direction);
    entities.push({
      name: source.name,
      category: entityCategory(source.name),
      x: source.position.x,
      y: source.position.y,
      w: size.w,
      h: size.h,
      direction,
    });
  }

  const tiles: PreviewTile[] = sortedTiles.slice(0, PREVIEW_MAX_TILES).map((source) => ({
    name: source.name,
    x: source.position.x,
    y: source.position.y,
  }));

  return {
    entities,
    tiles,
    ...previewBounds(entities, tiles),
    entityCount,
    tileCount,
    truncated: entityCount > PREVIEW_MAX_ENTITIES || tileCount > PREVIEW_MAX_TILES,
  };
}
