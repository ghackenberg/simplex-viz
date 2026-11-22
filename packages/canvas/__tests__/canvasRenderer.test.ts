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

  it('renders shared breadcrumb & timeline HUD overlays and supports full setOptions & keyboard focus API parity', () => {
    const container = createSizedContainer(840, 560);
    const { ctx } = createMock2DContext();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    const items = makeSampleItems(24);
    const legendSnapshots: number[] = [];
    const controller = createSimplexCanvas(container, {
      items,
      preset: 'badges',
      reducedMotion: true,
      zoomStrategy: createBarycentricZoomStrategy({ stopWhenFullScale: false }),
      showZoomBreadcrumbs: true,
      timeline: true,
    });

    try {
      controller.setOnLegendChange((model) => {
        legendSnapshots.push(model.totalItems);
      });

      // Timeline shorthand (`timeline: true`) mounts shared `.sv-timeline-bar` HUD
      const timelineBar = container.querySelector('.sv-timeline-bar') as HTMLDivElement;
      expect(timelineBar).not.toBeNull();
      expect(timelineBar.style.display).toBe('flex');

      // Drill-down renders shared `.sv-zoom-breadcrumbs` HUD and handles depth button clicks
      const triIdx = controller.getZoomState().drillableTriangleIndices[0]!;
      expect(controller.drillDownTriangle(triIdx)).toBe(true);
      controller.stepForTest(16.67);

      const breadcrumbsEl = container.querySelector('.sv-zoom-breadcrumbs') as HTMLDivElement;
      expect(breadcrumbsEl).not.toBeNull();
      expect(breadcrumbsEl.style.display).toBe('flex');
      const rootBtn = breadcrumbsEl.querySelectorAll('button')[0]!;
      rootBtn.click();
      controller.stepForTest(16.67);
      expect(controller.getZoomState().depth).toBe(0);
      expect(breadcrumbsEl.style.display).toBe('none');

      // Keyboard navigation focus target APIs & Enter/Escape cascade
      const canvas = controller.getCanvasElement();
      expect(controller.getInteractiveTargets().length).toBeGreaterThan(0);
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(controller.getKeyboardFocusTarget()).not.toBeNull();
      expect(container.querySelector('.sv-sr-announcer')?.textContent?.length).toBeGreaterThan(0);
      controller.clearKeyboardFocus();
      expect(controller.getKeyboardFocusTarget()).toBeNull();

      // Atomic setOptions parity: theme, ariaLabel, sizeMultiplier, showZoomBreadcrumbs, focusedItemId, timeline null
      controller.setOptions({
        theme: 'light',
        ariaLabel: 'Canvas Parity Graph',
        sizeMultiplier: 1.15,
        showZoomBreadcrumbs: false,
        focusedItemId: 'item-2',
        timeline: null,
      });
      expect(canvas.getAttribute('aria-label')).toBe('Canvas Parity Graph');
      expect(controller.getFocusedItemId()).toBe('item-2');
      expect(controller.getTimeline()).toBeNull();
      expect(timelineBar.style.display).toBe('none');

      // removeItems keeps corpus consistent and fires legend updates
      controller.removeItems(['item-0', 'item-1']);
      controller.stepForTest(16.67);
      expect(controller.getItems().length).toBe(22);
      expect(legendSnapshots.length).toBeGreaterThanOrEqual(1);
    } finally {
      controller.destroy();
      HTMLCanvasElement.prototype.getContext = origGetContext;
      container.remove();
    }
  });

  it('supports createSimplexCanvas(container, items) array shorthand, relayoutOnFontLoad, onClustersChange, onFpsUpdate, and controller exportPng', async () => {
    const container = createSizedContainer(800, 540);
    const { ctx } = createMock2DContext();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;
    const origPerfNow = performance.now.bind(performance);
    const origFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

    HTMLCanvasElement.prototype.getContext = function () {
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    let rafNow = 100;
    let nextRafId = 1;
    const rafQueue = new Map<number, FrameRequestCallback>();
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      rafQueue.delete(id);
    }) as typeof cancelAnimationFrame;
    vi.spyOn(performance, 'now').mockImplementation(() => rafNow);

    let resolveFontsReady!: () => void;
    const readyPromise = new Promise<void>((res) => {
      resolveFontsReady = res;
    });
    const listeners = new Map<string, Set<EventListener>>();
    const mockFonts = {
      status: 'loading',
      ready: readyPromise,
      addEventListener: (type: string, fn: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        listeners.get(type)?.delete(fn);
      },
      dispatchLoadingDone: () => {
        for (const fn of listeners.get('loadingdone') ?? []) {
          fn(new Event('loadingdone'));
        }
      },
    };
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: mockFonts,
    });

    try {
      const items = makeSampleItems(14);
      // 1) Array shorthand mounts cleanly without extra options
      const quickCtrl = createSimplexCanvas(container, items);
      expect(quickCtrl.getItems().length).toBe(14);
      expect(quickCtrl.getMetrics().itemCount).toBe(14);
      quickCtrl.destroy();

      // 2) relayoutOnFontLoad: false does not subscribe to loadingdone
      const noFontCtrl = createSimplexCanvas(container, {
        items,
        relayoutOnFontLoad: false,
      });
      expect(listeners.get('loadingdone')?.size ?? 0).toBe(0);
      noFontCtrl.destroy();

      // 3) relayoutOnFontLoad: true + onClustersChange + onFpsUpdate + exportPng
      const clusterCounts: number[] = [];
      const fpsSamples: number[] = [];
      let metricsCalls = 0;

      const controller = createSimplexCanvas(container, {
        items: items.slice(0, 10),
        timeline: {
          getTimestamp: (it) => it.year,
          autoPlay: true,
        },
        onClustersChange: (clusters) => {
          clusterCounts.push(clusters.length);
        },
        onMetricsChange: () => {
          metricsCalls += 1;
        },
        onFpsUpdate: (fps) => {
          fpsSamples.push(fps);
        },
      });

      const canvas = controller.getCanvasElement();
      Object.defineProperty(canvas, 'toDataURL', {
        configurable: true,
        value: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      });
      Object.defineProperty(canvas, 'toBlob', {
        configurable: true,
        value: (cb: (b: Blob | null) => void) =>
          cb(new Blob(['canvas-png'], { type: 'image/png' })),
      });

      expect(clusterCounts.length).toBeGreaterThanOrEqual(1);
      expect(listeners.get('loadingdone')?.size).toBe(1);

      // Drive queued rAF frames across >500ms while timeline is playing so onFpsUpdate emits
      for (let i = 0; i < 45; i++) {
        const pending = Array.from(rafQueue.entries());
        if (pending.length === 0) break;
        rafQueue.clear();
        rafNow += 16.67;
        for (const [, cb] of pending) {
          cb(rafNow);
        }
      }
      controller.getTimeline()!.pause();
      controller.getTimeline()!.resetToEnd();
      expect(fpsSamples.length).toBeGreaterThanOrEqual(1);
      expect(fpsSamples[0]).toBeGreaterThan(0);

      // Updating items notifies onClustersChange
      const clusterEventsBeforeUpdate = clusterCounts.length;
      controller.setItems(items);
      expect(clusterCounts.length).toBeGreaterThan(clusterEventsBeforeUpdate);

      // document.fonts.ready and loadingdone trigger clean relayout
      const metricsBeforeReady = metricsCalls;
      resolveFontsReady();
      await Promise.resolve();
      await Promise.resolve();
      expect(metricsCalls).toBeGreaterThan(metricsBeforeReady);

      const metricsBeforeEvent = metricsCalls;
      mockFonts.dispatchLoadingDone();
      expect(metricsCalls).toBeGreaterThan(metricsBeforeEvent);

      // Controller exportPng parity
      const dataUrl = await controller.exportPng({ format: 'dataUrl' });
      expect(typeof dataUrl).toBe('string');
      expect((dataUrl as string).startsWith('data:image/png')).toBe(true);
      const blob = await controller.exportPng({ format: 'blob' });
      expect(blob).toBeInstanceOf(Blob);

      controller.destroy();
      expect(listeners.get('loadingdone')?.size ?? 0).toBe(0);
    } finally {
      vi.restoreAllMocks();
      performance.now = origPerfNow;
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancelRaf;
      HTMLCanvasElement.prototype.getContext = origGetContext;
      if (originalFontsOrUndefined(origFonts)) {
        Object.defineProperty(document, 'fonts', origFonts!);
      } else {
        delete (document as unknown as Record<string, unknown>).fonts;
      }
      container.remove();
    }
  });

  it('defers initial layout until first non-zero ResizeObserver entry or fallbackTimeoutMs when deferInitialLayout is set', async () => {
    const items = makeSampleItems(14);

    type RoCallback = (entries: ResizeObserverEntry[]) => void;
    const observers: Array<{ target: Element; cb: RoCallback }> = [];
    const OriginalResizeObserver = globalThis.ResizeObserver;
    class MockResizeObserver {
      private readonly cb: RoCallback;
      constructor(cb: RoCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        observers.push({ target, cb: this.cb });
      }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    const triggerResize = (target: Element, width: number, height: number) => {
      for (const rec of observers) {
        if (rec.target === target) {
          rec.cb([
            {
              target,
              contentRect: {
                x: 0,
                y: 0,
                width,
                height,
                top: 0,
                left: 0,
                right: width,
                bottom: height,
                toJSON: () => ({}),
              },
            } as ResizeObserverEntry,
          ]);
        }
      }
    };

    const { ctx } = createMock2DContext();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    const hiddenContainer = createSizedContainer(0, 0);
    const timeoutContainer = createSizedContainer(0, 0);
    const destroyedContainer = createSizedContainer(0, 0);

    try {
      // 1) deferInitialLayout: true holds solving until first >= 40x40 ResizeObserver entry
      let metricsCalls = 0;
      const deferredCtrl = createSimplexCanvas(hiddenContainer, {
        items: items.slice(0, 8),
        deferInitialLayout: true,
        reducedMotion: true,
        layoutOptions: { seed: 42 },
        onMetricsChange: () => {
          metricsCalls += 1;
        },
      });

      expect(metricsCalls).toBe(0);
      expect(deferredCtrl.getClusters().length).toBe(0);
      expect(deferredCtrl.getMetrics().meshSideLength).toBe(0);

      deferredCtrl.setItems(items);
      expect(metricsCalls).toBe(0);

      // Tiny sizes stay ignored
      triggerResize(hiddenContainer, 0, 0);
      triggerResize(hiddenContainer, 24, 24);
      expect(metricsCalls).toBe(0);

      // First valid measurement triggers initial layout
      triggerResize(hiddenContainer, 760, 520);
      deferredCtrl.stepForTest(16.67);
      expect(metricsCalls).toBe(1);
      expect(deferredCtrl.getMetrics().itemCount).toBe(items.length);
      expect(deferredCtrl.getMetrics().overlapCount).toBe(0);
      expect(deferredCtrl.getRenderStats().drawnItems).toBe(items.length);

      // 2) deferInitialLayout: { fallbackTimeoutMs } initializes on timer and re-solves cleanly on real resize
      const timeoutCtrl = createSimplexCanvas(timeoutContainer, {
        items,
        deferInitialLayout: { fallbackTimeoutMs: 25 },
        reducedMotion: true,
        layoutOptions: { seed: 42 },
      });
      expect(timeoutCtrl.getClusters().length).toBe(0);

      await new Promise((resolve) => setTimeout(resolve, 60));
      timeoutCtrl.stepForTest(16.67);
      expect(timeoutCtrl.getClusters().length).toBeGreaterThanOrEqual(3);
      expect(timeoutCtrl.getMetrics().itemCount).toBe(items.length);

      triggerResize(timeoutContainer, 680, 460);
      timeoutCtrl.stepForTest(16.67);
      expect(timeoutCtrl.getMetrics().overlapCount).toBe(0);

      // 3) destroy() before fallbackTimeoutMs cancels cleanly
      let destroyedMetricsCalls = 0;
      const destroyedCtrl = createSimplexCanvas(destroyedContainer, {
        items,
        deferInitialLayout: { fallbackTimeoutMs: 25 },
        onMetricsChange: () => {
          destroyedMetricsCalls += 1;
        },
      });
      destroyedCtrl.destroy();
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(destroyedMetricsCalls).toBe(0);

      deferredCtrl.destroy();
      timeoutCtrl.destroy();
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
      HTMLCanvasElement.prototype.getContext = origGetContext;
      hiddenContainer.remove();
      timeoutContainer.remove();
      destroyedContainer.remove();
    }
  });

  it('supports SimplexDomTooltipRenderer, function/structured tooltip formatters, Shift+Drag marquee, timeline ViewState round-trip, and StrategyItemIdentityConfig generics', () => {
    const container = createSizedContainer(840, 560);
    const { ctx } = createMock2DContext();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    interface CustomRecord {
      readonly recordKey: string;
      readonly title: string;
      readonly keywords: readonly string[];
      readonly year: number;
    }

    const customItems: CustomRecord[] = makeSampleItems(18).map((item, idx) => ({
      recordKey: `rec-${idx}`,
      title: item.label,
      keywords: item.tags,
      year: item.year,
    }));

    const cleanupSpy = vi.fn();
    const onHideSpy = vi.fn();

    interface CustomClusterMeta {
      readonly tag: string;
      readonly itemCount: number;
    }

    const controller = createSimplexCanvas<
      CustomRecord,
      CanvasDefaultContentVisual,
      CanvasDefaultClusterVisual,
      undefined,
      CustomClusterMeta
    >(container, {
      items: customItems,
      getId: (r) => r.recordKey,
      getTags: (r) => r.keywords,
      getLabel: (r) => r.title,
      deriveClusterMeta: (ctx) => ({
        tag: ctx.defaultLabel,
        itemCount: ctx.members.length,
      }),
      reducedMotion: true,
      zoomStrategy: createBarycentricZoomStrategy(),
      timeline: {
        getTimestamp: (r) => r.year,
        autoFinalSeed: true,
      },
      tooltip: {
        render: (target, tooltipEl) => {
          if (target.kind !== 'content') return false;
          const strong = document.createElement('strong');
          strong.textContent = `DOM:${target.item.title}`;
          tooltipEl.replaceChildren(strong);
          return cleanupSpy;
        },
        onHide: onHideSpy,
      },
    });

    try {
      controller.stepForTest(16.67);
      const canvas = controller.getCanvasElement();
      Object.defineProperty(canvas, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          left: 0,
          top: 0,
          right: 840,
          bottom: 560,
          width: 840,
          height: 560,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
      });

      const tl = controller.getTimeline()!;
      tl.resetToEnd();
      controller.stepForTest(16.67);

      const initialTriIdx = controller.getZoomState().drillableTriangleIndices[0];
      if (initialTriIdx !== undefined) {
        controller.drillDownTriangle(initialTriIdx);
        controller.stepForTest(16.67);
      }

      const itemTargets = controller
        .getInteractiveTargets()
        .filter((t): t is Extract<typeof t, { kind: 'item' }> => t.kind === 'item');
      expect(itemTargets.length).toBeGreaterThanOrEqual(2);
      const firstPos = itemTargets[0]!.screenPosition;

      // 1) Custom DOM tooltip renders, cleans up on pointerleave, and invokes onHide
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'mouse',
          clientX: firstPos.x,
          clientY: firstPos.y,
          bubbles: true,
        }),
      );
      const tooltipEl = container.querySelector('.sv-canvas-tooltip') as HTMLDivElement;
      expect(tooltipEl).not.toBeNull();
      expect(tooltipEl.style.display).not.toBe('none');
      expect(tooltipEl.textContent).toContain('DOM:');

      canvas.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
      expect(onHideSpy).toHaveBeenCalledTimes(1);

      // 2) Function formatter tooltip & structured tooltip option via setOptions
      controller.setOptions({
        tooltip: (target) =>
          target.kind === 'content' ? `FN:${target.item.recordKey}` : false,
      });
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'mouse',
          clientX: firstPos.x,
          clientY: firstPos.y,
          bubbles: true,
        }),
      );
      expect(tooltipEl.textContent).toBe(`FN:${itemTargets[0]!.item.recordKey}`);

      controller.setOptions({
        tooltip: {
          formatContent: (ev) => `STRUCT:${ev.item.title}`,
        },
      });
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'mouse',
          clientX: firstPos.x,
          clientY: firstPos.y,
          bubbles: true,
        }),
      );
      expect(tooltipEl.textContent).toBe(`STRUCT:${itemTargets[0]!.item.title}`);

      // 3) Shift+Drag marquee selects multiple items within screen bounding box
      const marqueeSlice = itemTargets.slice(0, Math.min(3, itemTargets.length));
      const xs = marqueeSlice.map((t) => t.screenPosition.x);
      const ys = marqueeSlice.map((t) => t.screenPosition.y);
      const minX = Math.max(0, Math.min(...xs) - 20);
      const minY = Math.max(0, Math.min(...ys) - 20);
      const maxX = Math.min(840, Math.max(...xs) + 20);
      const maxY = Math.min(560, Math.max(...ys) + 20);

      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 3,
          pointerType: 'mouse',
          button: 0,
          shiftKey: true,
          clientX: minX,
          clientY: minY,
          bubbles: true,
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 3,
          pointerType: 'mouse',
          shiftKey: true,
          clientX: maxX,
          clientY: maxY,
          bubbles: true,
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 3,
          pointerType: 'mouse',
          button: 0,
          shiftKey: true,
          clientX: maxX,
          clientY: maxY,
          bubbles: true,
        }),
      );
      expect(controller.getSelectedIds().size).toBeGreaterThanOrEqual(marqueeSlice.length);

      // 4) Timeline step + zoom depth ViewState round-trip
      controller.drillToRoot();
      tl.seek(1);
      controller.stepForTest(16.67);
      const triIdx = controller.getZoomState().drillableTriangleIndices[0];
      if (triIdx !== undefined) {
        controller.drillDownTriangle(triIdx);
        controller.stepForTest(16.67);
      }
      const saved = controller.getViewState();
      expect(saved.timelineStep).toBe(1);

      controller.drillToRoot();
      tl.resetToEnd();
      controller.stepForTest(16.67);
      expect(controller.getZoomState().depth).toBe(0);

      controller.restoreViewState(saved);
      controller.stepForTest(16.67);
      expect(controller.getTimeline()!.getState().step).toBe(1);
      if (triIdx !== undefined) {
        expect(controller.getZoomState().depth).toBe(1);
      }
    } finally {
      controller.destroy();
      HTMLCanvasElement.prototype.getContext = origGetContext;
      container.remove();
    }
  });

  it('schedules redraws via camera proxy mutations, supports (x1, y1, x2, y2) marquee coordinates, and renders/guards exportPng()', async () => {
    const container = createSizedContainer(800, 560);
    const { ctx } = createMock2DContext();
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    const origRaf = globalThis.requestAnimationFrame;
    const origCancelRaf = globalThis.cancelAnimationFrame;

    HTMLCanvasElement.prototype.getContext = function () {
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;

    let nextRafId = 1;
    const rafQueue = new Map<number, FrameRequestCallback>();
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => {
      rafQueue.delete(id);
    }) as typeof cancelAnimationFrame;

    const items = makeSampleItems(14);
    const controller = createSimplexCanvas(container, {
      items,
      reducedMotion: true,
    });

    try {
      const canvas = controller.getCanvasElement();
      Object.defineProperty(canvas, 'toDataURL', {
        configurable: true,
        value: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      });
      Object.defineProperty(canvas, 'toBlob', {
        configurable: true,
        value: (cb: (b: Blob | null) => void) =>
          cb(new Blob(['canvas-png'], { type: 'image/png' })),
      });

      // Drain initial frame scheduling until engine is completely settled & idle
      for (let i = 0; i < 10; i++) {
        const pending = Array.from(rafQueue.entries());
        if (pending.length === 0) break;
        rafQueue.clear();
        for (const [, cb] of pending) cb(100 + i * 16.67);
      }
      expect(rafQueue.size).toBe(0);

      // Camera mutations via controller.camera proxy must enqueue a new rAF frame
      controller.camera.zoomToCursor(400, 280, 1.5);
      expect(rafQueue.size).toBe(1);

      // Even before the queued rAF callback executes, exportPng() flushes renderNow() immediately
      vi.mocked(ctx.setTransform).mockClear();
      const exported = await controller.exportPng({ format: 'dataUrl' });
      expect(exported.startsWith('data:image/png')).toBe(true);
      expect(ctx.setTransform).toHaveBeenCalled();

      // Execute pending rAF from zoomToCursor so scheduler returns to idle,
      // then verify panBy / setState / reset each schedule a fresh redraw
      for (const [, cb] of rafQueue.entries()) cb(210);
      rafQueue.clear();
      controller.camera.panBy(24, -18);
      expect(rafQueue.size).toBe(1);
      for (const [, cb] of rafQueue.entries()) cb(230);
      rafQueue.clear();
      controller.camera.setState({ zoom: 1.25, panX: 10, panY: 10 });
      expect(rafQueue.size).toBe(1);
      for (const [, cb] of rafQueue.entries()) cb(250);
      rafQueue.clear();
      controller.camera.reset();
      expect(rafQueue.size).toBe(1);
      for (const [, cb] of rafQueue.entries()) cb(270);
      rafQueue.clear();

      // selectItemsInScreenRect supports both 4-coordinate and rect-object signatures identically
      const fromCoords = [...controller.selectItemsInScreenRect(0, 0, 800, 560)].sort();
      controller.clearSelection();
      const fromRect = [
        ...controller.selectItemsInScreenRect({ x: 0, y: 0, width: 800, height: 560 }),
      ].sort();
      expect(fromCoords).toEqual(fromRect);
      expect(fromCoords.length).toBe(items.length);

      controller.destroy();
      await expect(controller.exportPng()).rejects.toThrow(/after destroy/i);
    } finally {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCancelRaf;
      HTMLCanvasElement.prototype.getContext = origGetContext;
      container.remove();
    }
  });
});

function originalFontsOrUndefined(
  desc: PropertyDescriptor | undefined,
): desc is PropertyDescriptor {
  return Boolean(desc);
}

