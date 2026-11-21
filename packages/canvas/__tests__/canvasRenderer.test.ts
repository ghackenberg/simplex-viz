// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  CanvasRendererAdapter,
  createBarycentricZoomStrategy,
  createSimplexCanvas,
  renderSimplexSnapshotToCanvas,
  solveSimplexSnapshot,
  type CanvasDefaultClusterVisual,
  type CanvasDefaultContentVisual,
  type SceneFrameSnapshot,
} from '../src/index.js';

interface RecordedCanvasCalls {
  fillRect: number;
  clearRect: number;
  arc: number;
  fill: number;
  stroke: number;
  fillText: string[];
  save: number;
  restore: number;
}

function createMock2DContext(): {
  ctx: CanvasRenderingContext2D;
  calls: RecordedCanvasCalls;
} {
  const calls: RecordedCanvasCalls = {
    fillRect: 0,
    clearRect: 0,
    arc: 0,
    fill: 0,
    stroke: 0,
    fillText: [],
    save: 0,
    restore: 0,
  };

  const mock = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '12px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    setTransform: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    save: vi.fn(() => {
      calls.save += 1;
    }),
    restore: vi.fn(() => {
      calls.restore += 1;
    }),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    arc: vi.fn(() => {
      calls.arc += 1;
    }),
    fill: vi.fn(() => {
      calls.fill += 1;
    }),
    stroke: vi.fn(() => {
      calls.stroke += 1;
    }),
    fillRect: vi.fn(() => {
      calls.fillRect += 1;
    }),
    strokeRect: vi.fn(),
    clearRect: vi.fn(() => {
      calls.clearRect += 1;
    }),
    setLineDash: vi.fn(),
    fillText: vi.fn((text: string) => {
      calls.fillText.push(text);
    }),
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
  };

  return {
    ctx: mock as unknown as CanvasRenderingContext2D,
    calls,
  };
}

function attachMockCanvasContext(canvas: HTMLCanvasElement): RecordedCanvasCalls {
  const { ctx, calls } = createMock2DContext();
  Object.defineProperty(canvas, 'getContext', {
    configurable: true,
    value: (type: string) => (type === '2d' ? ctx : null),
  });
  Object.defineProperty(canvas, 'toDataURL', {
    configurable: true,
    value: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
  });
  Object.defineProperty(canvas, 'toBlob', {
    configurable: true,
    value: (cb: (b: Blob | null) => void) => cb(new Blob(['png'], { type: 'image/png' })),
  });
  return calls;
}

function createSizedContainer(width = 800, height = 560): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
  document.body.appendChild(el);
  return el;
}

function makeSampleItems(count = 20) {
  const tagPools = [
    ['geometry', 'math'],
    ['math', 'topology'],
    ['topology', 'physics'],
    ['physics', 'simulation'],
    ['simulation', 'geometry'],
    ['geometry', 'topology'],
  ];
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    label: `Record ${i + 1}`,
    tags: tagPools[i % tagPools.length]!,
    year: 2020 + (i % 5),
  }));
}

