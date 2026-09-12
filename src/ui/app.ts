import {
  BlueprintDecodeError,
  decodeBlueprint,
  extractBlueprintParam,
  getBookPage,
  type BlueprintBookJson,
  type BlueprintDocument,
  type BlueprintJson,
  type DecodedBlueprint,
} from '../blueprint/decode';
import { computeFootprint, formatFootprintCaveat } from '../blueprint/footprint';
import {
  buildShareHash,
  copyTextToClipboard,
  parseShareHash,
  replaceHash,
} from '../blueprint/share';
import {
  dominantDirection,
  filterSummaryRows,
  formatPositionSpan,
  sortSummaryRows,
  summarizeBlueprint,
  type EntitySummaryRow,
  type SortDirection,
  type SummarySortKey,
  type TileTally,
} from '../blueprint/summary';
import { formatEntitySize, getEntitySize } from '../blueprint/sizes';
import { encodeBlueprintPage } from '../blueprint/encode';
import {
  buildBlueprintPreview,
  PREVIEW_MAX_ENTITIES,
  PREVIEW_MAX_TILES,
  type EntityCategory,
} from '../blueprint/preview';
import { renderPreviewSvg } from './previewSvg';
import { formatBlueprintVersion } from '../blueprint/version';

const CIRCUITDECK_URL = 'https://github.com/brocahontaz/circuitdeck';
const DEBOUNCE_MS = 150;
const COPY_CONFIRMATION_MS = 1600;
const TABLE_COLUMNS = ['Name', 'Count', 'Size', 'Position', 'Directions', 'Notes'] as const;

/** Natural sort direction applied on the first click of a column header. */
interface SortMeta {
  key: SummarySortKey;
  natural: SortDirection;
}

const SORT_META: Partial<Record<(typeof TABLE_COLUMNS)[number], SortMeta>> = {
  Name: { key: 'name', natural: 'asc' },
  Count: { key: 'count', natural: 'desc' },
  Size: { key: 'size', natural: 'desc' },
  Position: { key: 'position', natural: 'asc' },
};

/** Legend chips, one per category PRESENT in the preview model. */
const LEGEND_CATEGORIES: ReadonlyArray<EntityCategory> = [
  'belt',
  'inserter',
  'machine',
  'storage',
  'power',
  'rail',
  'pipe',
  'other',
];

