import { describe, expect, it } from 'vitest';
import { decodeBlueprint } from '../src/blueprint/decode';
import { computeFootprint, formatFootprintCaveat } from '../src/blueprint/footprint';
import { buildShareHash, parseShareHash } from '../src/blueprint/share';
import { summarizeBlueprint } from '../src/blueprint/summary';
import { formatBlueprintVersion } from '../src/blueprint/version';

/**
 * Integration fixture: a complete blueprint string produced by an independent
 * encoder script (pako.deflateRaw + base64url + '0' prefix), kept as a
 * literal so regressions in the test helpers cannot mask decode breakage.
 */
const SMOKE_TEST_BLUEPRINT_STRING =
  '0bZHdasMwDIVfJeg6Hk3Wrl3eYBe7267GGI6jtaL-CbYyGkLefUrSlUEKhmBJ5ztHzgC17bCN5BmqAYjRQfWvloPVNVqpvWrfaZslF86YMaap12AykVqm4GXirW-xyUQVMj5h9v4iEz8Y09wtD8V2_1zud09ytoccyASfoPoYINHRazvZe-1QQBSDV63VjEJgoU61KdkoMt_gBapi_MwBPRMTLpT50n_5ztUYZSD_o3HUPrUhspJFptRtSLREHkBQm4ddDv38FX5DEc3SLcd8hS1vWJ0SutqSPyqnzYk8qnINX9BCAsHSvAlaMZANyShD0XTEcMfo8WaUGLVT6I9isTYoymv8QuLf4WxvHNcLKfaqDpc1ptzMEEHIuzLZ66NepRG_xbxR8stMRL4TY5FvRD6Ovw';

describe('decode integration with a standalone-encoded string', () => {
  const decoded = decodeBlueprint(SMOKE_TEST_BLUEPRINT_STRING);
  if (decoded.kind !== 'blueprint') throw new Error('expected a single blueprint');

  it('decodes the full pipeline data', () => {
    expect(decoded.blueprint.label).toBe('Manual smoke test');
    expect(decoded.blueprint.entities).toHaveLength(4);
    expect(decoded.blueprint.tiles).toHaveLength(1);
    expect(formatBlueprintVersion(decoded.blueprint.version ?? Number.NaN)).toBe('1.1.61');
  });

  it('summarizes the decoded data', () => {
    const summary = summarizeBlueprint(decoded.blueprint);
    expect(summary.totals).toEqual({
      entityCount: 4,
      entityTypes: 4,
      tileCount: 1,
      tileTypes: 1,
    });
    const assembler = summary.rows.find((row) => row.name === 'assembling-machine-2');
    expect(assembler?.notes).toEqual(['electronic-circuit ×1']);
  });

  it('measures the footprint across known, approx and unknown sizes', () => {
    const result = computeFootprint(decoded.blueprint);
    // belt 1×1 at (0.5, 0.5) → tile (0,0); assembler 3×3 at (5,2) → 4–6 × 1–3;
    // steam engine ≈5×3 at (12.5, 1.5) → 10–14 × 0–2; mystery box unknown.
    expect(result).toMatchObject({
      widthTiles: 15,
      heightTiles: 4,
      area: 60,
      knownCount: 2,
      approxCount: 1,
      unknownCount: 1,
      positionsOnly: false,
    });
    expect(formatFootprintCaveat(result)).toBe(
      'Includes 1 approximate size estimate and 1 unknown (assumed 1×1).',
    );
  });

  it('round trips through a share URL', () => {
    const hash = buildShareHash(SMOKE_TEST_BLUEPRINT_STRING);
    const parsed = parseShareHash(hash);
    if (!parsed.bp) throw new Error('expected a bp value');
    const redecoded = decodeBlueprint(parsed.bp);
    expect(redecoded.kind).toBe('blueprint');
    if (redecoded.kind !== 'blueprint') return;
    expect(redecoded.blueprint.label).toBe('Manual smoke test');
  });
});
