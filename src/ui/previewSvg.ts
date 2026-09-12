import type { BlueprintPreviewModel, PreviewEntity, PreviewTile } from '../blueprint/preview';
import { directionLabel } from '../blueprint/summary';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Direction arrow drawn inside every oriented entity: ~0.4 tiles long. */
const ARROW_LENGTH = 0.4;
const ARROW_HALF_WIDTH = 0.1;
const ARROW_FILL = '#16181d';
const GRID_STROKE = 'rgba(255, 255, 255, 0.07)';

/**
 * Create an SVG element with the given tag. The generic createElementNS
 * overload is used when available; the intermediate `Element` type makes the
 * cast safe either way.
 */
function svg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  const node: Element = document.createElementNS(SVG_NS, tag);
  return node as SVGElementTagNameMap[K];
}

/**
 * Low-contrast tile grid as a 1×1 userSpaceOnUse pattern: each cell draws its
 * top and left edges, so the lines land exactly on integer tile boundaries.
 */
function buildGrid(): SVGDefsElement {
  const pattern = svg('pattern');
  pattern.setAttribute('id', 'pv-grid');
  pattern.setAttribute('width', '1');
  pattern.setAttribute('height', '1');
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  const line = svg('path');
  line.setAttribute('d', 'M 1 0 L 0 0 0 1');
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', GRID_STROKE);
  line.setAttribute('stroke-width', '0.02');
  pattern.append(line);
  const defs = svg('defs');
  defs.append(pattern);
  return defs;
}

/** Backdrop rect covering the whole viewBox, filled with the tile pattern. */
function buildGridRect(model: BlueprintPreviewModel): SVGRectElement {
  const rect = svg('rect');
  rect.setAttribute('x', String(model.minX - 0.5));
  rect.setAttribute('y', String(model.minY - 0.5));
  rect.setAttribute('width', String(model.widthTiles + 1));
  rect.setAttribute('height', String(model.heightTiles + 1));
  rect.setAttribute('fill', 'url(#pv-grid)');
  return rect;
}

function tileRect(tile: PreviewTile): SVGRectElement {
  const rect = svg('rect');
  rect.setAttribute('x', String(tile.x));
  rect.setAttribute('y', String(tile.y));
  rect.setAttribute('width', '1');
  rect.setAttribute('height', '1');
  rect.setAttribute('class', 'pv-tile');
  const title = svg('title');
  title.textContent = tile.name;
  rect.append(title);
  return rect;
}

function entityRect(entity: PreviewEntity): SVGRectElement {
  const rect = svg('rect');
  rect.setAttribute('x', String(entity.x - entity.w / 2));
  rect.setAttribute('y', String(entity.y - entity.h / 2));
  rect.setAttribute('width', String(entity.w));
  rect.setAttribute('height', String(entity.h));
  rect.setAttribute('rx', '0.15');
  rect.setAttribute('class', `pv-entity pv-cat-${entity.category}`);
  const title = svg('title');
  title.textContent =
    entity.direction === 0
      ? entity.name
      : `${entity.name} — facing ${directionLabel(entity.direction)}`;
  rect.append(title);
  return rect;
}

/**
 * Direction arrow for one entity: a triangle pointing north, rotated
 * `rotate(direction * 45 cx cy)` around the entity center.
 */
function directionArrow(entity: PreviewEntity): SVGPathElement {
  const arrow = svg('path');
  const tipY = entity.y - ARROW_LENGTH / 2;
  const baseY = entity.y + ARROW_LENGTH / 2;
  arrow.setAttribute(
    'd',
    `M ${entity.x} ${tipY} ` +
      `L ${entity.x - ARROW_HALF_WIDTH} ${baseY} ` +
      `L ${entity.x + ARROW_HALF_WIDTH} ${baseY} Z`,
  );
  arrow.setAttribute('fill', ARROW_FILL);
  arrow.setAttribute('transform', `rotate(${entity.direction * 45} ${entity.x} ${entity.y})`);
  return arrow;
}

/**
 * Render the symbolic 2D grid preview as an SVG.
 *
 * - viewBox in tile coordinates with a 0.5-tile margin around the model's
 *   bounding box; entity boxes are centered on their tile-center positions
 *   and tiles cover their own cells, matching the blueprint string format.
 * - Draw order: tile pattern, tiles, entity boxes, then every direction
 *   arrow, so arrows stay visible above neighboring entity boxes.
 */
export function renderPreviewSvg(model: BlueprintPreviewModel): SVGSVGElement {
  const svgNode = svg('svg');
  svgNode.setAttribute('class', 'pv-svg');
  svgNode.setAttribute('role', 'img');
  svgNode.setAttribute(
    'aria-label',
    `Symbolic preview, ${model.widthTiles} by ${model.heightTiles} tiles, ` +
      `${model.entityCount} entities, ${model.tileCount} tiles` +
      (model.truncated ? ' (truncated)' : ''),
  );
  svgNode.setAttribute(
    'viewBox',
    `${model.minX - 0.5} ${model.minY - 0.5} ${model.widthTiles + 1} ${model.heightTiles + 1}`,
  );
  svgNode.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svgNode.append(buildGrid());
  svgNode.append(buildGridRect(model));
  for (const tile of model.tiles) svgNode.append(tileRect(tile));
  for (const entity of model.entities) svgNode.append(entityRect(entity));
  for (const entity of model.entities) svgNode.append(directionArrow(entity));
  return svgNode;
}
