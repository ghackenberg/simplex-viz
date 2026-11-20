import { describe, expect, it } from 'vitest';
import { SimplexGraphEngine } from '../src/engine';
import { createBarycentricZoomStrategy } from '../src/index';
import type {
  DefaultTaggedItem,
  SceneFrameSnapshot,
  SimplexRendererAdapter,
  VisualResolver,
} from '../src/types';

function makeHeadlessAdapter(contentRadius = 10): {
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

const SIMPLE_RESOLVER: VisualResolver<DefaultTaggedItem, string, string> = {
  resolveContentVisual: (item, ctx) => `${item.id}:${ctx.mixedColorHex}`,
  resolveClusterVisual: (cluster) => `${cluster.code}:${cluster.members.length}`,
  getVisualCacheKey: (v) => v,
};

describe('Interruptible Animation & Re-entering Exit Reversal', () => {
  it('maintains finite C1-continuous state when interrupted mid-transition by addItems/removeItems', () => {
    const { adapter, getLastSnapshot } = makeHeadlessAdapter();
    const initial: DefaultTaggedItem[] = Array.from({ length: 18 }, (_, i) => ({
      id: `doc-${i}`,
      tags: [`tag-${i % 5}`, `tag-${(i + 1) % 5}`],
    }));

    const engine = new SimplexGraphEngine({
      items: initial,
      visualResolver: SIMPLE_RESOLVER,
      renderer: adapter,
      viewportWidth: 900,
      viewportHeight: 600,
      layoutOptions: { seed: 77 },
    });

    // Remove doc-0 and advance partway through fade-out
    engine.removeItems('doc-0');
    for (let f = 0; f < 5; f++) {
      engine.step(16);
    }

    const midExitSnap = getLastSnapshot()!;
    const exitingNode = midExitSnap.items.find((n) => n.id === 'doc-0');
    expect(exitingNode).toBeDefined();
    expect(exitingNode!.opacity).toBeGreaterThan(0.05);
    expect(exitingNode!.opacity).toBeLessThan(0.98);
    const opacityBeforeReAdd = exitingNode!.opacity;

    // Re-add doc-0 mid-fade-out and also add new items simultaneously
    engine.addItems([
      { id: 'doc-0', tags: ['tag-0', 'tag-1'] },
      { id: 'doc-18', tags: ['tag-2', 'tag-4'] },
      { id: 'doc-19', tags: ['tag-1', 'tag-3'] },
    ]);

    engine.step(16);
    const afterReAdd = getLastSnapshot()!;
    const recoveredNode = afterReAdd.items.find((n) => n.id === 'doc-0')!;
    expect(recoveredNode).toBeDefined();
    // Must not jump immediately to 1.0 or NaN
    expect(Number.isFinite(recoveredNode.x)).toBe(true);
    expect(Number.isFinite(recoveredNode.y)).toBe(true);
    expect(Math.abs(recoveredNode.opacity - opacityBeforeReAdd)).toBeLessThan(0.25);

    // Step to full settlement
    for (let f = 0; f < 160; f++) {
      engine.step(16);
    }
    const settledSnap = getLastSnapshot()!;
    const finalDoc0 = settledSnap.items.find((n) => n.id === 'doc-0')!;
    expect(finalDoc0.opacity).toBeGreaterThan(0.99);
    expect(engine.getMetrics().overlapCount).toBe(0);
    engine.destroy();
  });
});

describe('Reduced Motion (Issue #23)', () => {
  it('snaps item mutations, visual transitions, and 1:4 drill-down immediately when reducedMotion is true', () => {
    const { adapter, getLastSnapshot } = makeHeadlessAdapter(28);
    const initial: DefaultTaggedItem[] = Array.from({ length: 36 }, (_, i) => ({
      id: `doc-${i}`,
      tags: [`tag-${i % 6}`, `tag-${(i + 1) % 6}`, `detail-${i % 7}`],
    }));

    const engine = new SimplexGraphEngine({
      items: initial,
      visualResolver: SIMPLE_RESOLVER,
      renderer: adapter,
      viewportWidth: 640,
      viewportHeight: 460,
      reducedMotion: true,
      zoomStrategy: createBarycentricZoomStrategy(),
      layoutOptions: { seed: 42 },
    });

    expect(engine.getReducedMotion()).toBe(true);
    expect(engine.isReducedMotion()).toBe(true);
    expect(engine.getMetrics().isSettled).toBe(true);

    // 1) Mutations snap immediately — removed item is gone, new item is at opacity 1, no transitions
    engine.removeItems('doc-0');
    engine.addItems([{ id: 'doc-99', tags: ['tag-0', 'tag-1', 'detail-0'] }]);
    const afterMutate = getLastSnapshot()!;
    expect(afterMutate.items.find((n) => n.id === 'doc-0')).toBeUndefined();
    const added = afterMutate.items.find((n) => n.id === 'doc-99');
    expect(added).toBeDefined();
    expect(added!.opacity).toBe(1);
    expect(added!.scale).toBeGreaterThan(0);
    const snappedScale = added!.scale;
    expect(added!.transition).toBeNull();
    expect(engine.getMetrics().isSettled).toBe(true);
    // Stepping does not move or rescale already-snapped nodes
    expect(engine.step(16)).toBe(true);
    expect(getLastSnapshot()!.items.find((n) => n.id === 'doc-99')!.scale).toBe(snappedScale);

    // 2) 1:4 drill-down snaps immediately without flight frames
    const drillableIdx = engine.getZoomState().drillableTriangleIndices[0];
    expect(drillableIdx).toBeDefined();
    expect(engine.drillDownTriangle(drillableIdx!)).toBe(true);
    expect(engine.getZoomState().depth).toBe(1);
    expect(engine.getMetrics().isSettled).toBe(true);
    expect(engine.step(16)).toBe(true);

    // 3) Drill up snaps immediately as well
    expect(engine.drillUp()).toBe(true);
    expect(engine.getZoomState().depth).toBe(0);
    expect(engine.getMetrics().isSettled).toBe(true);

    engine.destroy();
  });

  it('snaps an in-flight spring and zoom transition immediately when setReducedMotion(true) is called mid-flight', () => {
    const { adapter, getLastSnapshot } = makeHeadlessAdapter(28);
    const initial: DefaultTaggedItem[] = Array.from({ length: 42 }, (_, i) => ({
      id: `item-${i}`,
      tags: [`t-${i % 6}`, `t-${(i + 1) % 6}`, `sub-${i % 7}`],
    }));

    const engine = new SimplexGraphEngine({
      items: initial,
      visualResolver: SIMPLE_RESOLVER,
      renderer: adapter,
      viewportWidth: 640,
      viewportHeight: 460,
      zoomStrategy: createBarycentricZoomStrategy(),
      layoutOptions: { seed: 42 },
    });

    // Headless default `'auto'` resolves to false
    expect(engine.getReducedMotion()).toBe('auto');
    expect(engine.isReducedMotion()).toBe(false);

    // Trigger an animated removal and step partway
    engine.removeItems('item-0');
    engine.step(16);
    expect(getLastSnapshot()!.items.find((n) => n.id === 'item-0')).toBeDefined();
    expect(engine.getMetrics().isSettled).toBe(false);

    // Enabling reduced motion mid-flight must snap immediately to settled target state
    engine.setReducedMotion(true);
    expect(engine.isReducedMotion()).toBe(true);
    expect(engine.getMetrics().isSettled).toBe(true);
    expect(getLastSnapshot()!.items.find((n) => n.id === 'item-0')).toBeUndefined();

    // Turning reducedMotion back to false re-enables animated flights, and toggling true mid-drill snaps immediately
    engine.setReducedMotion(false);
    expect(engine.isReducedMotion()).toBe(false);
    const drillIdx = engine.getZoomState().drillableTriangleIndices[0];
    expect(drillIdx).toBeDefined();
    expect(engine.drillDownTriangle(drillIdx!)).toBe(true);
    engine.step(16);
    expect(engine.getMetrics().isSettled).toBe(false);

    engine.setReducedMotion(true);
    expect(engine.getMetrics().isSettled).toBe(true);
    expect(engine.getZoomState().depth).toBe(1);

    engine.destroy();
  });
});

