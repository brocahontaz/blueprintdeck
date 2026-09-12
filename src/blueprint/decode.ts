import { inflate, inflateRaw } from 'pako';

/**
 * Factorio blueprint string decoding (blueprint string format, 0.17+):
 * version char '0' + base64url(raw DEFLATE(JSON)).
 *
 * See https://wiki.factorio.com/Blueprint_string_format
 */

export type BlueprintDecodeErrorKind =
  'not-a-blueprint-string' | 'bad-base64' | 'bad-deflate' | 'bad-json' | 'unexpected-shape';

/**
 * Typed decode failure. The message is short, human-readable and safe to show
 * in the UI; raw underlying errors are never exposed.
 */
export class BlueprintDecodeError extends Error {
  readonly kind: BlueprintDecodeErrorKind;

  constructor(kind: BlueprintDecodeErrorKind, message: string) {
    super(message);
    this.name = 'BlueprintDecodeError';
    this.kind = kind;
  }
}

/** Short human reasons for each decode failure, safe for UI display. */
export const DECODE_ERROR_MESSAGES: Record<BlueprintDecodeErrorKind, string> = {
  'not-a-blueprint-string':
    "That doesn't look like a Factorio blueprint string — blueprint strings start with '0'.",
  'bad-base64': 'The blueprint string contains invalid base64 data.',
  'bad-deflate': 'The blueprint data could not be decompressed.',
  'bad-json': 'The decompressed blueprint data is not valid JSON.',
  'unexpected-shape': 'The decoded data is not a Factorio blueprint or blueprint book.',
};

// ---------------------------------------------------------------------------
// Documented JSON shape (https://wiki.factorio.com/Blueprint_string_format)
// ---------------------------------------------------------------------------

export interface SignalSpec {
  name: string;
  /** Signal type ('item', 'fluid', 'virtual', …). Factorio 2.x may omit it. */
  type: string;
}

export interface BlueprintIcon {
  signal: SignalSpec;
  index: number;
}

export interface BlueprintPosition {
  x: number;
  y: number;
}

export interface BlueprintEntity {
  entity_number: number;
  name: string;
  position: BlueprintPosition;
  /** 0..7, clockwise from north. Absent means 0 (north). */
  direction?: number;
  /** Crafting machine recipe (item name). */
  recipe?: string;
  /** Item quality tier (e.g. 'uncommon'). Absent means normal quality. */
  quality?: string;
  /** Container contents: slot key → item name. Absent means unspecified. */
  inventory?: Record<string, string>;
  /** Installed module names. */
  modules?: string[];
  /**
   * Entity-specific settings entries. Values are heterogeneous (strings,
   * numbers, booleans, null, nested structures) and are kept as given.
   */
  settings?: Record<string, unknown>;
}

export interface BlueprintTile {
  name: string;
  position: BlueprintPosition;
}

export interface ScheduleStop {
  station?: string;
  wait_conditions?: unknown[];
}

export interface ScheduleGroup {
  id?: number;
  locomotives?: number[];
  schedule?: ScheduleStop[];
}

export interface BlueprintJson {
  item?: string;
  label?: string;
  description?: string;
  icons: BlueprintIcon[];
  entities: BlueprintEntity[];
  tiles: BlueprintTile[];
  schedules: ScheduleGroup[];
  /** Packed Factorio version, see version.ts. */
  version?: number;
}

export interface BlueprintPage {
  blueprint: BlueprintJson;
  /**
   * True when this page's `blueprint` is itself a book. Such pages are not
   * expanded; the UI should surface a note instead of treating the page as an
   * empty blueprint.
   */
  nestedBook?: boolean;
}

export interface BlueprintBookJson {
  item?: string;
  label?: string;
  description?: string;
  icons?: BlueprintIcon[];
  blueprints: BlueprintPage[];
  active_index?: number;
  version?: number;
}

/** The parsed root JSON document, as-is (unknown fields preserved). */
export type BlueprintDocument = Record<string, unknown>;

export type DecodedBlueprint =
  | { kind: 'blueprint'; blueprint: BlueprintJson; raw: BlueprintDocument }
  | { kind: 'book'; book: BlueprintBookJson; raw: BlueprintDocument };

// ---------------------------------------------------------------------------
// URL extraction
// ---------------------------------------------------------------------------

/**
 * If the text contains a '#bp=' or '?bp=' URL parameter, return its value
 * (up to the next '&' or the end of the string). Otherwise return null.
 */
export function extractBlueprintParam(text: string): string | null {
  const hashIndex = text.indexOf('#bp=');
  const queryIndex = text.indexOf('?bp=');
  let start = -1;
  if (hashIndex >= 0 && (queryIndex < 0 || hashIndex < queryIndex)) {
    start = hashIndex + '#bp='.length;
  } else if (queryIndex >= 0) {
    start = queryIndex + '?bp='.length;
  }
  if (start < 0) return null;
  const ampersand = text.indexOf('&', start);
  const raw = (ampersand >= 0 ? text.slice(start, ampersand) : text.slice(start)).trim();
  if (!raw) return null;
  // Share URLs may percent-encode the payload; base64url characters are left
  // untouched by decodeURIComponent, so this is always safe to attempt.
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizePosition(raw: unknown): BlueprintPosition | null {
  if (!isRecord(raw)) return null;
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) return null;
  return { x: raw.x, y: raw.y };
}

