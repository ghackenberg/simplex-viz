# Contributing to SimplexViz

Thank you for your interest in **SimplexViz**! This guide covers the local workspace setup, strict architectural boundaries, and the release workflow.

## Local Setup

```bash
pnpm install
pnpm dev               # Starts the docs & showcase app on port 3000 against package sources
pnpm test              # Runs the Vitest suite across all workspace packages
pnpm lint              # Checks ESLint Flat Config + workspace TypeScript typecheck
pnpm validate:packages # Validates package exports and ESM/CJS types via publint
pnpm release:check     # Runs brand-check, lint, typecheck, package builds, publint, tests, and demo build
```

## Strict Architecture & Module Boundaries

The separation across the five workspace packages is mechanically enforced via TypeScript (`packages/*/tsconfig.json`) and ESLint (`eslint.config.js`):

1. **`@simplex-viz/core`** (`packages/core`):
   - **Zero** runtime dependencies (`"dependencies": {}`).
   - **No** DOM globals in `.` or `./worker` (`lib: ["ES2022"]` without `"DOM"`, no `window`, `document`, or `SVGElement`); structural browser/DOM helpers live exclusively under `@simplex-viz/core/dom`.
   - **No** imports from `react`, `react-dom`, `@simplex-viz/svg`, `@simplex-viz/canvas`, `@simplex-viz/react`, or `@simplex-viz/wc`.
2. **`@simplex-viz/svg`** (`packages/svg`):
   - Depends exclusively on `@simplex-viz/core` (and `@simplex-viz/core/dom`).
   - Headless SSR string rendering lives exclusively under `@simplex-viz/svg/ssr` (not re-exported from root).
   - **No** imports from `react`, `react-dom`, `@simplex-viz/react`, or `@simplex-viz/wc`.
3. **`@simplex-viz/canvas`** (`packages/canvas`):
   - Depends exclusively on `@simplex-viz/core` (and `@simplex-viz/core/dom`) — **zero** dependency on `@simplex-viz/svg`.
   - **No** imports from `react`, `react-dom`, `@simplex-viz/svg`, `@simplex-viz/react`, or `@simplex-viz/wc`.
4. **`@simplex-viz/wc`** (`packages/wc`):
   - Custom Element (`<simplex-topic-graph>`) with auto-registration exclusively under `@simplex-viz/wc/define`.
   - Depends on `@simplex-viz/core` and `@simplex-viz/svg` — **no** imports from `react`, `react-dom`, or `@simplex-viz/react`.
5. **`@simplex-viz/react`** (`packages/react`):
   - React 18 & 19 bindings wrapping `@simplex-viz/core` and `@simplex-viz/svg`.
6. **No `any` casts** when threading generic types (`TItem`, `TTagMeta`, `TClusterMeta`, `TContentVisual`, `TClusterVisual`).

## Developing Custom Renderer Plugins

- **SVG (`SvgNodeView`)**: Define a pure data descriptor `TVisual` without DOM references, implement `mountOrUpdate(groupEl, visual, state)` around local `(0, 0)`, and optionally implement `measureConvexHull(visual)` for analytical hulls (otherwise `@simplex-viz/svg` measures via offscreen `getBBox()`).
- **Canvas (`Canvas*Renderer`)**: Implement pure Canvas 2D draw hooks (`drawTriangle`, `drawEdge`, `drawCluster`, `drawContent`) without DOM mutations so `renderSimplexSnapshotToCanvas()` and `exportPng()` work cleanly.
- Add tests under `packages/<pkg>/__tests__` and run `pnpm release:check` before opening a PR.

## Changesets & Pull Requests

Create a changeset for user-facing changes:

```bash
pnpm changeset
```

Select the affected packages (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/canvas`, `@simplex-viz/react`, `@simplex-viz/wc`), choose the SemVer bump type (`patch`, `minor`, `major`), and add a concise summary. Before opening a PR, verify that `pnpm release:check` passes cleanly.
