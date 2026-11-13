# Contributing to SimplexViz

Thank you for your interest in **SimplexViz**! This guide covers the local workspace setup, strict architectural boundaries, and the release workflow.

## Local Setup

```bash
pnpm install
pnpm dev          # Starts the demo app on port 3000 (directly against package sources)
pnpm test         # Runs the Vitest test suite
pnpm lint         # Checks ESLint Flat Config + TypeScript module boundaries
```

## Strict Architecture & Module Boundaries

The separation of the three packages is mechanically enforced via TypeScript (`packages/core/tsconfig.json`) and ESLint (`eslint.config.js`):

1. **`@simplex-viz/core`** (`packages/core`):
   - **Zero** runtime dependencies (`"dependencies": {}`).
   - **No** DOM (`lib: ["ES2022"]` without `"DOM"`), no `window`, no `document`, no `SVGElement`.
   - **No** imports from `react`, `react-dom`, `@simplex-viz/svg`, or `@simplex-viz/react`.
2. **`@simplex-viz/svg`** (`packages/svg`):
   - Depends exclusively on `@simplex-viz/core`.
   - **No** imports from `react`, `react-dom`, or `@simplex-viz/react`.
3. **No `any` or `as unknown` casts** when threading generic types (`TItem`, `TTagMeta`, `TClusterMeta`, `TContentVisual`, `TClusterVisual`).

## Developing Custom `SvgNodeView` Plugins

1. Define a pure data descriptor `TVisual` without DOM references.
2. Implement `mountOrUpdate(groupEl, visual, state)` around the local origin `(0, 0)`.
3. Optionally implement `measureConvexHull(visual)` for analytical convex hulls, or omit the method so `@simplex-viz/svg` measures the bounding box automatically via offscreen `getBBox()`.
4. Add tests under `packages/svg/__tests__` and run `pnpm test` as well as `pnpm build:packages`.

## Changesets & Pull Requests

Create a changeset for user-facing changes:

```bash
pnpm changeset
```

Select the affected packages (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react`), choose the SemVer bump type (`patch`, `minor`, `major`), and add a concise summary. Before opening a PR, make sure `pnpm lint`, `pnpm test`, and `pnpm build:packages` pass cleanly.
