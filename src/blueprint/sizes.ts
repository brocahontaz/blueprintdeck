/**
 * Approximate tile footprints for known Factorio entities.
 *
 * Sizes are tile counts (w × h) with the entity's `position` treated as its
 * center. This dataset is an approximation used for quick visual estimation;
 * see README.md for how to extend it.
 */

export interface EntitySize {
  w: number;
  h: number;
  /** The real footprint is close to, but not exactly, this box. */
  approx?: boolean;
  /** The entity is missing from the dataset; assumed 1×1. */
  unknown?: boolean;
}

/**
 * How the recorded w/h relate to the entity's `direction` (0..7, clockwise
 * from north). Values are the size at direction 0 or 4; swap w/h at 2 or 6.
 */
export type SizeOrientation = 'perpendicular' | 'parallel';

export interface EntitySizeEntry extends EntitySize {
  /**
   * perpendicular: long axis runs across the direction (splitters, train stops).
   * parallel: long axis runs along the direction (straight rails).
   */
  orientation?: SizeOrientation;
}

/**
 * Known sizes, keyed by entity prototype name. Add new entries here to extend
 * the footprint dataset (see README.md).
 */
export const ENTITY_SIZES: Record<string, EntitySizeEntry> = {
  // 1×1 — belts, inserters, chests, small power and pipes
  'transport-belt': { w: 1, h: 1 },
  'fast-transport-belt': { w: 1, h: 1 },
  'express-transport-belt': { w: 1, h: 1 },
  'turbo-transport-belt': { w: 1, h: 1 },
  'underground-belt': { w: 1, h: 1 },
  'fast-underground-belt': { w: 1, h: 1 },
  'express-underground-belt': { w: 1, h: 1 },
  'turbo-underground-belt': { w: 1, h: 1 },
  'burner-inserter': { w: 1, h: 1 },
  'long-handed-inserter': { w: 1, h: 1 },
  'fast-inserter': { w: 1, h: 1 },
  'filter-inserter': { w: 1, h: 1 },
  'stack-inserter': { w: 1, h: 1 },
  'bulk-inserter': { w: 1, h: 1 },
  'wooden-chest': { w: 1, h: 1 },
  'iron-chest': { w: 1, h: 1 },
  'steel-chest': { w: 1, h: 1 },
  'logistic-chest-passive-provider': { w: 1, h: 1 },
  'logistic-chest-active-provider': { w: 1, h: 1 },
  'logistic-chest-storage': { w: 1, h: 1 },
  'logistic-chest-requester': { w: 1, h: 1 },
  'logistic-chest-buffer': { w: 1, h: 1 },
  'small-electric-pole': { w: 1, h: 1 },
  'medium-electric-pole': { w: 1, h: 1 },
  lamp: { w: 1, h: 1 },
  pipe: { w: 1, h: 1 },
  'heat-pipe': { w: 1, h: 1 },
  pump: { w: 1, h: 1 },
  'offshore-pump': { w: 1, h: 1 },

  // 2×2 — miners, furnaces, big power, buffering
  'burner-mining-drill': { w: 2, h: 2 },
  'stone-furnace': { w: 2, h: 2 },
  'steel-furnace': { w: 2, h: 2 },
  'big-electric-pole': { w: 2, h: 2 },
  substation: { w: 2, h: 2 },
  accumulator: { w: 2, h: 2 },
  pumpjack: { w: 2, h: 2 },

  // 3×3 — production machines
  'assembling-machine-1': { w: 3, h: 3 },
  'assembling-machine-2': { w: 3, h: 3 },
  'assembling-machine-3': { w: 3, h: 3 },
  'chemical-plant': { w: 3, h: 3 },
  centrifuge: { w: 3, h: 3 },
  'electric-mining-drill': { w: 3, h: 3 },
  lab: { w: 3, h: 3 },
  radar: { w: 3, h: 3 },
  'solar-panel': { w: 3, h: 3 },
  'electric-furnace': { w: 3, h: 3 },
  beacon: { w: 3, h: 3 },
  'heat-exchanger': { w: 3, h: 3 },
  'storage-tank': { w: 3, h: 3 },

  // Large uniques
  'oil-refinery': { w: 5, h: 5 },
  'nuclear-reactor': { w: 5, h: 5 },
  'rocket-silo': { w: 9, h: 9 },
  roboport: { w: 4, h: 4 },

  // Approximate sizes (footprint is close but not exact)
  'steam-engine': { w: 5, h: 3, approx: true },
  'steam-turbine': { w: 5, h: 3, approx: true },
  // Long axis across the belt direction: dir 0/4 → 2 wide, dir 2/6 → 2 deep.
  splitter: { w: 2, h: 1, approx: true, orientation: 'perpendicular' },
  'train-stop': { w: 2, h: 1, approx: true, orientation: 'perpendicular' },
  // Long axis along the rail: dir 0/4 → 2 deep (N–S rail), dir 2/6 → 2 wide.
  'straight-rail': { w: 1, h: 2, approx: true, orientation: 'parallel' },
  'curved-rail': { w: 2, h: 2, approx: true },
  foundry: { w: 4, h: 4, approx: true },
  biochamber: { w: 4, h: 4, approx: true },
  'electromagnetic-plant': { w: 4, h: 4, approx: true },
  'cryogenic-plant': { w: 5, h: 5, approx: true },
  crusher: { w: 3, h: 3, approx: true },
};

/** Fallback for entities missing from the dataset. */
export const UNKNOWN_ENTITY_SIZE: EntitySize = { w: 1, h: 1, unknown: true };

/**
 * Return the approximate tile size for an entity. Direction-aware entries
 * (splitters, train stops, rails) swap their long axis at directions 2 and 6.
 */
export function getEntitySize(name: string, direction?: number): EntitySize {
  const entry = ENTITY_SIZES[name];
  if (!entry) return UNKNOWN_ENTITY_SIZE;
  if (!entry.orientation) {
    return { w: entry.w, h: entry.h, ...(entry.approx ? { approx: true } : {}) };
  }
  const dir = ((Math.trunc(direction ?? 0) % 8) + 8) % 8;
  const swap = dir === 2 || dir === 6;
  const w = swap ? entry.h : entry.w;
  const h = swap ? entry.w : entry.h;
  return { w, h, ...(entry.approx ? { approx: true } : {}) };
}

/** Format a size for the summary table: "1×1", "≈3×3" or "1×1?" for unknowns. */
export function formatEntitySize(size: EntitySize): string {
  if (size.unknown) return `${size.w}×${size.h}?`;
  if (size.approx) return `≈${size.w}×${size.h}`;
  return `${size.w}×${size.h}`;
}
