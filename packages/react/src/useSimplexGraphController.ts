import type {
  CameraController,
  ClusterDescriptor,
  DefaultTaggedItem,
  LayoutMetrics,
} from '@simplex-viz/core';
import type { SimplexSvgController } from '@simplex-viz/svg';
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
  resetCamera(): void;
  zoomBy(factor: number): void;
  getMetrics(): LayoutMetrics | null;
  getClusters(): readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[];
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
 * (`addItems`, `removeItems`, `setItems`, camera controls, and live telemetry getters).
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

  const resetCamera = useCallback(() => {
    controllerRef.current?.camera.reset();
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    const svg = ctrl.getSvgElement();
    const rect = svg.getBoundingClientRect();
    const cam: CameraController = ctrl.camera;
    cam.zoomToCursor(rect.width / 2, rect.height / 2, factor);
  }, []);

  const getMetrics = useCallback(() => {
    return controllerRef.current?.getMetrics() ?? null;
  }, []);

  const getClusters = useCallback(() => {
    return controllerRef.current?.getClusters() ?? [];
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
      resetCamera,
      zoomBy,
      getMetrics,
      getClusters,
      getRawController,
    },
  };
}
