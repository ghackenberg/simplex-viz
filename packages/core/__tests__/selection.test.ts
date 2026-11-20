import { describe, expect, it, vi } from 'vitest';
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
      measureContentHull: () => ({ kind: 'circle', radius: 12 }),
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

const SAMPLE_ITEMS: readonly DefaultTaggedItem[] = [
  { id: 'a1', tags: ['alpha', 'beta'] },
  { id: 'a2', tags: ['alpha', 'gamma'] },
  { id: 'b1', tags: ['beta', 'gamma'] },
  { id: 'b2', tags: ['beta', 'delta'] },
  { id: 'c1', tags: ['gamma', 'delta'] },
  { id: 'c2', tags: ['alpha', 'delta'] },
];

describe('Interactive Multi-Selection (Issue #25)', () => {
  it('tracks selectedIds independently of highlightedIds/pinnedIds and emits onSelectionChange only on real diffs', () => {
    const { adapter, getLastSnapshot } = makeHeadlessAdapter();
    const onSelectionChange = vi.fn();

    const engine = new SimplexGraphEngine({
      items: SAMPLE_ITEMS,
      visualResolver: RESOLVER,
      renderer: adapter,
      viewportWidth: 800,
      viewportHeight: 600,
      selectedIds: ['a1'],
      onSelectionChange,
      layoutOptions: { seed: 11 },
    });
    engine.renderNow();

    expect([...engine.getSelectedIds()]).toEqual(['a1']);
    expect(onSelectionChange).not.toHaveBeenCalled();

    // Setting the exact same selection is a no-op (prevents React controlled loops)
    engine.setSelectedIds(['a1']);
    expect(onSelectionChange).not.toHaveBeenCalled();

    // Toggle adds a2
    expect(engine.toggleSelectedId('a2')).toBe(true);
    expect([...engine.getSelectedIds()].sort()).toEqual(['a1', 'a2']);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);

    // Highlighting a disjoint item does not clear selection or dim selected items
    engine.setHighlightedIds(['b1']);
    engine.setPinnedIds(['c1']);
    engine.renderNow();

    const snap = getLastSnapshot()!;
    const nodeA1 = snap.items.find((n) => n.id === 'a1')!;
    const nodeB1 = snap.items.find((n) => n.id === 'b1')!;
    const nodeB2 = snap.items.find((n) => n.id === 'b2')!;
    expect(nodeA1.interaction.isSelected).toBe(true);
    expect(nodeA1.interaction.isHighlighted).toBe(false);
    expect(nodeA1.interaction.isDimmed).toBe(false);
    expect(nodeB1.interaction.isHighlighted).toBe(true);
    expect(nodeB1.interaction.isSelected).toBe(false);
    expect(nodeB2.interaction.isDimmed).toBe(true);

    // Clearing highlights preserves selection
    engine.setHighlightedIds(null);
    expect([...engine.getSelectedIds()].sort()).toEqual(['a1', 'a2']);

    // Removing a selected item prunes it and notifies listener
    engine.removeItems('a1');
    expect([...engine.getSelectedIds()]).toEqual(['a2']);
    expect(onSelectionChange).toHaveBeenCalledTimes(2);

    // clearSelection empties set and notifies once
    engine.clearSelection();
    expect(engine.getSelectedIds().size).toBe(0);
    expect(onSelectionChange).toHaveBeenCalledTimes(3);
    engine.clearSelection();
    expect(onSelectionChange).toHaveBeenCalledTimes(3);

    engine.destroy();
  });

  it('toggles selection on Shift+Click unless consumed by user click handlers', () => {
    const { adapter, getLastSnapshot } = makeHeadlessAdapter();
    let consumeClicks = false;
    const onSelectionChange = vi.fn();

    const engine = new SimplexGraphEngine({
      items: SAMPLE_ITEMS,
      visualResolver: RESOLVER,
      renderer: adapter,
      viewportWidth: 800,
      viewportHeight: 600,
      onSelectionChange,
      interactions: {
        onContentClick: () => consumeClicks,
      },
      layoutOptions: { seed: 23 },
    });
    engine.renderNow();

    const snap = getLastSnapshot()!;
    const targetA = snap.items.find((n) => n.id === 'a1')!;
    const targetB = snap.items.find((n) => n.id === 'b1')!;

    // Plain click without Shift does not select
    engine.handleLeftClick({
      screenX: targetA.x,
      screenY: targetA.y,
      button: 0,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
    expect(engine.getSelectedIds().size).toBe(0);

    // Shift+Click selects targetA, then targetB
    engine.handleLeftClick({
      screenX: targetA.x,
      screenY: targetA.y,
      button: 0,
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
    engine.handleLeftClick({
      screenX: targetB.x,
      screenY: targetB.y,
      button: 0,
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
    expect([...engine.getSelectedIds()].sort()).toEqual(['a1', 'b1']);

    // Shift+Click again deselects targetA
    engine.handleLeftClick({
      screenX: targetA.x,
      screenY: targetA.y,
      button: 0,
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
    expect([...engine.getSelectedIds()]).toEqual(['b1']);

    // Consumed onContentClick suppresses built-in Shift+Click selection
    consumeClicks = true;
    engine.handleLeftClick({
      screenX: targetA.x,
      screenY: targetA.y,
      button: 0,
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    });
    expect([...engine.getSelectedIds()]).toEqual(['b1']);

    engine.destroy();
  });

  it('selects items via world and screen marquee rects across add/replace/toggle modes and camera transforms', () => {
    const { adapter, getLastSnapshot } = makeHeadlessAdapter();
    const engine = new SimplexGraphEngine({
      items: SAMPLE_ITEMS,
      visualResolver: RESOLVER,
      renderer: adapter,
      viewportWidth: 800,
      viewportHeight: 600,
      layoutOptions: { seed: 31 },
    });
    engine.renderNow();

    const snap = getLastSnapshot()!;
    const a1 = snap.items.find((n) => n.id === 'a1')!;
    const c1 = snap.items.find((n) => n.id === 'c1')!;

    // Hide a2 via filter so marquee excludes hidden items
    engine.setItemFilter((it) => it.id !== 'a2', { mode: 'hide' });

    // Select a1 with a tight world rect
    const first = engine.selectItemsInWorldRect(
      a1.x - 4,
      a1.y - 4,
      a1.x + 4,
      a1.y + 4,
    );
    expect(first.has('a1')).toBe(true);

    // Pan & zoom camera, then select c1 via screen-space rect in 'add' mode
    engine.camera.panBy(60, -40);
    engine.camera.zoomToCursor(400, 300, 1.5);
    const screenC1 = engine.camera.worldToScreen(c1.x, c1.y);
    const added = engine.selectItemsInScreenRect(
      screenC1.x - 5,
      screenC1.y - 5,
      screenC1.x + 5,
      screenC1.y + 5,
      { mode: 'add' },
    );
    expect(added.has('a1')).toBe(true);
    expect(added.has('c1')).toBe(true);

    // Full canvas replace marquee selects all non-hidden items (excludes a2)
    const allVisible = engine.selectItemsInWorldRect(-1000, -1000, 2000, 2000, {
      mode: 'replace',
    });
    expect(allVisible.has('a2')).toBe(false);
    expect(allVisible.size).toBe(SAMPLE_ITEMS.length - 1);

    // Toggle mode on c1 deselects c1 while keeping others
    const toggled = engine.selectItemsInScreenRect(
      screenC1.x - 1,
      screenC1.y - 1,
      screenC1.x + 1,
      screenC1.y + 1,
      { mode: 'toggle' },
    );
    expect(toggled.has('c1')).toBe(false);
    expect(toggled.has('a1')).toBe(true);

    engine.destroy();
  });
});
