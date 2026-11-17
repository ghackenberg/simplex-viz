import { describe, expect, it } from 'vitest';
import { SimplexGraphEngine } from '../src/engine';
import { isPointInTriangle } from '../src/geometry';
import {
  createBarycentricPbdRelaxer,
  createCollisionLocalScaleController,
  createMeshInwardFanSeeder,
} from '../src/layout';
import {
  createComposedLayoutStrategy,
  createFixedLatticeMeshStrategy,
  createSimilarityClusteringStrategy,
} from '../src/strategies';
import {
  buildSubdividedTriangleMesh,
  createBarycentricZoomStrategy,
  createFreeCameraZoomStrategy,
  createSemanticZoomStrategy,
  createSubspaceZoomStrategy,
} from '../src/zoom';
import type {
  DefaultTaggedItem,
  NodeRenderState,
  SimplexRendererAdapter,
  VisualResolver,
} from '../src/types';

function createHeadlessRenderer(): {
  readonly adapter: SimplexRendererAdapter<{ readonly r: number }, { readonly r: number }>;
  getLastItems: () => readonly NodeRenderState<{ readonly r: number }>[];
  getLastTriangles: () => readonly import('../src/types').MeshTriangleRenderState<
    DefaultTaggedItem,
    undefined,
    undefined
  >[];
  getLastEdges: () => readonly import('../src/types').MeshEdgeRenderState<
    DefaultTaggedItem,
    undefined,
    undefined
  >[];
  getLastClusters: () => readonly NodeRenderState<{ readonly r: number }>[];
} {
  let lastItems: readonly NodeRenderState<{ readonly r: number }>[] = [];
  let lastTriangles: readonly import('../src/types').MeshTriangleRenderState<
    DefaultTaggedItem,
    undefined,
    undefined
  >[] = [];
  let lastEdges: readonly import('../src/types').MeshEdgeRenderState<
    DefaultTaggedItem,
    undefined,
    undefined
  >[] = [];
  let lastClusters: readonly NodeRenderState<{ readonly r: number }>[] = [];
  return {
    adapter: {
      measureContentHull: (v) => ({ kind: 'circle', radius: v.r }),
      measureClusterHull: (v) => ({ kind: 'circle', radius: v.r }),
      renderFrame: (frame) => {
        lastItems = frame.items;
        lastTriangles = frame.triangles;
        lastEdges = frame.edges;
        lastClusters = frame.clusters;
      },
      destroy: () => {},
    },
    getLastItems: () => lastItems,
    getLastTriangles: () => lastTriangles,
    getLastEdges: () => lastEdges,
    getLastClusters: () => lastClusters,
  };
}

function createResolver(
  itemRadius = 10,
  clusterRadius = 20,
): VisualResolver<
  DefaultTaggedItem,
  { readonly r: number },
  { readonly r: number }
> {
  return {
    resolveContentVisual: () => ({ r: itemRadius }),
    resolveClusterVisual: () => ({ r: clusterRadius }),
    getVisualCacheKey: () => `r${itemRadius}:c${clusterRadius}`,
  };
}

function stepToSettle(
  engine: SimplexGraphEngine<
    DefaultTaggedItem,
    { readonly r: number },
    { readonly r: number }
  >,
): void {
  for (let i = 0; i < 45; i++) {
    engine.step(20);
  }
}

const RICH_ITEMS: readonly DefaultTaggedItem[] = Array.from({ length: 36 }, (_, i) => {
  const pairPool: readonly (readonly string[])[] = [
    ['rust', 'wasm'],
    ['rust', 'compilers'],
    ['wasm', 'compilers'],
    ['rust', 'wasm', 'compilers'],
    ['typescript', 'react'],
    ['react', 'svg'],
    ['typescript', 'svg'],
    ['typescript', 'react', 'svg'],
    ['geometry', 'svg'],
    ['geometry', 'oklab'],
    ['svg', 'oklab'],
    ['rust', 'geometry'],
  ];
  const base = pairPool[i % pairPool.length]!;
  return {
    id: `i${i + 1}`,
    tags: [...base, `detail-${i % 7}`],
  };
});