function normalizeIcon(raw: unknown): BlueprintIcon | null {
  if (!isRecord(raw)) return null;
  if (!isRecord(raw.signal)) return null;
  const { name } = raw.signal;
  if (typeof name !== 'string') return null;
  // Factorio 2.x omits `type` and defaults to "item".
  const type = raw.signal.type === undefined ? 'item' : raw.signal.type;
  if (typeof type !== 'string') return null;
  if (!isFiniteNumber(raw.index)) return null;
  return { signal: { name, type }, index: raw.index };
}

function normalizeEntity(raw: unknown): BlueprintEntity | null {
  if (!isRecord(raw)) return null;
  if (!isFiniteNumber(raw.entity_number) || typeof raw.name !== 'string') return null;
  const position = normalizePosition(raw.position);
  if (!position) return null;
  const entity: BlueprintEntity = { entity_number: raw.entity_number, name: raw.name, position };
  if (raw.direction !== undefined) {
    if (!isFiniteNumber(raw.direction)) return null;
    entity.direction = raw.direction;
  }
  if (raw.recipe !== undefined) {
    if (typeof raw.recipe !== 'string') return null;
    entity.recipe = raw.recipe;
  }
  if (raw.quality !== undefined) {
    if (typeof raw.quality !== 'string') return null;
    entity.quality = raw.quality;
  }
  if (raw.inventory !== undefined) {
    if (!isRecord(raw.inventory)) return null;
    const inventory: Record<string, string> = {};
    for (const [slot, item] of Object.entries(raw.inventory)) {
      if (typeof item !== 'string') return null;
      inventory[slot] = item;
    }
    entity.inventory = inventory;
  }
  if (raw.modules !== undefined) {
    if (!Array.isArray(raw.modules)) return null;
    const modules: string[] = [];
    for (const entry of raw.modules) {
      if (typeof entry !== 'string') return null;
      modules.push(entry);
    }
    entity.modules = modules;
  }
  if (raw.settings !== undefined) {
    if (!isRecord(raw.settings)) return null;
    // Settings values are heterogeneous by design; keep them as given.
    entity.settings = { ...raw.settings };
  }
  return entity;
}

function normalizeTile(raw: unknown): BlueprintTile | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.name !== 'string') return null;
  const position = normalizePosition(raw.position);
  if (!position) return null;
  return { name: raw.name, position };
}

function normalizeScheduleGroup(raw: Record<string, unknown>): ScheduleGroup {
  const group: ScheduleGroup = {};
  if (isFiniteNumber(raw.id)) group.id = raw.id;
  if (Array.isArray(raw.locomotives) && raw.locomotives.every(isFiniteNumber)) {
    group.locomotives = [...raw.locomotives];
  }
  if (Array.isArray(raw.schedule)) {
    group.schedule = raw.schedule.filter(isRecord).map((stop) => {
      const normalized: ScheduleStop = {};
      if (typeof stop.station === 'string') normalized.station = stop.station;
      if (Array.isArray(stop.wait_conditions)) normalized.wait_conditions = stop.wait_conditions;
      return normalized;
    });
  }
  return group;
}

function normalizeBlueprint(raw: unknown): BlueprintJson | null {
  if (!isRecord(raw)) return null;
  const blueprint: BlueprintJson = { icons: [], entities: [], tiles: [], schedules: [] };
  if (raw.item !== undefined) {
    if (typeof raw.item !== 'string') return null;
    blueprint.item = raw.item;
  }
  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string') return null;
    blueprint.label = raw.label;
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') return null;
    blueprint.description = raw.description;
  }
  if (raw.version !== undefined) {
    if (!isFiniteNumber(raw.version)) return null;
    blueprint.version = raw.version;
  }
  if (raw.icons !== undefined) {
    if (!Array.isArray(raw.icons)) return null;
    for (const entry of raw.icons) {
      const icon = normalizeIcon(entry);
      if (!icon) return null;
      blueprint.icons.push(icon);
    }
  }
  if (raw.entities !== undefined) {
    if (!Array.isArray(raw.entities)) return null;
    for (const entry of raw.entities) {
      const entity = normalizeEntity(entry);
      if (!entity) return null;
      blueprint.entities.push(entity);
    }
  }
  if (raw.tiles !== undefined) {
    if (!Array.isArray(raw.tiles)) return null;
    for (const entry of raw.tiles) {
      const tile = normalizeTile(entry);
      if (!tile) return null;
      blueprint.tiles.push(tile);
    }
  }
  if (raw.schedules !== undefined) {
    if (!Array.isArray(raw.schedules)) return null;
    for (const entry of raw.schedules) {
      if (!isRecord(entry)) return null;
      blueprint.schedules.push(normalizeScheduleGroup(entry));
    }
  }
  return blueprint;
}

