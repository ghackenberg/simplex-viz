# @simplex-viz/core

Headless, zero-dependency TypeScript engine for triangulation-based tagged content visualization on a dynamic 60° equilateral simplex mesh.

- **Live Demo:** <https://hackenberg.tech/simplex-viz/>
- **Source & Monorepo:** <https://github.com/ghackenberg/simplex-viz/tree/main/packages/core>

## Features

- **Zero dependencies & zero DOM**: Strict `ES2022`-only compilation (`"dependencies": {}`), runs in browsers, Node.js, Web Workers, or Edge runtimes.
- **Schema-free & end-to-end type safe**: Works with arbitrary `<TItem, TContentVisual, TClusterVisual, TTagMeta, TClusterMeta>` via conditional hybrid accessors (`ItemIdentityConfig`) and `deriveClusterMeta`.
- **Two-stage topic clustering**: Regularized Jaccard partition + Simulated Annealing QAP mesh embedding + Weighted Hitting-Set planar triangle completion + backward pruning + Hungarian bipartite identity matching.
- **Perceptual OKLab palette & mixing**: Edge-contrast optimized cluster colors and chroma-preserving OKLab mixing.
- **Strict 0.0 px overlap guarantee**: Hierarchical 2-phase solver combining Separating Axis Theorem (SAT), circle-polygon analytics, spatial hash grids, binary scale search, and hard-separation polishing.
- **Interruptible C1-continuous animation**: Critically damped spring integrators and dual-layer transition tracking.

## Installation

```bash
npm install @simplex-viz/core
```

## Usage

Implement `SimplexRendererAdapter<TContentVisual, TClusterVisual>` (or use `@simplex-viz/svg` / `@simplex-viz/react` directly) and instantiate `SimplexGraphEngine`.