describe('Pluggable SimplexZoomStrategy', () => {
  it('buildSubdividedTriangleMesh splits into 4 congruent triangles preserving parent ▲ and ▼ orientations', () => {
    const upMesh = buildSubdividedTriangleMesh(
      { x: 100, y: 0 },
      { x: 0, y: 173.205 },
      { x: 200, y: 173.205 },
      800,
      600,
      60,
    );
    expect(upMesh.vertices.length).toBe(6);
    expect(upMesh.edges.length).toBe(9);
    expect(upMesh.triangles.length).toBe(4);

    const v = upMesh.vertices;
    expect(v[0]!.y).toBeLessThan(v[1]!.y);
    expect(v[3]!.y).toBeCloseTo(v[5]!.y, 3);
    expect(v[4]!.y).toBeGreaterThan(v[3]!.y);

    const minX = Math.min(...v.map((p) => p.x));
    const maxX = Math.max(...v.map((p) => p.x));
    const minY = Math.min(...v.map((p) => p.y));
    const maxY = Math.max(...v.map((p) => p.y));
    expect((minX + maxX) * 0.5).toBeCloseTo(400, 1);
    expect((minY + maxY) * 0.5).toBeCloseTo(300, 1);

    const downMesh = buildSubdividedTriangleMesh(
      { x: 0, y: 0 },
      { x: 100, y: 173.205 },
      { x: 200, y: 0 },
      800,
      600,
      60,
    );
    expect(downMesh.vertices[0]!.y).toBeLessThan(downMesh.vertices[1]!.y);
    expect(downMesh.vertices[2]!.y).toBeCloseTo(downMesh.vertices[0]!.y, 3);
    expect(downMesh.vertices[5]!.y).toBeLessThan(downMesh.vertices[3]!.y);
  });

  it('barycentric zoom drills recursively 1:4 with 0.0 px overlaps, exposes neighbors, and navigates back cleanly', () => {
    const hr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items: RICH_ITEMS,
      visualResolver: createResolver(28, 22),
      renderer: hr.adapter,
      viewportWidth: 640,
      viewportHeight: 460,
      zoomStrategy: createBarycentricZoomStrategy(),
    });
    stepToSettle(engine);

    const rootState = engine.getZoomState();
    expect(rootState.mode).toBe('drill-down');
    expect(rootState.depth).toBe(0);
    expect(rootState.canDrillUp).toBe(false);
    expect(rootState.fullScaleItemRatio).toBeLessThan(1);
    expect(rootState.drillableTriangleIndices.length).toBeGreaterThan(0);

    const firstTriIdx = rootState.drillableTriangleIndices[0]!;
    expect(engine.drillDownTriangle(firstTriIdx)).toBe(true);
    stepToSettle(engine);

    const d1State = engine.getZoomState();
    expect(d1State.depth).toBe(1);
    expect(d1State.activeFrameKind).toBe('triangle');
    expect(d1State.canDrillUp).toBe(true);
    expect(d1State.breadcrumbs.length).toBe(2);
    expect(engine.getMesh()!.vertices.length).toBe(6);
    expect(engine.getMesh()!.triangles.length).toBe(4);
    expect(engine.getMetrics().clusterCount).toBe(6);
    expect(engine.getMetrics().overlapCount).toBe(0);

    // Surrounding parent triangles/edges/clusters stay visible dimmed as clickable neighborhood context
    const ctxTriangles = hr.getLastTriangles().filter((t) => t.isContext);
    const activeTriangles = hr.getLastTriangles().filter((t) => !t.isContext);
    expect(activeTriangles.length).toBe(4);
    expect(ctxTriangles.length).toBeGreaterThan(0);
    expect(ctxTriangles.every((t) => t.interaction.isDimmed)).toBe(true);
    expect(ctxTriangles.some((t) => Boolean(t.neighborId))).toBe(true);
    expect(hr.getLastEdges().some((e) => e.isDimmed)).toBe(true);
    expect(hr.getLastClusters().some((c) => c.isContext && c.interaction.isDimmed)).toBe(
      true,
    );

    const clickableNeighborTri = ctxTriangles.find(
      (t) => Boolean(t.neighborId) && t.coveredItemCount > 1,
    );
    expect(clickableNeighborTri).toBeDefined();
    if (clickableNeighborTri?.neighborId) {
      const hitTarget = engine.hitTest(
        clickableNeighborTri.centroid.x,
        clickableNeighborTri.centroid.y,
      );
      expect(hitTarget.kind).toBe('triangle');
      if (hitTarget.kind === 'triangle') {
        expect(hitTarget.triangle.isContext).toBe(true);
        expect(hitTarget.triangle.neighborId).toBe(clickableNeighborTri.neighborId);
      }

      const beforeFrameId = engine.getZoomState().breadcrumbs.at(-1)?.frameId;
      expect(engine.drillToNeighbor(clickableNeighborTri.neighborId)).toBe(true);
      stepToSettle(engine);
      const nbState = engine.getZoomState();
      expect(nbState.depth).toBe(1);
      expect(nbState.breadcrumbs.length).toBe(2);
      expect(nbState.breadcrumbs.at(-1)?.frameId).not.toBe(beforeFrameId);
      expect(engine.getMetrics().overlapCount).toBe(0);
    }

    expect(engine.drillUp()).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().depth).toBe(0);
    expect(
      hr.getLastTriangles().filter((t) => t.isContext).length,
    ).toBe(0);
    expect(engine.getMetrics().overlapCount).toBe(0);

    engine.destroy();
  });

  it('stops triangle drill-down at leaf once all covered items reach full 1.0x scale', () => {
    const smallItems: readonly DefaultTaggedItem[] = [
      { id: 's1', tags: ['alpha', 'beta'] },
      { id: 's2', tags: ['beta', 'gamma'] },
      { id: 's3', tags: ['alpha', 'gamma'] },
      { id: 's4', tags: ['alpha', 'beta', 'gamma'] },
    ];

    const hr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items: smallItems,
      visualResolver: createResolver(9, 18),
      renderer: hr.adapter,
      viewportWidth: 900,
      viewportHeight: 620,
      zoomStrategy: createBarycentricZoomStrategy({ stopWhenFullScale: true }),
    });
    stepToSettle(engine);

    const zState = engine.getZoomState();
    expect(zState.fullScaleItemRatio).toBe(1);
    expect(zState.isLeafReached).toBe(true);
    expect(zState.drillableTriangleIndices.length).toBe(0);
    expect(engine.drillDownTriangle(0)).toBe(false);

    engine.destroy();
  });

  it('applies Adaptive Contrast Stretch so a 99%-corner outlier separates cleanly in one drill step', () => {
    const denseSkewed: DefaultTaggedItem[] = Array.from({ length: 28 }, (_, i) => ({
      id: `skew-${i}`,
      tags:
        i < 10
          ? ['a', 'b']
          : i < 18
            ? ['b', 'c']
            : i < 25
              ? ['a', 'c']
              : ['a', 'b', 'c'],
    }));

    const hr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items: denseSkewed,
      visualResolver: createResolver(30, 24),
      renderer: hr.adapter,
      viewportWidth: 520,
      viewportHeight: 400,
      zoomStrategy: createBarycentricZoomStrategy({
        adaptiveContrastStretch: true,
        stopWhenFullScale: true,
      }),
    });
    stepToSettle(engine);

    const state = engine.getZoomState();
    expect(state.drillableTriangleIndices.length).toBeGreaterThan(0);

    const triIdx = state.drillableTriangleIndices[0]!;
    expect(engine.drillDownTriangle(triIdx)).toBe(true);
    stepToSettle(engine);

    const subMesh = engine.getMesh()!;
    const subItems = hr.getLastItems().filter((it) => !it.isContext);
    expect(engine.getMetrics().overlapCount).toBe(0);

    const occupiedSubTris = new Set<number>();
    for (const p of subItems) {
      for (const tri of subMesh.triangles) {
        const p0 = subMesh.vertices[tri.vertices[0]]!;
        const p1 = subMesh.vertices[tri.vertices[1]]!;
        const p2 = subMesh.vertices[tri.vertices[2]]!;
        if (isPointInTriangle(p.x, p.y, p0, p1, p2)) {
          occupiedSubTris.add(tri.index);
        }
      }
    }
    expect(occupiedSubTris.size).toBeGreaterThanOrEqual(1);
    engine.destroy();
  });

  it('supports Cluster 1-Ring Incident Star zoom, Direct Spotlight 3-sector splitting, and Triangles-Only mode', () => {
    const crowded: DefaultTaggedItem[] = Array.from({ length: 36 }, (_, i) => ({
      id: `crowd-${i}`,
      tags:
        i % 4 === 0
          ? ['core', 'sub1']
          : i % 4 === 1
            ? ['core', 'sub2']
            : i % 4 === 2
              ? ['sub1', 'sub2']
              : ['sub2', 'sub3'],
    }));

    // 1) incident-star mode
    const starHr = createHeadlessRenderer();
    const starEngine = new SimplexGraphEngine({
      items: crowded,
      visualResolver: createResolver(28, 22),
      renderer: starHr.adapter,
      viewportWidth: 580,
      viewportHeight: 440,
      zoomStrategy: createBarycentricZoomStrategy({
        clusterZoomMode: 'incident-star',
      }),
    });
    stepToSettle(starEngine);

    const starRoot = starEngine.getZoomState();
    expect(starRoot.drillableClusterUids.length).toBeGreaterThan(0);
    const targetClusterUid = starRoot.drillableClusterUids[0]!;
    const rootTriCount = starEngine.getMesh()!.triangles.length;

    expect(starEngine.drillDownCluster(targetClusterUid)).toBe(true);
    stepToSettle(starEngine);
    expect(starEngine.getZoomState().activeFrameKind).toBe('cluster-star');
    expect(starEngine.getMesh()!.triangles.length).toBeLessThanOrEqual(rootTriCount);
    expect(starEngine.getMetrics().overlapCount).toBe(0);
    starEngine.destroy();

    // 2) spotlight mode splits a dense single-cluster stack across 3 sectors
    const monoItems: DefaultTaggedItem[] = Array.from({ length: 24 }, (_, i) => ({
      id: `mono-${i}`,
      tags: i < 16 ? ['solo'] : i < 20 ? ['solo', 'p2'] : ['p2', 'p3'],
    }));
    const spotHr = createHeadlessRenderer();
    const spotEngine = new SimplexGraphEngine({
      items: monoItems,
      visualResolver: createResolver(36, 24),
      renderer: spotHr.adapter,
      viewportWidth: 520,
      viewportHeight: 400,
      zoomStrategy: createBarycentricZoomStrategy({
        clusterZoomMode: 'spotlight',
      }),
    });
    stepToSettle(spotEngine);
    const soloCluster = spotEngine
      .getClusters()
      .reduce((best, c) => (c.members.length > best.members.length ? c : best));
    expect(spotEngine.drillDownCluster(soloCluster.clusterUid)).toBe(true);
    stepToSettle(spotEngine);
    expect(spotEngine.getZoomState().activeFrameKind).toBe('cluster-spotlight');
    expect(spotEngine.getMesh()!.triangles.length).toBe(1);
    expect(spotEngine.getClusters().length).toBe(3);
    expect(spotEngine.getMetrics().overlapCount).toBe(0);
    spotEngine.destroy();

    // 3) clusterZoomMode: 'none' disables cluster drill-down
    const noneHr = createHeadlessRenderer();
    const noneEngine = new SimplexGraphEngine({
      items: crowded,
      visualResolver: createResolver(28, 22),
      renderer: noneHr.adapter,
      viewportWidth: 580,
      viewportHeight: 440,
      zoomStrategy: createBarycentricZoomStrategy({
        clusterZoomMode: 'none',
      }),
    });
    stepToSettle(noneEngine);
    expect(noneEngine.getZoomState().drillableClusterUids.length).toBe(0);
    expect(noneEngine.drillDownCluster(noneEngine.getClusters()[0]!.clusterUid)).toBe(false);
    noneEngine.destroy();
  });

  it('createSemanticZoomStrategy splits secondary tags into 3->6 sub-clusters and supports free-camera disabling drill', () => {
    const taggedRich: DefaultTaggedItem[] = Array.from({ length: 32 }, (_, i) => ({
      id: `sem-${i}`,
      tags: [
        `main-${i % 3}`,
        `main-${(i + 1) % 3}`,
        `sub-${i % 4}`,
        `topic-${i % 5}`,
      ],
    }));

    const semHr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items: taggedRich,
      visualResolver: createResolver(28, 22),
      renderer: semHr.adapter,
      viewportWidth: 560,
      viewportHeight: 420,
      zoomStrategy: createSemanticZoomStrategy(),
    });
    stepToSettle(engine);

    const rootState = engine.getZoomState();
    expect(rootState.drillableTriangleIndices.length).toBeGreaterThan(0);
    expect(engine.drillDownTriangle(rootState.drillableTriangleIndices[0]!)).toBe(true);
    stepToSettle(engine);

    expect(engine.getZoomState().depth).toBe(1);
    expect(engine.getClusters().length).toBe(6);
    expect(engine.getMetrics().overlapCount).toBe(0);
    expect(engine.drillToRoot()).toBe(true);
    expect(engine.getZoomState().depth).toBe(0);
    engine.destroy();

    const freeHr = createHeadlessRenderer();
    const freeEngine = new SimplexGraphEngine({
      items: taggedRich,
      visualResolver: createResolver(24, 20),
      renderer: freeHr.adapter,
      viewportWidth: 800,
      viewportHeight: 600,
      zoomStrategy: createFreeCameraZoomStrategy(),
    });
    stepToSettle(freeEngine);
    expect(freeEngine.getZoomState().mode).toBe('free-camera');
    expect(freeEngine.drillDownTriangle(0)).toBe(false);
    expect(freeEngine.drillUp()).toBe(false);
    freeEngine.destroy();
  });

  it('animates continuous affine spatial flights on zoom-in, neighbor pan, zoom-out, and mid-flight interruption', () => {
    const hr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items: RICH_ITEMS,
      visualResolver: createResolver(28, 22),
      renderer: hr.adapter,
      viewportWidth: 640,
      viewportHeight: 460,
      zoomStrategy: createBarycentricZoomStrategy(),
    });
    stepToSettle(engine);

    const triSideLength = (
      tri: import('../src/types').MeshTriangleRenderState<DefaultTaggedItem, undefined, undefined>,
    ): number => Math.hypot(tri.points[1].x - tri.points[0].x, tri.points[1].y - tri.points[0].y);

    const firstTriIdx = engine.getZoomState().drillableTriangleIndices[0]!;
    expect(engine.drillDownTriangle(firstTriIdx)).toBe(true);

    // Immediately at t=0 of zoom-in flight, engine is actively flying (not settled)
    expect(engine.getMetrics().isSettled).toBe(false);
    const activeStartSide = triSideLength(
      hr.getLastTriangles().find((t) => !t.isContext && t.index >= 0)!,
    );

    // Sample mid-flight frames: active sub-triangles expand monotonically while preserving exact equilateral sides
    engine.step(140);
    const activeMid1 = hr.getLastTriangles().find((t) => !t.isContext && t.index >= 0)!;
    const activeMid1Side = triSideLength(activeMid1);
    const side12 = Math.hypot(
      activeMid1.points[2].x - activeMid1.points[1].x,
      activeMid1.points[2].y - activeMid1.points[1].y,
    );
    expect(activeMid1Side).toBeGreaterThan(activeStartSide);
    expect(side12).toBeCloseTo(activeMid1Side, 3);

    engine.step(180);
    const activeMid2Side = triSideLength(
      hr.getLastTriangles().find((t) => !t.isContext && t.index >= 0)!,
    );
    expect(activeMid2Side).toBeGreaterThan(activeMid1Side);

    stepToSettle(engine);
    const settledSubSide = triSideLength(
      hr.getLastTriangles().find((t) => !t.isContext && t.index >= 0)!,
    );
    expect(settledSubSide).toBeGreaterThanOrEqual(activeMid2Side);
    expect(engine.getMetrics().isSettled).toBe(true);
    expect(engine.getMetrics().overlapCount).toBe(0);
    // All departing ghosts are cleaned up once settled
    expect(hr.getLastTriangles().some((t) => t.index <= -10000)).toBe(false);
    expect(hr.getLastClusters().some((c) => c.id.startsWith('ghost-'))).toBe(false);

    // Lateral neighbor flight glides smoothly across the shared parent plane
    const neighborTri = hr
      .getLastTriangles()
      .find((t) => t.isContext && Boolean(t.neighborId) && t.coveredItemCount > 1);
    expect(neighborTri).toBeDefined();
    if (neighborTri?.neighborId) {
      const targetStartCentroid = { ...neighborTri.centroid };
      expect(engine.drillToNeighbor(neighborTri.neighborId)).toBe(true);
      // At t=0 of lateral flight, center of active sub-mesh starts near the clicked neighbor's on-screen centroid
      const activeAtPanStart = hr.getLastTriangles().filter((t) => !t.isContext && t.index >= 0);
      const meanStartX =
        activeAtPanStart.reduce((acc, t) => acc + t.centroid.x, 0) / activeAtPanStart.length;
      expect(Math.abs(meanStartX - targetStartCentroid.x)).toBeLessThan(25);

      engine.step(160);
      const activeMidPan = hr.getLastTriangles().filter((t) => !t.isContext && t.index >= 0);
      const meanMidX =
        activeMidPan.reduce((acc, t) => acc + t.centroid.x, 0) / activeMidPan.length;
      // Moves progressively toward viewport center (320)
      expect(Math.abs(meanMidX - 320)).toBeLessThan(Math.abs(meanStartX - 320) + 1);

      // Interrupt mid-flight with Zoom-Out (`drillUp`) and ensure zero coordinate jump
      const clusterBeforeInterrupt = hr
        .getLastClusters()
        .find((c) => !c.id.startsWith('ghost-') && !c.isContext)!;
      const posBeforeInterrupt = { x: clusterBeforeInterrupt.x, y: clusterBeforeInterrupt.y };

      expect(engine.drillUp()).toBe(true);
      const matchingAfterInterrupt = hr
        .getLastClusters()
        .find(
          (c) =>
            Math.hypot(c.x - posBeforeInterrupt.x, c.y - posBeforeInterrupt.y) < 4,
        );
      expect(matchingAfterInterrupt).toBeDefined();

      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(0);
      expect(engine.getMetrics().isSettled).toBe(true);
      expect(engine.getMetrics().overlapCount).toBe(0);
      expect(hr.getLastTriangles().some((t) => t.index <= -10000)).toBe(false);
    }

    engine.destroy();
  });

  it('preserves exact triangle geometric orientation (▲, ▼, ▶, ◀) from top overview down to deepest leaf frame', () => {
    const unitEdge = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    };

    const assertSameOrientation = (
      parentPts: readonly [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ],
      childPts: readonly [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ],
    ) => {
      for (let e = 0; e < 3; e++) {
        const uParent = unitEdge(parentPts[e]!, parentPts[(e + 1) % 3]!);
        const uChild = unitEdge(childPts[e]!, childPts[(e + 1) % 3]!);
        const dot = uParent.x * uChild.x + uParent.y * uChild.y;
        expect(dot).toBeGreaterThan(0.9995);
      }
    };

    // Dataset with enough density in every root triangle plus stacked identical items
    // so leaf depth exercises the zero-spread (`spread < 0.004`) sector-partition fallback too.
    const denseItems: DefaultTaggedItem[] = [
      ...RICH_ITEMS,
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `stack-a-${i}`,
        tags: ['rust', 'wasm', 'compilers'],
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `stack-b-${i}`,
        tags: ['typescript', 'react', 'svg'],
      })),
    ];

    for (const meshOrientation of ['horizontal', 'vertical'] as const) {
      const hr = createHeadlessRenderer();
      const engine = new SimplexGraphEngine({
        items: denseItems,
        visualResolver: createResolver(30, 22),
        renderer: hr.adapter,
        viewportWidth: meshOrientation === 'horizontal' ? 620 : 460,
        viewportHeight: meshOrientation === 'horizontal' ? 460 : 620,
        meshStrategy: createFixedLatticeMeshStrategy({
          cols: 3,
          rows: 2,
          orientation: meshOrientation,
        }),
        layoutOptions: { seed: 17 },
        zoomStrategy: createBarycentricZoomStrategy(),
      });
      stepToSettle(engine);

      const rootActiveTris = hr.getLastTriangles().filter((t) => !t.isContext && t.index >= 0);
      const rootDrillable = engine.getZoomState().drillableTriangleIndices;
      expect(rootDrillable.length).toBeGreaterThanOrEqual(2);

      // Test every drillable root triangle (covers both ▲ and ▼ in horizontal, and ▶ and ◀ in vertical)
      for (const rootTriIdx of rootDrillable) {
        engine.drillToRoot();
        stepToSettle(engine);

        let guard = 0;
        let nextTriIdx: number | undefined = rootTriIdx;
        while (nextTriIdx !== undefined && guard < 8) {
          const clickedTri = hr
            .getLastTriangles()
            .find((t) => !t.isContext && t.index === nextTriIdx)!;
          expect(clickedTri).toBeDefined();
          const parentPoints = clickedTri.points;

          expect(engine.drillDownTriangle(nextTriIdx)).toBe(true);
          stepToSettle(engine);

          const childTris = hr
            .getLastTriangles()
            .filter((t) => !t.isContext && t.index >= 0)
            .sort((a, b) => a.index - b.index);
          expect(childTris.length).toBeGreaterThanOrEqual(1);

          if (childTris.length === 1) {
            // Single-triangle leaf / sector-fallback frame must keep exact parent orientation
            assertSameOrientation(parentPoints, childTris[0]!.points);
          } else if (childTris.length === 4) {
            // Outer 3 sub-triangles (0, 1, 2) must keep exact parent orientation;
            // central medial sub-triangle (3) is the inverted medial triangle (-1 * edge vectors).
            assertSameOrientation(parentPoints, childTris[0]!.points);
            assertSameOrientation(parentPoints, childTris[1]!.points);
            assertSameOrientation(parentPoints, childTris[2]!.points);
          }

          const deeper = engine.getZoomState().drillableTriangleIndices;
          // Prefer central medial triangle (index 3) when available to test inverted sub-triangle chaining too
          nextTriIdx = deeper.includes(3) ? 3 : deeper[0];
          guard += 1;
        }
      }

      // Confirm root mesh actually contained opposite orientations (both ▲ and ▼, or both ▶ and ◀)
      if (rootActiveTris.length >= 2) {
        const polarity = (pts: readonly [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]) => {
          const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
          const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
          if (meshOrientation === 'horizontal') {
            const minY = Math.min(pts[0].y, pts[1].y, pts[2].y);
            const maxY = Math.max(pts[0].y, pts[1].y, pts[2].y);
            return cy - minY > maxY - cy ? 'up' : 'down';
          }
          const minX = Math.min(pts[0].x, pts[1].x, pts[2].x);
          const maxX = Math.max(pts[0].x, pts[1].x, pts[2].x);
          return maxX - cx > cx - minX ? 'right' : 'left';
        };
        const p0 = polarity(rootActiveTris[0]!.points);
        expect(rootActiveTris.some((t) => polarity(t.points) !== p0)).toBe(true);
      }

      engine.destroy();
    }
  });

  it('marks zoomed midpoint clusters as compact intermediate bridge nodes and preserves intermediate role at deeper zoom levels', () => {
    const hr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items: RICH_ITEMS,
      visualResolver: createResolver(30, 22),
      renderer: hr.adapter,
      viewportWidth: 620,
      viewportHeight: 440,
      zoomStrategy: createBarycentricZoomStrategy(),
    });
    stepToSettle(engine);

    // Depth 0: all root clusters are primary topic clusters
    for (const rootCluster of engine.getClusters()) {
      expect(rootCluster.role ?? 'primary').toBe('primary');
      expect(rootCluster.code).toMatch(/^T\d+$/);
    }

    const tri0 = engine.getZoomState().drillableTriangleIndices[0]!;
    expect(engine.drillDownTriangle(tri0)).toBe(true);
    stepToSettle(engine);

    const depth1Clusters = engine.getClusters();
    expect(depth1Clusters.length).toBe(6);

    // Midpoint clusters (indices 3..5) must have role === 'intermediate', compact 'Tx·Ty' code (no '50%' bloat), and mixWeights
    for (const midIdx of [3, 4, 5]) {
      const mid = depth1Clusters[midIdx]!;
      expect(mid.role).toBe('intermediate');
      expect(mid.code).toMatch(/^T\d+·T\d+(·T\d+)?$/);
      expect(mid.code).not.toContain('%');
      expect(mid.mixWeights?.length).toBeGreaterThanOrEqual(2);
    }

    // Drill deeper into a sub-triangle at depth 2 and ensure inherited midpoint corners stay 'intermediate'
    const depth2Drillable = engine.getZoomState().drillableTriangleIndices;
    if (depth2Drillable.length > 0) {
      // Sub-triangle 0 uses parent vertices [0, 3, 5]; sub-triangle 3 uses [3, 4, 5] (all midpoints)
      const pickSub = depth2Drillable.includes(0) ? 0 : depth2Drillable[0]!;
      expect(engine.drillDownTriangle(pickSub)).toBe(true);
      stepToSettle(engine);

      const depth2Clusters = engine.getClusters();
      if (depth2Clusters.length === 6 && pickSub === 0) {
        // Corners 1 and 2 of sub-triangle 0 were midpoints 3 and 5 in depth 1 -> must remain 'intermediate'
        expect(depth2Clusters[1]!.role).toBe('intermediate');
        expect(depth2Clusters[2]!.role).toBe('intermediate');
        expect(depth2Clusters[3]!.role).toBe('intermediate');
      } else {
        expect(depth2Clusters.some((c) => c.role === 'intermediate')).toBe(true);
      }
    }

    engine.destroy();
  });

  it('keeps non-active neighborhood content items visible as dimmed pass-through nodes without hover effects, routing hover & click to the neighbor triangle', () => {
    for (const strategy of [
      createBarycentricZoomStrategy(),
      createSemanticZoomStrategy(),
    ]) {
      let contentHoverHits = 0;
      let hoveredNeighborTriId: string | undefined;
      const hr = createHeadlessRenderer();
      const engine = new SimplexGraphEngine({
        items: RICH_ITEMS,
        visualResolver: createResolver(28, 22),
        renderer: hr.adapter,
        viewportWidth: 640,
        viewportHeight: 460,
        zoomStrategy: strategy,
        interactions: {
          onContentHover: (ev) => {
            if (ev) contentHoverHits += 1;
          },
          onTriangleHover: (ev) => {
            hoveredNeighborTriId = ev?.triangle.isContext
              ? ev.triangle.neighborId
              : undefined;
          },
        },
      });
      stepToSettle(engine);

      const rootItemCount = hr.getLastItems().length;
      expect(rootItemCount).toBe(RICH_ITEMS.length);
      expect(hr.getLastItems().some((it) => it.isContext)).toBe(false);

      const firstTriIdx = engine.getZoomState().drillableTriangleIndices[0]!;
      expect(engine.drillDownTriangle(firstTriIdx)).toBe(true);
      stepToSettle(engine);

      const activeItems = hr.getLastItems().filter((it) => !it.isContext);
      const contextItems = hr.getLastItems().filter((it) => it.isContext);
      expect(activeItems.length).toBeGreaterThan(0);
      expect(contextItems.length).toBeGreaterThan(0);
      expect(engine.getMetrics().overlapCount).toBe(0);

      for (const ci of contextItems) {
        expect(ci.opacity).toBeCloseTo(0.32, 2);
        expect(ci.interaction.isDimmed).toBe(true);
        expect(ci.interaction.isHovered).toBe(false);
        expect(ci.isPassThrough).toBe(true);
        expect(ci.id.startsWith('ctx-it-')).toBe(true);
      }

      // Find a dimmed neighbor item whose coordinates hit its neighbor context triangle (not occluded by an active node/cluster)
      const unoccludedCtxItem = contextItems.find((ci) => {
        const hit = engine.hitTest(ci.x, ci.y);
        return (
          hit.kind === 'triangle' &&
          hit.triangle.isContext === true &&
          Boolean(hit.triangle.neighborId)
        );
      });
      expect(unoccludedCtxItem).toBeDefined();
      if (unoccludedCtxItem) {
        engine.handlePointerMove(unoccludedCtxItem.x, unoccludedCtxItem.y);
        engine.step(16);

        // Hovering directly over the dimmed content item produces ZERO content hover effect;
        // instead the entire neighbor triangle highlights!
        expect(contentHoverHits).toBe(0);
        expect(
          hr
            .getLastItems()
            .filter((it) => it.isContext)
            .every((it) => it.interaction.isHovered === false),
        ).toBe(true);
        expect(hoveredNeighborTriId).toBeDefined();
        expect(
          hr
            .getLastTriangles()
            .some((t) => t.isContext && t.interaction.isHovered === true),
        ).toBe(true);

        const hit = engine.hitTest(unoccludedCtxItem.x, unoccludedCtxItem.y);
        expect(hit.kind).toBe('triangle');
        if (hit.kind === 'triangle' && hit.triangle.neighborId) {
          const prevFrameId = engine.getZoomState().breadcrumbs.at(-1)?.frameId;
          expect(engine.drillToNeighbor(hit.triangle.neighborId)).toBe(true);
          stepToSettle(engine);
          expect(engine.getZoomState().breadcrumbs.at(-1)?.frameId).not.toBe(
            prevFrameId,
          );
          expect(engine.getMetrics().overlapCount).toBe(0);
          expect(hr.getLastItems().some((it) => it.isContext)).toBe(true);
        }
      }

      expect(engine.drillToRoot()).toBe(true);
      stepToSettle(engine);
      expect(hr.getLastItems().some((it) => it.isContext)).toBe(false);
      expect(hr.getLastItems().length).toBe(RICH_ITEMS.length);

      engine.destroy();
    }
  });

  it('restores exact content node scales and positions after zoom-in followed by zoom-out with warm-start collision local scaling and semantic zoom', () => {
    const hr = createHeadlessRenderer();
    const composedWarmLayout = createComposedLayoutStrategy({
      seeder: createMeshInwardFanSeeder(),
      relaxer: createBarycentricPbdRelaxer(),
      scaleController: createCollisionLocalScaleController({
        minLocalScale: 0.34,
        shrinkFactor: 0.85,
        refinementPasses: 6,
      }),
      warmStart: true,
    });

    const engine = new SimplexGraphEngine({
      items: RICH_ITEMS,
      visualResolver: createResolver(28, 22),
      renderer: hr.adapter,
      viewportWidth: 620,
      viewportHeight: 440,
      layoutOptions: { seed: 42 },
      layoutStrategy: composedWarmLayout,
      zoomStrategy: createSemanticZoomStrategy(),
    });
    stepToSettle(engine);

    const beforeRootItems = new Map(
      hr.getLastItems().map((it) => [
        it.id,
        { x: it.x, y: it.y, scale: it.scale },
      ]),
    );
    expect(beforeRootItems.size).toBe(RICH_ITEMS.length);

    const tri0 = engine.getZoomState().drillableTriangleIndices[0]!;
    expect(engine.drillDownTriangle(tri0)).toBe(true);
    stepToSettle(engine);

    const d1Drillable = engine.getZoomState().drillableTriangleIndices;
    if (d1Drillable.length > 0) {
      const beforeD1Active = new Map(
        hr
          .getLastItems()
          .filter((it) => !it.isContext)
          .map((it) => [it.id, { x: it.x, y: it.y, scale: it.scale }]),
      );

      expect(engine.drillDownTriangle(d1Drillable[0]!)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(2);

      // Zoom out one step (depth 2 -> depth 1) and verify depth 1 scales/positions match pre-drill
      expect(engine.drillUp()).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(1);
      const afterD1Active = hr.getLastItems().filter((it) => !it.isContext);
      expect(afterD1Active.length).toBe(beforeD1Active.size);
      for (const it of afterD1Active) {
        const before = beforeD1Active.get(it.id)!;
        expect(before).toBeDefined();
        expect(it.scale).toBeCloseTo(before.scale, 5);
        expect(it.x).toBeCloseTo(before.x, 4);
        expect(it.y).toBeCloseTo(before.y, 4);
      }
    }

    // Zoom out to root (depth 1 -> depth 0) and verify zero shrinkage on every single content node
    expect(engine.drillUp()).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().depth).toBe(0);

    const afterRootItems = hr.getLastItems();
    expect(afterRootItems.length).toBe(RICH_ITEMS.length);
    for (const it of afterRootItems) {
      const before = beforeRootItems.get(it.id)!;
      expect(before).toBeDefined();
      expect(it.scale).toBeCloseTo(before.scale, 5);
      expect(it.x).toBeCloseTo(before.x, 4);
      expect(it.y).toBeCloseTo(before.y, 4);
    }

    engine.destroy();
  });

  it('re-partitions a triangle tag subset across all 6 vertices when needed and prevents infinite loops in semantic zoom', () => {
    // 1) Dataset where a dense hub group shares 'ml' plus distinct sub-tags inside one triangle
    // AND an identical-tag clump ('dupA', 'dupB', 'dupC') tests strict loop termination.
    const semanticChallengeItems: DefaultTaggedItem[] = [
      // Rich sub-tag combinations under shared 'ml' umbrella (requires 6-vertex re-partitioning!)
      ...Array.from({ length: 18 }, (_, i) => {
        const subCombos: readonly (readonly string[])[] = [
          ['ml', 'vision', 'cnn'],
          ['ml', 'nlp', 'transformers'],
          ['ml', 'rl', 'robotics'],
          ['ml', 'vision', 'transformers'],
          ['ml', 'nlp', 'cnn'],
          ['ml', 'rl', 'vision'],
        ];
        return {
          id: `hub-${i}`,
          tags: [...subCombos[i % subCombos.length]!],
        };
      }),
      // Identical-tag clump that previously looped infinitely into central sub-triangle [4,5,3]
      ...Array.from({ length: 14 }, (_, i) => ({
        id: `identical-${i}`,
        tags: ['dup-alpha', 'dup-beta', 'dup-gamma'],
      })),
      // Separate outer topic items so root forms a multi-triangle mesh
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `outer-${i}`,
        tags: i % 2 === 0 ? ['systems', 'kernel'] : ['frontend', 'webgl'],
      })),
    ];

    const hr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items: semanticChallengeItems,
      visualResolver: createResolver(28, 22),
      renderer: hr.adapter,
      viewportWidth: 560,
      viewportHeight: 420,
      layoutOptions: { seed: 99 },
      zoomStrategy: createSemanticZoomStrategy(),
    });
    stepToSettle(engine);

    const rootDrillable = [...engine.getZoomState().drillableTriangleIndices];
    expect(rootDrillable.length).toBeGreaterThan(0);

    // Verify EVERY drillable root path terminates in a small finite number of steps with 0 overlaps
    for (const startTri of rootDrillable) {
      engine.drillToRoot();
      stepToSettle(engine);

      // Record parent triangle's allowed tag subset (union of parent corner tags + covered item tags)
      const rootClusters = engine.getClusters();
      const rootTri = engine.getMesh()!.triangles[startTri]!;
      const parentCornerTagUnion = new Set<string>();
      for (const vIdx of rootTri.vertices) {
        const cl = rootClusters[vIdx];
        if (!cl) continue;
        for (const t of cl.coreTags) parentCornerTagUnion.add(t.tag);
        for (const t of cl.sharedTags) parentCornerTagUnion.add(t.tag);
      }

      let steps = 0;
      let nextTri: number | undefined = startTri;
      let prevActiveCount = Infinity;

      while (nextTri !== undefined && steps < 14) {
        expect(engine.drillDownTriangle(nextTri)).toBe(true);
        stepToSettle(engine);
        steps += 1;

        expect(engine.getMetrics().overlapCount).toBe(0);
        const activeItems = hr.getLastItems().filter((it) => !it.isContext);
        expect(activeItems.length).toBeGreaterThan(0);

        if (steps === 1) {
          // Verify all synthesized cluster tags stay within the focused triangle's tag subset
          const allowedTags = new Set<string>(parentCornerTagUnion);
          for (const cl of engine.getClusters()) {
            for (const m of cl.members) {
              for (const rawT of m.item.tags) allowedTags.add(rawT);
            }
          }
          for (const cl of engine.getClusters()) {
            for (const t of cl.coreTags) {
              expect(allowedTags.has(t.tag)).toBe(true);
            }
          }

          // When 6-vertex mesh is built for diverse hub items, items spread across multiple sub-triangles
          const subMesh = engine.getMesh()!;
          if (subMesh.triangles.length === 4 && activeItems.some((it) => it.id.startsWith('hub-'))) {
            const occupiedFaces = new Set<number>();
            for (const p of activeItems) {
              for (const t of subMesh.triangles) {
                const a = subMesh.vertices[t.vertices[0]]!;
                const b = subMesh.vertices[t.vertices[1]]!;
                const c = subMesh.vertices[t.vertices[2]]!;
                if (isPointInTriangle(p.x, p.y, a, b, c)) {
                  occupiedFaces.add(t.index);
                }
              }
            }
            expect(occupiedFaces.size).toBeGreaterThanOrEqual(2);
          }
        }

        // Strict progress: either active item count shrinks OR frame transitioned to terminal leaf sector frame
        const zState = engine.getZoomState();
        if (zState.drillableTriangleIndices.length > 0) {
          expect(activeItems.length).toBeLessThanOrEqual(prevActiveCount);
        }
        prevActiveCount = activeItems.length;
        nextTri = zState.drillableTriangleIndices[0];
      }

      // Must have reached leaf well before the loop guard (no infinite loop!)
      expect(steps).toBeLessThanOrEqual(10);
      expect(engine.getZoomState().drillableTriangleIndices.length).toBe(0);
      expect(engine.getZoomState().isLeafReached).toBe(true);
    }

    engine.destroy();
  });

  it('disables mouse scroll wheel camera zoom/pan in drill-down strategies even when custom onWheel handlers are supplied', () => {
    let customWheelCalled = 0;
    const hr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items: RICH_ITEMS,
      visualResolver: createResolver(24, 20),
      renderer: hr.adapter,
      viewportWidth: 640,
      viewportHeight: 460,
      zoomStrategy: createBarycentricZoomStrategy(),
      interactions: {
        onWheel: (_ev, cam) => {
          customWheelCalled += 1;
          cam.zoomToCursor(320, 230, 1.5);
        },
      },
    });
    stepToSettle(engine);

    // 1. Barycentric drill-down: wheel returns false, camera untouched, custom onWheel NOT invoked
    const handledBary = engine.handleWheel({
      screenX: 320,
      screenY: 230,
      deltaX: 0,
      deltaY: -120,
      ctrlKey: false,
      shiftKey: false,
    });
    expect(handledBary).toBe(false);
    expect(customWheelCalled).toBe(0);
    expect(engine.camera.getState()).toEqual({ panX: 0, panY: 0, zoom: 1 });

    // 2. Semantic drill-down: wheel also returns false, camera untouched
    engine.setZoomStrategy(createSemanticZoomStrategy());
    const handledSem = engine.handleWheel({
      screenX: 200,
      screenY: 180,
      deltaX: 20,
      deltaY: 140,
      ctrlKey: false,
      shiftKey: false,
    });
    expect(handledSem).toBe(false);
    expect(customWheelCalled).toBe(0);
    expect(engine.camera.getState()).toEqual({ panX: 0, panY: 0, zoom: 1 });

    // 3. Switching to free-camera re-enables wheel policy immediately
    engine.setZoomStrategy(createFreeCameraZoomStrategy());
    const handledFree = engine.handleWheel({
      screenX: 320,
      screenY: 230,
      deltaX: 0,
      deltaY: -120,
      ctrlKey: false,
      shiftKey: false,
    });
    expect(handledFree).toBe(true);
    expect(customWheelCalled).toBe(1);
    expect(engine.camera.getState().zoom).toBeGreaterThan(1);

    engine.destroy();
  });

  it('allows clicking any dimmed neighbor across depths, automatically zooming out as many levels as needed when the neighbor does not support the deeper zoom level', () => {
    // Construct an asymmetric dataset on a fixed 3x2 lattice (4 triangles):
    // - One super-dense group (`dense-a` + `dense-b` + `dense-c` with sub-variations) drills to depth >= 2
    // - A second dense group (`mid-x` + `mid-y`) supports depth 1
    // - Remaining triangle(s) on the 3x2 lattice are empty/sparse and do NOT support depth 1
    const asymmetricItems: DefaultTaggedItem[] = [
      ...Array.from({ length: 28 }, (_, i) => ({
        id: `deep-${i}`,
        tags:
          i % 4 === 0
            ? ['dense-a', 'dense-b']
            : i % 4 === 1
              ? ['dense-b', 'dense-c']
              : i % 4 === 2
                ? ['dense-a', 'dense-c']
                : ['dense-a', 'dense-b', 'dense-c'],
      })),
      ...Array.from({ length: 14 }, (_, i) => ({
        id: `mid-${i}`,
        tags: ['mid-x', 'dense-c'],
      })),
    ];

    const localScaleLayout = createComposedLayoutStrategy({
      seeder: createMeshInwardFanSeeder(),
      relaxer: createBarycentricPbdRelaxer(),
      scaleController: createCollisionLocalScaleController(),
    });

    for (const strategyFactory of [
      () =>
        createBarycentricZoomStrategy({
          clusterZoomMode: 'none',
          leafTriangleFocus: false,
        }),
      () =>
        createSemanticZoomStrategy({
          clusterZoomMode: 'none',
          leafTriangleFocus: false,
        }),
    ]) {
      const hr = createHeadlessRenderer();
      const engine = new SimplexGraphEngine({
        items: asymmetricItems,
        visualResolver: createResolver(36, 24),
        renderer: hr.adapter,
        viewportWidth: 520,
        viewportHeight: 390,
        meshStrategy: createFixedLatticeMeshStrategy({
          cols: 4,
          rows: 2,
          orientation: 'horizontal',
        }),
        layoutStrategy: localScaleLayout,
        layoutOptions: { seed: 42 },
        zoomStrategy: strategyFactory(),
      });
      stepToSettle(engine);

      const rootDrillableSet = new Set(engine.getZoomState().drillableTriangleIndices);
      expect(rootDrillableSet.size).toBeGreaterThanOrEqual(2);
      const totalRootTris = engine.getMesh()!.triangles.length;
      // Ensure there is at least one non-drillable root triangle (empty or already full-scale leaf)
      expect(totalRootTris).toBeGreaterThan(rootDrillableSet.size);

      // Find a (rootTri, subTri) path to depth = 2 where both a drillable and a non-drillable `@root/tri:*`
      // neighbor overlap the viewport so we can test both depth 2 -> 1 (switch) and depth 2 -> 0 (2-level zoom-out)
      let deepRootTri: number | null = null;
      let secondLevelTri: number | null = null;
      for (const candRootTri of rootDrillableSet) {
        engine.drillToRoot();
        stepToSettle(engine);
        if (!engine.drillDownTriangle(candRootTri)) continue;
        stepToSettle(engine);
        const d1Drillable = [...engine.getZoomState().drillableTriangleIndices];
        for (const candSubTri of d1Drillable) {
          engine.drillToRoot();
          stepToSettle(engine);
          engine.drillDownTriangle(candRootTri);
          stepToSettle(engine);
          if (!engine.drillDownTriangle(candSubTri)) continue;
          stepToSettle(engine);
          const ctxAtD2 = hr.getLastTriangles().filter((t) => t.isContext);
          const hasLeafOuter = ctxAtD2.some((t) => {
            const m = t.neighborId?.match(/^@root\/tri:(\d+)$/);
            return m ? !rootDrillableSet.has(Number(m[1])) : false;
          });
          const hasDrillableOuter = ctxAtD2.some((t) => {
            const m = t.neighborId?.match(/^@root\/tri:(\d+)$/);
            return m ? rootDrillableSet.has(Number(m[1])) : false;
          });
          if (hasLeafOuter && hasDrillableOuter) {
            deepRootTri = candRootTri;
            secondLevelTri = candSubTri;
            break;
          }
        }
        if (deepRootTri !== null) break;
      }
      expect(deepRootTri).not.toBeNull();
      expect(secondLevelTri).not.toBeNull();

      // Case A: At depth = 1, clicking a root neighbor triangle that does NOT support depth 1 zooms out 1 level to depth = 0
      engine.drillToRoot();
      stepToSettle(engine);
      expect(engine.drillDownTriangle(deepRootTri!)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(1);

      const d1CtxTris = hr.getLastTriangles().filter((t) => t.isContext);
      // Every context triangle now carries a scoped `@root/tri:<idx>` neighborId (even 0-item or leaf faces!)
      expect(d1CtxTris.every((t) => Boolean(t.neighborId))).toBe(true);
      const nonDrillableRootNeighbor = d1CtxTris.find((t) => {
        const match = t.neighborId?.match(/tri:(\d+)$/);
        return match ? !rootDrillableSet.has(Number(match[1])) : false;
      });
      expect(nonDrillableRootNeighbor?.neighborId).toBeDefined();
      expect(engine.drillToNeighbor(nonDrillableRootNeighbor!.neighborId!)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(0);
      expect(engine.getMetrics().overlapCount).toBe(0);

      // Case B: At depth = 1, clicking a root neighbor triangle that DOES support depth 1 switches laterally at depth = 1
      expect(engine.drillDownTriangle(deepRootTri!)).toBe(true);
      stepToSettle(engine);
      const d1FrameBefore = engine.getZoomState().breadcrumbs.at(-1)?.frameId;
      const drillableRootNeighbor = hr
        .getLastTriangles()
        .filter((t) => t.isContext)
        .find((t) => {
          const match = t.neighborId?.match(/^@root\/tri:(\d+)$/);
          return match ? rootDrillableSet.has(Number(match[1])) : false;
        });
      expect(drillableRootNeighbor?.neighborId).toBeDefined();
      expect(engine.drillToNeighbor(drillableRootNeighbor!.neighborId!)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(1);
      expect(engine.getZoomState().breadcrumbs.at(-1)?.frameId).not.toBe(d1FrameBefore);
      expect(engine.getMetrics().overlapCount).toBe(0);

      // Case C: Drill to depth = 2 and inspect dimmed neighbors from BOTH depth 1 (`@<d1Frame>/...`) AND depth 0 (`@root/...`)
      engine.drillToRoot();
      stepToSettle(engine);
      expect(engine.drillDownTriangle(deepRootTri!)).toBe(true);
      stepToSettle(engine);
      const d1FrameId = engine.getZoomState().breadcrumbs.at(-1)!.frameId;
      const d1DrillableSet = new Set(engine.getZoomState().drillableTriangleIndices);

      expect(engine.drillDownTriangle(secondLevelTri!)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(2);

      const d2CtxTris = hr.getLastTriangles().filter((t) => t.isContext);
      // Ancestor context triangles from root (`@root/tri:...`) preserve their neighborId at depth = 2!
      const outerRootCtxAtD2 = d2CtxTris.filter((t) =>
        t.neighborId?.startsWith('@root/tri:'),
      );
      const siblingD1CtxAtD2 = d2CtxTris.filter((t) =>
        t.neighborId?.startsWith(`@${d1FrameId}/tri:`),
      );
      expect(outerRootCtxAtD2.length).toBeGreaterThan(0);
      expect(siblingD1CtxAtD2.length).toBeGreaterThan(0);

      // C1: Clicking a sibling sub-triangle at depth 1 that does NOT support depth 2 zooms out 1 level (2 -> 1, NOT 0!)
      const leafSiblingAtD2 = siblingD1CtxAtD2.find((t) => {
        const m = t.neighborId?.match(/tri:(\d+)$/);
        return m ? !d1DrillableSet.has(Number(m[1])) : false;
      });
      if (leafSiblingAtD2?.neighborId) {
        expect(engine.drillToNeighbor(leafSiblingAtD2.neighborId)).toBe(true);
        stepToSettle(engine);
        expect(engine.getZoomState().depth).toBe(1);
        expect(engine.getZoomState().breadcrumbs.at(-1)?.frameId).toBe(d1FrameId);
        // Drill back into depth = 2 for outer root neighbor tests
        expect(engine.drillDownTriangle(secondLevelTri!)).toBe(true);
        stepToSettle(engine);
        expect(engine.getZoomState().depth).toBe(2);
      }

      // C2: Clicking an outer `@root/tri:<idx>` neighbor from depth = 2 that DOES support depth 1
      // zooms out 1 level AND switches into that neighbor root triangle (`depth = 1`)!
      const drillableOuterAtD2 = hr
        .getLastTriangles()
        .filter((t) => t.isContext)
        .find((t) => {
          const m = t.neighborId?.match(/^@root\/tri:(\d+)$/);
          return m ? rootDrillableSet.has(Number(m[1])) : false;
        });
      expect(drillableOuterAtD2?.neighborId).toBeDefined();
      expect(engine.drillToNeighbor(drillableOuterAtD2!.neighborId!)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(1);
      expect(engine.getZoomState().breadcrumbs.at(-1)?.frameId).not.toBe(d1FrameId);
      expect(engine.getMetrics().overlapCount).toBe(0);

      // C3: Drill back to depth = 2, then click an outer `@root/tri:<idx>` neighbor that does NOT even support depth 1 ->
      // zooms out 2 levels straight to `depth = 0`!
      engine.drillToRoot();
      stepToSettle(engine);
      expect(engine.drillDownTriangle(deepRootTri!)).toBe(true);
      stepToSettle(engine);
      expect(engine.drillDownTriangle(secondLevelTri!)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(2);

      const leafOuterAtD2 = hr
        .getLastTriangles()
        .filter((t) => t.isContext)
        .find((t) => {
          const m = t.neighborId?.match(/^@root\/tri:(\d+)$/);
          return m ? !rootDrillableSet.has(Number(m[1])) : false;
        });
      expect(leafOuterAtD2?.neighborId).toBeDefined();
      expect(engine.drillToNeighbor(leafOuterAtD2!.neighborId!)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(0);
      expect(engine.getMetrics().overlapCount).toBe(0);

      // C4: Dimmed clusters in `clusterZoomMode: 'none'` zoom out cleanly to their ancestor depth when clicked!
      expect(engine.drillDownTriangle(deepRootTri!)).toBe(true);
      stepToSettle(engine);
      expect(engine.drillDownTriangle(secondLevelTri!)).toBe(true);
      stepToSettle(engine);
      const d2SiblingCtxCluster = hr
        .getLastClusters()
        .find((c) => c.isContext && c.neighborId?.startsWith(`@${d1FrameId}/cluster:`));
      expect(d2SiblingCtxCluster?.neighborId).toBeDefined();
      expect(engine.drillToNeighbor(d2SiblingCtxCluster!.neighborId!)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(1);

      const d1RootCtxCluster = hr
        .getLastClusters()
        .find((c) => c.isContext && c.neighborId?.startsWith('@root/cluster:'));
      expect(d1RootCtxCluster?.neighborId).toBeDefined();
      expect(engine.drillToNeighbor(d1RootCtxCluster!.neighborId!)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(0);

      engine.destroy();
    }
  });

  it('highlights the focused macro-triangle when zoomed in and highlights the clicked neighbor when neighbor click triggers zoom-out', () => {
    const meshStrategy = createFixedLatticeMeshStrategy({ rows: 3, cols: 3 });
    const items: DefaultTaggedItem[] = [
      ...Array.from({ length: 18 }, (_, i) => ({
        id: `focus-dense-${i}`,
        tags: ['alpha', 'beta', `sub-${i % 3}`],
      })),
      ...Array.from({ length: 16 }, (_, i) => ({
        id: `focus-dense-b-${i}`,
        tags: ['beta', 'gamma', `sub-${i % 3}`],
      })),
      { id: 'sparse-leaf-0', tags: ['delta'] },
    ];

    const hr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items,
      visualResolver: createResolver(30, 20),
      renderer: hr.adapter,
      viewportWidth: 640,
      viewportHeight: 460,
      meshStrategy,
      zoomStrategy: createBarycentricZoomStrategy({
        clusterZoomMode: 'none',
        leafTriangleFocus: false,
      }),
      layoutOptions: { seed: 77 },
    });
    stepToSettle(engine);

    // At root overview (depth = 0), no triangle or edge is highlighted at rest
    expect(hr.getLastTriangles().every((t) => !t.interaction.isHighlighted)).toBe(
      true,
    );
    expect(hr.getLastEdges().every((e) => !e.isHighlighted)).toBe(true);

    const rootDrillable = engine.getZoomState().drillableTriangleIndices;
    const rootDrillableSet = new Set(rootDrillable);
    expect(rootDrillable.length).toBeGreaterThan(0);

    // 1) Zoom into a drillable root triangle -> focused macro-triangle gets hover-like highlight!
    expect(engine.drillDownTriangle(rootDrillable[0]!)).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().depth).toBe(1);

    const activeD1Tris = hr.getLastTriangles().filter((t) => !t.isContext);
    const contextD1Tris = hr.getLastTriangles().filter((t) => t.isContext);
    expect(activeD1Tris.length).toBe(4);
    expect(activeD1Tris.every((t) => t.interaction.isHighlighted === true)).toBe(
      true,
    );
    expect(contextD1Tris.every((t) => t.interaction.isHighlighted === false)).toBe(
      true,
    );

    // Outer 6 perimeter edges of the 1:4 subdivided triangle are highlighted; inner 3 medial edges stay un-highlighted at rest
    const activeD1Edges = hr.getLastEdges().filter((e) => !e.isDimmed);
    expect(activeD1Edges.length).toBe(9);
    expect(activeD1Edges.filter((e) => e.isHighlighted).length).toBe(6);
    expect(activeD1Edges.filter((e) => !e.isHighlighted).length).toBe(3);

    // Total outer boundary segments across active sub-triangles = 6, total outer corners = 3
    const totalBoundarySides = activeD1Tris.reduce(
      (acc, t) =>
        acc + (t.highlightBoundary?.edges.filter(Boolean).length ?? 0),
      0,
    );
    const totalOuterCorners = activeD1Tris.reduce(
      (acc, t) =>
        acc + (t.highlightBoundary?.corners.filter(Boolean).length ?? 0),
      0,
    );
    expect(totalBoundarySides).toBe(6);
    expect(totalOuterCorners).toBe(3);

    // Hovering center sub-triangle #3 [4,5,3] illuminates all 3 of its inner medial edges too!
    const centerTri = activeD1Tris[3]!;
    engine.handlePointerMove(centerTri.centroid.x, centerTri.centroid.y);
    engine.step(16);
    const hoveredCenter = hr
      .getLastTriangles()
      .find((t) => !t.isContext && t.index === 3);
    if (hoveredCenter?.interaction.isHovered) {
      expect(hoveredCenter.highlightBoundary).toBeUndefined();
      expect(
        hr.getLastEdges().filter((e) => !e.isDimmed && e.isHighlighted).length,
      ).toBe(9);
    }
    engine.handlePointerLeave();
    engine.step(16);

    // 2) Click a non-drillable root neighbor triangle -> zooms out to depth 0 AND highlights that exact neighbor triangle!
    const leafNeighborCtx = hr
      .getLastTriangles()
      .filter((t) => t.isContext)
      .find((t) => {
        const m = t.neighborId?.match(/^@root\/tri:(\d+)$/);
        return m ? !rootDrillableSet.has(Number(m[1])) : false;
      });
    expect(leafNeighborCtx?.neighborId).toBeDefined();
    const expectedNeighborTriIdx = Number(
      leafNeighborCtx!.neighborId!.match(/tri:(\d+)$/)![1],
    );

    expect(engine.drillToNeighbor(leafNeighborCtx!.neighborId!)).toBe(true);
    // Simulate controlled React/DemoApp focus-reset calls right after `drillToNeighbor`
    engine.setFocusedClusterUid(null);
    engine.setFocusedTriangleIndex(null);
    engine.setHighlightedIds(new Set());
    stepToSettle(engine);

    expect(engine.getZoomState().depth).toBe(0);
    const rootTrisAfterZoomOut = hr.getLastTriangles();
    const highlightedTris = rootTrisAfterZoomOut.filter(
      (t) => t.interaction.isHighlighted,
    );
    expect(highlightedTris.map((t) => t.index)).toEqual([expectedNeighborTriIdx]);
    expect(highlightedTris[0]!.highlightBoundary).toBeUndefined();
    // All 3 edges of the returned neighbor triangle are highlighted
    expect(hr.getLastEdges().filter((e) => e.isHighlighted).length).toBe(3);

    // 3) Clicking a non-drillable neighbor cluster zooms out and highlights that cluster + its incident edges
    expect(engine.drillDownTriangle(rootDrillable[0]!)).toBe(true);
    stepToSettle(engine);
    const ctxCluster = hr
      .getLastClusters()
      .find((c) => c.isContext && c.neighborId?.startsWith('@root/cluster:'));
    expect(ctxCluster?.neighborId).toBeDefined();
    expect(engine.drillToNeighbor(ctxCluster!.neighborId!)).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().depth).toBe(0);
    const highlightedClusters = hr
      .getLastClusters()
      .filter((c) => c.interaction.isHighlighted);
    expect(highlightedClusters.length).toBe(1);
    expect(hr.getLastEdges().some((e) => e.isHighlighted)).toBe(true);

    // Subsequent background left-click clears the neighbor-return highlight cleanly
    engine.handleLeftClick({
      screenX: 4,
      screenY: 4,
      button: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
    engine.step(16);
    expect(hr.getLastClusters().some((c) => c.interaction.isHighlighted)).toBe(
      false,
    );
    expect(hr.getLastTriangles().some((t) => t.interaction.isHighlighted)).toBe(
      false,
    );

    engine.destroy();
  });

  it('passes hover and click through content items inside drillable triangles while keeping leaf-triangle content items interactive', () => {
    const meshStrategy = createFixedLatticeMeshStrategy({ rows: 3, cols: 3 });
    const items: DefaultTaggedItem[] = [
      // Dense 3-cluster interior items in one triangle -> downscaled & drillable
      ...Array.from({ length: 18 }, (_, i) => ({
        id: `dense-item-${i}`,
        tags: ['alpha', 'beta', 'gamma'],
      })),
      // Single sparse item on a separate cluster -> sits in a non-drillable leaf triangle
      { id: 'leaf-item-0', tags: ['omega'] },
    ];

    let hoveredContentCount = 0;
    let hoveredTriangleIdx: number | null = null;
    const hr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items,
      visualResolver: createResolver(32, 20),
      renderer: hr.adapter,
      viewportWidth: 640,
      viewportHeight: 460,
      meshStrategy,
      layoutStrategy: createComposedLayoutStrategy({
        seeder: createMeshInwardFanSeeder(),
        relaxer: createBarycentricPbdRelaxer(),
        scaleController: createCollisionLocalScaleController({
          minLocalScale: 0.3,
          shrinkFactor: 0.85,
          refinementPasses: 6,
        }),
      }),
      zoomStrategy: createBarycentricZoomStrategy({
        subdivision: '1:4',
        clusterZoomMode: 'none',
      }),
      interactions: {
        onContentHover: (ev) => {
          if (ev) hoveredContentCount += 1;
        },
        onTriangleHover: (ev) => {
          hoveredTriangleIdx = ev ? ev.triangle.index : null;
        },
      },
      layoutOptions: { seed: 55 },
    });
    stepToSettle(engine);

    const drillableSet = new Set(engine.getZoomState().drillableTriangleIndices);
    expect(drillableSet.size).toBeGreaterThan(0);

    const rootItems = hr.getLastItems();
    const denseNode = rootItems.find((it) => it.id.startsWith('dense-item-'))!;
    const leafNode = rootItems.find((it) => it.id === 'leaf-item-0')!;
    expect(denseNode).toBeDefined();
    expect(leafNode).toBeDefined();

    // 1) Item inside drillable triangle is marked pass-through and routes hitTest + hover straight to its owning triangle
    expect(denseNode.isPassThrough).toBe(true);
    const denseHit = engine.hitTest(denseNode.x, denseNode.y);
    expect(denseHit.kind).toBe('triangle');
    if (denseHit.kind === 'triangle') {
      expect(drillableSet.has(denseHit.triangle.index)).toBe(true);
    }

    engine.handlePointerMove(denseNode.x, denseNode.y);
    expect(hoveredContentCount).toBe(0);
    expect(hoveredTriangleIdx).not.toBeNull();
    expect(drillableSet.has(hoveredTriangleIdx!)).toBe(true);

    // 2) Item in non-drillable leaf region stays directly interactive (`kind: 'content'`)
    expect(leafNode.isPassThrough).toBeUndefined();
    const leafHit = engine.hitTest(leafNode.x, leafNode.y);
    expect(leafHit.kind).toBe('content');
    if (leafHit.kind === 'content') {
      expect(leafHit.item.id).toBe('leaf-item-0');
    }

    // 3) Drill repeatedly until leaf depth is reached -> dense items become directly clickable content nodes!
    let guard = 0;
    while (engine.getZoomState().drillableTriangleIndices.length > 0 && guard < 6) {
      const nextTri = engine.getZoomState().drillableTriangleIndices[0]!;
      expect(engine.drillDownTriangle(nextTri)).toBe(true);
      stepToSettle(engine);
      guard += 1;
    }
    expect(engine.getZoomState().drillableTriangleIndices.length).toBe(0);

    const leafDepthActiveItems = hr.getLastItems().filter((it) => !it.isContext);
    expect(leafDepthActiveItems.length).toBeGreaterThan(0);
    expect(leafDepthActiveItems.every((it) => it.isPassThrough === undefined)).toBe(
      true,
    );
    const sampleLeafActive = leafDepthActiveItems[0]!;
    const postZoomHit = engine.hitTest(sampleLeafActive.x, sampleLeafActive.y);
    expect(postZoomHit.kind).toBe('content');

    // At leaf depth, active and context triangles all have isDrillable === undefined
    expect(
      hr.getLastTriangles().every((t) => t.isDrillable === undefined),
    ).toBe(true);

    // Return to root: drillable triangles report isDrillable === true, leaf triangles undefined
    expect(engine.drillToRoot()).toBe(true);
    stepToSettle(engine);
    const rootDrillSetAfter = new Set(engine.getZoomState().drillableTriangleIndices);
    for (const tr of hr.getLastTriangles()) {
      expect(tr.isDrillable).toBe(
        rootDrillSetAfter.has(tr.index) ? true : undefined,
      );
    }

    // Swapping to free-camera clears isDrillable immediately on next step
    engine.setZoomStrategy(createFreeCameraZoomStrategy());
    engine.step(16);
    expect(
      hr.getLastTriangles().every((t) => t.isDrillable === undefined),
    ).toBe(true);

    engine.destroy();
  });

  it('createSubspaceZoomStrategy projects out locally constant traits, assigns distinct subclusterLabels, and terminates cleanly', () => {
    interface ZooMockItem {
      readonly id: string;
      readonly name: string;
      readonly milk: boolean;
      readonly backbone: boolean;
      readonly predator: boolean;
      readonly aquatic: boolean;
      readonly catsize: boolean;
      readonly legs: number;
    }

    const zooSubset: readonly ZooMockItem[] = [
      // Dense mammalian group (milk=true, backbone=true constant across all 24!)
      ...Array.from({ length: 24 }, (_, i) => ({
        id: `mammal-${i}`,
        name: `Mammal ${i + 1}`,
        milk: true,
        backbone: true,
        predator: i % 2 === 0,
        aquatic: i % 3 === 0,
        catsize: i >= 10,
        legs: i % 3 === 0 ? 0 : i % 5 === 0 ? 2 : 4,
      })),
      // Non-mammalian species to form additional root clusters
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `bird-${i}`,
        name: `Bird ${i + 1}`,
        milk: false,
        backbone: true,
        predator: i % 2 === 0,
        aquatic: i % 2 === 1,
        catsize: false,
        legs: 2,
      })),
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `invert-${i}`,
        name: `Invertebrate ${i + 1}`,
        milk: false,
        backbone: false,
        predator: true,
        aquatic: i % 2 === 0,
        catsize: false,
        legs: 6,
      })),
    ];

    let lastClusters: readonly NodeRenderState<{ readonly r: number }>[] = [];
    let lastItems: readonly NodeRenderState<{ readonly r: number }>[] = [];
    const adapter: SimplexRendererAdapter<{ readonly r: number }, { readonly r: number }> = {
      measureContentHull: (v) => ({ kind: 'circle', radius: v.r }),
      measureClusterHull: (v) => ({ kind: 'circle', radius: v.r }),
      renderFrame: (frame) => {
        lastItems = frame.items;
        lastClusters = frame.clusters;
      },
      destroy: () => {},
    };

    const gowerSim = (a: ZooMockItem, b: ZooMockItem): number => {
      let s = 0;
      s += a.milk === b.milk ? 1.5 : 0;
      s += a.backbone === b.backbone ? 1.5 : 0;
      s += a.predator === b.predator ? 1 : 0;
      s += a.aquatic === b.aquatic ? 1 : 0;
      s += a.catsize === b.catsize ? 1 : 0;
      s += 1 - Math.abs(a.legs - b.legs) / 8;
      return s / 7;
    };

    const subspaceZoom = createSubspaceZoomStrategy<ZooMockItem>({
      features: [
        { id: 'milk', label: 'Milk', getValue: (z) => z.milk, highLabel: 'Mammalian' },
        { id: 'backbone', label: 'Backbone', getValue: (z) => z.backbone, highLabel: 'Vertebrate' },
        { id: 'predator', label: 'Predator', getValue: (z) => z.predator, highLabel: 'Predators', lowLabel: 'Non-Predator' },
        { id: 'aquatic', label: 'Aquatic', getValue: (z) => z.aquatic, highLabel: 'Aquatic', lowLabel: 'Terrestrial' },
        { id: 'catsize', label: 'Catsize', getValue: (z) => z.catsize, highLabel: 'Large Size', lowLabel: 'Small Size' },
        { id: 'legs', label: 'Legs', getValue: (z) => (z.legs === 0 ? 'Legless' : `${z.legs} Legs`) },
      ],
      getSimilarity: gowerSim,
      clusterZoomMode: 'spotlight',
    });

    const engine = new SimplexGraphEngine({
      items: zooSubset,
      getId: (z) => z.id,
      visualResolver: {
        resolveContentVisual: () => ({ r: 28 }),
        resolveClusterVisual: () => ({ r: 22 }),
        getVisualCacheKey: () => 'sub-test',
      },
      renderer: adapter,
      viewportWidth: 580,
      viewportHeight: 420,
      clusteringStrategy: createSimilarityClusteringStrategy({
        clusterCount: 5,
        getSimilarity: gowerSim,
      }),
      zoomStrategy: subspaceZoom,
    });
    for (let i = 0; i < 45; i++) engine.step(20);

    expect(engine.getZoomState().strategyName).toBe('subspace-recluster');
    const rootDrillTris = engine.getZoomState().drillableTriangleIndices;
    expect(rootDrillTris.length).toBeGreaterThan(0);

    // 1) Drill into a dense triangle -> 6 sub-clusters with distinct, non-constant subclusterLabels
    expect(engine.drillDownTriangle(rootDrillTris[0]!)).toBe(true);
    for (let i = 0; i < 45; i++) engine.step(20);

    expect(engine.getMetrics().overlapCount).toBe(0);
    const subClusters = engine.getClusters();
    expect(subClusters.length).toBeGreaterThanOrEqual(3);
    const labels = subClusters.map((c) => c.subclusterLabel ?? '');
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(subClusters.length);

    // If all active items inside the zoomed triangle are mammals, constant 'Mammalian' must have σ_local = 0 and NOT appear!
    const activeIds = new Set(lastItems.filter((it) => !it.isContext).map((it) => it.id));
    if ([...activeIds].every((id) => id.startsWith('mammal-'))) {
      expect(labels).not.toContain('Mammalian');
      expect(labels).not.toContain('Vertebrate');
    }

    // 2) Return to root and drill into a mammal cluster in 'spotlight' mode -> 3-way subspace spotlight (not 'Sector A/B/C')
    expect(engine.drillToRoot()).toBe(true);
    for (let i = 0; i < 45; i++) engine.step(20);
    const drillClusters = engine.getZoomState().drillableClusterUids;
    expect(drillClusters.length).toBeGreaterThan(0);
    expect(engine.drillDownCluster(drillClusters[0]!)).toBe(true);
    for (let i = 0; i < 45; i++) engine.step(20);

    expect(engine.getZoomState().activeFrameKind).toBe('cluster-spotlight');
    expect(engine.getClusters().length).toBe(3);
    expect(engine.getMetrics().overlapCount).toBe(0);
    const spotLabels = engine.getClusters().map((c) => c.subclusterLabel ?? '');
    expect(spotLabels.every((l) => l.length > 0 && !l.startsWith('Sector '))).toBe(true);
    expect(new Set(spotLabels).size).toBe(3);
    expect(lastClusters.filter((c) => !c.isContext).length).toBe(3);

    engine.destroy();

    // 3) Zero-config introspection on tagged items also terminates cleanly with 0 overlaps
    const zeroCfgHr = createHeadlessRenderer();
    const zeroCfgEngine = new SimplexGraphEngine({
      items: RICH_ITEMS,
      visualResolver: createResolver(28, 22),
      renderer: zeroCfgHr.adapter,
      viewportWidth: 580,
      viewportHeight: 420,
      zoomStrategy: createSubspaceZoomStrategy(),
    });
    stepToSettle(zeroCfgEngine);
    let steps = 0;
    while (zeroCfgEngine.getZoomState().drillableTriangleIndices.length > 0 && steps < 10) {
      const nextTri = zeroCfgEngine.getZoomState().drillableTriangleIndices[0]!;
      expect(zeroCfgEngine.drillDownTriangle(nextTri)).toBe(true);
      stepToSettle(zeroCfgEngine);
      expect(zeroCfgEngine.getMetrics().overlapCount).toBe(0);
      steps += 1;
    }
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThanOrEqual(8);
    expect(zeroCfgEngine.getZoomState().isLeafReached).toBe(true);
    zeroCfgEngine.destroy();
  });

  it('guarantees non-empty 3-tier subclusterLabels, preserves parentContextLabel on outer corners, and emits color-coded breadcrumb segments', () => {
    // 1) Barycentric zoom: midpoints must carry explicit bridge relation labels (never empty), and breadcrumbs carry 3 colored topic segments
    const baryHr = createHeadlessRenderer();
    const baryEngine = new SimplexGraphEngine({
      items: RICH_ITEMS,
      visualResolver: createResolver(28, 22),
      renderer: baryHr.adapter,
      viewportWidth: 580,
      viewportHeight: 420,
      zoomStrategy: createBarycentricZoomStrategy(),
    });
    stepToSettle(baryEngine);
    const bTri = baryEngine.getZoomState().drillableTriangleIndices[0]!;
    expect(baryEngine.drillDownTriangle(bTri)).toBe(true);
    stepToSettle(baryEngine);

    const baryClusters = baryEngine.getClusters();
    for (const midIdx of [3, 4, 5]) {
      const mid = baryClusters[midIdx]!;
      expect(mid.role).toBe('intermediate');
      expect((mid.subclusterLabel ?? '').trim().length).toBeGreaterThan(0);
    }
    const baryCrumb = baryEngine.getZoomState().breadcrumbs.at(-1)!;
    expect(baryCrumb.segments?.length).toBe(3);
    expect(baryCrumb.segments?.every((s) => s.label.length > 0 && Boolean(s.colorHex))).toBe(
      true,
    );
    baryEngine.destroy();

    // 2) Subspace zoom: outer 3 corners preserve parentContextLabel while 3 edge midpoints stay single-line
    const subHr = createHeadlessRenderer();
    const subEngine = new SimplexGraphEngine({
      items: RICH_ITEMS,
      visualResolver: createResolver(28, 22),
      renderer: subHr.adapter,
      viewportWidth: 580,
      viewportHeight: 420,
      zoomStrategy: createSubspaceZoomStrategy(),
    });
    stepToSettle(subEngine);
    const sTri = subEngine.getZoomState().drillableTriangleIndices[0]!;
    expect(subEngine.drillDownTriangle(sTri)).toBe(true);
    stepToSettle(subEngine);

    const subClusters = subEngine.getClusters();
    if (subClusters.length === 6) {
      for (const cornerIdx of [0, 1, 2]) {
        expect((subClusters[cornerIdx]!.parentContextLabel ?? '').length).toBeGreaterThan(0);
        expect((subClusters[cornerIdx]!.subclusterLabel ?? '').length).toBeGreaterThan(0);
      }
      for (const midIdx of [3, 4, 5]) {
        expect(subClusters[midIdx]!.parentContextLabel).toBeUndefined();
        expect((subClusters[midIdx]!.subclusterLabel ?? '').length).toBeGreaterThan(0);
      }
    }
    subEngine.destroy();
  });

  it('promotes vertex-exclusive sub-tags, avoids duplicate 6-vertex labels, and prevents parent/child corner stutter in semantic zoom', () => {
    const tagDisplayTitles: Record<string, string> = {
      javascript: 'JavaScript',
      visualization: 'Visualization',
      'data-visualization': 'Data Vis',
      graph: 'Graphs',
      threejs: 'Three.js',
      typescript: 'TypeScript',
      d3: 'D3.js',
      canvas: 'Canvas',
      svg: 'SVG',
      webgl: 'WebGL',
      wasm: 'WebAssembly',
    };

    // Mirrors the GitHub visualization ecosystem: overlapping 3-tag signatures sharing
    // carrier tags ('javascript', 'visualization') plus exclusive sub-tags ('graph', 'threejs')
    // alongside a sparse 3-tag neighbor region ('webgl', 'wasm', 'javascript').
    const ecosystemItems: DefaultTaggedItem[] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `js-vis-graph-${i}`,
        tags: ['javascript', 'visualization', 'graph'],
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `js-vis-three-${i}`,
        tags: ['javascript', 'visualization', 'threejs'],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `dv-ts-${i}`,
        tags: ['data-visualization', 'typescript', 'd3'],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `dv-canvas-${i}`,
        tags: ['data-visualization', 'javascript', 'canvas', 'svg'],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `js-d3-${i}`,
        tags: ['javascript', 'visualization', 'd3'],
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `wasm-webgl-${i}`,
        tags:
          i % 2 === 0
            ? ['wasm', 'webgl', 'visualization']
            : ['wasm', 'webgl', 'javascript'],
      })),
    ];

    let renderedClusters: readonly NodeRenderState<{ readonly r: number }>[] = [];
    const engine = new SimplexGraphEngine<
      DefaultTaggedItem,
      { readonly r: number },
      { readonly r: number },
      { readonly displayTitle: string },
      { readonly title: string }
    >({
      items: ecosystemItems,
      resolveTagMeta: (tag) => ({
        displayTitle: tagDisplayTitles[tag] ?? `#${tag}`,
      }),
      deriveClusterMeta: (ctx) => {
        if (ctx.role === 'intermediate') {
          return { title: ctx.subclusterLabel ?? ctx.defaultLabel };
        }
        const top = ctx.coreTags[0];
        return {
          title: top ? (top.meta?.displayTitle ?? top.tag) : ctx.defaultLabel,
        };
      },
      visualResolver: {
        resolveContentVisual: () => ({ r: 36 }),
        resolveClusterVisual: () => ({ r: 22 }),
        getVisualCacheKey: () => 'eco-r36:c22',
      },
      renderer: {
        measureContentHull: (v) => ({ kind: 'circle', radius: v.r }),
        measureClusterHull: (v) => ({ kind: 'circle', radius: v.r }),
        renderFrame: (f) => {
          renderedClusters = f.clusters;
        },
        destroy: () => {},
      },
      viewportWidth: 640,
      viewportHeight: 460,
      layoutOptions: { seed: 42 },
      zoomStrategy: createSemanticZoomStrategy(),
    });

    for (let i = 0; i < 45; i++) engine.step(20);
    expect(renderedClusters.length).toBeGreaterThan(0);

    const canonicalizeLabel = (label: string): string => {
      const cleaned = label.trim().replace(/^#+/, '').toLowerCase();
      if (cleaned.includes('↔')) {
        return cleaned
          .split('↔')
          .map((p) => p.trim())
          .sort()
          .join(' ↔ ');
      }
      if (cleaned.includes(' · ')) {
        return cleaned
          .split(' · ')
          .map((p) => p.trim())
          .sort()
          .join(' · ');
      }
      return cleaned;
    };

    const drillable = [...engine.getZoomState().drillableTriangleIndices];
    expect(drillable.length).toBeGreaterThan(0);

    let sawGraphAndThree = false;
    for (const triIdx of drillable) {
      engine.drillToRoot();
      for (let i = 0; i < 45; i++) engine.step(20);

      expect(engine.drillDownTriangle(triIdx)).toBe(true);
      for (let i = 0; i < 45; i++) engine.step(20);

      const zoomedClusters = engine.getClusters();
      if (zoomedClusters.length === 6) {
        const displayLabels = zoomedClusters.map((c) => {
          const raw =
            c.role === 'intermediate'
              ? (c.subclusterLabel ?? c.meta.title)
              : c.meta.title;
          return raw.trim().toLowerCase();
        });
        const canonicalLabels = displayLabels.map(canonicalizeLabel);

        // All 6 sub-vertices in every 1:4 zoomed triangle MUST have pairwise distinct display labels
        // (even up to symmetric order swaps like A ↔ B vs B ↔ A or A · B vs B · A)
        expect(new Set(displayLabels).size).toBe(6);
        expect(new Set(canonicalLabels).size).toBe(6);

        // No outer corner may stutter its own parentContextLabel as its sole subclusterLabel (e.g. JAVASCRIPT / JavaScript)
        for (const cornerIdx of [0, 1, 2]) {
          const corner = zoomedClusters[cornerIdx]!;
          if (corner.parentContextLabel && corner.subclusterLabel) {
            expect(corner.subclusterLabel.trim().toLowerCase()).not.toBe(
              corner.parentContextLabel.trim().toLowerCase(),
            );
          }
        }

        const assignedCoreTagSet = new Set<string>();
        for (const c of zoomedClusters) {
          for (const td of c.coreTags) assignedCoreTagSet.add(td.tag);
        }
        if (assignedCoreTagSet.has('graph') && assignedCoreTagSet.has('threejs')) {
          sawGraphAndThree = true;
          expect(displayLabels.some((l) => l.includes('graphs'))).toBe(true);
          expect(displayLabels.some((l) => l.includes('three.js'))).toBe(true);
        }
      }
    }
    expect(sawGraphAndThree).toBe(true);

    engine.destroy();
  });

  it('keeps incident-star cluster drill-down strictly lattice-conformal (no off-grid spotlight fallback) and dims incident items by barycentric simplex distance', () => {
    const dataset: DefaultTaggedItem[] = [];
    for (let i = 0; i < 8; i++) {
      dataset.push({ id: `pure-a-${i}`, tags: ['vis'] });
    }
    for (let i = 0; i < 6; i++) {
      dataset.push({ id: `bridge-ab-${i}`, tags: ['vis', 'charts'] });
    }
    for (let i = 0; i < 6; i++) {
      dataset.push({ id: `pure-b-${i}`, tags: ['charts'] });
    }
    for (let i = 0; i < 6; i++) {
      dataset.push({ id: `bridge-bc-${i}`, tags: ['charts', 'maps'] });
    }
    for (let i = 0; i < 6; i++) {
      dataset.push({ id: `pure-c-${i}`, tags: ['maps'] });
    }
    for (let i = 0; i < 6; i++) {
      dataset.push({ id: `outer-d-${i}`, tags: ['webgl', 'shaders'] });
    }

    const hr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items: dataset,
      visualResolver: createResolver(36, 22),
      renderer: hr.adapter,
      viewportWidth: 680,
      viewportHeight: 500,
      zoomStrategy: createSemanticZoomStrategy({
        clusterZoomMode: 'incident-star',
      }),
    });
    stepToSettle(engine);

    const visCluster =
      engine.getClusters().find((c) => c.coreTags.some((t) => t.tag === 'vis')) ??
      engine.getClusters()[0]!;
    expect(engine.getZoomState().drillableClusterUids).toContain(visCluster.clusterUid);

    // 1) First click drills into lattice-conformal 'cluster-star'
    expect(engine.drillDownCluster(visCluster.clusterUid)).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().activeFrameKind).toBe('cluster-star');
    expect(engine.getZoomState().depth).toBe(1);

    // 2) Active items inside the incident triangles are dimmed by simplex distance d = 1 - w_0
    const starCenter = engine.getClusters()[0]!;
    expect(starCenter.clusterIndex).toBe(0);
    expect(engine.getZoomState().drillableClusterUids).not.toContain(
      starCenter.clusterUid,
    );
    const activeRenderedById = new Map(
      hr
        .getLastItems()
        .filter((it) => !it.isContext)
        .map((it) => [it.id, it]),
    );
    const centerMemberWeights = new Map(
      starCenter.members.map((m) => [m.itemId, m.normalizedWeight]),
    );

    let sawPureCenter = false;
    let sawHybrid = false;
    let sawOuterRim = false;
    for (const [id, node] of activeRenderedById) {
      const w0 = centerMemberWeights.get(id) ?? 0;
      const expectedOpacity = 0.32 + 0.68 * w0;
      expect(node.opacity).toBeCloseTo(expectedOpacity, 3);
      if (w0 >= 0.999) sawPureCenter = true;
      else if (w0 > 0.01 && w0 < 0.99) sawHybrid = true;
      else if (w0 === 0) sawOuterRim = true;
    }
    expect(sawPureCenter).toBe(true);
    expect(sawHybrid).toBe(true);
    expect(sawOuterRim).toBe(true);

    // 3) Clicking a rim cluster inside cluster-star switches laterally at depth === 1 (never growing an infinite stack)
    const rimCluster = engine.getClusters()[1]!;
    expect(engine.getZoomState().drillableClusterUids).toContain(
      rimCluster.clusterUid,
    );
    expect(engine.drillDownCluster(rimCluster.clusterUid)).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().activeFrameKind).toBe('cluster-star');
    expect(engine.getZoomState().depth).toBe(1);
    expect(engine.getClusters()[0]!.code).toBe(rimCluster.code);

    // 4) Clicking the already-focused center cluster toggles back up (`drillUp`) without spawning 'cluster-spotlight'
    const switchedCenter = engine.getClusters()[0]!;
    expect(engine.drillDownCluster(switchedCenter.clusterUid)).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().depth).toBe(0);
    expect(engine.getZoomState().activeFrameKind).toBe('root');
    for (const node of hr.getLastItems().filter((it) => !it.isContext)) {
      expect(node.opacity).toBeCloseTo(1, 3);
    }

    // 5) Inside a zoomed 1:4 triangle (even at 1.0x leaf scale or on sparse/0-item corners), ALL 6 subclusters are uniformly clickable
    const drillTris = engine.getZoomState().drillableTriangleIndices;
    expect(drillTris.length).toBeGreaterThan(0);
    expect(engine.drillDownTriangle(drillTris[0]!)).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().activeFrameKind).toBe('triangle');
    expect(engine.getZoomState().depth).toBe(1);
    expect(engine.getClusters().length).toBe(6);
    expect(engine.getZoomState().drillableClusterUids.length).toBe(6);

    for (let subIdx = 0; subIdx < 6; subIdx++) {
      const subCluster = engine.getClusters()[subIdx]!;
      expect(engine.drillDownCluster(subCluster.clusterUid)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().activeFrameKind).toBe('cluster-star');
      expect(engine.getZoomState().depth).toBe(2);
      // Toggle back up to the 1:4 triangle by clicking the focused subcluster center
      const subStarCenter = engine.getClusters()[0]!;
      expect(engine.drillDownCluster(subStarCenter.clusterUid)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().activeFrameKind).toBe('triangle');
      expect(engine.getZoomState().depth).toBe(1);
    }

    engine.destroy();
  });

  it('focuses non-subdividable leaf triangles as single un-subdivided triangles while keeping content nodes directly clickable', () => {
    const items: DefaultTaggedItem[] = [
      // Dense 3-cluster interior + edge items in one triangle -> downscaled & 1:4 drillable
      ...Array.from({ length: 18 }, (_, i) => ({
        id: `dense-ab-${i}`,
        tags: i % 2 === 0 ? ['alpha', 'beta', 'gamma'] : ['alpha', 'beta'],
      })),
      // Isolated full-scale items in a disjoint leaf triangle [omega, psi, chi]
      { id: 'leaf-item-omega', tags: ['omega', 'psi', 'chi'] },
      { id: 'leaf-item-psi', tags: ['psi'] },
      { id: 'leaf-item-chi', tags: ['chi'] },
    ];

    const localScaleLayout = createComposedLayoutStrategy({
      seeder: createMeshInwardFanSeeder(),
      relaxer: createBarycentricPbdRelaxer(),
      scaleController: createCollisionLocalScaleController({
        minLocalScale: 0.3,
        shrinkFactor: 0.85,
        refinementPasses: 6,
      }),
    });

    const hr = createHeadlessRenderer();
    const engine = new SimplexGraphEngine({
      items,
      visualResolver: createResolver(32, 20),
      renderer: hr.adapter,
      viewportWidth: 640,
      viewportHeight: 460,
      meshStrategy: createFixedLatticeMeshStrategy({
        cols: 3,
        rows: 3,
      }),
      layoutStrategy: localScaleLayout,
      zoomStrategy: createBarycentricZoomStrategy(),
      layoutOptions: { seed: 55 },
    });
    stepToSettle(engine);

    const rootState = engine.getZoomState();
    const totalRootTris = engine.getMesh()!.triangles.length;
    expect(totalRootTris).toBeGreaterThan(2);
    expect(rootState.drillableTriangleIndices.length).toBeGreaterThanOrEqual(1);
    expect(rootState.focusableTriangleIndices.length).toBeGreaterThanOrEqual(1);
    expect(
      rootState.drillableTriangleIndices.length +
        rootState.focusableTriangleIndices.length,
    ).toBe(totalRootTris);

    // Content nodes inside leaf/focusable triangles must NOT be pass-through so users can click them directly!
    const rootItems = hr.getLastItems().filter((it) => !it.isContext);
    const leafSparseNode = rootItems.find((it) => it.id === 'leaf-item-omega');
    expect(leafSparseNode).toBeDefined();
    expect(leafSparseNode!.isPassThrough).toBeUndefined();
    const hitLeafItem = engine.hitTest(leafSparseNode!.x, leafSparseNode!.y);
    expect(hitLeafItem.kind).toBe('content');

    // Clicking a leaf triangle focuses that single un-subdivided triangle (3 clusters, 1 active face, dimmed neighbors)
    const leafTriIdx = rootState.focusableTriangleIndices[0]!;
    expect(engine.drillDownTriangle(leafTriIdx)).toBe(true);
    stepToSettle(engine);

    const focusedState = engine.getZoomState();
    expect(focusedState.depth).toBe(1);
    expect(focusedState.activeFrameKind).toBe('triangle-focus');
    expect(focusedState.drillableTriangleIndices).toEqual([]);
    expect(focusedState.focusableTriangleIndices).toEqual([]);
    expect(engine.getClusters().length).toBe(3);
    expect(focusedState.drillableClusterUids.length).toBe(3);

    const activeFocusTris = hr.getLastTriangles().filter((t) => !t.isContext);
    const ctxFocusTris = hr.getLastTriangles().filter((t) => t.isContext);
    expect(activeFocusTris.length).toBe(1);
    expect(ctxFocusTris.length).toBeGreaterThan(0);
    expect(engine.getMetrics().overlapCount).toBe(0);

    // Clicking a dimmed neighbor triangle from inside `triangle-focus` switches laterally at depth === 1!
    const neighborCtxTri = ctxFocusTris.find((t) => Boolean(t.neighborId));
    expect(neighborCtxTri?.neighborId).toBeDefined();
    expect(engine.drillToNeighbor(neighborCtxTri!.neighborId!)).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().depth).toBe(1);
    expect(engine.drillToRoot()).toBe(true);
    stepToSettle(engine);
    expect(engine.drillDownTriangle(leafTriIdx)).toBe(true);
    stepToSettle(engine);

    // All content nodes inside the focused leaf triangle remain directly clickable
    for (const activeItem of hr.getLastItems().filter((it) => !it.isContext)) {
      expect(activeItem.isPassThrough).toBeUndefined();
    }

    // Clicking the free face of the already-focused single triangle toggles back out (`drillUp`)
    expect(engine.drillDownTriangle(0)).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().depth).toBe(0);
    expect(engine.getZoomState().activeFrameKind).toBe('root');

    // Focus the leaf triangle again, then click one of its 3 corner clusters -> switches laterally at depth 1 to `cluster-star`!
    expect(engine.drillDownTriangle(leafTriIdx)).toBe(true);
    stepToSettle(engine);
    const cornerCluster = engine.getClusters()[0]!;
    expect(engine.drillDownCluster(cornerCluster.clusterUid)).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().depth).toBe(1);
    expect(engine.getZoomState().activeFrameKind).toBe('cluster-star');
    expect(engine.getClusters()[0]!.code).toBe(cornerCluster.code);

    // Return to root, drill 1:4 into a dense triangle, and verify any leaf sub-triangle inside the 1:4 frame is also focusable!
    expect(engine.drillToRoot()).toBe(true);
    stepToSettle(engine);
    const denseTriIdx = engine.getZoomState().drillableTriangleIndices[0]!;
    expect(engine.drillDownTriangle(denseTriIdx)).toBe(true);
    stepToSettle(engine);
    expect(engine.getZoomState().activeFrameKind).toBe('triangle');
    const subFocusable = engine.getZoomState().focusableTriangleIndices;
    if (subFocusable.length > 0) {
      expect(engine.drillDownTriangle(subFocusable[0]!)).toBe(true);
      stepToSettle(engine);
      expect(engine.getZoomState().depth).toBe(2);
      expect(engine.getZoomState().activeFrameKind).toBe('triangle-focus');
      expect(engine.getClusters().length).toBe(3);
      // Clicking its 3 corners (even intermediate midpoint subclusters!) highlights all 3 corners cleanly
      expect(
        hr
          .getLastClusters()
          .filter((c) => !c.isContext)
          .every((c) => c.interaction.isHighlighted),
      ).toBe(true);
    }

    engine.destroy();
  });
});

