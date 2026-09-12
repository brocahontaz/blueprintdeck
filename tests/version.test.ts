import { describe, expect, it } from 'vitest';
import {
  decodeBlueprintVersionParts,
  encodeBlueprintVersion,
  formatBlueprintVersion,
  isBlueprintVersion,
} from '../src/blueprint/version';

describe('formatBlueprintVersion', () => {
  const cases: Array<[parts: [number, number, number, number], expected: string]> = [
    [[1, 1, 61, 0], '1.1.61'],
    [[0, 17, 79, 0], '0.17.79'],
    [[1, 1, 61, 5], '1.1.61.5'],
    [[2, 0, 7, 1], '2.0.7.1'],
    [[0, 0, 0, 0], '0.0.0'],
    [[31, 65535, 65535, 65535], '31.65535.65535.65535'],
  ];

  for (const [[major, minor, patch, dev], expected] of cases) {
    it(`formats ${expected}`, () => {
      expect(formatBlueprintVersion(encodeBlueprintVersion(major, minor, patch, dev))).toBe(
        expected,
      );
    });
  }

  it('decodes the documented 1.1.61 packing bit-for-bit', () => {
    const packed = encodeBlueprintVersion(1, 1, 61);
    expect(packed).toBe(281479275675648);
    expect(formatBlueprintVersion(packed)).toBe('1.1.61');
  });

  it('rejects packings beyond Number.MAX_SAFE_INTEGER instead of rounding', () => {
    // 33 << 48 is the first packing that no longer fits a safe integer.
    expect(() => encodeBlueprintVersion(33, 0, 0, 0)).toThrow(RangeError);
    expect(() => encodeBlueprintVersion(65535, 65535, 65535, 65535)).toThrow(RangeError);
  });

  it('reports unknown for invalid input', () => {
    expect(formatBlueprintVersion(Number.NaN)).toBe('unknown');
    expect(formatBlueprintVersion(-1)).toBe('unknown');
    expect(formatBlueprintVersion(Number.POSITIVE_INFINITY)).toBe('unknown');
    expect(formatBlueprintVersion(Number.MAX_SAFE_INTEGER + 1)).toBe('unknown');
  });
});

describe('version round trip', () => {
  it('survives encode → decode → encode', () => {
    const samples: Array<[number, number, number, number]> = [
      [0, 12, 0, 0],
      [0, 17, 79, 6],
      [1, 0, 0, 0],
      [1, 1, 110, 23],
      [2, 0, 75, 3],
      [31, 65535, 65535, 65535],
    ];
    for (const [major, minor, patch, dev] of samples) {
      const packed = encodeBlueprintVersion(major, minor, patch, dev);
      const parts = decodeBlueprintVersionParts(packed);
      expect(parts).toEqual({ major, minor, patch, dev });
      expect(formatBlueprintVersion(packed)).toBe(
        dev === 0 ? `${major}.${minor}.${patch}` : `${major}.${minor}.${patch}.${dev}`,
      );
    }
  });
});

describe('isBlueprintVersion', () => {
  it('accepts finite non-negative numbers and rejects the rest', () => {
    expect(isBlueprintVersion(0)).toBe(true);
    expect(isBlueprintVersion(281479275675648)).toBe(true);
    expect(isBlueprintVersion(-1)).toBe(false);
    expect(isBlueprintVersion(1.5)).toBe(true);
    expect(isBlueprintVersion(Number.NaN)).toBe(false);
    expect(isBlueprintVersion('1')).toBe(false);
  });
});
