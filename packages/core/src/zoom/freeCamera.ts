import {
  DEFAULT_FULL_SCALE_THRESHOLD,
  type SimplexZoomStrategy,
} from './types.js';

/**
 * Classic continuous camera pan/zoom strategy (wheel zoom-to-cursor, 2-finger pinch zoom,
 * pointer drag-to-pan, no mesh drill-down stack).
 */
export function createFreeCameraZoomStrategy<
  TItem = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> {
  return {
    name: 'free-camera',
    mode: 'free-camera',
    evaluateTargets(ctx) {
      const ids = ctx.frame.items.map((it) => it.id);
      let full = 0;
      for (const id of ids) {
        if ((ctx.itemScaleRatios.get(id) ?? 1) >= DEFAULT_FULL_SCALE_THRESHOLD) {
          full++;
        }
      }
      return {
        drillableTriangleIndices: [],
        focusableTriangleIndices: [],
        drillableClusterUids: [],
        isLeafReached: false,
        fullScaleItemRatio: ids.length > 0 ? full / ids.length : 1,
      };
    },
  };
}
