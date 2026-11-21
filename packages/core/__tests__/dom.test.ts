// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  areSimplexLayoutOptionsEqual,
  areSimplexMeshOptionsEqual,
  areSimplexTimelineOptionsEqual,
  createSimplexTimelineNotifier,
  type ClusterDescriptor,
  type ContentLayoutContext,
  type DefaultTaggedItem,
  type NormalizedPointerEvent,
  type SimplexTimelineState,
} from '../src/index.js';
import {
  buildSimplexTooltipContentModel,
  computeSimplexTooltipCoords,
  createSimplexSrAnnouncer,
  dispatchSimplexDefaultLeftClick,
  ensureSimplexContainerPositioned,
  formatSimplexInteractiveTargetAriaLabel,
  formatSimplexTooltipText,
  measureSimplexContainer,
  observeSimplexContainerResize,
  positionSimplexTooltipElement,
  resolveNextSimplexKeyboardFocusIndex,
  resolveSimplexContainer,
  resolveSimplexReducedMotion,
  stepSimplexDrillDownWheelPinch,
  subscribeSimplexReducedMotionMedia,
  zoomSimplexViewportByFactor,
} from '../src/dom.js';

function getDomDocument(): Document {
  return (globalThis as unknown as { document: Document }).document;
}

function makeDummyPointerEvent(overrides?: Partial<NormalizedPointerEvent>): NormalizedPointerEvent {
  return {
    screenX: 100,
    screenY: 120,
    worldX: 10,
    worldY: 20,
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe('@simplex-viz/core/dom & shared utilities', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    getDomDocument().body.innerHTML = '';
  });

  it('resolves DOM containers by element reference or CSS selector and measures size cleanly', () => {
    const doc = getDomDocument();
    const el = doc.createElement('div');
    el.id = 'graph-host';
    doc.body.appendChild(el);

    expect(resolveSimplexContainer(el, 'test')).toBe(el);
    expect(resolveSimplexContainer('#graph-host', 'test')).toBe(el);
    expect(() => resolveSimplexContainer('#missing-host', 'test')).toThrow(/no element matched/);

    // 0x0 falls back safely to defaults
    const zero = measureSimplexContainer(el, 800, 500, 40);
    expect(zero).toEqual({ width: 800, height: 500, hasValidSize: false });

    Object.defineProperty(el, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 640, height: 420 }),
    });
    const valid = measureSimplexContainer(el, 800, 500, 40);
    expect(valid).toEqual({ width: 640, height: 420, hasValidSize: true });

    ensureSimplexContainerPositioned(el);
    expect(el.style.position).toBe('relative');
  });

  it('defers initial ResizeObserver init and fires fallback timeout when unmeasured', () => {
    vi.useFakeTimers();
    const container = getDomDocument().createElement('div');
    let observerCb: ((entries: readonly { contentRect: { width: number; height: number } }[]) => void) | null = null;
    const origRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: typeof observerCb) {
        observerCb = cb;
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    try {
      const onDeferredInit = vi.fn();
      const onResize = vi.fn();
      const handle = observeSimplexContainerResize({
        container,
        pendingInitialViewport: true,
        shouldDeferSolve: true,
        deferFallbackTimeoutMs: 250,
        fallbackWidth: 720,
        fallbackHeight: 480,
        isDestroyed: () => false,
        onDeferredInit,
        onResize,
      });

      vi.advanceTimersByTime(250);
      expect(onDeferredInit).toHaveBeenCalledTimes(1);
      expect(onDeferredInit).toHaveBeenLastCalledWith(720, 480);

      // Subsequent real ResizeObserver entry performs clean deferred re-init when still unmeasured at timeout
      observerCb?.([{ contentRect: { width: 900, height: 600 } }]);
      expect(onDeferredInit).toHaveBeenCalledTimes(2);
      expect(onDeferredInit).toHaveBeenLastCalledWith(900, 600);

      // Further resizes invoke onResize
      observerCb?.([{ contentRect: { width: 1024, height: 700 } }]);
      expect(onResize).toHaveBeenCalledTimes(1);
      expect(onResize).toHaveBeenLastCalledWith(1024, 700);

      handle.disconnect();
    } finally {
      globalThis.ResizeObserver = origRO;
    }
  });

  it('resolves reduced motion preference and subscribes to live media changes', () => {
    const doc = getDomDocument();
    expect(resolveSimplexReducedMotion(true, doc)).toBe(true);
    expect(resolveSimplexReducedMotion(false, doc)).toBe(false);

    let listener: ((ev?: { matches?: boolean }) => void) | null = null;
    const mockWin = {
      matchMedia: vi.fn(() => ({
        matches: true,
        addEventListener: (_: 'change', fn: (ev?: { matches?: boolean }) => void) => {
          listener = fn;
        },
        removeEventListener: vi.fn(() => {
          listener = null;
        }),
      })),
    };
    const fakeDoc = { defaultView: mockWin } as unknown as Document;
    expect(resolveSimplexReducedMotion('auto', fakeDoc)).toBe(true);

    const onChange = vi.fn();
    const unsub = subscribeSimplexReducedMotionMedia('auto', fakeDoc, onChange);
    listener?.({ matches: false });
    expect(onChange).toHaveBeenCalledWith(false);
    unsub();
    expect(listener).toBeNull();
  });

  it('creates an accessible live-region announcer and cleans it up on destroy', () => {
    const doc = getDomDocument();
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const announcer = createSimplexSrAnnouncer(container, doc);

    expect(announcer.element.className).toBe('sv-sr-announcer');
    expect(announcer.element.getAttribute('aria-live')).toBe('polite');
    announcer.announce('Focused Alpha');
    expect(announcer.element.textContent).toBe('Focused Alpha');
    announcer.announce('Focused Alpha');
    expect(announcer.element.textContent).toBe('Focused Alpha');

    announcer.destroy();
    expect(container.querySelector('.sv-sr-announcer')).toBeNull();
  });

  it('computes edge-flipped tooltip coordinates and positions DOM tooltip elements', () => {
    const coordsDefault = computeSimplexTooltipCoords({
      containerWidth: 600,
      containerHeight: 400,
      tipWidth: 160,
      tipHeight: 50,
      screenX: 100,
      screenY: 100,
    });
    expect(coordsDefault).toEqual({ left: 114, top: 114 });

    // Near bottom-right corner flips cleanly to top-left of cursor
    const coordsFlipped = computeSimplexTooltipCoords({
      containerWidth: 600,
      containerHeight: 400,
      tipWidth: 160,
      tipHeight: 60,
      screenX: 560,
      screenY: 370,
    });
    expect(coordsFlipped).toEqual({ left: 386, top: 296 });

    const doc = getDomDocument();
    const container = doc.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 600 });
    Object.defineProperty(container, 'clientHeight', { value: 400 });
    const tip = doc.createElement('div');
    Object.defineProperty(tip, 'offsetWidth', { value: 160 });
    Object.defineProperty(tip, 'offsetHeight', { value: 60 });
    positionSimplexTooltipElement(container, tip, 560, 370);
    expect(tip.style.left).toBe('386px');
    expect(tip.style.top).toBe('296px');
  });

  it('builds shared tooltip models/text for content, cluster, and triangle targets', () => {
    const cluster: ClusterDescriptor<DefaultTaggedItem> = {
      clusterUid: 'cluster:0',
      clusterIndex: 0,
      code: 'T1',
      defaultLabel: 'Geometry',
      subclusterLabel: 'Mesh & Curvature',
      parentContextLabel: 'Mathematics',
      colorHex: '#38bdf8',
      tags: ['geometry'],
      members: [{ item: { id: 'i1', tags: ['geometry'] }, index: 0, itemId: 'i1' }],
      centroidAnchor: { x: 0, y: 0 },
      label: 'Geometry',
    } as unknown as ClusterDescriptor<DefaultTaggedItem>;

    const contentCtx: ContentLayoutContext<DefaultTaggedItem> = {
      id: 'i1',
      tags: [{ tag: 'geometry', weight: 1 }],
      unitClusters: [{ cluster, weight: 1 }],
      primaryCluster: cluster,
      barycentricCoords: [1, 0, 0],
      worldPosition: { x: 0, y: 0 },
      rank: 0,
      mixedColorHex: '#38bdf8',
    } as unknown as ContentLayoutContext<DefaultTaggedItem>;

    const contentText = formatSimplexTooltipText(
      {
        kind: 'content',
        item: { id: 'i1', label: 'Alpha Node', tags: ['geometry'] },
        visual: {},
        layoutContext: contentCtx,
        screenPosition: { x: 50, y: 50 },
        worldPosition: { x: 0, y: 0 },
      },
      { formatTagLabel: (t) => t.toUpperCase() },
    );
    expect(contentText).toBe('Alpha Node\nGEOMETRY');

    const clusterModel = buildSimplexTooltipContentModel(
      {
        kind: 'cluster',
        cluster,
        visual: {},
        screenPosition: { x: 80, y: 90 },
        worldPosition: { x: 0, y: 0 },
        neighborId: 'n-1',
      },
      { preferSubclusterLabel: true, neighborHint: 'Click to switch' },
    );
    expect(clusterModel).toEqual({
      kind: 'cluster',
      eyebrow: 'Mathematics',
      code: 'T1',
      label: 'Mesh & Curvature',
      title: 'T1 · Mesh & Curvature',
      accentColorHex: '#38bdf8',
      countText: '1 item',
      hint: 'Click to switch',
    });

    const triText = formatSimplexTooltipText(
      {
        kind: 'triangle',
        triangle: {
          index: 0,
          vertexIndices: [0, 1, 2],
          clusters: [cluster, null, null],
          coveredItemCount: 5,
          interiorItemCount: 3,
          isContext: false,
        },
        screenPosition: { x: 100, y: 100 },
        worldPosition: { x: 0, y: 0 },
      },
      {
        zoomMode: 'drill-down',
        zoomState: {
          mode: 'drill-down',
          depth: 0,
          canDrillUp: false,
          activeFrameKind: 'root',
          breadcrumbs: [],
          drillableTriangleIndices: [0],
          focusableTriangleIndices: [],
          drillableClusterUids: [],
        },
      },
    );
    expect(triText).toBe('Triangle #1 (T1 · V1 · V2)\n5 items\nClick to zoom in');
  });

  it('tracks drill-down pinch thresholds, keyboard focus wrap-around, zoomBy center, and left-click dispatch', () => {
    const state = { accum: 0, cooldownUntil: 0 };
    expect(stepSimplexDrillDownWheelPinch(state, -10, 100)).toBeNull();
    expect(stepSimplexDrillDownWheelPinch(state, -15, 110)).toBe('drill-in');
    // Respects cooldown window
    expect(stepSimplexDrillDownWheelPinch(state, 30, 200)).toBeNull();
    expect(stepSimplexDrillDownWheelPinch(state, 30, 600)).toBe('drill-up');

    expect(resolveNextSimplexKeyboardFocusIndex(0, -1, 'ArrowRight')).toBeNull();
    expect(resolveNextSimplexKeyboardFocusIndex(4, -1, 'ArrowRight')).toBe(0);
    expect(resolveNextSimplexKeyboardFocusIndex(4, 3, 'ArrowRight')).toBe(0);
    expect(resolveNextSimplexKeyboardFocusIndex(4, 0, 'ArrowLeft')).toBe(3);
    expect(resolveNextSimplexKeyboardFocusIndex(4, 1, 'End')).toBe(3);
    expect(resolveNextSimplexKeyboardFocusIndex(4, 2, 'Home')).toBe(0);

    const zoomSpy = vi.fn();
    const el = getDomDocument().createElement('div');
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 500 }),
    });
    zoomSimplexViewportByFactor(el, { zoomToCursor: zoomSpy }, 1.25);
    expect(zoomSpy).toHaveBeenCalledWith(400, 250, 1.25);

    const setFocusedClusterUid = vi.fn();
    const setFocusedTriangleIndex = vi.fn();
    const drillDownCluster = vi.fn(() => true);
    const drillUp = vi.fn(() => true);

    const clusterHit = {
      kind: 'cluster' as const,
      cluster: { clusterUid: 'c-1', defaultLabel: 'Alpha', members: [] } as unknown as ClusterDescriptor<DefaultTaggedItem>,
      visual: {},
      screenPosition: { x: 0, y: 0 },
      worldPosition: { x: 0, y: 0 },
    };

    dispatchSimplexDefaultLeftClick(clusterHit, makeDummyPointerEvent(), {
      zoomMode: 'free-camera',
      canDrillUp: false,
      selectedCount: 0,
      focusedItemId: null,
      focusedClusterUid: null,
      focusedTriangleIndex: 2,
      drillToNeighbor: () => false,
      drillDownTriangle: () => false,
      drillDownCluster,
      drillUp,
      setFocusedClusterUid,
      setFocusedTriangleIndex,
      clearFocusedItem: () => {},
      clearSelection: () => {},
    });
    expect(setFocusedTriangleIndex).toHaveBeenCalledWith(null);
    expect(setFocusedClusterUid).toHaveBeenCalledWith('c-1');

    dispatchSimplexDefaultLeftClick(
      { kind: 'background', screenPosition: { x: 0, y: 0 }, worldPosition: { x: 0, y: 0 } },
      makeDummyPointerEvent(),
      {
        zoomMode: 'drill-down',
        canDrillUp: true,
        selectedCount: 0,
        focusedItemId: null,
        focusedClusterUid: null,
        focusedTriangleIndex: null,
        drillToNeighbor: () => false,
        drillDownTriangle: () => false,
        drillDownCluster,
        drillUp,
        setFocusedClusterUid,
        setFocusedTriangleIndex,
        clearFocusedItem: () => {},
        clearSelection: () => {},
      },
    );
    expect(drillUp).toHaveBeenCalledTimes(1);

    const ariaLabel = formatSimplexInteractiveTargetAriaLabel(
      {
        kind: 'cluster',
        id: 'cluster:c-1',
        cluster: {
          clusterUid: 'c-1',
          clusterIndex: 1,
          defaultLabel: 'Alpha',
          subclusterLabel: 'Sub Alpha',
          members: [{}, {}],
        } as unknown as ClusterDescriptor<DefaultTaggedItem>,
        visual: {},
        isDrillable: true,
        isFocusable: false,
        isFocused: false,
      },
      {
        mode: 'drill-down',
        depth: 0,
        canDrillUp: false,
        activeFrameKind: 'root',
        breadcrumbs: [],
        drillableTriangleIndices: [],
        focusableTriangleIndices: [],
        drillableClusterUids: ['c-1'],
      },
    );
    expect(ariaLabel).toBe('Topic cluster: Sub Alpha, 2 items, press Enter to zoom in');
  });

  it('manages timeline notifiers and compares mesh/layout/timeline option bags accurately', () => {
    const notifier = createSimplexTimelineNotifier<DefaultTaggedItem>();
    const received: (SimplexTimelineState<DefaultTaggedItem> | null)[] = [];
    const unsub = notifier.subscribe((s) => received.push(s), null);
    expect(received).toEqual([null]);

    const fakeState = { step: 1 } as unknown as SimplexTimelineState<DefaultTaggedItem>;
    notifier.notify(fakeState);
    expect(received).toEqual([null, fakeState]);

    unsub();
    notifier.notify(null);
    expect(received).toHaveLength(2);
    notifier.clear();

    expect(areSimplexMeshOptionsEqual({ innerPadding: 10 }, { innerPadding: 10 })).toBe(true);
    expect(areSimplexMeshOptionsEqual({ innerPadding: 10 }, { innerPadding: 12 })).toBe(false);
    expect(areSimplexMeshOptionsEqual(undefined, {})).toBe(false);

    expect(
      areSimplexLayoutOptionsEqual(
        { clusterGapPx: 20, seed: 42 },
        { clusterGapPx: 20, seed: 42 },
      ),
    ).toBe(true);
    expect(
      areSimplexLayoutOptionsEqual({ clusterGapPx: 20 }, { clusterGapPx: 24 }),
    ).toBe(false);

    expect(
      areSimplexTimelineOptionsEqual(
        { showControls: true, speed: 1, getTimestamp: () => 2024 },
        { showControls: true, speed: 1, getTimestamp: () => 2025 },
      ),
    ).toBe(true);
    expect(
      areSimplexTimelineOptionsEqual(
        { showControls: true, speed: 1 },
        { showControls: false, speed: 1 },
      ),
    ).toBe(false);
    expect(areSimplexTimelineOptionsEqual(true, true)).toBe(true);
    expect(areSimplexTimelineOptionsEqual(true, false)).toBe(false);
  });
});