describe('@simplex-viz/canvas high-capacity Canvas 2D renderer (Issue #21)', () => {
  it('mounts a zero-node-DOM <canvas> surface, solves overlap-free layout, and switches presets/themes', () => {
    const container = createSizedContainer(840, 560);
    const items = makeSampleItems(18);

    // Patch HTMLCanvasElement.prototype.getContext for controller-created canvas
    const { ctx, calls } = createMock2DContext();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    const controller = createSimplexCanvas(container, {
      items,
      preset: 'badges',
      theme: 'dark',
      reducedMotion: true,
      tooltip: true,
    });

    try {
      controller.stepForTest(16.67);

      const canvas = controller.getCanvasElement();
      expect(canvas.tagName).toBe('CANVAS');
      expect(canvas.getAttribute('role')).toBe('application');
      // Zero per-item SVG/DOM nodes inside the canvas root
      expect(container.querySelectorAll('svg')).toHaveLength(0);
      expect(container.querySelectorAll('canvas')).toHaveLength(1);

      const metrics = controller.getMetrics();
      expect(metrics.itemCount).toBe(18);
      expect(metrics.overlapCount).toBe(0);

      const stats = controller.getRenderStats();
      expect(stats.totalItems).toBe(18);
      expect(stats.drawnItems).toBe(18);
      expect(stats.culledItems).toBe(0);
      expect(stats.drawnClusters).toBeGreaterThan(0);
      expect(stats.drawnTriangles).toBeGreaterThan(0);
      expect(calls.fill).toBeGreaterThan(0);
      expect(calls.fillText.length).toBeGreaterThan(0);

      // Switch presets & theme cleanly
      controller.setPreset('glyphs');
      controller.stepForTest(16.67);
      expect(controller.getRenderStats().drawnItems).toBe(18);

      controller.setPreset('geometric');
      controller.setTheme('light');
      controller.setBackgroundColor('transparent');
      controller.setShowHulls(true);
      controller.stepForTest(16.67);
      expect(calls.clearRect).toBeGreaterThan(0);
    } finally {
      controller.destroy();
      HTMLCanvasElement.prototype.getContext = origGetContext;
      container.remove();
    }

    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('handles 3,000+ items with viewport frustum culling and automatic LOD simplification', () => {
    const canvas = document.createElement('canvas');
    const calls = attachMockCanvasContext(canvas);

    const adapter = new CanvasRendererAdapter<
      CanvasDefaultContentVisual,
      CanvasDefaultClusterVisual
    >({
      canvas,
      theme: 'dark',
      lodThresholdPx: 4,
      cullMarginPx: 20,
      maxDevicePixelRatio: 2,
    });

    const totalCount = 3_000;
    const denseItems = Array.from({ length: totalCount }, (_, i) => {
      const col = i % 60;
      const row = Math.floor(i / 60);
      const x = col * 24;
      const y = row * 24;
      return {
        id: `n-${i}`,
        x,
        y,
        scale: 0.35, // effective radius ~3.3px at zoom=1 -> triggers LOD!
        opacity: 1,
        visual: {
          kind: 'geometric' as const,
          shape: 'hexagon' as const,
          radius: 9.5,
          colorHex: '#38bdf8',
          label: `N${i}`,
          theme: 'dark' as const,
        },
        hull: { kind: 'circle' as const, radius: 9.5 },
        cacheKey: 'hex-small',
        interaction: {
          isHovered: false,
          isPinned: false,
          isDimmed: false,
          isHighlighted: false,
          isSelected: false,
        },
        transition: null,
      };
    });

    const baseSnapshot: SceneFrameSnapshot<
      CanvasDefaultContentVisual,
      CanvasDefaultClusterVisual
    > = {
      viewportWidth: 960,
      viewportHeight: 600,
      camera: { zoom: 1, panX: 0, panY: 0 },
      triangles: [],
      edges: [],
      clusters: [],
      items: denseItems,
      showHulls: false,
    };

    // Pass 1: zoomed-out viewport covering part of the 1440x1200 grid -> culls off-screen items + simplifies LOD
    adapter.renderFrame(baseSnapshot);
    const stats1 = adapter.getRenderStats();
    expect(stats1.totalItems).toBe(totalCount);
    expect(stats1.drawnItems).toBeGreaterThan(0);
    expect(stats1.culledItems).toBeGreaterThan(500);
    expect(stats1.drawnItems + stats1.culledItems).toBe(totalCount);
    expect(stats1.lodSimplifiedItems).toBe(stats1.drawnItems);
    // Zero per-node save/restore calls on the built-in content hot path (only 1 camera save/restore!)
    expect(calls.save).toBe(1);
    expect(calls.restore).toBe(1);

    // Pass 2: zoom in 3x on a sub-region -> far fewer items drawn, and LOD disables (full hexagons)
    adapter.renderFrame({
      ...baseSnapshot,
      camera: { zoom: 3, panX: -400, panY: -300 },
    });
    const stats2 = adapter.getRenderStats();
    expect(stats2.drawnItems).toBeLessThan(stats1.drawnItems);
    expect(stats2.culledItems).toBeGreaterThan(2_500);
    expect(stats2.lodSimplifiedItems).toBe(0);

    adapter.destroy();
  });

  it('supports 1:4 hierarchical drill-down, view-state serialization, filtering, multi-selection, keyboard nav, and timeline playback', () => {
    const container = createSizedContainer(820, 560);
    const { ctx } = createMock2DContext();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    const items = makeSampleItems(24);
    const timelineEvents: number[] = [];

    const controller = createSimplexCanvas(container, {
      items,
      preset: 'badges',
      reducedMotion: true,
      zoomStrategy: createBarycentricZoomStrategy(),
      timeline: {
        getTimestamp: (it) => it.year,
        stepIntervalMs: 500,
        autoFinalSeed: true,
        emptyClusterBehavior: 'dim',
      },
    });

    try {
      const unsub = controller.subscribeTimeline((state) => {
        if (state) timelineEvents.push(state.step);
      });
      expect(timelineEvents.length).toBeGreaterThanOrEqual(1);

      const tl = controller.getTimeline();
      expect(tl).not.toBeNull();
      tl!.seek(0);
      controller.stepForTest(16.67);
      const step0Legend = controller.getLegendModel();
      expect(step0Legend.timelineStep).toBe(0);
      expect(step0Legend.entries.length).toBeGreaterThan(0);

      // Advance timeline to full dataset
      tl!.resetToEnd();
      controller.stepForTest(16.67);
      expect(controller.getMetrics().itemCount).toBe(24);

      // Zero-relayout item filter
      controller.setItemFilter((it) => it.year >= 2022, { mode: 'dim' });
      controller.stepForTest(16.67);
      expect(controller.getLegendModel().hasActiveFilter).toBe(true);
      controller.setItemFilter(null);

      // Multi-selection + keyboard traversal
      controller.setSelectedIds(['item-0', 'item-1']);
      expect(controller.getSelectedIds().size).toBe(2);
      controller.toggleSelectedId('item-0');
      expect(controller.getSelectedIds().size).toBe(1);

      const canvas = controller.getCanvasElement();
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const announcer = container.querySelector('.sv-sr-announcer');
      expect(announcer?.textContent?.length).toBeGreaterThan(0);
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(controller.getSelectedIds().size).toBe(0);

      // Hierarchical drill-down + ViewState round-trip
      const zoomBefore = controller.getZoomState();
      if (zoomBefore.drillableTriangleIndices.length > 0) {
        const triIdx = zoomBefore.drillableTriangleIndices[0]!;
        expect(controller.drillDownTriangle(triIdx)).toBe(true);
        controller.stepForTest(16.67);
        expect(controller.getZoomState().depth).toBe(1);

        const saved = controller.getViewState();
        controller.drillToRoot();
        controller.stepForTest(16.67);
        expect(controller.getZoomState().depth).toBe(0);

        controller.restoreViewState(saved);
        controller.stepForTest(16.67);
        expect(controller.getZoomState().depth).toBe(1);
      }

      unsub();
    } finally {
      controller.destroy();
      HTMLCanvasElement.prototype.getContext = origGetContext;
      container.remove();
    }
  });

  it('renders pre-solved SimplexLayoutSnapshot via renderSimplexSnapshotToCanvas() and exports native PNGs', async () => {
    const canvas = document.createElement('canvas');
    const calls = attachMockCanvasContext(canvas);

    const items = makeSampleItems(16);
    const snapshot = solveSimplexSnapshot(items, { width: 800, height: 500 });
    expect(snapshot.metrics.overlapCount).toBe(0);

    const stats = renderSimplexSnapshotToCanvas(canvas, snapshot, {
      theme: 'light',
      showClusterBadges: true,
      devicePixelRatio: 2,
    });

    expect(stats.totalItems).toBe(16);
    expect(stats.drawnItems).toBe(16);
    expect(stats.drawnClusters).toBe(snapshot.clusters.length);
    expect(stats.devicePixelRatio).toBe(2);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1000);
    expect(calls.fill).toBeGreaterThan(0);

    // Native exportPng via CanvasRendererAdapter
    const adapter = new CanvasRendererAdapter({ canvas, theme: 'dark' });
    const dataUrl = await adapter.exportPng({ format: 'dataUrl' });
    expect(typeof dataUrl).toBe('string');
    expect((dataUrl as string).startsWith('data:image/png')).toBe(true);

    const blob = await adapter.exportPng({ format: 'blob' });
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('image/png');
    adapter.destroy();
  });

  it('handles interactive click drill-down, background click drill-up, trackpad pinch, and free-camera wheel zoom', () => {
    const container = createSizedContainer(820, 560);
    const { ctx } = createMock2DContext();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    const items = makeSampleItems(28);
    const controller = createSimplexCanvas(container, {
      items,
      preset: 'badges',
      reducedMotion: true,
      zoomStrategy: createBarycentricZoomStrategy(),
    });

    try {
      controller.stepForTest(16.67);
      const canvas = controller.getCanvasElement();
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          left: 0,
          top: 0,
          right: 820,
          bottom: 560,
          width: 820,
          height: 560,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      });

      // 1. Hovering a drillable triangle shows zoom-in cursor (matching SVG)
      const zoom0 = controller.getZoomState();
      expect(zoom0.depth).toBe(0);
      if (zoom0.drillableTriangleIndices.length > 0) {
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: 410,
            clientY: 280,
            bubbles: true,
          }),
        );
        expect(['zoom-in', 'pointer']).toContain(canvas.style.cursor);

        // Trackpad ctrl+wheel pinch-out drills into the nearest drillable triangle
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            clientX: 410,
            clientY: 280,
            deltaY: -40,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        controller.stepForTest(16.67);
        expect(controller.getZoomState().depth).toBe(1);

        // Hovering background while drilled in shows zoom-out cursor
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: 8,
            clientY: 8,
            bubbles: true,
          }),
        );
        expect(canvas.style.cursor).toBe('zoom-out');

        // 2. Clicking the empty corner background drills back up to depth 0
        canvas.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            clientX: 8,
            clientY: 8,
            bubbles: true,
          }),
        );
        canvas.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId: 1,
            pointerType: 'mouse',
            button: 0,
            clientX: 8,
            clientY: 8,
            bubbles: true,
          }),
        );
        controller.stepForTest(16.67);
        expect(controller.getZoomState().depth).toBe(0);
        expect(canvas.style.cursor).toBe('default');

        // 3. Clicking the center of a drillable triangle drills in 1:4
        canvas.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 2,
            pointerType: 'mouse',
            button: 0,
            clientX: 410,
            clientY: 280,
            bubbles: true,
          }),
        );
        canvas.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId: 2,
            pointerType: 'mouse',
            button: 0,
            clientX: 410,
            clientY: 280,
            bubbles: true,
          }),
        );
        controller.stepForTest(16.67);
        expect(controller.getZoomState().depth).toBeGreaterThanOrEqual(1);
      }
    } finally {
      controller.destroy();
      HTMLCanvasElement.prototype.getContext = origGetContext;
      container.remove();
    }
  });
});
