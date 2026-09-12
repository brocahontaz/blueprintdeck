import type { BlueprintJson } from './decode';
import { getEntitySize } from './sizes';

/**
 * Approximate tile footprint of a blueprint: union of every entity's tile box.
 *
 * Entity positions are their *centers*. Odd-sized entities sit on half-tile
 * centers (e.g. x = 5.5), even-sized ones on integer centers (e.g. x = 5):
 *   box = [position − size/2, position + size/2)
 *
 * A tile t is covered when t >= min and t < max, i.e. tiles ceil(min)…
 * ceil(max) − 1. Example: a 1×1 entity at x = 5.5 covers tile 5; a 3×3
 * entity at x = 5 covers tiles 4–6.
 */

export interface FootprintResult {
  widthTiles: number;
  heightTiles: number;
  area: number;
  minTileX: number;
  maxTileX: number;
  minTileY: number;
  maxTileY: number;
  knownCount: number;
  approxCount: number;
  unknownCount: number;
  /**
   * True when no known/approximate entity sizes were available, so the box is
   * a positions-only estimate (each position ±0.5).
   */
  positionsOnly: boolean;
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function tileRange(min: number, max: number): { start: number; end: number } {
  // Tiles t with min <= t < max, using a tiny epsilon guard so that boxes
  // ending exactly on a tile boundary don't spill into the next tile.
  // (Math.ceil can return -0; normalize it so tile numbers stay +0.)
  const start = Math.ceil(min - 1e-9);
  const end = Math.ceil(max - 1e-9) - 1;
  return { start: start === 0 ? 0 : start, end: end === 0 ? 0 : end };
}

function unionTileBoxes(
  boxes: Box[],
): { minTileX: number; maxTileX: number; minTileY: number; maxTileY: number } | null {
  if (boxes.length === 0) return null;
  let minTileX = Number.POSITIVE_INFINITY;
  let maxTileX = Number.NEGATIVE_INFINITY;
  let minTileY = Number.POSITIVE_INFINITY;
  let maxTileY = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    const x = tileRange(box.minX, box.maxX);
    const y = tileRange(box.minY, box.maxY);
    minTileX = Math.min(minTileX, x.start);
    maxTileX = Math.max(maxTileX, x.end);
    minTileY = Math.min(minTileY, y.start);
    maxTileY = Math.max(maxTileY, y.end);
  }
  return { minTileX, maxTileX, minTileY, maxTileY };
}

/** Compute the approximate union footprint of a blueprint's entities. */
export function computeFootprint(blueprint: BlueprintJson): FootprintResult {
  const boxes: Box[] = [];
  let knownCount = 0;
  let approxCount = 0;
  let unknownCount = 0;

  for (const entity of blueprint.entities) {
    const size = getEntitySize(entity.name, entity.direction);
    if (size.unknown) {
      unknownCount += 1;
      continue;
    }
    if (size.approx) approxCount += 1;
    else knownCount += 1;
    boxes.push({
      minX: entity.position.x - size.w / 2,
      maxX: entity.position.x + size.w / 2,
      minY: entity.position.y - size.h / 2,
      maxY: entity.position.y + size.h / 2,
    });
  }

  let positionsOnly = false;
  if (boxes.length === 0) {
    // No known/approximate entities: fall back to a positions-only box.
    positionsOnly = true;
    if (blueprint.entities.length > 0) {
      for (const entity of blueprint.entities) {
        boxes.push({
          minX: entity.position.x - 0.5,
          maxX: entity.position.x + 0.5,
          minY: entity.position.y - 0.5,
          maxY: entity.position.y + 0.5,
        });
      }
    } else {
      // Tiles-only blueprint (e.g. landfill): treat each tile as 1×1.
      for (const tile of blueprint.tiles) {
        boxes.push({
          minX: tile.position.x,
          maxX: tile.position.x + 1,
          minY: tile.position.y,
          maxY: tile.position.y + 1,
        });
      }
    }
  }

  const union = unionTileBoxes(boxes);
  if (!union) {
    return {
      widthTiles: 0,
      heightTiles: 0,
      area: 0,
      minTileX: 0,
      maxTileX: 0,
      minTileY: 0,
      maxTileY: 0,
      knownCount,
      approxCount,
      unknownCount,
      positionsOnly,
    };
  }
  const widthTiles = Math.max(union.maxTileX - union.minTileX + 1, 1);
  const heightTiles = Math.max(union.maxTileY - union.minTileY + 1, 1);
  return {
    widthTiles,
    heightTiles,
    area: widthTiles * heightTiles,
    ...union,
    knownCount,
    approxCount,
    unknownCount,
    positionsOnly,
  };
}

/** One-line caveat describing how approximate the footprint is. */
export function formatFootprintCaveat(result: FootprintResult): string {
  if (result.widthTiles === 0) return 'No entities to measure.';
  const bits: string[] = [];
  if (result.approxCount > 0)
    bits.push(
      `${result.approxCount} approximate size estimate${result.approxCount === 1 ? '' : 's'}`,
    );
  if (result.unknownCount > 0) bits.push(`${result.unknownCount} unknown (assumed 1×1)`);
  if (result.positionsOnly)
    return 'Positions-only estimate — no known or approximate entity sizes.';
  if (bits.length === 0) return 'All entity sizes are known.';
  return `Includes ${bits.join(' and ')}.`;
}
