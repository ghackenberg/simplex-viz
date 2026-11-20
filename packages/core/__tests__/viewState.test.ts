import { describe, expect, it, vi } from 'vitest';
import { SimplexGraphEngine } from '../src/engine';
import { createBarycentricZoomStrategy } from '../src/zoom';
import type {
  DefaultTaggedItem,
  SceneFrameSnapshot,
  SimplexRendererAdapter,
  SimplexViewState,
  VisualResolver,
} from '../src/types';

function makeHeadlessAdapter(contentRadius = 12): {
  adapter: SimplexRendererAdapter<string, string>;
  getLastSnapshot: () => SceneFrameSnapshot<string, string> | null;
} {
  let last: SceneFrameSnapshot<string, string> | null = null;
  return {
    adapter: {
      measureContentHull: () => ({ kind: 'circle', radius: contentRadius }),
      measureClusterHull: () => ({ kind: 'circle', radius: 22 }),
      renderFrame: (snapshot) => {
        last = snapshot;
      },
      destroy: () => {},
    },
    getLastSnapshot: () => last,
  };
}

const RESOLVER: VisualResolver<DefaultTaggedItem, string, string> = {
  resolveContentVisual: (item, ctx) => `${item.id}:${ctx.mixedColorHex}`,
  resolveClusterVisual: (cluster) => `${cluster.code}:${cluster.members.length}`,
  getVisualCacheKey: (v) => v,
};

const FREE_CAM_ITEMS: readonly DefaultTaggedItem[] = [
  { id: 'item-1', tags: ['alpha', 'beta'] },
  { id: 'item-2', tags: ['alpha', 'gamma'] },
  { id: 'item-3', tags: ['beta', 'gamma'] },
  { id: 'item-4', tags: ['beta', 'delta'] },
  { id: 'item-5', tags: ['gamma', 'delta'] },
  { id: 'item-6', tags: ['alpha', 'delta'] },
];

const DENSE_DRILL_ITEMS: readonly DefaultTaggedItem[] = Array.from({ length: 42 }, (_, i) => ({
  id: `dense-${i}`,
  tags: [
    i % 3 === 0 ? 'alpha' : i % 3 === 1 ? 'beta' : 'gamma',
    i % 2 === 0 ? 'beta' : 'gamma',
    `sub-${i % 4}`,
  ],
}));

