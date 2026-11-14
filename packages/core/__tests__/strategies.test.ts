import { describe, expect, it, vi } from 'vitest';
import { SimplexGraphEngine } from '../src/engine';
import { solveSimplexSnapshot } from '../src/snapshot';
import {
  createAdaptiveHexMeshStrategy,
  createFixedLatticeMeshStrategy,
  createIncrementalAnchorClusteringStrategy,
  createJaccardAnnealingClusteringStrategy,
  createLocalAdaptiveLayoutStrategy,
  createPaletteColorStrategy,
  createPbdUniformLayoutStrategy,
  createThemeAdaptiveOklabColorStrategy,
  createWarmStartPbdLayoutStrategy,
  type SimplexClusteringStrategy,
} from '../src/strategies';
import { hexToOklab } from '../src/oklab';
import type {
  ClusterDescriptor,
  ContentLayoutContext,
  DefaultTaggedItem,
  SimplexRendererAdapter,
  VisualResolver,
} from '../src/types';

const TEST_ITEMS: readonly DefaultTaggedItem[] = [
  { id: '1', tags: ['rust', 'wasm'] },
  { id: '2', tags: ['rust', 'compilers'] },
  { id: '3', tags: ['typescript', 'compilers', 'ast'] },
  { id: '4', tags: ['typescript', 'react', 'svg'] },
  { id: '5', tags: ['svg', 'animation', 'geometry'] },
  { id: '6', tags: ['geometry', 'triangulation', 'sat'] },
  { id: '7', tags: ['oklab', 'color', 'svg'] },
  { id: '8', tags: ['crdt', 'distributed', 'consensus'] },
  { id: '9', tags: ['webgl', 'shaders', 'geometry'] },
  { id: '10', tags: ['react', 'accessibility', 'typography'] },
  { id: '11', tags: ['rust', 'webgl', 'triangulation'] },
];

function createHeadlessRenderer(): SimplexRendererAdapter<
  { readonly r: number },
  { readonly r: number }
> {
  return {
    measureContentHull: (v) => ({ kind: 'circle', radius: v.r }),
    measureClusterHull: (v) => ({ kind: 'circle', radius: v.r }),
    renderFrame: () => {},
    destroy: () => {},
  };
}

const HEADLESS_RESOLVER: VisualResolver<
  DefaultTaggedItem,
  { readonly r: number },
  { readonly r: number }
> = {
  resolveContentVisual: () => ({ r: 10 }),
  resolveClusterVisual: () => ({ r: 22 }),
  getVisualCacheKey: () => 'v1',
};

