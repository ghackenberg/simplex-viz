import { describe, expect, it } from 'vitest';
import {
  SimplexGraphEngine,
  SimplexTimelineController,
  createCollisionDrivenLayoutStrategy,
  createFinalSeededClusteringStrategy,
  createFinalSeededLayoutStrategy,
  createSimplexTimeline,
  createWarmStartPbdLayoutStrategy,
  type DefaultTaggedItem,
  type RenderFrameSnapshot,
  type SimplexRendererAdapter,
  type VisualResolver,
} from '../src/index.js';

interface DatedItem extends DefaultTaggedItem {
  readonly year?: number;
  readonly phase?: string;
}

describe('SimplexTimelineController & createSimplexTimeline (Issue #8)', () => {
  it('groups items chronologically with undated baseline at step 0 and starts at full corpus by default', () => {
    const items: readonly DatedItem[] = [
      { id: 'base-1', tags: ['alpha', 'beta'] },
      { id: 'y2023-a', tags: ['beta', 'gamma'], year: 2023 },
      { id: 'y2021-a', tags: ['alpha', 'gamma'], year: 2021 },
      { id: 'y2022-a', tags: ['alpha', 'delta'], year: 2022 },
      { id: 'y2023-b', tags: ['delta', 'gamma'], year: 2023 },
      { id: 'base-2', tags: ['alpha', 'delta'] },
    ];

    const tl = createSimplexTimeline(items, {
      getTimestamp: (item) => item.year,
      baselineLabel: 'Undated',
    });

    const initial = tl.getState();
    // 4 frames: Undated (step 0), 2021 (step 1), 2022 (step 2), 2023 (step 3)
    expect(initial.frames.length).toBe(4);
    expect(initial.totalSteps).toBe(3);
    expect(initial.step).toBe(3);
    expect(initial.atEnd).toBe(true);
    expect(initial.atStart).toBe(false);
    expect(initial.playing).toBe(false);
    expect(initial.activeLabel).toBe('2023');
    expect(initial.activeItemCount).toBe(6);
    expect(initial.totalItemCount).toBe(6);
    expect(initial.progress).toBe(1);

    // Step 0 contains only undated baseline items
    tl.seek(0);
    expect(tl.getState().activeLabel).toBe('Undated');
    expect(tl.getState().activeFrame?.isBaseline).toBe(true);
    expect(tl.getState().activeItems.map((i) => i.id)).toEqual(['base-1', 'base-2']);

    // Step 1 accumulates 2021 on top of baseline
    tl.stepBy(1);
    expect(tl.getState().step).toBe(1);
    expect(tl.getState().activeLabel).toBe('2021');
    expect(tl.getState().activeItems.map((i) => i.id)).toEqual([
      'base-1',
      'base-2',
      'y2021-a',
    ]);

    // Step 3 reaches full corpus
    tl.seek(3);
    expect(tl.getState().activeItemCount).toBe(6);
    expect(tl.getState().atEnd).toBe(true);
  });

  it('supports ISO strings, Date instances, includeEmptyStart, and explicit getFrameKey', () => {
    const isoItems = [
      { id: 'd2', tags: ['a'], date: '2024-03-01T00:00:00.000Z' },
      { id: 'd1', tags: ['b'], date: new Date('2024-01-01T00:00:00.000Z') },
    ];

    const tlIso = createSimplexTimeline(isoItems, {
      includeEmptyStart: true,
      emptyStartLabel: 'Empty',
      initialStep: 'start',
    });
    expect(tlIso.getState().totalSteps).toBe(2);
    expect(tlIso.getState().step).toBe(0);
    expect(tlIso.getState().activeLabel).toBe('Empty');
    expect(tlIso.getState().activeItemCount).toBe(0);

    tlIso.stepBy(1);
    expect(tlIso.getState().activeLabel).toBe('Jan 2024');
    expect(tlIso.getState().activeItems.map((i) => i.id)).toEqual(['d1']);

    tlIso.stepBy(1);
    expect(tlIso.getState().activeLabel).toBe('Mar 2024');
    expect(tlIso.getState().activeItems.map((i) => i.id)).toEqual(['d1', 'd2']);

    // Explicit getFrameKey with custom ordering & formatFrameLabel
    const keyed = [
      { id: 'k2', tags: ['x'], phase: 'beta' },
      { id: 'k1', tags: ['y'], phase: 'alpha' },
      { id: 'k3', tags: ['z'], phase: 'gamma' },
    ];
    const order: Record<string, number> = { alpha: 0, beta: 1, gamma: 2 };
    const tlKeyed = new SimplexTimelineController(keyed, {
      getFrameKey: (item) => item.phase,
      compareFrameKeys: (a, b) => (order[String(a)] ?? 0) - (order[String(b)] ?? 0),
      formatFrameLabel: (ctx) => `${ctx.key.toUpperCase()} (${ctx.cumulativeItemCount})`,
      initialStep: 0,
    });
    expect(tlKeyed.getState().frames.map((f) => f.label)).toEqual([
      'ALPHA (1)',
      'BETA (2)',
      'GAMMA (3)',
    ]);
  });

  it('auto-rewinds on play() from end, advances deterministically via tick(dtMs), and supports speed, pause, loop, and setItems', () => {
    const items: readonly DefaultTaggedItem[] = [
      { id: 's1', tags: ['a'] },
      { id: 's2', tags: ['b'] },
      { id: 's3', tags: ['c'] },
    ];

    const seenSteps: number[] = [];
    const seenItemCounts: number[] = [];

    // Zero-config fallback: 1 item per step when no date/timestamp field exists
    const tl = createSimplexTimeline(items, {
      stepIntervalMs: 500,
      onItemsChange: (active, st) => {
        seenSteps.push(st.step);
        seenItemCounts.push(active.length);
      },
    });
    expect(tl.getState().step).toBe(2);
    expect(tl.getState().atEnd).toBe(true);

    // Calling play() at end rewinds to step 0 and starts playing
    tl.play();
    expect(tl.getState().playing).toBe(true);
    expect(tl.getState().step).toBe(0);
    expect(tl.getState().activeItemCount).toBe(1);

    // Partial tick does not advance yet
    expect(tl.tick(250)).toBe(false);
    expect(tl.getState().step).toBe(0);

    // Completing 500ms advances to step 1
    expect(tl.tick(250)).toBe(true);
    expect(tl.getState().step).toBe(1);
    expect(tl.getState().playing).toBe(true);

    // Speed 2x advances step 1 -> 2 in 250ms and auto-pauses at end
    tl.setSpeed(2);
    expect(tl.tick(250)).toBe(true);
    expect(tl.getState().step).toBe(2);
    expect(tl.getState().atEnd).toBe(true);
    expect(tl.getState().playing).toBe(false);

    // Enable looping and play again -> wraps from step 2 back to 0
    tl.setLoop(true);
    tl.setSpeed(1);
    tl.seek(2);
    tl.play(); // rewinds to 0 because atEnd
    expect(tl.getState().step).toBe(0);
    tl.tick(500); // -> 1
    tl.tick(500); // -> 2
    expect(tl.getState().playing).toBe(true);
    tl.tick(500); // wraps -> 0
    expect(tl.getState().step).toBe(0);
    expect(tl.getState().playing).toBe(true);

    // resetToEnd pauses and jumps to final step
    tl.resetToEnd();
    expect(tl.getState().playing).toBe(false);
    expect(tl.getState().atEnd).toBe(true);

    // Adding items while pinned at end keeps timeline at the new final step
    tl.setItems([...items, { id: 's4', tags: ['d'] }]);
    expect(tl.getState().totalSteps).toBe(3);
    expect(tl.getState().step).toBe(3);
    expect(tl.getState().activeItemCount).toBe(4);
    expect(seenSteps.length).toBeGreaterThan(0);
    expect(seenItemCounts.at(-1)).toBe(4);
  });

  it('composes seamlessly with SimplexGraphEngine and createFinalSeededClusteringStrategy across 0..N frames without cluster hopping', () => {
    const corpus: readonly DatedItem[] = [
      { id: 'c1', tags: ['robotics', 'control'], year: 2020 },
      { id: 'c2', tags: ['robotics', 'vision'], year: 2020 },
      { id: 'c3', tags: ['vision', 'learning'], year: 2021 },
      { id: 'c4', tags: ['learning', 'safety'], year: 2021 },
      { id: 'c5', tags: ['safety', 'control'], year: 2022 },
      { id: 'c6', tags: ['robotics', 'safety'], year: 2022 },
      { id: 'c7', tags: ['vision', 'control'], year: 2023 },
      { id: 'c8', tags: ['learning', 'robotics'], year: 2023 },
      { id: 'c9', tags: ['safety', 'vision'], year: 2024 },
      { id: 'c10', tags: ['control', 'learning'], year: 2024 },
    ];

    const renderer: SimplexRendererAdapter<
      { readonly id: string },
      { readonly id: string }
    > = {
      measureContentHull: () => ({ kind: 'circle', radius: 12 }),
      measureClusterHull: () => ({ kind: 'circle', radius: 22 }),
      renderFrame: () => {},
      destroy: () => {},
    };
    const visualResolver: VisualResolver<
      DatedItem,
      { readonly id: string },
      { readonly id: string }
    > = {
      resolveContentVisual: (item) => ({ id: item.id }),
      resolveClusterVisual: (cluster) => ({ id: cluster.clusterUid }),
      getVisualCacheKey: (v) => v.id,
    };

    const timeline = createSimplexTimeline(corpus, {
      getTimestamp: (item) => item.year,
      stepIntervalMs: 300,
    });

    const engine = new SimplexGraphEngine({
      items: timeline.getActiveItems(),
      visualResolver,
      renderer,
      viewportWidth: 960,
      viewportHeight: 620,
      clusteringStrategy: createFinalSeededClusteringStrategy(undefined, {
        seedItems: corpus,
      }),
      layoutStrategy: createWarmStartPbdLayoutStrategy(),
      layoutOptions: { seed: 42 },
    });

    timeline.subscribe((state) => {
      engine.setItems(state.activeItems);
    });

    const canonicalClusters = engine
      .getClusters()
      .map((c) => `${c.vertexIndex}:${c.clusterUid}:${c.colorHex}`);
    expect(canonicalClusters.length).toBeGreaterThanOrEqual(3);

    // Replay chronologically from step 0 -> totalSteps via play() + tick()
    timeline.play();
    expect(timeline.getState().step).toBe(0);
    while (timeline.getState().playing) {
      const frameClusters = engine
        .getClusters()
        .map((c) => `${c.vertexIndex}:${c.clusterUid}:${c.colorHex}`);
      expect(frameClusters).toEqual(canonicalClusters);
      expect(engine.getMetrics().overlapCount).toBe(0);
      timeline.tick(300);
      engine.step(20);
    }

    // Final step N restores full corpus and identical clusters with 0 overlaps
    expect(timeline.getState().atEnd).toBe(true);
    expect(engine.getItems().length).toBe(corpus.length);
    expect(
      engine.getClusters().map((c) => `${c.vertexIndex}:${c.clusterUid}:${c.colorHex}`),
    ).toEqual(canonicalClusters);
    expect(engine.getMetrics().overlapCount).toBe(0);

    timeline.destroy();
    engine.destroy();
  });

  it('freezes item coordinates across timeline frames via createFinalSeededLayoutStrategy (pinned & adaptive scale modes)', () => {
    // Dense corpus so final frame forces local down-scaling below 1.0x
    const corpus: readonly DatedItem[] = Array.from({ length: 24 }, (_, idx) => ({
      id: `dense-${idx}`,
      tags:
        idx % 3 === 0
          ? ['alpha', 'beta']
          : idx % 3 === 1
            ? ['beta', 'gamma']
            : ['alpha', 'gamma'],
      year: 2020 + Math.floor(idx / 6), // 4 frames: 6, 12, 18, 24 items
    }));

    const captureLayoutSnapshots = (scaleMode: 'pinned' | 'adaptive') => {
      let lastFrame: RenderFrameSnapshot<
        { readonly id: string },
        { readonly id: string }
      > | null = null;
      const renderer: SimplexRendererAdapter<
        { readonly id: string },
        { readonly id: string }
      > = {
        measureContentHull: () => ({ kind: 'circle', radius: 34 }),
        measureClusterHull: () => ({ kind: 'circle', radius: 26 }),
        renderFrame: (frame) => {
          lastFrame = frame;
        },
        destroy: () => {},
      };
      const visualResolver: VisualResolver<
        DatedItem,
        { readonly id: string },
        { readonly id: string }
      > = {
        resolveContentVisual: (item) => ({ id: item.id }),
        resolveClusterVisual: (cluster) => ({ id: cluster.clusterUid }),
        getVisualCacheKey: (v) => v.id,
      };

      const timeline = createSimplexTimeline(corpus, {
        getTimestamp: (item) => item.year,
      });

      const engine = new SimplexGraphEngine({
        items: timeline.getActiveItems(),
        canonicalSeedItems: corpus,
        visualResolver,
        renderer,
        viewportWidth: 520,
        viewportHeight: 380,
        clusteringStrategy: createFinalSeededClusteringStrategy(undefined, {
          seedItems: corpus,
        }),
        layoutStrategy: createFinalSeededLayoutStrategy(
          createCollisionDrivenLayoutStrategy(),
          { scaleMode },
        ),
        layoutOptions: { seed: 19 },
      });

      timeline.subscribe((st) => {
        engine.setItems(st.activeItems);
      });

      const settleAndRecord = () => {
        for (let i = 0; i < 60; i++) engine.step(20);
        const snap = lastFrame!;
        const byId = new Map<string, { x: number; y: number; scale: number }>();
        for (const n of snap.items) {
          if (!n.isExiting) {
            byId.set(n.id, { x: n.x, y: n.y, scale: n.scale });
          }
        }
        return { byId, overlaps: engine.getMetrics().overlapCount };
      };

      // Step N (full corpus)
      const finalRecord = settleAndRecord();
      expect(finalRecord.overlaps).toBe(0);
      expect(finalRecord.byId.size).toBe(corpus.length);

      // Step 0 (sparse: 6 items)
      timeline.seek(0);
      const step0Forward = settleAndRecord();
      expect(step0Forward.overlaps).toBe(0);
      expect(step0Forward.byId.size).toBe(6);

      // Step 1 (12 items)
      timeline.seek(1);
      const step1Record = settleAndRecord();
      expect(step1Record.overlaps).toBe(0);

      // Scrub backward to Step 0 -> must match step0Forward identically (path-independent!)
      timeline.seek(0);
      const step0Backward = settleAndRecord();
      expect(step0Backward.overlaps).toBe(0);

      timeline.destroy();
      engine.destroy();
      return { finalRecord, step0Forward, step1Record, step0Backward };
    };

    // 1. Pinned mode: exact (x, y) AND exact scale match final frame on every step
    const pinned = captureLayoutSnapshots('pinned');
    for (const [id, p0] of pinned.step0Forward.byId) {
      const pFinal = pinned.finalRecord.byId.get(id)!;
      const pBack = pinned.step0Backward.byId.get(id)!;
      expect(p0.x).toBeCloseTo(pFinal.x, 1);
      expect(p0.y).toBeCloseTo(pFinal.y, 1);
      expect(p0.scale).toBeCloseTo(pFinal.scale, 2);
      expect(pBack.x).toBeCloseTo(p0.x, 1);
      expect(pBack.y).toBeCloseTo(p0.y, 1);
      expect(pBack.scale).toBeCloseTo(p0.scale, 2);
    }

    // 2. Adaptive mode: exact (x, y) match final frame, sparse scale >= pinned scale,
    //    at least one item scales up when sparse, and backward scrub is identical
    const adaptive = captureLayoutSnapshots('adaptive');
    let scaledUpCount = 0;
    for (const [id, a0] of adaptive.step0Forward.byId) {
      const aFinal = adaptive.finalRecord.byId.get(id)!;
      const aBack = adaptive.step0Backward.byId.get(id)!;
      expect(a0.x).toBeCloseTo(aFinal.x, 1);
      expect(a0.y).toBeCloseTo(aFinal.y, 1);
      expect(a0.scale).toBeGreaterThanOrEqual(aFinal.scale - 0.01);
      if (a0.scale > aFinal.scale + 0.04) {
        scaledUpCount += 1;
      }
      expect(aBack.x).toBeCloseTo(a0.x, 1);
      expect(aBack.y).toBeCloseTo(a0.y, 1);
      expect(aBack.scale).toBeCloseTo(a0.scale, 2);
    }
    expect(scaledUpCount).toBeGreaterThan(0);
  });

  it('supports configurable emptyClusterBehavior (normal | dim | hide) on SimplexGraphEngine', () => {
    // 2020 only populates alpha/beta; gamma/delta clusters remain empty until 2022
    const corpus: readonly DatedItem[] = [
      { id: 'i1', tags: ['alpha', 'beta'], year: 2020 },
      { id: 'i2', tags: ['alpha'], year: 2020 },
      { id: 'i3', tags: ['gamma', 'delta'], year: 2022 },
      { id: 'i4', tags: ['gamma'], year: 2022 },
      { id: 'i5', tags: ['delta'], year: 2022 },
    ];

    let lastFrame: RenderFrameSnapshot<
      { readonly id: string },
      { readonly id: string }
    > | null = null;
    const renderer: SimplexRendererAdapter<
      { readonly id: string },
      { readonly id: string }
    > = {
      measureContentHull: () => ({ kind: 'circle', radius: 12 }),
      measureClusterHull: () => ({ kind: 'circle', radius: 22 }),
      renderFrame: (frame) => {
        lastFrame = frame;
      },
      destroy: () => {},
    };
    const visualResolver: VisualResolver<
      DatedItem,
      { readonly id: string },
      { readonly id: string }
    > = {
      resolveContentVisual: (item) => ({ id: item.id }),
      resolveClusterVisual: (cluster) => ({ id: cluster.clusterUid }),
      getVisualCacheKey: (v) => v.id,
    };

    const earlyItems = corpus.filter((it) => it.year === 2020);
    const engine = new SimplexGraphEngine({
      items: earlyItems,
      visualResolver,
      renderer,
      viewportWidth: 800,
      viewportHeight: 540,
      clusteringStrategy: createFinalSeededClusteringStrategy(undefined, {
        seedItems: corpus,
      }),
      emptyClusterBehavior: 'normal',
      layoutOptions: { seed: 7 },
    });

    const settle = () => {
      for (let i = 0; i < 45; i++) engine.step(20);
      return lastFrame!;
    };

    const emptyClusterUids = new Set(
      engine
        .getClusters()
        .filter((c) => c.members.length === 0)
        .map((c) => c.clusterUid),
    );
    const populatedClusterUids = new Set(
      engine
        .getClusters()
        .filter((c) => c.members.length > 0)
        .map((c) => c.clusterUid),
    );
    expect(emptyClusterUids.size).toBeGreaterThan(0);
    expect(populatedClusterUids.size).toBeGreaterThan(0);

    // 'normal': empty clusters are neither dimmed nor hidden
    const normalFrame = settle();
    for (const cNode of normalFrame.clusters) {
      expect(cNode.interaction.isDimmed).toBe(false);
      expect(Boolean(cNode.isPassThrough)).toBe(false);
      expect(cNode.opacity).toBeCloseTo(1, 2);
    }

    // 'dim': empty clusters are dimmed while populated clusters stay full-strength
    engine.setEmptyClusterBehavior('dim');
    expect(engine.getEmptyClusterBehavior()).toBe('dim');
    const dimFrame = settle();
    for (const cNode of dimFrame.clusters) {
      if (emptyClusterUids.has(cNode.id)) {
        expect(cNode.interaction.isDimmed).toBe(true);
        expect(Boolean(cNode.isPassThrough)).toBe(false);
        expect(cNode.opacity).toBeCloseTo(1, 2);
      } else if (populatedClusterUids.has(cNode.id)) {
        expect(cNode.interaction.isDimmed).toBe(false);
      }
    }

    // 'hide': empty clusters fade to opacity 0, become pass-through, and are ignored by hitTest
    engine.setEmptyClusterBehavior('hide');
    expect(engine.getEmptyClusterBehavior()).toBe('hide');
    const hideFrame = settle();
    for (const cNode of hideFrame.clusters) {
      if (emptyClusterUids.has(cNode.id)) {
        expect(cNode.opacity).toBeLessThan(0.05);
        expect(Boolean(cNode.isPassThrough)).toBe(true);
        const hit = engine.hitTest(cNode.x, cNode.y);
        expect(hit.kind === 'cluster' && hit.cluster.clusterUid === cNode.id).toBe(false);
      } else if (populatedClusterUids.has(cNode.id)) {
        expect(cNode.opacity).toBeCloseTo(1, 2);
        expect(Boolean(cNode.isPassThrough)).toBe(false);
      }
    }

    // Populating the full corpus immediately restores all clusters to full opacity
    engine.setItems(corpus);
    const fullFrame = settle();
    for (const cNode of fullFrame.clusters) {
      expect(cNode.opacity).toBeCloseTo(1, 2);
      expect(Boolean(cNode.isPassThrough)).toBe(false);
      expect(cNode.interaction.isDimmed).toBe(false);
    }

    engine.destroy();
  });
});