describe('Serializable View State (Issue #24)', () => {
  it('round-trips free-camera, focus, highlights, selection, and pins via JSON into a fresh engine', () => {
    const { adapter: adapterA } = makeHeadlessAdapter();
    const engineA = new SimplexGraphEngine({
      items: FREE_CAM_ITEMS,
      visualResolver: RESOLVER,
      renderer: adapterA,
      viewportWidth: 800,
      viewportHeight: 600,
      layoutOptions: { seed: 42 },
    });
    engineA.renderNow();

    const firstClusterUid = engineA.getClusters()[0]!.clusterUid;
    engineA.camera.setState({ zoom: 2.25, panX: -120.5, panY: 84.25 });
    engineA.setHighlightedIds(['item-4', 'item-1']);
    engineA.setSelectedIds(['item-5', 'item-2']);
    engineA.setPinnedIds(['item-6', firstClusterUid]);
    engineA.setFocusedClusterUid(firstClusterUid);
    engineA.setFocusedTriangleIndex(0);
    engineA.focusItem('item-3', { hover: false });

    const serialized = JSON.stringify(engineA.getViewState());
    const parsed = JSON.parse(serialized) as SimplexViewState;

    // Deterministic sorted ID arrays & exact JSON schema
    expect(parsed.version).toBe(1);
    expect(parsed.camera).toEqual({ zoom: 2.25, panX: -120.5, panY: 84.25 });
    expect(parsed.zoomPath).toEqual([]);
    expect(parsed.highlightedIds).toEqual(['item-1', 'item-4']);
    expect(parsed.selectedIds).toEqual(['item-2', 'item-5']);
    expect(parsed.pinnedIds).toEqual([firstClusterUid, 'item-6'].sort());
    expect(parsed.focusedClusterUid).toBe(firstClusterUid);
    expect(parsed.focusedTriangleIndex).toBe(0);
    expect(parsed.focusedItemId).toBe('item-3');

    // Hydrate into a brand-new engine instance
    const { adapter: adapterB, getLastSnapshot } = makeHeadlessAdapter();
    const onSelectionChange = vi.fn();
    const engineB = new SimplexGraphEngine({
      items: FREE_CAM_ITEMS,
      visualResolver: RESOLVER,
      renderer: adapterB,
      viewportWidth: 800,
      viewportHeight: 600,
      layoutOptions: { seed: 42 },
      onSelectionChange,
    });

    expect(engineB.restoreViewState(parsed)).toBe(true);
    expect(engineB.getViewState()).toEqual(parsed);
    expect(engineB.getMetrics().isSettled).toBe(true);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect([...onSelectionChange.mock.calls[0]![0]!].sort()).toEqual(['item-2', 'item-5']);

    const snapB = getLastSnapshot()!;
    expect(snapB.camera).toEqual({ zoom: 2.25, panX: -120.5, panY: 84.25 });
    expect(snapB.items.find((n) => n.id === 'item-2')?.interaction.isSelected).toBe(true);
    expect(snapB.items.find((n) => n.id === 'item-1')?.interaction.isHighlighted).toBe(true);
    expect(snapB.items.find((n) => n.id === 'item-6')?.interaction.isPinned).toBe(true);

    engineA.destroy();
    engineB.destroy();
  });

  it('captures and replays triangle 1:4 drill-down and cluster-star zoomPath across fresh engines', () => {
    const makeDrillEngine = (clusterZoomMode: 'none' | 'star') => {
      const { adapter } = makeHeadlessAdapter(26);
      const engine = new SimplexGraphEngine({
        items: DENSE_DRILL_ITEMS,
        visualResolver: RESOLVER,
        renderer: adapter,
        viewportWidth: 720,
        viewportHeight: 500,
        layoutOptions: { seed: 17 },
        zoomStrategy: createBarycentricZoomStrategy({
          subdivision: '1:4',
          clusterZoomMode,
          stopWhenFullScale: false,
        }),
      });
      engine.renderNow();
      return engine;
    };

    // 1) Multi-step 1:4 triangle drill-down + selection
    const triA = makeDrillEngine('none');
    const triIdx1 = triA.getZoomState().drillableTriangleIndices[0]!;
    expect(triIdx1).toBeDefined();
    expect(triA.drillDownTriangle(triIdx1)).toBe(true);
    for (let i = 0; i < 40; i++) triA.step(20);

    const triIdx2 = triA.getZoomState().drillableTriangleIndices[0];
    if (triIdx2 !== undefined) {
      expect(triA.drillDownTriangle(triIdx2)).toBe(true);
      for (let i = 0; i < 40; i++) triA.step(20);
    }

    triA.setSelectedIds(['dense-0', 'dense-1']);
    const savedTri = JSON.parse(JSON.stringify(triA.getViewState())) as SimplexViewState;
    expect(savedTri.zoomPath.length).toBe(triA.getZoomState().depth);
    expect(savedTri.zoomPath[0]).toEqual({ kind: 'triangle', index: triIdx1 });

    // Restore into a fresh engine with animate: false (default) -> immediate settled state
    const triB = makeDrillEngine('none');
    expect(triB.restoreViewState(savedTri)).toBe(true);
    expect(triB.getZoomState().depth).toBe(triA.getZoomState().depth);
    expect(triB.getZoomState().activeFrameKind).toBe(triA.getZoomState().activeFrameKind);
    expect(triB.getViewState()).toEqual(savedTri);
    expect(triB.getMetrics().isSettled).toBe(true);

    // Drilling back to root clears zoomPath
    expect(triB.drillToRoot()).toBe(true);
    expect(triB.getViewState().zoomPath).toEqual([]);

    // Restore with animate: true starts a zoom flight when reducedMotion is false
    const triAnimated = makeDrillEngine('none');
    expect(triAnimated.restoreViewState(savedTri, { animate: true })).toBe(true);
    expect(triAnimated.getZoomState().depth).toBe(triA.getZoomState().depth);
    expect(triAnimated.getMetrics().isSettled).toBe(false);
    // Settling after frames matches exact target state
    for (let i = 0; i < 60; i++) triAnimated.step(20);
    expect(triAnimated.getMetrics().isSettled).toBe(true);

    // 2) Cluster-star drill-down round-trip
    const starA = makeDrillEngine('star');
    const starClusterUid = starA.getZoomState().drillableClusterUids[0]!;
    expect(starClusterUid).toBeDefined();
    expect(starA.drillDownCluster(starClusterUid)).toBe(true);
    for (let i = 0; i < 40; i++) starA.step(20);

    const savedStar = JSON.parse(JSON.stringify(starA.getViewState())) as SimplexViewState;
    expect(savedStar.zoomPath.length).toBe(1);
    expect(savedStar.zoomPath[0]!.kind).toBe('cluster');

    const starB = makeDrillEngine('star');
    expect(starB.restoreViewState(savedStar)).toBe(true);
    expect(starB.getZoomState().depth).toBe(1);
    expect(starB.getZoomState().activeFrameKind).toBe('cluster-spotlight');
    expect(starB.getZoomState().activeFrameKind).toBe(starA.getZoomState().activeFrameKind);
    expect(starB.getViewState().zoomPath).toEqual(savedStar.zoomPath);

    triA.destroy();
    triB.destroy();
    triAnimated.destroy();
    starA.destroy();
    starB.destroy();
  });

  it('degrades gracefully on stale IDs, unreachable zoomPath steps, and malformed inputs without throwing', () => {
    const { adapter } = makeHeadlessAdapter();
    const engine = new SimplexGraphEngine({
      items: FREE_CAM_ITEMS,
      visualResolver: RESOLVER,
      renderer: adapter,
      viewportWidth: 800,
      viewportHeight: 600,
      layoutOptions: { seed: 7 },
    });
    engine.renderNow();

    // Invalid / unsupported inputs return false cleanly
    expect(engine.restoreViewState(null)).toBe(false);
    expect(engine.restoreViewState(undefined)).toBe(false);
    expect(
      engine.restoreViewState({ version: 99 } as unknown as Partial<SimplexViewState>),
    ).toBe(false);

    // Mix of valid and stale IDs, out-of-bounds focus/zoom steps -> applies valid subset cleanly
    const ok = engine.restoreViewState({
      version: 1,
      camera: { zoom: 1.5, panX: 30, panY: -20 },
      zoomPath: [
        { kind: 'triangle', index: 999 },
        { kind: 'cluster', clusterIndex: 77, clusterUid: 'missing-cluster', label: 'Ghost' },
      ],
      focusedClusterUid: 'nonexistent-cluster',
      focusedTriangleIndex: 999,
      focusedItemId: 'deleted-item',
      highlightedIds: ['item-1', 'deleted-item'],
      selectedIds: ['item-2', 'deleted-item'],
      pinnedIds: ['item-3', 'deleted-item'],
    });
    expect(ok).toBe(true);

    const after = engine.getViewState();
    expect(after.camera).toEqual({ zoom: 1.5, panX: 30, panY: -20 });
    expect(after.zoomPath).toEqual([]);
    expect(after.focusedClusterUid).toBeNull();
    expect(after.focusedTriangleIndex).toBeNull();
    expect(after.focusedItemId).toBeNull();
    expect(after.highlightedIds).toEqual(['item-1']);
    expect(after.selectedIds).toEqual(['item-2']);
    expect(after.pinnedIds).toEqual(['item-3']);

    // Destroyed engine returns false safely
    engine.destroy();
    expect(engine.restoreViewState(after)).toBe(false);
  });
});
