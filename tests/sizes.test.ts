import { describe, expect, it } from 'vitest';
import { ENTITY_SIZES, formatEntitySize, getEntitySize } from '../src/blueprint/sizes';

describe('getEntitySize — confident sizes', () => {
  const confident: Array<[name: string, w: number, h: number]> = [
    ['transport-belt', 1, 1],
    ['fast-transport-belt', 1, 1],
    ['express-transport-belt', 1, 1],
    ['turbo-transport-belt', 1, 1],
    ['underground-belt', 1, 1],
    ['bulk-inserter', 1, 1],
    ['logistic-chest-requester', 1, 1],
    ['small-electric-pole', 1, 1],
    ['offshore-pump', 1, 1],
    ['burner-mining-drill', 2, 2],
    ['stone-furnace', 2, 2],
    ['substation', 2, 2],
    ['pumpjack', 2, 2],
    ['assembling-machine-3', 3, 3],
    ['electric-furnace', 3, 3],
    ['storage-tank', 3, 3],
    ['oil-refinery', 5, 5],
    ['nuclear-reactor', 5, 5],
    ['rocket-silo', 9, 9],
    ['roboport', 4, 4],
  ];

  for (const [name, w, h] of confident) {
    it(`sizes ${name} as ${w}×${h}`, () => {
      expect(getEntitySize(name)).toEqual({ w, h });
    });
  }

  it('never marks confident entries approx or unknown', () => {
    for (const [name, size] of Object.entries(ENTITY_SIZES)) {
      if (size.approx) continue;
      expect(`${name}: approx=${size.approx} unknown=${size.unknown}`).toBe(
        `${name}: approx=undefined unknown=undefined`,
      );
    }
  });
});

describe('getEntitySize — approximate sizes', () => {
  it('marks steam engines approximate', () => {
    expect(getEntitySize('steam-engine')).toEqual({ w: 5, h: 3, approx: true });
    expect(getEntitySize('steam-turbine')).toEqual({ w: 5, h: 3, approx: true });
  });

  it('marks curved rails and smelter-style machines approximate', () => {
    expect(getEntitySize('curved-rail')).toEqual({ w: 2, h: 2, approx: true });
    expect(getEntitySize('foundry')).toEqual({ w: 4, h: 4, approx: true });
    expect(getEntitySize('biochamber')).toEqual({ w: 4, h: 4, approx: true });
    expect(getEntitySize('electromagnetic-plant')).toEqual({ w: 4, h: 4, approx: true });
    expect(getEntitySize('cryogenic-plant')).toEqual({ w: 5, h: 5, approx: true });
    expect(getEntitySize('crusher')).toEqual({ w: 3, h: 3, approx: true });
  });

  it('swaps splitters perpendicular to their belt direction', () => {
    expect(getEntitySize('splitter', 0)).toEqual({ w: 2, h: 1, approx: true });
    expect(getEntitySize('splitter', 4)).toEqual({ w: 2, h: 1, approx: true });
    expect(getEntitySize('splitter', 2)).toEqual({ w: 1, h: 2, approx: true });
    expect(getEntitySize('splitter', 6)).toEqual({ w: 1, h: 2, approx: true });
  });

  it('swaps train stops like splitters', () => {
    expect(getEntitySize('train-stop', 0)).toEqual({ w: 2, h: 1, approx: true });
    expect(getEntitySize('train-stop', 6)).toEqual({ w: 1, h: 2, approx: true });
  });

  it('lays straight rails along their direction', () => {
    expect(getEntitySize('straight-rail', 0)).toEqual({ w: 1, h: 2, approx: true });
    expect(getEntitySize('straight-rail', 4)).toEqual({ w: 1, h: 2, approx: true });
    expect(getEntitySize('straight-rail', 2)).toEqual({ w: 2, h: 1, approx: true });
    expect(getEntitySize('straight-rail', 6)).toEqual({ w: 2, h: 1, approx: true });
  });

  it('defaults to direction 0 when absent', () => {
    expect(getEntitySize('splitter')).toEqual({ w: 2, h: 1, approx: true });
  });
});

describe('getEntitySize — unknown entities', () => {
  it('falls back to a 1×1 unknown size', () => {
    expect(getEntitySize('alien-artifact')).toEqual({ w: 1, h: 1, unknown: true });
    expect(getEntitySize('')).toEqual({ w: 1, h: 1, unknown: true });
  });
});

describe('formatEntitySize', () => {
  it('renders confident, approximate and unknown sizes', () => {
    expect(formatEntitySize(getEntitySize('transport-belt'))).toBe('1×1');
    expect(formatEntitySize(getEntitySize('steam-engine'))).toBe('≈5×3');
    expect(formatEntitySize(getEntitySize('who-knows'))).toBe('1×1?');
  });
});
