import type {
  CameraController,
  ClusterDescriptor,
  DefaultTaggedItem,
  FocusItemOptions,
  ItemFilterOptions,
  ItemFilterPredicate,
  ItemFilterState,
  LayoutMetrics,
  SimplexClusteringStrategy,
  SimplexColorStrategy,
  SimplexKeyboardFocusTarget,
  SimplexLayoutStrategy,
  SimplexMeshStrategy,
  SimplexTimelineController,
  SimplexZoomState,
  SimplexZoomStrategy,
  ZoomToItemOptions,
} from '@simplex-viz/core';
import type {
  SimplexSvgController,
  SimplexSvgUpdateOptions,
  SvgEdgeView,
  SvgTriangleView,
} from '@simplex-viz/svg';
import { useCallback, useRef } from 'react';

/**
 * Imperative handle bound to `<SimplexTopicGraph controllerRef={...} />`.
 */
export interface SimplexGraphHandle<
  TItem = DefaultTaggedItem,
  TContentVisual = unknown,
  TClusterVisual = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
> {
  addItems(items: TItem | readonly TItem[]): void;
  removeItems(ids: string | readonly string[]): void;
  setItems(items: readonly TItem[]): void;
  setMeshStrategy(strategy: SimplexMeshStrategy<TItem>): void;
  setClusteringStrategy(strategy: SimplexClusteringStrategy<TItem, TTagMeta>): void;
  setColorStrategy(strategy: SimplexColorStrategy<TItem, TTagMeta>): void;
  setLayoutStrategy(strategy: SimplexLayoutStrategy): void;
  setZoomStrategy(
    strategy: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>,
  ): void;
  setTriangleView(view: SvgTriangleView<TItem, TTagMeta, TClusterMeta>): void;
  setEdgeView(view: SvgEdgeView<TItem, TTagMeta, TClusterMeta>): void;
  setFocusedTriangleIndex(triangleIndex: number | null): void;
  drillDownTriangle(triangleIndex: number): boolean;
  drillDownCluster(clusterUid: string): boolean;
  drillToNeighbor(neighborId: string): boolean;
  drillUp(): boolean;
  drillToDepth(depth: number): boolean;
  drillToRoot(): boolean;
  getZoomState(): SimplexZoomState | null;
  resetCamera(): void;
  zoomBy(factor: number): void;
  batch<TResult>(fn: () => TResult): TResult | undefined;
  setOptions(
    options: SimplexSvgUpdateOptions<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >,
  ): void;
  setItemFilter(
    predicate: ItemFilterPredicate<TItem> | null,
    options?: ItemFilterOptions,
  ): void;
  getItemFilter(): ItemFilterState<TItem> | null;
  setHighlightedIds(ids: Iterable<string> | null): void;
  setHighlightedItems(ids: Iterable<string> | null): void;
  getHighlightedIds(): ReadonlySet<string>;
  getHighlightedItems(): ReadonlySet<string>;
  focusItem(
    itemId: string | null,
    options?: FocusItemOptions & { readonly announce?: boolean },
  ): boolean;
  getFocusedItemId(): string | null;
  zoomToItem(itemId: string, options?: ZoomToItemOptions): boolean;
  getKeyboardFocusTarget(): SimplexKeyboardFocusTarget | null;
  clearKeyboardFocus(): void;
  relayout(): void;
  getMetrics(): LayoutMetrics | null;
  getClusters(): readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[];
  getTimeline(): SimplexTimelineController<TItem> | null;
  getRawController(): SimplexSvgController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null;
}

/**
 * React hook returning a stable `controllerRef` and imperative transaction helpers
 * (`addItems`, `removeItems`, `setItems`, strategy setters, camera controls, and live telemetry getters).
 */
