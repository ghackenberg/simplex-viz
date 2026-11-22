import { extractSimplexItemLabel } from '../presetShared.js';
import type {
  ClusterDescriptor,
  MeshTriangleRenderState,
  SimplexInteractiveTarget,
  TagDescriptor,
} from '../types.js';
import type { SimplexZoomState } from '../zoom.js';
import {
  asContainerOps,
  getGlobalEnv,
  type SimplexDomDivLike,
  type SimplexDomDocumentLike,
  type SimplexDomElementLike,
} from './types.js';

// ============================================================================
// Screen-Reader Live Region & Accessibility Labels
// ============================================================================

export interface SimplexSrAnnouncerHandle {
  readonly element: SimplexDomDivLike;
  announce(message: string): void;
  destroy(): void;
}

export function createSimplexSrAnnouncer(
  container: SimplexDomElementLike,
  doc?: SimplexDomDocumentLike | null,
): SimplexSrAnnouncerHandle {
  const resolvedDoc = doc ?? container.ownerDocument ?? getGlobalEnv().document;
  if (!resolvedDoc) {
    throw new Error('createSimplexSrAnnouncer(): no Document available.');
  }
  const el = resolvedDoc.createElement('div');
  el.className = 'sv-sr-announcer';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.style.position = 'absolute';
  el.style.width = '1px';
  el.style.height = '1px';
  el.style.padding = '0';
  el.style.margin = '-1px';
  el.style.overflow = 'hidden';
  el.style.clip = 'rect(0, 0, 0, 0)';
  el.style.clipPath = 'inset(50%)';
  el.style.whiteSpace = 'nowrap';
  el.style.border = '0';
  el.style.pointerEvents = 'none';
  const ops = asContainerOps(container);
  ops.appendChild(el);

  return {
    element: el,
    announce(message: string): void {
      if (!message) return;
      if (el.textContent === message) {
        el.textContent = '';
      }
      el.textContent = message;
    },
    destroy(): void {
      if (el.parentElement === container) {
        ops.removeChild(el);
      }
    },
  };
}

export function computeSimplexZoomAnnouncementSignature(
  state: SimplexZoomState,
): string {
  return `${state.mode}:${state.depth}:${state.activeFrameKind}:${state.breadcrumbs
    .map((b) => b.label)
    .join('>')}`;
}

export interface SimplexTargetAriaMetadata {
  readonly role?: string;
  readonly label?: string;
  readonly pressed?: boolean;
  readonly hidden?: boolean;
}

export function formatSimplexClusterAriaMetadata<
  TItem,
  TTagMeta,
  TClusterMeta,
>(
  cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
  zoomState: SimplexZoomState,
  options?: {
    readonly isDrillable?: boolean;
    readonly isFocused?: boolean;
  },
): SimplexTargetAriaMetadata {
  const name = cluster.subclusterLabel || cluster.defaultLabel;
  const count = cluster.members.length;
  const isDrillable =
    options?.isDrillable ??
    (zoomState.mode === 'drill-down' &&
      zoomState.drillableClusterUids.includes(cluster.clusterUid));
  const isClusterStarCenter =
    zoomState.mode === 'drill-down' &&
    zoomState.activeFrameKind === 'cluster-star' &&
    cluster.clusterIndex === 0 &&
    zoomState.canDrillUp;
  const actionHint =
    zoomState.mode === 'drill-down'
      ? isClusterStarCenter
        ? ', press Enter to zoom out'
        : isDrillable
          ? ', press Enter to zoom in'
          : ''
      : options?.isFocused
        ? ', focused'
        : '';
  return {
    role: 'button',
    label: `Topic cluster: ${name}, ${count} ${count === 1 ? 'item' : 'items'}${actionHint}`,
    pressed: options?.isFocused ? true : undefined,
  };
}

export function formatSimplexItemAriaMetadata<TItem, TTagMeta, TClusterMeta>(
  item: TItem,
  layoutContext: {
    readonly id: string;
    readonly tags: readonly TagDescriptor<TTagMeta>[];
    readonly unitClusters: ReadonlyArray<{
      readonly cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>;
    }>;
  },
  options?: {
    readonly getLabel?: (item: TItem) => string;
    readonly formatTagLabel?: (tag: string) => string;
    readonly isFilteredDimmed?: boolean;
  },
): SimplexTargetAriaMetadata {
  const title = extractSimplexItemLabel(
    item,
    layoutContext.id,
    options?.getLabel,
  );
  const tagSummary =
    layoutContext.tags.length > 0
      ? layoutContext.tags
          .slice(0, 3)
          .map((t) => {
            if (t.label) return t.label;
            if (options?.formatTagLabel) {
              const formatted = options.formatTagLabel(t.tag).trim();
              if (formatted.length > 0) return formatted;
            }
            return t.tag;
          })
          .join(', ')
      : layoutContext.unitClusters
          .slice(0, 3)
          .map((uc) => uc.cluster.defaultLabel)
          .join(', ');
  const filterNote = options?.isFilteredDimmed ? ', dimmed by filter' : '';
  return {
    role: 'button',
    label: `Item: ${title}${tagSummary ? `, ${tagSummary}` : ''}${filterNote}`,
  };
}