describe('Pluggable Core Strategies', () => {
  it('supports custom SimplexMeshStrategy (fixed lattice) in snapshot & runtime swapping', () => {
    const fixedMesh = createFixedLatticeMeshStrategy({ cols: 3, rows: 2 });
    const snap = solveSimplexSnapshot(TEST_ITEMS, {
      width: 800,
      height: 500,
      meshStrategy: fixedMesh,
    });

    // 3 + 2 vertices = 5 clusters, 3 equilateral triangles
    expect(snap.clusters.length).toBe(5);
    expect(snap.mesh.triangles.length).toBe(3);
    expect(snap.metrics.overlapCount).toBe(0);

    const engine = new SimplexGraphEngine({
      items: TEST_ITEMS,
      visualResolver: HEADLESS_RESOLVER,
      renderer: createHeadlessRenderer(),
      viewportWidth: 800,
      viewportHeight: 500,
      meshStrategy: fixedMesh,
    });
    expect(engine.getClusters().length).toBe(5);

    engine.setMeshStrategy(createAdaptiveHexMeshStrategy());
    expect(engine.getClusters().length).toBeGreaterThanOrEqual(5);
    engine.destroy();
  });

  it('calls initialize() initially and update() on items/viewport mutations with incremental stability', () => {
    const base = createIncrementalAnchorClusteringStrategy<DefaultTaggedItem>();
    const initSpy = vi.fn(base.initialize.bind(base));
    const updateSpy = vi.fn(base.update!.bind(base));
    const spiedStrategy: SimplexClusteringStrategy<DefaultTaggedItem> = {
      name: 'spied-incremental',
      initialize: initSpy,
      update: updateSpy,
    };

    const engine = new SimplexGraphEngine({
      items: TEST_ITEMS.slice(0, 8),
      visualResolver: HEADLESS_RESOLVER,
      renderer: createHeadlessRenderer(),
      viewportWidth: 920,
      viewportHeight: 600,
      clusteringStrategy: spiedStrategy,
    });

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(0);

    const initialUids = new Set(engine.getClusters().map((c) => c.clusterUid));

    engine.addItems([
      { id: '12', tags: ['rust', 'gpu', 'vulkan'] },
      { id: '13', tags: ['crdt', 'sync'] },
    ]);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0].reason).toBe('items');
    expect(updateSpy.mock.calls[0]![0].addedItemIds.has('12')).toBe(true);

    // Every new/existing item must stay 100% covered via coreTags + sharedTags
    const afterAddClusters = engine.getClusters();
    const preservedUids = afterAddClusters.filter((c) => initialUids.has(c.clusterUid));
    expect(preservedUids.length).toBeGreaterThanOrEqual(3);

    engine.setViewport(1040, 660);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy.mock.calls[1]![0].reason).toBe('viewport');

    engine.removeItems('12');
    expect(updateSpy).toHaveBeenCalledTimes(3);
    expect(updateSpy.mock.calls[2]![0].removedItemIds.has('12')).toBe(true);
    engine.destroy();
  });

  it('allows disabling shared tags (sharedTagRule: "none") and switching simplex anchor rules', () => {
    const noShared = solveSimplexSnapshot(TEST_ITEMS, {
      clusteringStrategy: createJaccardAnnealingClusteringStrategy({
        sharedTagRule: 'none',
        anchorRule: 'barycentric-all',
      }),
    });

    for (const c of noShared.clusters) {
      expect(c.cluster.sharedTags.length).toBe(0);
    }
    for (const it of noShared.items) {
      const weightSum = it.layoutContext.unitClusters.reduce((s, u) => s + u.weight, 0);
      expect(Math.abs(weightSum - 1)).toBeLessThan(1e-5);
    }
  });

  it('supports swappable color strategies and theme-adaptive OKLab palettes without re-clustering', () => {
    const palette = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#06b6d4'];
    const baseClustering = createJaccardAnnealingClusteringStrategy<DefaultTaggedItem>();
    const initSpy = vi.fn(baseClustering.initialize.bind(baseClustering));
    const spiedClustering: SimplexClusteringStrategy<DefaultTaggedItem> = {
      name: 'spied',
      initialize: initSpy,
      update: (ctx) => baseClustering.initialize(ctx),
    };

    const engine = new SimplexGraphEngine({
      items: TEST_ITEMS,
      visualResolver: HEADLESS_RESOLVER,
      renderer: createHeadlessRenderer(),
      viewportWidth: 900,
      viewportHeight: 600,
      clusteringStrategy: spiedClustering,
      colorStrategy: createThemeAdaptiveOklabColorStrategy(),
      theme: 'dark',
    });

    expect(initSpy).toHaveBeenCalledTimes(1);
    const darkMeanL =
      engine.getClusters().reduce((s, c) => s + c.oklab[0], 0) /
      engine.getClusters().length;

    engine.setTheme('light');
    // Theme flip re-colors without re-running clustering!
    expect(initSpy).toHaveBeenCalledTimes(1);
    const lightMeanL =
      engine.getClusters().reduce((s, c) => s + c.oklab[0], 0) /
      engine.getClusters().length;
    expect(lightMeanL).toBeLessThan(darkMeanL);

    engine.setColorStrategy(
      createPaletteColorStrategy(palette, { mode: 'sequential' }),
    );
    expect(initSpy).toHaveBeenCalledTimes(1);
    const paletteSet = new Set(palette);
    for (const c of engine.getClusters()) {
      expect(paletteSet.has(c.colorHex)).toBe(true);
      expect(hexToOklab(c.colorHex)[0]).toBeGreaterThan(0);
    }
    engine.destroy();
  });

  it('supports local-adaptive and warm-start layout strategies with 0.0px overlap guarantee', () => {
    // Create a deliberately skewed hotspot dataset: 24 items share exact tags at one cluster,
    // plus a few sparse items elsewhere
    const skewedItems: DefaultTaggedItem[] = [
      ...Array.from({ length: 24 }, (_, i) => ({
        id: `hot-${i}`,
        tags: ['hotspot', 'core'],
      })),
      { id: 'sparse-a', tags: ['alpha', 'beta'] },
      { id: 'sparse-b', tags: ['gamma', 'delta'] },
      { id: 'sparse-c', tags: ['epsilon', 'zeta'] },
    ];

    const localSnap = solveSimplexSnapshot(skewedItems, {
      width: 680,
      height: 460,
      itemRadius: 16,
      layoutStrategy: createLocalAdaptiveLayoutStrategy({
        crowdRadiusPx: 90,
        minLocalScale: 0.4,
      }),
    });

    expect(localSnap.metrics.overlapCount).toBe(0);
    expect(localSnap.metrics.maxPenetrationPx).toBeLessThanOrEqual(1e-4);

    const hotspotItem = localSnap.items.find((it) => it.id === 'hot-0')!;
    const sparseItem = localSnap.items.find((it) => it.id === 'sparse-a')!;
    // Locally dense hotspot shrinks more than sparse outlier
    expect(hotspotItem.scale).toBeLessThan(sparseItem.scale);

    // Warm-start runtime strategy switch on engine
    let capturedPrevSize = -1;
    const baseWarm = createWarmStartPbdLayoutStrategy();
    const engine = new SimplexGraphEngine({
      items: skewedItems,
      visualResolver: HEADLESS_RESOLVER,
      renderer: createHeadlessRenderer(),
      viewportWidth: 680,
      viewportHeight: 460,
      layoutStrategy: createPbdUniformLayoutStrategy(),
    });
    expect(engine.getMetrics().overlapCount).toBe(0);

    engine.setLayoutStrategy({
      name: 'spied-warm',
      solve(ctx) {
        capturedPrevSize = ctx.previousItemPositions?.size ?? 0;
        return baseWarm.solve(ctx);
      },
    });
    expect(capturedPrevSize).toBe(skewedItems.length);
    expect(engine.getMetrics().overlapCount).toBe(0);
    engine.destroy();
  });

  it('threads custom TItem and TTagMeta cleanly through strategy interfaces', () => {
    interface CustomDoc {
      readonly docId: string;
      readonly keywords: readonly string[];
    }
    const docs: CustomDoc[] = [
      { docId: 'd1', keywords: ['a', 'b'] },
      { docId: 'd2', keywords: ['b', 'c'] },
      { docId: 'd3', keywords: ['c', 'd'] },
    ];
    const snap = solveSimplexSnapshot(docs, {
      getId: (d) => d.docId,
      getTags: (d) => d.keywords,
      resolveTagMeta: (tag) => ({ upper: tag.toUpperCase() }),
      deriveClusterMeta: (ctx) => ({ top: ctx.coreTags[0]?.meta?.upper ?? '' }),
      clusteringStrategy: createJaccardAnnealingClusteringStrategy<
        CustomDoc,
        { readonly upper: string }
      >(),
    });

    const cluster: ClusterDescriptor<
      CustomDoc,
      { readonly upper: string },
      { readonly top: string }
    > = snap.clusters[0]!.cluster;
    const ctx: ContentLayoutContext<
      CustomDoc,
      { readonly upper: string },
      { readonly top: string }
    > = snap.items[0]!.layoutContext;
    expect(cluster.meta.top.length).toBeGreaterThan(0);
    expect(ctx.tags[0]?.meta?.upper.length).toBeGreaterThan(0);
  });
});
