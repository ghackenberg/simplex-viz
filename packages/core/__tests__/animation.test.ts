import { describe, expect, it } from 'vitest';
import { SimplexGraphEngine } from '../src/engine';
import type {
  DefaultTaggedItem,
  SceneFrameSnapshot,
  SimplexRendererAdapter,
  VisualResolver,
} from '../src/types';

function makeHeadlessAdapter(): {
  adapter: SimplexRendererAdapter<string, string>;
  getLastSnapshot: () => SceneFrameSnapshot<string, string> | null;
} {
  let last: SceneFrameSnapshot<string, string> | null = null;
  return {
    adapter: {
      measureContentHull: () => ({ kind: 'circle', radius: 10 }),
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