function normalizeBook(raw: unknown): BlueprintBookJson | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.blueprints)) return null;
  const book: BlueprintBookJson = { blueprints: [] };
  if (raw.item !== undefined) {
    if (typeof raw.item !== 'string') return null;
    book.item = raw.item;
  }
  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string') return null;
    book.label = raw.label;
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') return null;
    book.description = raw.description;
  }
  if (raw.version !== undefined) {
    if (!isFiniteNumber(raw.version)) return null;
    book.version = raw.version;
  }
  if (raw.icons !== undefined) {
    if (!Array.isArray(raw.icons)) return null;
    for (const entry of raw.icons) {
      const icon = normalizeIcon(entry);
      if (!icon) return null;
      book.icons = [...(book.icons ?? []), icon];
    }
  }
  if (raw.active_index !== undefined) {
    if (!isFiniteNumber(raw.active_index) || !Number.isInteger(raw.active_index)) return null;
    book.active_index = raw.active_index;
  }
  for (const entry of raw.blueprints) {
    if (!isRecord(entry)) return null;
    const page = normalizeBlueprint(entry.blueprint);
    if (!page) return null;
    // A page whose `blueprint` is itself a book decodes as an empty-looking
    // blueprint; flag it so the UI can explain that it is not expanded.
    const nestedBook = isRecord(entry.blueprint) && entry.blueprint.item === 'blueprint-book';
    book.blueprints.push(nestedBook ? { blueprint: page, nestedBook: true } : { blueprint: page });
  }
  return book;
}

function base64UrlToBytes(text: string): Uint8Array {
  let base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const remainder = base64.length % 4;
  if (remainder === 1) {
    throw new BlueprintDecodeError('bad-base64', DECODE_ERROR_MESSAGES['bad-base64']);
  }
  if (remainder !== 0) base64 += '='.repeat(4 - remainder);
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new BlueprintDecodeError('bad-base64', DECODE_ERROR_MESSAGES['bad-base64']);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function inflateBytes(bytes: Uint8Array): Uint8Array {
  // Factorio 0.17+ uses raw DEFLATE; fall back to the zlib wrapper for
  // strings produced by older or non-standard encoders.
  try {
    return inflateRaw(bytes);
  } catch {
    // Try the zlib-wrapped variant before giving up.
  }
  try {
    return inflate(bytes);
  } catch {
    throw new BlueprintDecodeError('bad-deflate', DECODE_ERROR_MESSAGES['bad-deflate']);
  }
}

/**
 * Validate an already-parsed blueprint JSON document against the documented
 * shape and return its typed view together with the untouched raw document.
 *
 * Throws {@link BlueprintDecodeError} ('unexpected-shape') when the document
 * is neither a blueprint nor a blueprint book.
 */
export function parseBlueprintDocument(parsed: unknown): DecodedBlueprint {
  if (isRecord(parsed)) {
    if (parsed.blueprint !== undefined) {
      const blueprint = normalizeBlueprint(parsed.blueprint);
      if (blueprint) return { kind: 'blueprint', blueprint, raw: parsed };
    } else if (parsed.blueprint_book !== undefined) {
      const book = normalizeBook(parsed.blueprint_book);
      if (book) return { kind: 'book', book, raw: parsed };
    }
  }
  throw new BlueprintDecodeError('unexpected-shape', DECODE_ERROR_MESSAGES['unexpected-shape']);
}

/**
 * Decode a Factorio blueprint string (or a pasted share URL containing a
 * `bp=` parameter) into typed blueprint/book data.
 *
 * Throws {@link BlueprintDecodeError} on every failure path; raw errors never
 * escape this function.
 */
export function decodeBlueprint(input: string): DecodedBlueprint {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new BlueprintDecodeError(
      'not-a-blueprint-string',
      DECODE_ERROR_MESSAGES['not-a-blueprint-string'],
    );
  }
  const extracted = extractBlueprintParam(trimmed);
  // Strip ALL whitespace, including newlines, before decoding.
  const candidate = (extracted ?? trimmed).replace(/\s+/g, '');
  if (!candidate.startsWith('0')) {
    throw new BlueprintDecodeError(
      'not-a-blueprint-string',
      DECODE_ERROR_MESSAGES['not-a-blueprint-string'],
    );
  }

  const payloadBytes = base64UrlToBytes(candidate.slice(1));
  const jsonBytes = inflateBytes(payloadBytes);
  const jsonText = new TextDecoder('utf-8').decode(jsonBytes);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    throw new BlueprintDecodeError('bad-json', DECODE_ERROR_MESSAGES['bad-json']);
  }

  return parseBlueprintDocument(parsed);
}

/**
 * Return the page at `index` for a decoded book, clamped to the valid range,
 * or null when the book has no pages.
 */
export function getBookPage(book: BlueprintBookJson, index: number): BlueprintJson | null {
  if (book.blueprints.length === 0) return null;
  const clamped = Math.min(Math.max(Math.trunc(index), 0), book.blueprints.length - 1);
  return book.blueprints[clamped]?.blueprint ?? null;
}
