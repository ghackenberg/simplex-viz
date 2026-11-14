import { describe, expect, it, vi } from 'vitest';
import { SimplexGraphEngine } from '../src/engine';
import { isPointInTriangle } from '../src/geometry';
import { solveSimplexSnapshot } from '../src/snapshot';
import {
  createAdaptiveHexMeshStrategy,
  createCollisionDrivenLayoutStrategy,
  createEmbeddingClusteringStrategy,
  createFixedLatticeMeshStrategy,
  createIncrementalAnchorClusteringStrategy,
  createJaccardAnnealingClusteringStrategy,
  createLocalAdaptiveLayoutStrategy,
  createPaletteColorStrategy,
  createPbdUniformLayoutStrategy,
  createSimilarityClusteringStrategy,
  createSoftSimplexEmbeddingClusteringStrategy,
  createSoftSimplexTagClusteringStrategy,
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

  it('clusters untagged items using multi-modal vector embeddings with barycentric simplex projection and incremental UID stability', () => {
    interface VoiceRecording {
      readonly id: string;
      readonly label: string;
      readonly timbre: readonly number[];
      readonly prosody: readonly number[];
    }

    const recordings: VoiceRecording[] = [
      // Cluster A: low pitch + warm timbre
      { id: 'v1', label: 'Narrator A', timbre: [0.95, 0.2, 0.05, 0.0], prosody: [0.85, 0.15] },
      { id: 'v2', label: 'Narrator B', timbre: [0.92, 0.24, 0.08, 0.02], prosody: [0.8, 0.2] },
      { id: 'v3', label: 'Narrator C', timbre: [0.89, 0.28, 0.04, 0.05], prosody: [0.88, 0.12] },
      // Cluster B: bright + crisp
      { id: 'v4', label: 'Soprano A', timbre: [0.05, 0.94, 0.2, 0.02], prosody: [0.2, 0.8] },
      { id: 'v5', label: 'Soprano B', timbre: [0.08, 0.91, 0.25, 0.05], prosody: [0.25, 0.75] },
      { id: 'v6', label: 'Soprano C', timbre: [0.1, 0.88, 0.18, 0.08], prosody: [0.18, 0.82] },
      // Cluster C: gravelly + percussive
      { id: 'v7', label: 'Vocalist A', timbre: [0.04, 0.08, 0.93, 0.22], prosody: [0.5, 0.5] },
      { id: 'v8', label: 'Vocalist B', timbre: [0.06, 0.12, 0.9, 0.28], prosody: [0.55, 0.45] },
      { id: 'v9', label: 'Vocalist C', timbre: [0.05, 0.1, 0.94, 0.18], prosody: [0.48, 0.52] },
      // Hybrid bridge between A and B
      { id: 'v10', label: 'Alto Bridge', timbre: [0.55, 0.58, 0.12, 0.04], prosody: [0.52, 0.48] },
    ];

    const strategy = createEmbeddingClusteringStrategy<VoiceRecording>({
      getEmbedding: [
        { name: 'Timbre', getVector: (r) => r.timbre, weight: 0.75 },
        { name: 'Prosody', getVector: (r) => r.prosody, weight: 0.25 },
      ],
      metric: 'cosine',
      anchorRule: 'simplex-projection',
      deriveLabel: (reps, idx) =>
        reps[0]?.item.label ?? `Voice ${idx + 1}`,
    });

    expect(strategy.requiresTags).toBe(false);

    const snap = solveSimplexSnapshot(recordings, {
      width: 960,
      height: 620,
      clusteringStrategy: strategy,
      deriveClusterMeta: (ctx) => ({
        cohesion: ctx.cohesion ?? 0,
        leadLabel: ctx.representativeItems?.[0]?.item.label ?? '',
      }),
    });

    expect(snap.metrics.overlapCount).toBe(0);
    expect(snap.clusters.length).toBeGreaterThanOrEqual(3);
    for (const c of snap.clusters) {
      expect(c.cluster.coreTags.length).toBe(0);
      expect(c.cluster.centroid?.length).toBe(6);
      expect(c.cluster.representativeItems?.length).toBeGreaterThanOrEqual(1);
      expect(c.cluster.meta.leadLabel.length).toBeGreaterThan(0);
    }

    // Check barycentric weights & residual distances for untagged items
    for (const item of snap.items) {
      expect(item.layoutContext.tags.length).toBe(0);
      const weightSum = item.layoutContext.unitClusters.reduce((s, u) => s + u.weight, 0);
      expect(Math.abs(weightSum - 1)).toBeLessThan(1e-4);
      expect(item.layoutContext.residualDistance).toBeGreaterThanOrEqual(0);
      expect(item.layoutContext.featureSummary?.length).toBeGreaterThan(0);
    }

    // Verify incremental stability when adding/removing untagged items in SimplexGraphEngine
    const engine = new SimplexGraphEngine({
      items: recordings,
      clusteringStrategy: strategy,
      visualResolver: {
        resolveContentVisual: () => ({ r: 10 }),
        resolveClusterVisual: () => ({ r: 24 }),
        getVisualCacheKey: () => 'v-emb',
      },
      renderer: createHeadlessRenderer(),
      viewportWidth: 960,
      viewportHeight: 620,
    });

    const initialUids = new Set(engine.getClusters().map((c) => c.clusterUid));
    engine.addItems([
      { id: 'v11', label: 'Narrator D', timbre: [0.91, 0.22, 0.06, 0.03], prosody: [0.84, 0.16] },
    ]);
    const preserved = engine.getClusters().filter((c) => initialUids.has(c.clusterUid));
    expect(preserved.length).toBeGreaterThanOrEqual(3);
    expect(engine.getMetrics().overlapCount).toBe(0);

    // Euclidean distance metric also produces valid overlap-free snapshot
    const eucSnap = solveSimplexSnapshot(recordings, {
      clusteringStrategy: createEmbeddingClusteringStrategy<VoiceRecording>({
        getEmbedding: (r) => r.timbre,
        metric: 'euclidean',
        anchorRule: 'explaining-away',
      }),
    });
    expect(eucSnap.metrics.overlapCount).toBe(0);

    engine.destroy();
  });

  it('clusters untagged items from an arbitrary pairwise similarity function via k-Medoids + QAP mesh embedding', () => {
    interface BodyScan {
      readonly id: string;
      readonly measurements: readonly [number, number, number];
    }

    const scans: BodyScan[] = [
      { id: 'b1', measurements: [0.1, 0.1, 0.9] },
      { id: 'b2', measurements: [0.15, 0.12, 0.85] },
      { id: 'b3', measurements: [0.9, 0.1, 0.1] },
      { id: 'b4', measurements: [0.85, 0.15, 0.12] },
      { id: 'b5', measurements: [0.1, 0.9, 0.1] },
      { id: 'b6', measurements: [0.14, 0.86, 0.12] },
      { id: 'b7', measurements: [0.5, 0.5, 0.5] },
    ];

    const strategy = createSimilarityClusteringStrategy<BodyScan>({
      getSimilarity: (a, b) => {
        let sq = 0;
        for (let i = 0; i < 3; i++) {
          const d = a.measurements[i]! - b.measurements[i]!;
          sq += d * d;
        }
        return Math.exp(-sq * 2.5);
      },
      anchorRule: 'simplex-projection',
      deriveLabel: (reps, idx) => `Medoid ${reps[0]?.itemId ?? idx}`,
    });

    expect(strategy.requiresTags).toBe(false);

    const snap = solveSimplexSnapshot(scans, {
      width: 900,
      height: 580,
      clusteringStrategy: strategy,
    });

    expect(snap.metrics.overlapCount).toBe(0);
    expect(snap.clusters.length).toBeGreaterThanOrEqual(3);
    for (const c of snap.clusters) {
      expect(c.cluster.defaultLabel).toMatch(/^Medoid b/);
    }
    for (const it of snap.items) {
      const sum = it.layoutContext.unitClusters.reduce((s, u) => s + u.weight, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-4);
    }
  });

  it('scales adaptive mesh clusters cleanly when getTags is scoped to Jaccard/Incremental clustering strategy', () => {
    interface ArticleWithoutTagsProp {
      readonly id: string;
      readonly keywords: readonly string[];
    }

    const articles: ArticleWithoutTagsProp[] = Array.from({ length: 20 }, (_, i) => ({
      id: `art-${i}`,
      keywords: [
        `topic-${i % 12}`,
        `topic-${(i + 3) % 12}`,
        `topic-${(i + 5) % 12}`,
      ],
    }));

    const snap = solveSimplexSnapshot(articles, {
      width: 1200,
      height: 800,
      clusteringStrategy: createJaccardAnnealingClusteringStrategy({
        getTags: (a) => a.keywords,
      }),
    });

    expect(snap.metrics.overlapCount).toBe(0);
    expect(snap.metrics.tagCount).toBe(12);
    expect(snap.clusters.length).toBeGreaterThan(3);
  });

  it('supports Soft-Simplex tag & embedding clustering combined with Collision-Driven Adaptive Layout', () => {
    const softTagSnap = solveSimplexSnapshot(TEST_ITEMS, {
      width: 960,
      height: 620,
      clusteringStrategy: createSoftSimplexTagClusteringStrategy({
        triangleSpread: 0.45,
        balanceLoad: true,
      }),
      layoutStrategy: createCollisionDrivenLayoutStrategy({
        minLocalScale: 0.34,
      }),
    });

    expect(softTagSnap.metrics.overlapCount).toBe(0);
    expect(softTagSnap.metrics.maxPenetrationPx).toBeLessThanOrEqual(1e-4);

    // Items should spread into 3-way triangle simplices and preserve 100% weight sums
    const triItems = softTagSnap.items.filter(
      (it) => it.layoutContext.unitClusters.length >= 3,
    );
    expect(triItems.length).toBeGreaterThan(0);
    for (const it of softTagSnap.items) {
      const sum = it.layoutContext.unitClusters.reduce((s, u) => s + u.weight, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-5);
    }

    // Skewed embedding dataset paired with Soft-Simplex Embedding + Collision-Driven Layout
    interface AudioSample {
      readonly id: string;
      readonly label: string;
      readonly vec: readonly number[];
    }
    const samples: AudioSample[] = [
      ...Array.from({ length: 18 }, (_, i) => ({
        id: `crowd-${i}`,
        label: `Crowd ${i}`,
        vec: [0.95, 0.12 + (i % 3) * 0.02, 0.04, 0.01],
      })),
      { id: 'solo-a', label: 'Solo A', vec: [0.05, 0.96, 0.05, 0.02] },
      { id: 'solo-b', label: 'Solo B', vec: [0.04, 0.06, 0.95, 0.08] },
      { id: 'solo-c', label: 'Solo C', vec: [0.06, 0.05, 0.08, 0.95] },
      { id: 'bridge', label: 'Bridge', vec: [0.45, 0.48, 0.44, 0.12] },
    ];

    const softEmbStrategy = createSoftSimplexEmbeddingClusteringStrategy<AudioSample>({
      getEmbedding: (s) => s.vec,
      metric: 'cosine',
      triangleSpread: 0.48,
      balanceLoad: true,
    });
    expect(softEmbStrategy.requiresTags).toBe(false);

    const embSnap = solveSimplexSnapshot(samples, {
      width: 960,
      height: 620,
      itemRadius: 16,
      clusteringStrategy: softEmbStrategy,
      layoutStrategy: createCollisionDrivenLayoutStrategy({
        minLocalScale: 0.34,
        shrinkFactor: 0.85,
      }),
    });

    expect(embSnap.metrics.overlapCount).toBe(0);
    expect(embSnap.metrics.maxPenetrationPx).toBeLessThanOrEqual(1e-4);
    for (const it of embSnap.items) {
      const sum = it.layoutContext.unitClusters.reduce((s, u) => s + u.weight, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-4);
    }

    // Sparse items keep full 1.0x legibility while at least some dense items may stay large or shrink only where needed
    const maxItemScale = Math.max(...embSnap.items.map((it) => it.scale));
    expect(maxItemScale).toBeCloseTo(1.0, 5);
  });

  it('enforces covering-triangle containment end-to-end via solveSimplexSnapshot across all built-in layout strategies', () => {
    const denseTagged: DefaultTaggedItem[] = [
      ...Array.from({ length: 14 }, (_, i) => ({
        id: `d-${i}`,
        tags: ['rust', 'wasm', 'compilers'],
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `e-${i}`,
        tags: ['svg', 'geometry'],
      })),
      ...TEST_ITEMS,
    ];

    const verifySnapshotContainment = (
      snap: ReturnType<typeof solveSimplexSnapshot<DefaultTaggedItem>>,
    ) => {
      expect(snap.metrics.overlapCount).toBe(0);
      expect(snap.metrics.maxPenetrationPx).toBeLessThanOrEqual(1e-4);
      for (const it of snap.items) {
        const indices = it.layoutContext.unitClusters.map((uc) => uc.cluster.clusterIndex);
        if (indices.length < 2) continue;
        const covering = snap.mesh.triangles.filter((tr) =>
          indices.every((req) => tr.vertices.includes(req)),
        );
        if (covering.length === 0) continue;
        const insideAny = covering.some((tr) =>
          isPointInTriangle(
            it.x,
            it.y,
            snap.mesh.vertices[tr.vertices[0]]!,
            snap.mesh.vertices[tr.vertices[1]]!,
            snap.mesh.vertices[tr.vertices[2]]!,
            1e-4,
          ),
        );
        expect(insideAny).toBe(true);
      }
    };

    verifySnapshotContainment(
      solveSimplexSnapshot(denseTagged, {
        width: 820,
        height: 540,
        itemRadius: 16,
        clusteringStrategy: createJaccardAnnealingClusteringStrategy(),
        layoutStrategy: createPbdUniformLayoutStrategy(),
      }),
    );

    verifySnapshotContainment(
      solveSimplexSnapshot(denseTagged, {
        width: 820,
        height: 540,
        itemRadius: 16,
        clusteringStrategy: createSoftSimplexTagClusteringStrategy(),
        layoutStrategy: createLocalAdaptiveLayoutStrategy(),
      }),
    );

    verifySnapshotContainment(
      solveSimplexSnapshot(denseTagged, {
        width: 820,
        height: 540,
        itemRadius: 16,
        clusteringStrategy: createSoftSimplexTagClusteringStrategy(),
        layoutStrategy: createCollisionDrivenLayoutStrategy(),
      }),
    );
  });
});