export function formatSimplexTriangleAriaMetadata<TItem, TTagMeta, TClusterMeta>(
  triangle: Pick<
    MeshTriangleRenderState<TItem, TTagMeta, TClusterMeta>,
    'index' | 'clusters' | 'vertexIndices' | 'coveredItemCount'
  >,
  zoomState: SimplexZoomState,
  options?: {
    readonly isDrillable?: boolean;
    readonly isFocusable?: boolean;
    readonly isFocused?: boolean;
    readonly hideEmptyUninteractive?: boolean;
  },
): SimplexTargetAriaMetadata {
  const isDrillable =
    options?.isDrillable ??
    (zoomState.mode === 'drill-down' &&
      zoomState.drillableTriangleIndices.includes(triangle.index));
  const isFocusable =
    options?.isFocusable ??
    (zoomState.mode === 'drill-down' &&
      zoomState.focusableTriangleIndices.includes(triangle.index));
  if (
    options?.hideEmptyUninteractive &&
    !isDrillable &&
    !isFocusable &&
    triangle.coveredItemCount === 0
  ) {
    return { hidden: true };
  }
  const corners = triangle.clusters
    .map((c, idx) =>
      c ? c.defaultLabel : `Vertex ${triangle.vertexIndices[idx] ?? idx}`,
    )
    .join(', ');
  const count = triangle.coveredItemCount;
  const actionHint = isDrillable
    ? ', press Enter to zoom in'
    : isFocusable
      ? ', press Enter to focus'
      : options?.isFocused
        ? ', focused'
        : '';
  return {
    role: 'button',
    label: `Region: ${corners}, ${count} ${count === 1 ? 'item' : 'items'}${actionHint}`,
    pressed: options?.isFocused ? true : undefined,
  };
}

export function formatSimplexInteractiveTargetAriaLabel<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  target: SimplexInteractiveTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >,
  zoomState: SimplexZoomState,
  options?: {
    readonly getLabel?: (item: TItem) => string;
    readonly formatTagLabel?: (tag: string) => string;
  },
): string {
  if (target.kind === 'cluster') {
    return (
      formatSimplexClusterAriaMetadata(target.cluster, zoomState, {
        isDrillable: target.isDrillable,
        isFocused: target.isFocused,
      }).label ?? ''
    );
  }

  if (target.kind === 'triangle') {
    return (
      formatSimplexTriangleAriaMetadata(target.triangle, zoomState, {
        isDrillable: target.isDrillable,
        isFocusable: target.isFocusable,
        isFocused: target.isFocused,
      }).label ?? ''
    );
  }

  return (
    formatSimplexItemAriaMetadata(target.item, target.layoutContext, {
      getLabel: options?.getLabel,
      formatTagLabel: options?.formatTagLabel,
      isFilteredDimmed: target.isFilteredDimmed,
    }).label ?? ''
  );
}

export function formatSimplexZoomLevelAnnouncement<
  TItem,
  TContentVisual,
  TClusterVisual,
  TTagMeta,
  TClusterMeta,
>(
  state: SimplexZoomState,
  targets: readonly SimplexInteractiveTarget<
    TItem,
    TContentVisual,
    TClusterVisual,
    TTagMeta,
    TClusterMeta
  >[],
): string {
  const clusterCount = targets.filter((t) => t.kind === 'cluster').length;
  const itemCount = targets.filter((t) => t.kind === 'item').length;
  const triangleCount = targets.filter((t) => t.kind === 'triangle').length;
  const pathText = state.breadcrumbs.map((b) => b.label).join(' › ');
  const countsParts: string[] = [];
  if (clusterCount > 0) {
    countsParts.push(
      `${clusterCount} ${clusterCount === 1 ? 'cluster' : 'clusters'}`,
    );
  }
  if (triangleCount > 0) {
    countsParts.push(
      `${triangleCount} ${triangleCount === 1 ? 'region' : 'regions'}`,
    );
  }
  if (itemCount > 0) {
    countsParts.push(`${itemCount} ${itemCount === 1 ? 'item' : 'items'}`);
  }
  const countsText = countsParts.join(', ');

  if (state.depth === 0) {
    return `Zoom level 0: ${pathText || 'Overview'}${countsText ? `. ${countsText}` : ''}.`;
  }
  return `Zoom level ${state.depth}: ${pathText}${countsText ? `. ${countsText}` : ''}. Press Escape to zoom out.`;
}
