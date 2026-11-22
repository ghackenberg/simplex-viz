import type {
  ClusterDescriptor,
  DefaultTaggedItem,
  FocusItemOptions,
  ItemFilterOptions,
  ItemFilterPredicate,
  ItemFilterState,
  LayoutMetrics,
  ReducedMotionPreference,
  RestoreViewStateOptions,
  SelectInRectOptions,
  SimplexClusteringStrategy,
  SimplexColorStrategy,
  SimplexKeyboardFocusTarget,
  SimplexLayoutStrategy,
  SimplexLegendModel,
  SimplexLegendModelOptions,
  SimplexMeshStrategy,
  SimplexTimelineController,
  SimplexTimelineState,
  SimplexViewState,
  SimplexZoomState,
  SimplexZoomStrategy,
  ZoomToItemOptions,
} from '@simplex-viz/core';
import { zoomSimplexViewportByFactor } from '@simplex-viz/core/dom';
import type {
  ExportPngBlobOptions,
  ExportPngDataUrlOptions,
  ExportPngOptions,
  ExportSvgOptions,
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
  getHighlightedIds(): ReadonlySet<string>;
  setSelectedIds(ids: Iterable<string> | null): void;
  toggleSelectedId(id: string): boolean;
  clearSelection(): void;
  getSelectedIds(): ReadonlySet<string>;
  selectItemsInScreenRect(
    rect: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    },
    options?: SelectInRectOptions,
  ): ReadonlySet<string>;
  selectItemsInScreenRect(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: SelectInRectOptions,
  ): ReadonlySet<string>;
  focusItem(
    itemId: string | null,
    options?: FocusItemOptions & { readonly announce?: boolean },
  ): boolean;
  getFocusedItemId(): string | null;
  zoomToItem(itemId: string, options?: ZoomToItemOptions): boolean;
  getKeyboardFocusTarget(): SimplexKeyboardFocusTarget | null;
  clearKeyboardFocus(): void;
  setReducedMotion(preference: ReducedMotionPreference): void;
  getReducedMotion(): ReducedMotionPreference;
  isReducedMotionActive(): boolean;
  getViewState(): SimplexViewState | null;
  restoreViewState(
    state: Partial<SimplexViewState> | null | undefined,
    options?: RestoreViewStateOptions,
  ): boolean;
  relayout(): void;
  exportSvg(options?: ExportSvgOptions): string | null;
  exportPng(options: ExportPngDataUrlOptions): Promise<string | null>;
  exportPng(options?: ExportPngBlobOptions): Promise<Blob | null>;
  exportPng(options?: ExportPngOptions): Promise<Blob | string | null>;
  getMetrics(): LayoutMetrics | null;
  getClusters(): readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[];
  getLegendModel(
    options?: SimplexLegendModelOptions,
  ): SimplexLegendModel<TItem, TTagMeta, TClusterMeta> | null;
  getTimeline(): SimplexTimelineController<TItem> | null;
  subscribeTimeline(
    listener: (state: SimplexTimelineState<TItem> | null) => void,
  ): () => void;
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
    zoomSimplexViewportByFactor(ctrl.getSvgElement(), ctrl.camera, factor, 960, 620);
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

  const getHighlightedIds = useCallback((): ReadonlySet<string> => {
    return controllerRef.current?.getHighlightedIds() ?? new Set();
  }, []);

  const setSelectedIds = useCallback((ids: Iterable<string> | null) => {
    controllerRef.current?.setSelectedIds(ids);
  }, []);

  const toggleSelectedId = useCallback((id: string): boolean => {
    return controllerRef.current?.toggleSelectedId(id) ?? false;
  }, []);

  const clearSelection = useCallback(() => {
    controllerRef.current?.clearSelection();
  }, []);

  const getSelectedIds = useCallback((): ReadonlySet<string> => {
    return controllerRef.current?.getSelectedIds() ?? new Set();
  }, []);

  const selectItemsInScreenRect = useCallback(
    ((
      rectOrX1:
        | number
        | {
            readonly x: number;
            readonly y: number;
            readonly width: number;
            readonly height: number;
          },
      y1OrOptions?: number | SelectInRectOptions,
      x2?: number,
      y2?: number,
      options?: SelectInRectOptions,
    ): ReadonlySet<string> => {
      const ctrl = controllerRef.current;
      if (!ctrl) return new Set();
      if (typeof rectOrX1 === 'object' && rectOrX1 !== null) {
        return ctrl.selectItemsInScreenRect(
          rectOrX1,
          y1OrOptions as SelectInRectOptions | undefined,
        );
      }
      return ctrl.selectItemsInScreenRect(
        rectOrX1,
        y1OrOptions as number,
        x2 as number,
        y2 as number,
        options,
      );
    }) as SimplexGraphHandle<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >['selectItemsInScreenRect'],
    [],
  );

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

  const setReducedMotion = useCallback((preference: ReducedMotionPreference) => {
    controllerRef.current?.setReducedMotion(preference);
  }, []);

  const getReducedMotion = useCallback((): ReducedMotionPreference => {
    return controllerRef.current?.getReducedMotion() ?? 'auto';
  }, []);

  const isReducedMotionActive = useCallback((): boolean => {
    return controllerRef.current?.isReducedMotionActive() ?? false;
  }, []);

  const getViewState = useCallback((): SimplexViewState | null => {
    return controllerRef.current?.getViewState() ?? null;
  }, []);

  const restoreViewState = useCallback(
    (
      state: Partial<SimplexViewState> | null | undefined,
      options?: RestoreViewStateOptions,
    ): boolean => {
      return controllerRef.current?.restoreViewState(state, options) ?? false;
    },
    [],
  );

  const relayout = useCallback(() => {
    controllerRef.current?.relayout();
  }, []);

  const exportSvg = useCallback((options?: ExportSvgOptions): string | null => {
    return controllerRef.current?.exportSvg(options) ?? null;
  }, []);

  const exportPng = useCallback(
    ((options?: ExportPngOptions): Promise<Blob | string | null> => {
      const ctrl = controllerRef.current;
      if (!ctrl) return Promise.resolve(null);
      return ctrl.exportPng(options);
    }) as SimplexGraphHandle<
      TItem,
      TContentVisual,
      TClusterVisual,
      TTagMeta,
      TClusterMeta
    >['exportPng'],
    [],
  );

  const getMetrics = useCallback(() => {
    return controllerRef.current?.getMetrics() ?? null;
  }, []);

  const getClusters = useCallback(() => {
    return controllerRef.current?.getClusters() ?? [];
  }, []);

  const getLegendModel = useCallback((options?: SimplexLegendModelOptions) => {
    return controllerRef.current?.getLegendModel(options) ?? null;
  }, []);

  const getTimeline = useCallback(() => {
    return controllerRef.current?.getTimeline() ?? null;
  }, []);

  const subscribeTimeline = useCallback(
    (listener: (state: SimplexTimelineState<TItem> | null) => void): (() => void) => {
      const ctrl = controllerRef.current;
      if (!ctrl) {
        listener(null);
        return () => {};
      }
      return ctrl.subscribeTimeline(listener);
    },
    [],
  );

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
      getHighlightedIds,
      setSelectedIds,
      toggleSelectedId,
      clearSelection,
      getSelectedIds,
      selectItemsInScreenRect,
      focusItem,
      getFocusedItemId,
      zoomToItem,
      getKeyboardFocusTarget,
      clearKeyboardFocus,
      setReducedMotion,
      getReducedMotion,
      isReducedMotionActive,
      getViewState,
      restoreViewState,
      relayout,
      exportSvg,
      exportPng,
      getMetrics,
      getClusters,
      getLegendModel,
      getTimeline,
      subscribeTimeline,
      getRawController,
    },
  };
}