export function useSimplexGraphController<
  TItem = DefaultTaggedItem,
  TContentVisual = unknown,
  TClusterVisual = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(): {
  readonly controllerRef: React.MutableRefObject<SimplexSvgController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null>;
  readonly handle: SimplexGraphHandle<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >;
} {
  const controllerRef = useRef<SimplexSvgController<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  > | null>(null);

  const addItems = useCallback((items: TItem | readonly TItem[]) => {
    controllerRef.current?.addItems(items);
  }, []);

  const removeItems = useCallback((ids: string | readonly string[]) => {
    controllerRef.current?.removeItems(ids);
  }, []);

  const setItems = useCallback((items: readonly TItem[]) => {
    controllerRef.current?.setItems(items);
  }, []);

  const setMeshStrategy = useCallback((strategy: SimplexMeshStrategy<TItem>) => {
    controllerRef.current?.setMeshStrategy(strategy);
  }, []);

  const setClusteringStrategy = useCallback(
    (strategy: SimplexClusteringStrategy<TItem, TTagMeta>) => {
      controllerRef.current?.setClusteringStrategy(strategy);
    },
    [],
  );

  const setColorStrategy = useCallback(
    (strategy: SimplexColorStrategy<TItem, TTagMeta>) => {
      controllerRef.current?.setColorStrategy(strategy);
    },
    [],
  );

  const setLayoutStrategy = useCallback((strategy: SimplexLayoutStrategy) => {
    controllerRef.current?.setLayoutStrategy(strategy);
  }, []);

  const setZoomStrategy = useCallback(
    (strategy: SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta>) => {
      controllerRef.current?.setZoomStrategy(strategy);
    },
    [],
  );

  const setTriangleView = useCallback(
    (view: SvgTriangleView<TItem, TTagMeta, TClusterMeta>) => {
      controllerRef.current?.setTriangleView(view);
    },
    [],
  );

  const setEdgeView = useCallback(
    (view: SvgEdgeView<TItem, TTagMeta, TClusterMeta>) => {
      controllerRef.current?.setEdgeView(view);
    },
    [],
  );

  const setFocusedTriangleIndex = useCallback((triangleIndex: number | null) => {
    controllerRef.current?.setFocusedTriangleIndex(triangleIndex);
  }, []);

  const drillDownTriangle = useCallback((triangleIndex: number) => {
    return controllerRef.current?.drillDownTriangle(triangleIndex) ?? false;
  }, []);

  const drillDownCluster = useCallback((clusterUid: string) => {
    return controllerRef.current?.drillDownCluster(clusterUid) ?? false;
  }, []);

  const drillToNeighbor = useCallback((neighborId: string) => {
    return controllerRef.current?.drillToNeighbor(neighborId) ?? false;
  }, []);

  const drillUp = useCallback(() => {
    return controllerRef.current?.drillUp() ?? false;
  }, []);

  const drillToDepth = useCallback((depth: number) => {
    return controllerRef.current?.drillToDepth(depth) ?? false;
  }, []);

  const drillToRoot = useCallback(() => {
    return controllerRef.current?.drillToRoot() ?? false;
  }, []);

  const getZoomState = useCallback(() => {
    return controllerRef.current?.getZoomState() ?? null;
  }, []);

  const resetCamera = useCallback(() => {
    controllerRef.current?.camera.reset();
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    const svg = ctrl.getSvgElement();
    const rect = svg.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : svg.clientWidth || 960;
    const height = rect.height > 0 ? rect.height : svg.clientHeight || 620;
    const cam: CameraController = ctrl.camera;
    cam.zoomToCursor(width / 2, height / 2, factor);
  }, []);

  const batch = useCallback(<TResult,>(fn: () => TResult): TResult | undefined => {
    return controllerRef.current?.batch(fn);
  }, []);

  const setOptions = useCallback(
    (
      options: SimplexSvgUpdateOptions<
        TItem,
        TContentVisual,
        TClusterVisual,
        TTagMeta,
        TClusterMeta
      >,
    ) => {
      controllerRef.current?.setOptions(options);
    },
    [],
  );

  const setItemFilter = useCallback(
    (
      predicate: ItemFilterPredicate<TItem> | null,
      options?: ItemFilterOptions,
    ) => {
      controllerRef.current?.setItemFilter(predicate, options);
    },
    [],
  );

  const getItemFilter = useCallback(() => {
    return controllerRef.current?.getItemFilter() ?? null;
  }, []);

  const setHighlightedIds = useCallback((ids: Iterable<string> | null) => {
    controllerRef.current?.setHighlightedIds(ids);
  }, []);

  const setHighlightedItems = useCallback((ids: Iterable<string> | null) => {
    controllerRef.current?.setHighlightedItems(ids);
  }, []);

  const getHighlightedIds = useCallback((): ReadonlySet<string> => {
    return controllerRef.current?.getHighlightedIds() ?? new Set();
  }, []);

  const getHighlightedItems = useCallback((): ReadonlySet<string> => {
    return controllerRef.current?.getHighlightedItems() ?? new Set();
  }, []);

  const focusItem = useCallback(
    (
      itemId: string | null,
      options?: FocusItemOptions & { readonly announce?: boolean },
    ): boolean => {
      return controllerRef.current?.focusItem(itemId, options) ?? false;
    },
    [],
  );

  const getFocusedItemId = useCallback((): string | null => {
    return controllerRef.current?.getFocusedItemId() ?? null;
  }, []);

  const zoomToItem = useCallback(
    (itemId: string, options?: ZoomToItemOptions): boolean => {
      return controllerRef.current?.zoomToItem(itemId, options) ?? false;
    },
    [],
  );

  const getKeyboardFocusTarget = useCallback(() => {
    return controllerRef.current?.getKeyboardFocusTarget() ?? null;
  }, []);

  const clearKeyboardFocus = useCallback(() => {
    controllerRef.current?.clearKeyboardFocus();
  }, []);

  const relayout = useCallback(() => {
    controllerRef.current?.relayout();
  }, []);

  const getMetrics = useCallback(() => {
    return controllerRef.current?.getMetrics() ?? null;
  }, []);

  const getClusters = useCallback(() => {
    return controllerRef.current?.getClusters() ?? [];
  }, []);

  const getTimeline = useCallback(() => {
    return controllerRef.current?.getTimeline() ?? null;
  }, []);

  const getRawController = useCallback(() => {
    return controllerRef.current;
  }, []);

  return {
    controllerRef,
    handle: {
      addItems,
      removeItems,
      setItems,
      setMeshStrategy,
      setClusteringStrategy,
      setColorStrategy,
      setLayoutStrategy,
      setZoomStrategy,
      setTriangleView,
      setEdgeView,
      setFocusedTriangleIndex,
      drillDownTriangle,
      drillDownCluster,
      drillToNeighbor,
      drillUp,
      drillToDepth,
      drillToRoot,
      getZoomState,
      resetCamera,
      zoomBy,
      batch,
      setOptions,
      setItemFilter,
      getItemFilter,
      setHighlightedIds,
      setHighlightedItems,
      getHighlightedIds,
      getHighlightedItems,
      focusItem,
      getFocusedItemId,
      zoomToItem,
      getKeyboardFocusTarget,
      clearKeyboardFocus,
      relayout,
      getMetrics,
      getClusters,
      getTimeline,
      getRawController,
    },
  };
}
