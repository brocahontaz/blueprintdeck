/**
 * Decode Factorio's packed 64-bit version number into "major.minor.patch[.dev]".
 *
 * The packed layout is 16 bits per component:
 *   major = (v >> 48) & 0xffff
 *   minor = (v >> 32) & 0xffff
 *   patch = (v >> 16) & 0xffff
 *   dev   =  v        & 0xffff
 *
 * JavaScript bitwise operators are 32-bit, so the shifts use BigInt.
 */

/**
 * Factorio packs its version as a 64-bit integer. JavaScript numbers hold
 * that exactly only up to Number.MAX_SAFE_INTEGER, which covers every real
 * Factorio version (major ≤ 32); larger packings are rejected instead of
 * silently rounded.
 */

export interface BlueprintVersionParts {
  major: number;
  minor: number;
  patch: number;
  dev: number;
}

const MASK_16 = 0xffffn;

export function isBlueprintVersion(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

export function decodeBlueprintVersionParts(version: number): BlueprintVersionParts {
  const packed = BigInt(Math.trunc(version));
  return {
    major: Number((packed >> 48n) & MASK_16),
    minor: Number((packed >> 32n) & MASK_16),
    patch: Number((packed >> 16n) & MASK_16),
    dev: Number(packed & MASK_16),
  };
}

/** Format a packed version number as "major.minor.patch" (+ ".dev" if nonzero). */
export function formatBlueprintVersion(version: number): string {
  if (!isBlueprintVersion(version)) return 'unknown';
  const { major, minor, patch, dev } = decodeBlueprintVersionParts(version);
  const base = `${major}.${minor}.${patch}`;
  return dev !== 0 ? `${base}.${dev}` : base;
}

/**
 * Pack version components back into Factorio's 64-bit version number.
 * Throws RangeError for packings that exceed Number.MAX_SAFE_INTEGER.
 */
export function encodeBlueprintVersion(
  major: number,
  minor: number,
  patch: number,
  dev = 0,
): number {
  const packed =
    (BigInt(major) << 48n) | (BigInt(minor) << 32n) | (BigInt(patch) << 16n) | BigInt(dev);
  if (packed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `version ${major}.${minor}.${patch}.${dev} does not fit in a safe integer`,
    );
  }
  return Number(packed);
}
