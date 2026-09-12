# AGENTS.md

Client-side Factorio 2.1 blueprint tools: decode blueprint strings, searchable
entity summaries, tile footprints, shareable result URLs. Companion to the
[CircuitDeck](https://github.com/brocahontaz/circuitdeck) Factorio dashboard.

## Stack

- TypeScript (strict) + Vite + Vitest (node environment), npm; Node 22/npm 10.
- ESLint 9 flat config + Prettier.
- Sole runtime dependency: `pako` (+ `@types/pako`). No UI framework, no
  backend, no assets — the UI is one dark CSS file and typed DOM code.

## Commands

```sh
npm install
npm test            # vitest run
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run format:check
npm run build       # tsc --noEmit && vite build
npm run dev         # manual UI check
```

Run the relevant checks before completing any change; observable behavior
changes need automated tests under `tests/` (vitest, node environment).

## Conventions

- Work in vertical slices: smallest useful end-to-end behavior first
  (implementation + tests + verification together).
- Domain logic lives in `src/blueprint/` and must stay DOM-free; `src/ui/` is
  the only DOM-aware layer. `src/ui/app.ts` owns all state and event wiring.
- Decoding failures are always typed `BlueprintDecodeError` with short human
  messages; never leak raw errors to the UI.
- No `any` in public APIs. Prefer discriminated unions for decoded data.
- Do not copy game content, assets, or Phaser. The size table in
  `src/blueprint/sizes.ts` holds tile counts only and is documented as an
  approximation in the README.
- Match the config patterns of the sibling project `reel-and-riff-web`
  (ESLint flat config, tsconfig, vite.config, .prettierrc, package scripts).

## Git

Agents may run read-only git commands (`git status`, `git diff`,
`git log`, `git branch`, `git switch`) but must not commit or push unless
explicitly asked.