const LEGEND_LABELS: Record<EntityCategory, string> = {
  belt: 'Belts',
  inserter: 'Inserters',
  machine: 'Machines',
  storage: 'Storage',
  power: 'Power',
  rail: 'Rails',
  pipe: 'Pipes',
  other: 'Other',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setVisible(node: HTMLElement, visible: boolean): void {
  node.classList.toggle('hidden', !visible);
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/** Type guard for JSON objects (no `any`): narrows unknown → Record. */
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** '–' between two coordinates, or the single coordinate when min === max. */
function formatBBoxAxis(min: number, max: number): string {
  return min === max ? `${min}` : `${min}–${max}`;
}

function legendChip(category: EntityCategory): HTMLSpanElement {
  const chip = el('span', 'chip pv-chip');
  chip.append(
    el('span', `pv-swatch pv-cat-${category}`),
    document.createTextNode(LEGEND_LABELS[category]),
  );
  return chip;
}

/** Never-throws formatted JSON: decoded data is acyclic, but stay safe. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return 'null';
  }
}

/**
 * Mount the BlueprintDeck UI into `root`. All state lives in this closure;
 * the blueprint/ modules stay DOM-free.
 */
export function mountBlueprintDeck(root: HTMLElement): void {
  root.replaceChildren();

  // ----- header -----------------------------------------------------------
  const header = el('header', 'site-header');
  const title = el('h1', undefined, 'BlueprintDeck');
  title.id = 'site-title';
  header.append(
    title,
    el(
      'p',
      'tagline',
      'Client-side Factorio 2.1 blueprint tools — decode strings, search entities, measure footprints.',
    ),
  );
  const companion = el('p', 'header-link');
  const companionLink = el('a', undefined, 'CircuitDeck');
  companionLink.href = CIRCUITDECK_URL;
  companionLink.target = '_blank';
  companionLink.rel = 'noopener';
  companion.append('Companion to the ', companionLink, ' Factorio dashboard');
  header.append(companion);

  // ----- input card -------------------------------------------------------
  const inputCard = el('section', 'card');
  inputCard.append(el('h2', undefined, 'Paste a blueprint string'));
  const inputLabel = el('label', 'field-label', 'Blueprint string or share URL');
  inputLabel.htmlFor = 'bp-input';
  const textarea = document.createElement('textarea');
  textarea.id = 'bp-input';
  textarea.spellcheck = false;
  textarea.placeholder = '0eNr… — or a share link containing #bp=… or ?bp=…';
  const inputActions = el('div', 'row');
  const clearButton = el('button', undefined, 'Clear');
  clearButton.type = 'button';
  const stats = el('span', 'muted stats');
  inputActions.append(clearButton, stats);
  inputCard.append(inputLabel, textarea, inputActions);

  // ----- error card -------------------------------------------------------
  const errorMessage = el('p', 'error-message');
  const errorKind = el('p', 'muted error-kind');
  const errorCard = el('section', 'card error-card hidden');
  errorCard.setAttribute('role', 'alert');
  errorCard.append(el('h2', undefined, "Can't decode that blueprint"), errorMessage, errorKind);

  // ----- summary card -----------------------------------------------------
  const summaryCard = el('section', 'card hidden');
  summaryCard.append(el('h2', undefined, 'Summary'));
  const bookRow = el('div', 'row book-row hidden');
  const bookLabel = el('label', 'field-label', 'Book page');
  bookLabel.htmlFor = 'book-select';
  const bookSelect = document.createElement('select');
  bookSelect.id = 'book-select';
  const bookSelectWrap = el('div', 'book-select-wrap');
  bookSelectWrap.append(bookLabel, bookSelect);
  bookRow.append(bookSelectWrap);
  const summaryLabel = el('h3', 'summary-label');
  const summaryPageNote = el('p', 'muted summary-page-note hidden');
  const summaryDescription = el('p', 'summary-description');
  const summaryVersion = el('p', 'muted summary-version');
  const iconChips = el('div', 'chips');
  const summaryTotals = el('p', 'summary-totals');
  const summaryTiles = el('p', 'muted summary-tiles hidden');
  summaryCard.append(
    bookRow,
    summaryLabel,
    summaryPageNote,
    summaryDescription,
    summaryVersion,
    iconChips,
    summaryTotals,
    summaryTiles,
  );

  // ----- entities card ----------------------------------------------------
  const entitiesCard = el('section', 'card hidden');
  entitiesCard.append(el('h2', undefined, 'Entities'));
  const searchRow = el('div', 'row');
  const searchInput = document.createElement('input');
  searchInput.id = 'search-input';
  searchInput.type = 'search';
  searchInput.placeholder = 'Filter by name or notes…';
  searchInput.setAttribute('aria-label', 'Filter entities');
  const matchCount = el('span', 'muted match-count');
  searchRow.append(searchInput, matchCount);
  const searchEmpty = el('p', 'search-empty hidden');
  const tableWrap = el('div', 'table-wrap');
  const table = el('table');
  const thead = el('thead');
  const headRow = document.createElement('tr');
  const sortButtons = new Map<
    SummarySortKey,
    { th: HTMLTableCellElement; button: HTMLButtonElement; column: string }
  >();
  for (const column of TABLE_COLUMNS) {
    const th = document.createElement('th');
    const meta = SORT_META[column];
    if (meta) {
      const button = el('button', 'sort-button', column);
      button.type = 'button';
      button.setAttribute('aria-label', `Sort by ${column.toLowerCase()}`);
      button.addEventListener('click', () => toggleSort(meta.key, meta.natural));
      th.append(button);
      sortButtons.set(meta.key, { th, button, column });
    } else {
      th.textContent = column;
    }
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  tableWrap.append(table);
  entitiesCard.append(searchRow, searchEmpty, tableWrap);

  // ----- preview card -----------------------------------------------------
  const previewSvgWrap = el('div', 'preview-svg-wrap');
  const previewLegend = el('div', 'chips');
  const previewCaption = el(
    'p',
    'muted pv-caption',
    'Approximate symbolic layout — not game graphics.',
  );
  const previewTruncated = el('p', 'muted pv-truncated hidden');
  const previewBody = el('div', 'preview-body');
  previewBody.append(previewSvgWrap, previewLegend, previewCaption, previewTruncated);
  const previewEmpty = el('p', 'pv-empty hidden', 'Nothing to draw.');
  const previewCard = el('section', 'card hidden');
  previewCard.append(el('h2', undefined, 'Preview'), previewBody, previewEmpty);

  // ----- footprint card ---------------------------------------------------
  const footprintSize = el('p', 'footprint-size');
  const footprintBBox = el('p', 'muted footprint-bbox hidden');
  const footprintCaveat = el('p', 'muted footprint-caveat');
  const footprintCard = el('section', 'card hidden');
  footprintCard.append(
    el('h2', undefined, 'Footprint'),
    footprintSize,
    footprintBBox,
    footprintCaveat,
  );

  // ----- share card -------------------------------------------------------
  const shareCard = el('section', 'card hidden');
  shareCard.append(
    el('h2', undefined, 'Share'),
    el(
      'p',
      'muted share-hint',
      "The decoded result lives only in this page's URL hash — copying the link shares the exact view.",
    ),
  );
  const shareRow = el('div', 'row');
  const shareInput = document.createElement('input');
  shareInput.className = 'share-input';
  shareInput.type = 'text';
  shareInput.readOnly = true;
  shareInput.setAttribute('aria-label', 'Shareable URL');
  const copyButton = el('button', undefined, 'Copy link');
  copyButton.type = 'button';
  const copyStatus = el('span', 'copy-status');
  copyStatus.setAttribute('aria-live', 'polite');
  shareRow.append(shareInput, copyButton, copyStatus);
  shareCard.append(shareRow);

  // ----- JSON card --------------------------------------------------------
  const jsonHint = el('p', 'muted json-hint');
  const jsonActions = el('div', 'row');
  const copyJsonButton = el('button', undefined, 'Copy JSON');
  copyJsonButton.type = 'button';
  const editToggleButton = el('button', undefined, 'Edit JSON');
  editToggleButton.type = 'button';
  const jsonStatus = el('span', 'copy-status');
  jsonStatus.setAttribute('aria-live', 'polite');
  jsonActions.append(copyJsonButton, editToggleButton, jsonStatus);
  const jsonView = el('pre', 'json-view');
  const jsonCode = el('code');
  jsonView.append(jsonCode);
  const jsonEditArea = document.createElement('textarea');
  jsonEditArea.className = 'json-edit hidden';
  jsonEditArea.spellcheck = false;
  jsonEditArea.setAttribute('aria-label', 'Edit blueprint JSON');
  const jsonEditRow = el('div', 'row hidden');
  const encodeButton = el('button', undefined, 'Encode → blueprint string');
  encodeButton.type = 'button';
  const cancelEditButton = el('button', undefined, 'Cancel');
  cancelEditButton.type = 'button';
  jsonEditRow.append(encodeButton, cancelEditButton);
  const jsonCard = el('section', 'card hidden');
  jsonCard.append(
    el('h2', undefined, 'JSON'),
    jsonHint,
    jsonActions,
    jsonView,
    jsonEditArea,
    jsonEditRow,
  );

  const main = el('main', undefined);
  // Label the landmark with the visible page title; the #app div carries no
  // ARIA attributes.
  main.setAttribute('aria-labelledby', 'site-title');
  main.append(
    inputCard,
    errorCard,
    summaryCard,
    previewCard,
    entitiesCard,
    footprintCard,
    jsonCard,
    shareCard,
  );
  root.append(header, main);

  // ----- state ------------------------------------------------------------
  let decoded: DecodedBlueprint | null = null;
  let bookIndex = 0;
  let query = '';
  let sortKey: SummarySortKey | null = null;
  let sortDir: SortDirection = 'desc';
  let editMode = false;
  /** Canonical '0…' payload used for the share hash, or null. */
  let bpValue: string | null = null;
  let decodeTimer: ReturnType<typeof setTimeout> | undefined;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let jsonTimer: ReturnType<typeof setTimeout> | undefined;
  /** Book page requested via the URL hash before the next decode. */
  let pendingSel: number | null = null;

  // ----- helpers ----------------------------------------------------------
  function currentPage(): BlueprintJson | null {
    if (!decoded) return null;
    if (decoded.kind === 'blueprint') return decoded.blueprint;
    return getBookPage(decoded.book, bookIndex);
  }

  function currentBook(): BlueprintBookJson | null {
    return decoded && decoded.kind === 'book' ? decoded.book : null;
  }

  /** True when the selected book page is itself a nested book (not expanded). */
  function currentPageIsNestedBook(): boolean {
    if (!decoded || decoded.kind !== 'book') return false;
    return decoded.book.blueprints[bookIndex]?.nestedBook === true;
  }

  /**
   * The TRUE decoded JSON for the current page (unknown fields preserved),
   * falling back to the typed page object when the raw path is missing.
   */
  function currentRawPageValue(page: BlueprintJson | null): unknown {
    if (!decoded) return page;
    const raw: BlueprintDocument = decoded.raw;
    if (decoded.kind === 'blueprint') {
      return isRecordValue(raw.blueprint) ? raw.blueprint : page;
    }
    const bookValue = raw.blueprint_book;
    if (!isRecordValue(bookValue)) return page;
    const pagesValue = bookValue.blueprints;
    if (!Array.isArray(pagesValue)) return page;
    const pageValue = pagesValue[bookIndex];
    if (isRecordValue(pageValue) && isRecordValue(pageValue.blueprint)) {
      return pageValue.blueprint;
    }
    return page;
  }

  function formatCurrentJson(page: BlueprintJson | null): string {
    return safeStringify(currentRawPageValue(page));
  }

  function clampBookIndex(book: BlueprintBookJson, index: number): number {
    if (book.blueprints.length === 0) return 0;
    return Math.min(Math.max(Math.trunc(index), 0), book.blueprints.length - 1);
  }

  function updateStats(): void {
    const value = textarea.value;
    if (!value) {
      stats.textContent = '';
      return;
    }
    const lines = value.split('\n').length;
    stats.textContent = `${value.length.toLocaleString()} chars · ${plural(lines, 'line')}`;
  }

  function updateHash(): void {
    if (!bpValue) {
      replaceHash('');
      return;
    }
    replaceHash(buildShareHash(bpValue, decoded?.kind === 'book' ? bookIndex : undefined));
  }

  function scheduleDecode(): void {
    if (decodeTimer) clearTimeout(decodeTimer);
    decodeTimer = setTimeout(runDecode, DEBOUNCE_MS);
  }

  function runDecode(): void {
    const text = textarea.value;
    if (!text.trim()) {
      resetOutput();
      return;
    }
    try {
      decoded = decodeBlueprint(text);
    } catch (error) {
      decoded = null;
      bpValue = null;
      showError(error);
      return;
    }
    // Mirror decode.ts's canonicalization for the share payload.
    const extracted = extractBlueprintParam(text);
    bpValue = (extracted ?? text).replace(/\s+/g, '');
    const book = currentBook();
    if (book) {
      bookIndex =
        pendingSel !== null
          ? clampBookIndex(book, pendingSel)
          : clampBookIndex(book, book.active_index ?? 0);
    }
    pendingSel = null;
    renderOutput();
  }

  function resetOutput(): void {
    decoded = null;
    bpValue = null;
    setVisible(errorCard, false);
    setVisible(summaryCard, false);
    setVisible(previewCard, false);
    setVisible(entitiesCard, false);
    setVisible(footprintCard, false);
    setVisible(jsonCard, false);
    setVisible(shareCard, false);
    updateHash();
  }

  function showError(error: unknown): void {
    setVisible(errorCard, true);
    setVisible(summaryCard, false);
    setVisible(previewCard, false);
    setVisible(entitiesCard, false);
    setVisible(footprintCard, false);
    setVisible(jsonCard, false);
    setVisible(shareCard, false);
    if (error instanceof BlueprintDecodeError) {
      errorMessage.textContent = error.message;
      errorKind.textContent = `Reason: ${error.kind}`;
    } else {
      errorMessage.textContent = 'Something went wrong while decoding.';
      errorKind.textContent = '';
    }
  }

  function renderOutput(): void {
    setVisible(errorCard, false);
    setVisible(summaryCard, true);
    setVisible(shareCard, true);
    const book = currentBook();
    const page = currentPage();

    renderBookSelect(book);
    renderSummary(book, page);
    renderPreview(page);
    renderJson(page);
    renderTable(page);
    renderFootprint(page);
    updateHash();
    shareInput.value = window.location.href;
  }

  function toggleSort(key: SummarySortKey, natural: SortDirection): void {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = natural;
    }
    updateSortHeaders();
    renderTable(currentPage());
  }

  function updateSortHeaders(): void {
    for (const [key, refs] of sortButtons) {
      if (sortKey === key) {
        refs.th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
        refs.button.textContent = `${refs.column} ${sortDir === 'asc' ? '▲' : '▼'}`;
      } else {
        refs.th.removeAttribute('aria-sort');
        refs.button.textContent = refs.column;
      }
    }
  }

  function setJsonStatus(message: string, failed: boolean): void {
    jsonStatus.textContent = message;
    jsonStatus.classList.toggle('copy-failed', failed);
    if (jsonTimer) clearTimeout(jsonTimer);
    jsonTimer = setTimeout(() => {
      jsonStatus.textContent = '';
      jsonStatus.classList.remove('copy-failed');
    }, COPY_CONFIRMATION_MS);
  }

  function setEditMode(mode: boolean): void {
    editMode = mode;
    if (mode) {
      jsonEditArea.value = formatCurrentJson(currentPage());
    }
    setVisible(jsonView, !mode);
    setVisible(jsonEditArea, mode);
    setVisible(jsonEditRow, mode);
  }

  function renderPreview(page: BlueprintJson | null): void {
    setVisible(previewCard, page !== null);
    const model = page ? buildBlueprintPreview(page) : null;
    const empty = !model || (model.entities.length === 0 && model.tiles.length === 0);
    setVisible(previewBody, !empty);
    setVisible(previewEmpty, empty);
    if (!model || empty) {
      previewTruncated.textContent = '';
      setVisible(previewTruncated, false);
      return;
    }
    previewSvgWrap.replaceChildren(renderPreviewSvg(model));
    const present = new Set(model.entities.map((entity) => entity.category));
    previewLegend.replaceChildren(
      ...LEGEND_CATEGORIES.filter((category) => present.has(category)).map(legendChip),
    );
    if (model.truncated) {
      previewTruncated.textContent =
        `Showing the first ${PREVIEW_MAX_ENTITIES} of ${model.entityCount} entities ` +
        `and first ${PREVIEW_MAX_TILES} of ${model.tileCount} tiles.`;
      setVisible(previewTruncated, true);
    } else {
      previewTruncated.textContent = '';
      setVisible(previewTruncated, false);
    }
  }

  function renderJson(page: BlueprintJson | null): void {
    setVisible(jsonCard, page !== null);
    // Reset the transient status on every decode / page selection change.
    jsonStatus.textContent = '';
    jsonStatus.classList.remove('copy-failed');
    if (jsonTimer) clearTimeout(jsonTimer);
    jsonHint.textContent =
      decoded?.kind === 'book'
        ? 'The decoded blueprint as formatted JSON. The selected page is shown; encoding it exports the page as a standalone blueprint string.'
        : 'The decoded blueprint as formatted JSON.';
    if (page === null) {
      jsonCode.textContent = '';
      jsonEditArea.value = '';
      return;
    }
    if (editMode) {
      // The editor always shows the currently selected page's JSON.
      jsonEditArea.value = formatCurrentJson(page);
    } else {
      jsonCode.textContent = formatCurrentJson(page);
    }
  }

  function renderBookSelect(book: BlueprintBookJson | null): void {
    if (!book) {
      setVisible(bookRow, false);
      return;
    }
    setVisible(bookRow, true);
    bookSelect.replaceChildren();
    book.blueprints.forEach((page, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${index + 1}. ${page.blueprint.label ?? '(untitled)'}`;
      bookSelect.append(option);
    });
    bookSelect.value = String(bookIndex);
  }

  function renderSummary(book: BlueprintBookJson | null, page: BlueprintJson | null): void {
    const label = page?.label ?? book?.label ?? null;
    summaryLabel.textContent = label ?? (book ? 'Untitled book' : 'Untitled blueprint');
    // Nested books decode as empty-looking pages; be honest that they are not
    // expanded instead of presenting a silent 0-entity page.
    const nested = currentPageIsNestedBook();
    summaryPageNote.textContent = nested ? 'Nested book page — not expanded.' : '';
    setVisible(summaryPageNote, nested);
    const description = page?.description ?? book?.description ?? '';
    summaryDescription.textContent = description;
    setVisible(summaryDescription, description !== '');

    const version = page?.version ?? book?.version;
    summaryVersion.textContent =
      version === undefined ? 'Unknown version' : `Factorio ${formatBlueprintVersion(version)}`;

    const icons = page && page.icons.length > 0 ? page.icons : (book?.icons ?? []);
    iconChips.replaceChildren(
      ...icons.map((icon) =>
        el(
          'span',
          'chip',
          icon.signal.type === 'item'
            ? icon.signal.name
            : `${icon.signal.name} (${icon.signal.type})`,
        ),
      ),
    );

    if (!page) {
      summaryTotals.textContent = book ? 'This book contains no pages.' : '';
      setVisible(summaryTiles, false);
      setVisible(entitiesCard, false);
      setVisible(footprintCard, false);
      return;
    }
    const summary = summarizeBlueprint(page);
    const totals = summary.totals;
    summaryTotals.textContent = [
      plural(totals.entityCount, 'entity'),
      plural(totals.entityTypes, 'type'),
      plural(totals.tileCount, 'tile'),
      `${totals.tileTypes} tile type${totals.tileTypes === 1 ? '' : 's'}`,
    ].join(' · ');
    if (summary.tiles.length > 0) {
      summaryTiles.textContent = `Tiles: ${formatTileTallies(summary.tiles)}`;
      setVisible(summaryTiles, true);
    } else {
      summaryTiles.textContent = '';
      setVisible(summaryTiles, false);
    }
    setVisible(entitiesCard, true);
    setVisible(footprintCard, true);
  }

  function renderTable(page: BlueprintJson | null): void {
    if (!page) {
      tbody.replaceChildren();
      matchCount.textContent = '';
      setVisible(searchEmpty, false);
      return;
    }
    const rows = summarizeBlueprint(page).rows;
    const filtered = filterSummaryRows(rows, query);
    const visible = sortKey ? sortSummaryRows(filtered, sortKey, sortDir) : filtered;
    const trimmed = query.trim();
    matchCount.textContent = trimmed
      ? `${visible.length} of ${rows.length} match`
      : plural(rows.length, 'entity type');
    setVisible(searchEmpty, trimmed !== '' && visible.length === 0);
    if (trimmed !== '' && visible.length === 0) {
      searchEmpty.textContent = `No entities match “${trimmed}”.`;
    }
    tbody.replaceChildren(...visible.map(rowToTr));
  }

  function formatTileTallies(tiles: TileTally[]): string {
    return tiles.map((tally) => `${tally.name} ×${tally.count}`).join(' · ');
  }

  function rowToTr(row: EntitySummaryRow): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.append(
      el('td', 'entity-name', row.name),
      el('td', undefined, String(row.count)),
      // Direction-dependent sizes (splitters, rails, …) are shown at the
      // row's dominant direction, matching the footprint/preview math.
      el('td', undefined, formatEntitySize(getEntitySize(row.name, dominantDirection(row)))),
      el('td', undefined, formatPositionSpan(row)),
      el('td', undefined, row.directions.map((d) => `${d.label}×${d.count}`).join(', ')),
      el('td', undefined, row.notes.join(', ')),
    );
    return tr;
  }

  function renderFootprint(page: BlueprintJson | null): void {
    if (!page) {
      footprintSize.textContent = 'No footprint';
      footprintBBox.textContent = '';
      setVisible(footprintBBox, false);
      footprintCaveat.textContent = '';
      return;
    }
    const result = computeFootprint(page);
    footprintSize.textContent =
      result.widthTiles === 0
        ? 'No footprint to measure'
        : `${result.widthTiles}×${result.heightTiles} tiles · area ${result.area} tiles`;
    if (result.widthTiles > 0) {
      footprintBBox.textContent =
        `Bounding box: x ${formatBBoxAxis(result.minTileX, result.maxTileX)} · ` +
        `y ${formatBBoxAxis(result.minTileY, result.maxTileY)}`;
      setVisible(footprintBBox, true);
    } else {
      footprintBBox.textContent = '';
      setVisible(footprintBBox, false);
    }
    footprintCaveat.textContent = formatFootprintCaveat(result);
  }

  // ----- events -----------------------------------------------------------
  textarea.addEventListener('input', () => {
    updateStats();
    scheduleDecode();
  });

  clearButton.addEventListener('click', () => {
    if (decodeTimer) clearTimeout(decodeTimer);
    textarea.value = '';
    query = '';
    searchInput.value = '';
    sortKey = null;
    sortDir = 'desc';
    updateSortHeaders();
    setEditMode(false);
    jsonStatus.textContent = '';
    jsonStatus.classList.remove('copy-failed');
    if (jsonTimer) clearTimeout(jsonTimer);
    updateStats();
    resetOutput();
  });

  bookSelect.addEventListener('change', () => {
    const book = currentBook();
    if (!book) return;
    bookIndex = clampBookIndex(book, Number.parseInt(bookSelect.value, 10) || 0);
    renderOutput();
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderTable(currentPage());
  });

  copyButton.addEventListener('click', () => {
    void copyTextToClipboard(shareInput.value).then((copied) => {
      copyStatus.textContent = copied ? 'Copied ✓' : 'Copy failed — select the URL above manually.';
      copyStatus.classList.toggle('copy-failed', !copied);
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copyStatus.textContent = '';
        copyStatus.classList.remove('copy-failed');
      }, COPY_CONFIRMATION_MS);
    });
  });

  editToggleButton.addEventListener('click', () => {
    setEditMode(!editMode);
  });

  cancelEditButton.addEventListener('click', () => {
    setEditMode(false);
  });

  copyJsonButton.addEventListener('click', () => {
    void copyTextToClipboard(formatCurrentJson(currentPage())).then((copied) => {
      setJsonStatus(copied ? 'Copied ✓' : 'Copy failed — select the JSON text manually.', !copied);
    });
  });

  encodeButton.addEventListener('click', () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonEditArea.value) as unknown;
    } catch {
      setJsonStatus('The edited text is not valid JSON.', true);
      return;
    }
    try {
      const encoded = encodeBlueprintPage(parsed);
      textarea.value = encoded;
      updateStats();
      setEditMode(false);
      runDecode();
      setJsonStatus('Encoded ✓ — inspecting the re-encoded blueprint.', false);
    } catch (error) {
      if (error instanceof BlueprintDecodeError) {
        setJsonStatus(error.message, true);
      } else {
        setJsonStatus('Encoding failed.', true);
      }
    }
  });

  // ----- initial state ----------------------------------------------------
  const initial = parseShareHash(window.location.hash);
  if (initial.bp) {
    textarea.value = window.location.hash;
    pendingSel = initial.sel;
    updateStats();
    runDecode();
  } else {
    updateStats();
  }
}
