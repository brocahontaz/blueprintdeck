# BlueprintDeck

Small client-side tools for Factorio 2.1 blueprint strings: paste a string, get
a searchable entity summary, tile footprints, a symbolic 2D preview, and a
shareable URL for the exact result.

## Why "BlueprintDeck"

It is part of a small family of Factorio companion tools styled as "decks":
the sibling project [CircuitDeck](https://github.com/brocahontaz/circuitdeck)
visualizes circuit-network signals, and BlueprintDeck covers the other half of
the game's clipboard culture — blueprint strings. A "deck" of blueprints is
exactly what a blueprint book is, so the name doubles as the feature list.

## MVP features

- **Decode** — paste a blueprint string, a whole share URL (`#bp=…` or `?bp=…`),
  or a messy multi-line paste. Whitespace is stripped, URL parameters are
  extracted, and both raw DEFLATE (Factorio 0.17+) and zlib-wrapped payloads
  are supported. Single blueprints and blueprint books both decode.
- **Summary** — label, description, Factorio version, icon signals as text
  chips, totals (entity count, distinct entity types, tile count, distinct
  tile types), and a per-name tile tally line (`landfill ×40 · stone-brick ×12`).
- **Books** — pick a page from a decoded book; every card recomputes for the
  selection and the URL remembers the chosen page.
- **Entity table** — grouped rows per entity type: count, approximate size at
  the row's dominant direction (`1×1`, `≈3×3`, `1×1?` for unknowns), position
  span, direction histogram (0..7 → N/NE/E/SE/S/SW/W/NW), and notes covering
  recipes, quality tiers, chest inventory contents, modules, and per-entity
  settings (`electronic-circuit ×12, quality: uncommon, iron-plate ×100`).
  Rows are sortable by name, count, size, and position, and a case-insensitive
  filter matches names and notes.
- **Footprint** — approximate width × height in tiles, area, the exact
  tile-coordinate bounding box, and a caveat line counting approximate and
  unknown sizes (see below).
- **Preview** — a symbolic 2D grid preview of the selected page: one
  category-colored box per entity, direction arrows, and the bounding box.
  Category colors match the Summary chips. Not game graphics — just an
  approximate symbolic layout. Huge blueprints are capped at the first 3000
  entities and 8000 tiles (in sorted order) with a truncation note.
- **JSON** — a formatted view of the TRUE decoded JSON for the selected page
  (unknown fields preserved, untouched), with **Copy JSON** and **Edit JSON**:
  edits are re-encoded into a new blueprint string after validating through
  the same decoder rules. For a book, the selected page can be exported as a
  standalone blueprint string.
- **Share links** — the decoded string lives in the URL hash (`#bp=…&sel=…`);
  copying the link reproduces the exact view. A copy button uses the Clipboard
  API with an `execCommand` fallback.

Everything runs in the browser; there is no backend.

## Docker

BlueprintDeck ships as a fully static site: a multi-stage `Dockerfile` builds
the Vite output with Node and serves it with nginx (pinned `nginx:1.27-alpine`).

```sh
docker build -t blueprintdeck .
docker run -p 8080:8080 blueprintdeck
```

Or with compose for local development/testing:

```sh
docker compose up --build
```

The image self-reports health via `/healthz` (plain `ok`, inherited by compose).
Everything is static and client-side — no backend, no volumes, no environment
variables. Assets are served with relative paths (`vite.config.ts` sets
`base: './'`), so the container works behind any reverse proxy, from any path.

## Privacy

Blueprint data never leaves your machine. Decoding, summarizing, footprint
math, the preview, and JSON editing all happen client-side, and the only
persisted state is the URL hash — the standard place a Factorio blueprint
string already travels. Nothing is uploaded, logged, or stored.

## Format notes

Blueprint strings follow the
[Blueprint string format](https://wiki.factorio.com/Blueprint_string_format):
a `0` version character, then base64url-encoded raw DEFLATE-compressed JSON
(`-`/`_` map to `+`/`/`). Decoder behavior in this project:

- all whitespace (including newlines) is stripped before decoding;
- `#bp=` / `?bp=` URL parameters are extracted before the version check;
- raw DEFLATE is tried first, with a zlib-wrapper fallback for older or
  non-standard encoders;
- every failure becomes a typed `BlueprintDecodeError` with a short human
  reason (`not-a-blueprint-string`, `bad-base64`, `bad-deflate`, `bad-json`,
  `unexpected-shape`) — raw errors never reach the UI.

JSON editing re-encodes with the inverse of this pipeline: the edited page is
validated with the same normalizers, then serialized back to
`'0' + base64url(deflateRaw(JSON))` with unknown fields preserved.

Known limitations: nested blueprint books are not expanded (each book page is
expected to be a plain blueprint; nested book pages are flagged with a note in
the UI), and version numbers are JavaScript numbers, so packings above
`Number.MAX_SAFE_INTEGER` report an unknown version.

## Footprint accuracy

Entity positions in blueprint JSON are centers; the footprint unions
`position ± size/2` boxes per entity. The size dataset in
`src/blueprint/sizes.ts` is an **approximation**, not game data:

- confident sizes are exact tile counts (belts 1×1, assemblers 3×3,
  rocket silo 9×9, …);
- `approx: true` sizes are close but not exact (steam engines, rails,
  splitters, Space Age machines);
- unknown entities are assumed 1×1 and flagged with `?`.

Direction-aware entries (`splitter`, `train-stop`, `straight-rail`) record
their size at direction 0/4 and swap width/height at directions 2/6.

To extend the dataset, add an entry to `ENTITY_SIZES` in
`src/blueprint/sizes.ts`:

```ts
'new-entity': { w: 3, h: 3 },              // confident
'wobbly-entity': { w: 4, h: 2, approx: true }, // approximate
```

No game assets or content are copied here — only tile counts.

## Development

Requires Node 22 and npm 10.

```sh
npm install
npm run dev       # Vite dev server
npm test          # Vitest (node environment)
npm run typecheck # tsc --noEmit
npm run lint      # ESLint 9 flat config
npm run format    # Prettier write
npm run format:check
npm run build     # typecheck + vite build into dist/
```

Stack: TypeScript (strict) + Vite + Vitest, ESLint 9 flat config + Prettier.
The only runtime dependency is `pako` for DEFLATE; there is no UI framework.

## Test data

All fixtures are synthetic (built in `tests/fixtures.ts` with the same
`'0' + base64url(deflateRaw(JSON))` encoding Factorio uses). A real-string
integration fixture was attempted but skipped for the MVP: public blueprint
sites either need a rendered SPA or an account, so no embeddable string could
be fetched cleanly.

## License

[MIT](./LICENSE)
