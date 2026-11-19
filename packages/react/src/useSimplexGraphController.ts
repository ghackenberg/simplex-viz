import type {
  CameraController,
  ClusterDescriptor,
  DefaultTaggedItem,
  LayoutMetrics,
  SimplexClusteringStrategy,
  SimplexColorStrategy,
  SimplexLayoutStrategy,
  SimplexMeshStrategy,
  SimplexTimelineController,
  SimplexZoomState,
  SimplexZoomStrategy,
} from '@simplex-viz/core';
import type {
  SimplexSvgController,
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
      relayout,
      getMetrics,
      getClusters,
      getTimeline,
      getRawController,
    },
  };
}
