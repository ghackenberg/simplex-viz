import { mixOklabColors, type OklabTuple } from '../oklab.js';
import { truncateSimplexBadgeTitle } from '../presetShared.js';
import type {
  ClusterDerivationContext,
  ClusterDescriptor,
  ClusterMixComponent,
  ClusterRole,
  Point2D,
  SimplexMesh,
  TagDescriptor,
} from '../types.js';
import {
  bboxOverlapsViewport,
  buildIncidentStarMesh,
  buildOrientedSingleTriangleMeshWithTransform,
  computeContextAwarePadding,
  pointNearViewport,
} from './geometry.js';
import {
  MAX_ZOOM_DRILL_DEPTH,
  type InternalFrameMeta,
  type ViewportAffineTransform,
  type ZoomBreadcrumbSegment,
  type ZoomClusterDrillContext,
  type ZoomContextCluster,
  type ZoomContextEdge,
  type ZoomContextItem,
  type ZoomContextTriangle,
  type ZoomDrillOutcome,
  type ZoomFrameSpec,
  type ZoomItemAnchorInput,
  type ZoomNeighborTarget,
  type ZoomSharedHelpers,
  type ZoomTriangleDrillContext,
} from './types.js';

export function defaultClusterCode(index: number): string {
  return `T${index + 1}`;
}

export function normalizeWeightMap(
  raw: ReadonlyMap<number, number>,
): Map<number, number> {
  const out = new Map<number, number>();
  let total = 0;
  for (const [k, v] of raw) {
    if (v > 1e-6) {
      out.set(k, v);
      total += v;
    }
  }
  if (total <= 1e-9) return out;
  for (const [k, v] of out) {
    const w = v / total;
    if (w > 1e-5) {
      out.set(k, w);
    } else {
      out.delete(k);
    }
  }
  return out;
}

export function mixRootWeightMaps(
  a: ReadonlyMap<number, number>,
  wa: number,
  b: ReadonlyMap<number, number>,
  wb: number,
  c?: ReadonlyMap<number, number>,
  wc = 0,
): Map<number, number> {
  const sum = new Map<number, number>();
  for (const [k, v] of a) sum.set(k, (sum.get(k) ?? 0) + v * wa);
  for (const [k, v] of b) sum.set(k, (sum.get(k) ?? 0) + v * wb);
  if (c && wc > 0) {
    for (const [k, v] of c) sum.set(k, (sum.get(k) ?? 0) + v * wc);
  }
  return normalizeWeightMap(sum);
}

export function getFrameVertexRootWeights<TItem, TTagMeta, TClusterMeta>(
  frame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  vertexIdx: number,
): ReadonlyMap<number, number> {
  const meta = frame.strategyData as InternalFrameMeta | undefined;
  const fromMeta = meta?.vertexWeights[vertexIdx]?.rootWeights;
  if (fromMeta) return fromMeta;
  return new Map<number, number>([[vertexIdx, 1]]);
}

export function getItemRootWeights<TItem, TTagMeta, TClusterMeta>(
  frame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  item: ZoomItemAnchorInput<TItem, TTagMeta>,
): ReadonlyMap<number, number> {
  const meta = frame.strategyData as InternalFrameMeta | undefined;
  const direct = meta?.itemRootWeights?.get(item.id);
  if (direct) return direct;

  const out = new Map<number, number>();
  for (const uw of item.unitWeights) {
    const vWeights = getFrameVertexRootWeights(frame, uw.clusterIndex);
    for (const [rootIdx, rw] of vWeights) {
      out.set(rootIdx, (out.get(rootIdx) ?? 0) + rw * uw.weight);
    }
  }
  return normalizeWeightMap(out);
}

/**
 * Solves exact 3D/Simplex barycentric coordinates `(λ0, λ1, λ2)` of `targetWeights`
 * as a convex combination of 3 triangle corner weight distributions `(w0, w1, w2)`.
 * Returns `null` if `targetWeights` lies materially outside the simplex spanned by `(w0, w1, w2)`.
 */
export function projectRootWeightsOntoTriangleCorners(
  targetWeights: ReadonlyMap<number, number>,
  w0: ReadonlyMap<number, number>,
  w1: ReadonlyMap<number, number>,
  w2: ReadonlyMap<number, number>,
): { readonly l0: number; readonly l1: number; readonly l2: number } | null {
  const allKeys = new Set<number>([
    ...targetWeights.keys(),
    ...w0.keys(),
    ...w1.keys(),
    ...w2.keys(),
  ]);
  const keys = [...allKeys];
  if (keys.length === 0) return null;

  // Solve min || l0*w0 + l1*w1 + l2*w2 - target ||^2  s.t. l0+l1+l2=1, l >= 0
  // Express l0 = 1 - u - v, l1 = u, l2 = v -> 2D least squares over (u, v)
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  for (const k of keys) {
    const t = targetWeights.get(k) ?? 0;
    const x0 = w0.get(k) ?? 0;
    const d1 = (w1.get(k) ?? 0) - x0;
    const d2 = (w2.get(k) ?? 0) - x0;
    const rhs = t - x0;
    a11 += d1 * d1;
    a12 += d1 * d2;
    a22 += d2 * d2;
    b1 += d1 * rhs;
    b2 += d2 * rhs;
  }

  const det = a11 * a22 - a12 * a12;
  let l0: number;
  let l1: number;
  let l2: number;

  if (det > 1e-10) {
    const u = (b1 * a22 - b2 * a12) / det;
    const v = (a11 * b2 - a12 * b1) / det;
    l1 = u;
    l2 = v;
    l0 = 1 - u - v;
  } else {
    // Degenerate / collinear corners: fall back to 1D edge projection
    let bestEdge = { l0: 1, l1: 0, l2: 0, errSq: Infinity };
    const candidates: readonly [
      number,
      number,
      number,
      ReadonlyMap<number, number>,
      ReadonlyMap<number, number>,
    ][] = [
      [0, 1, 2, w0, w1],
      [1, 2, 0, w1, w2],
      [2, 0, 1, w2, w0],
    ];
    for (const [iA, iB, _iC, mapA, mapB] of candidates) {
      let denom = 0;
      let num = 0;
      for (const k of keys) {
        const diff = (mapB.get(k) ?? 0) - (mapA.get(k) ?? 0);
        const rhs = (targetWeights.get(k) ?? 0) - (mapA.get(k) ?? 0);
        denom += diff * diff;
        num += diff * rhs;
      }
      const t = denom > 1e-9 ? Math.max(0, Math.min(1, num / denom)) : 0;
      let errSq = 0;
      for (const k of keys) {
        const val =
          (mapA.get(k) ?? 0) * (1 - t) +
          (mapB.get(k) ?? 0) * t -
          (targetWeights.get(k) ?? 0);
        errSq += val * val;
      }
      if (errSq < bestEdge.errSq) {
        const arr = [0, 0, 0];
        arr[iA] = 1 - t;
        arr[iB] = t;
        bestEdge = { l0: arr[0]!, l1: arr[1]!, l2: arr[2]!, errSq };
      }
    }
    l0 = bestEdge.l0;
    l1 = bestEdge.l1;
    l2 = bestEdge.l2;
  }

  // Clamp tiny numerical noise to exact [0, 1] simplex; reject if far outside
  if (l0 < -0.025 || l1 < -0.025 || l2 < -0.025) {
    return null;
  }
  const c0 = Math.max(0, l0);
  const c1 = Math.max(0, l1);
  const c2 = Math.max(0, l2);
  const sum = c0 + c1 + c2;
  if (sum <= 1e-9) return null;
  const n0 = c0 / sum;
  const n1 = c1 / sum;
  const n2 = c2 / sum;

  // Verify reconstruction residual across root dimensions
  let errSq = 0;
  for (const k of keys) {
    const recon =
      n0 * (w0.get(k) ?? 0) +
      n1 * (w1.get(k) ?? 0) +
      n2 * (w2.get(k) ?? 0);
    const diff = recon - (targetWeights.get(k) ?? 0);
    errSq += diff * diff;
  }
  if (errSq > 1e-4) {
    return null;
  }

  return { l0: n0, l1: n1, l2: n2 };
}

/**
 * Projects an item's root-weight distribution onto a parent triangle `(v0, v1, v2)`,
 * falling back cleanly to normalized local `unitWeights` if the affine inverse check misses.
 */
export function projectItemOntoTriangleBarycentric<TItem, TTagMeta, TClusterMeta>(
  parentFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  item: ZoomItemAnchorInput<TItem, TTagMeta>,
  v0: number,
  v1: number,
  v2: number,
  w0Base: ReadonlyMap<number, number>,
  w1Base: ReadonlyMap<number, number>,
  w2Base: ReadonlyMap<number, number>,
): {
  readonly rootWeights: ReadonlyMap<number, number>;
  readonly l0: number;
  readonly l1: number;
  readonly l2: number;
} {
  const rw = getItemRootWeights(parentFrame, item);
  const proj = projectRootWeightsOntoTriangleCorners(rw, w0Base, w1Base, w2Base);
  if (proj) {
    return { rootWeights: rw, ...proj };
  }
  let l0 = 0;
  let l1 = 0;
  let l2 = 0;
  for (const uw of item.unitWeights) {
    if (uw.clusterIndex === v0) l0 += uw.weight;
    else if (uw.clusterIndex === v1) l1 += uw.weight;
    else if (uw.clusterIndex === v2) l2 += uw.weight;
  }
  const s = l0 + l1 + l2 || 1;
  return { rootWeights: rw, l0: l0 / s, l1: l1 / s, l2: l2 / s };
}

export function isItemCoveredByVertices<TItem, TTagMeta, TClusterMeta>(
  _frame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  item: ZoomItemAnchorInput<TItem, TTagMeta>,
  vertexSet: ReadonlySet<number>,
): boolean {
  if (item.unitWeights.length === 0) return false;
  return item.unitWeights.every((uw) => vertexSet.has(uw.clusterIndex));
}

export function buildSynthesizedClusterDescriptor<TItem, TTagMeta, TClusterMeta>(params: {
  readonly clusterIndex: number;
  readonly clusterUid: string;
  readonly code: string;
  readonly defaultLabel: string;
  readonly oklab: OklabTuple;
  readonly hex: string;
  readonly vertex: {
    readonly row: number;
    readonly col: number;
    readonly x: number;
    readonly y: number;
  };
  readonly coreTags: readonly TagDescriptor<TTagMeta>[];
  readonly sharedTags: readonly TagDescriptor<TTagMeta>[];
  readonly members: ClusterDescriptor<
    TItem,
    TTagMeta,
    TClusterMeta
  >['members'];
  readonly featureSummary?: string;
  readonly role?: ClusterRole;
  readonly mixWeights?: readonly ClusterMixComponent[];
  readonly subclusterLabel?: string;
  readonly parentContextLabel?: string;
  readonly preservePrimaryTitle?: string;
  readonly deriveClusterMeta: (
    ctx: ClusterDerivationContext<TItem, TTagMeta>,
  ) => TClusterMeta;
}): ClusterDescriptor<TItem, TTagMeta, TClusterMeta> {
  const ctx: ClusterDerivationContext<TItem, TTagMeta> = {
    clusterIndex: params.clusterIndex,
    clusterUid: params.clusterUid,
    code: params.code,
    defaultLabel: params.defaultLabel,
    colorHex: params.hex,
    oklab: params.oklab,
    gridNode: {
      row: params.vertex.row,
      col: params.vertex.col,
      x: params.vertex.x,
      y: params.vertex.y,
    },
    coreTags: params.coreTags,
    sharedTags: params.sharedTags,
    members: params.members,
    featureSummary: params.featureSummary,
    role: params.role ?? 'primary',
    mixWeights: params.mixWeights,
    subclusterLabel: params.subclusterLabel,
    parentContextLabel: params.parentContextLabel,
  };
  const rawMeta = params.deriveClusterMeta(ctx);
  const meta =
    params.preservePrimaryTitle &&
    typeof rawMeta === 'object' &&
    rawMeta !== null &&
    'title' in rawMeta &&
    typeof (rawMeta as { readonly title?: unknown }).title === 'string'
      ? ({
          ...(rawMeta as Record<string, unknown>),
          title: params.preservePrimaryTitle,
        } as TClusterMeta)
      : rawMeta;
  return {
    ...ctx,
    meta,
  };
}

export function truncateClean(text: string, maxChars: number): string {
  return truncateSimplexBadgeTitle(text, maxChars);
}

export function resolveReadableClusterName<TItem, TTagMeta, TClusterMeta>(
  cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
  maxChars = 16,
): string {
  if (!cluster) return 'Cluster';
  let raw = '';
  if (
    cluster.meta &&
    typeof cluster.meta === 'object' &&
    'title' in cluster.meta &&
    typeof (cluster.meta as { readonly title?: unknown }).title === 'string'
  ) {
    const metaTitle = (cluster.meta as { readonly title: string }).title.trim();
    if (metaTitle.length > 0 && metaTitle !== 'bridge') {
      raw = metaTitle;
    }
  }
  if (!raw) {
    raw =
      cluster.subclusterLabel ||
      cluster.parentContextLabel ||
      cluster.defaultLabel ||
      cluster.code;
  }
  const primaryPart = raw.split(/\s*\/\s*|\s*↔\s*/)[0]!.trim() || raw.trim();
  return truncateClean(primaryPart, maxChars);
}

export function deriveCornerParentContextLabel<TItem, TTagMeta, TClusterMeta>(
  parentCorner: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
): string {
  if (parentCorner.parentContextLabel && parentCorner.subclusterLabel) {
    const rootPart = truncateClean(parentCorner.parentContextLabel, 9);
    const subPart = truncateClean(parentCorner.subclusterLabel, 10);
    if (rootPart.toLowerCase() !== subPart.toLowerCase()) {
      return `${rootPart} › ${subPart}`;
    }
  }
  if (parentCorner.parentContextLabel) {
    return truncateClean(parentCorner.parentContextLabel, 18);
  }
  return resolveReadableClusterName(parentCorner, 18);
}

export function buildTriangleBreadcrumbInfo<TItem, TTagMeta, TClusterMeta>(
  corners: readonly (
    | ClusterDescriptor<TItem, TTagMeta, TClusterMeta>
    | undefined
  )[],
  fallbackCodes: readonly string[],
): {
  readonly label: string;
  readonly shortLabel: string;
  readonly segments: readonly ZoomBreadcrumbSegment[];
} {
  const segments: ZoomBreadcrumbSegment[] = corners.map((c, idx) => ({
    label: c ? resolveReadableClusterName(c, 14) : fallbackCodes[idx]!,
    colorHex: c?.colorHex,
  }));
  const joined = segments.map((s) => s.label).join(' · ');
  return {
    label: joined,
    shortLabel: joined,
    segments,
  };
}

export function buildClusterBreadcrumbInfo<TItem, TTagMeta, TClusterMeta>(
  cluster: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>,
): {
  readonly label: string;
  readonly shortLabel: string;
  readonly segments: readonly ZoomBreadcrumbSegment[];
} {
  const name = resolveReadableClusterName(cluster, 18);
  return {
    label: `${cluster.code} · ${name}`,
    shortLabel: name,
    segments: [{ label: name, colorHex: cluster.colorHex }],
  };
}

export function extractHumanExemplarTitle<TItem>(
  item: TItem,
  getItemLabel?: (item: TItem) => string,
): string | null {
  if (getItemLabel) {
    const custom = getItemLabel(item)?.trim();
    if (custom) return custom.replace(/\s*\(\d{4}\)$/, '').trim();
  }
  if (typeof item === 'object' && item !== null) {
    const rec = item as Record<string, unknown>;
    const candidateKeys = [
      'shortTitle',
      'title',
      'label',
      'name',
      'headline',
    ];
    for (const k of candidateKeys) {
      const val = rec[k];
      if (typeof val === 'string' && val.trim().length > 0) {
        return val.trim().replace(/\s*\(\d{4}\)$/, '').trim();
      }
    }
  }
  return null;
}

export function sortRootWeightEntries(
  weights: ReadonlyMap<number, number>,
): ReadonlyArray<readonly [number, number]> {
  return [...weights.entries()]
    .filter(([, w]) => w >= 0.005)
    .sort((a, b) =>
      Math.abs(b[1] - a[1]) > 1e-4 ? b[1] - a[1] : a[0] - b[0],
    );
}

export function buildMixWeights<TItem, TTagMeta, TClusterMeta>(
  weights: ReadonlyMap<number, number>,
  rootClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
): readonly ClusterMixComponent[] {
  return sortRootWeightEntries(weights).map(([idx, w]) => {
    const c = rootClusters[idx];
    return {
      code: c?.code ?? defaultClusterCode(idx),
      label: resolveReadableClusterName(c, 16),
      colorHex: c?.colorHex ?? '#64748b',
      weight: w,
    };
  });
}

export function formatCompactBridgeLabel<TItem, TTagMeta, TClusterMeta>(
  weights: ReadonlyMap<number, number>,
  rootClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
  immediateEdgePair?: readonly [
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
    ClusterDescriptor<TItem, TTagMeta, TClusterMeta> | undefined,
  ],
): string {
  if (immediateEdgePair && immediateEdgePair[0] && immediateEdgePair[1]) {
    const nameA = resolveReadableClusterName(immediateEdgePair[0], 10);
    const nameB = resolveReadableClusterName(immediateEdgePair[1], 10);
    if (nameA.toLowerCase() !== nameB.toLowerCase()) {
      return `${nameA} ↔ ${nameB}`;
    }
  }
  const sorted = sortRootWeightEntries(weights);
  if (sorted.length === 0) return 'Bridge';
  const [domIdx, domW] = sorted[0]!;
  const domCluster = rootClusters[domIdx];
  if (sorted.length === 1 || domW >= 0.996) {
    return resolveReadableClusterName(domCluster, 16);
  }
  const [idxA, wA] = sorted[0]!;
  const [idxB] = sorted[1]!;
  const nameA = resolveReadableClusterName(rootClusters[idxA], 10);
  const nameB = resolveReadableClusterName(rootClusters[idxB], 10);
  if (Math.abs(wA - 0.5) <= 0.04) {
    return `${nameA} ↔ ${nameB}`;
  }
  const pctA = wA >= 0.99 ? 99 : Math.max(1, Math.round(wA * 100));
  return `${pctA}% ${nameA} · ${nameB}`;
}

export function formatMixLabel<TItem, TTagMeta, TClusterMeta>(
  weights: ReadonlyMap<number, number>,
  rootClusters: readonly ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[],
): { readonly code: string; readonly label: string } {
  const sorted = sortRootWeightEntries(weights);
  if (sorted.length === 0) {
    return { code: 'M', label: 'Midpoint' };
  }
  const [domIdx, domW] = sorted[0]!;
  const domCluster = rootClusters[domIdx];
  if (sorted.length === 1 || domW >= 0.996) {
    return {
      code: domCluster?.code ?? defaultClusterCode(domIdx),
      label: resolveReadableClusterName(domCluster, 18),
    };
  }
  if (sorted.length === 2) {
    const [idxA, wA] = sorted[0]!;
    const [idxB] = sorted[1]!;
    const cA = rootClusters[idxA];
    const cB = rootClusters[idxB];
    const codeA = cA?.code ?? defaultClusterCode(idxA);
    const codeB = cB?.code ?? defaultClusterCode(idxB);
    const nameA = resolveReadableClusterName(cA, 12);
    const nameB = resolveReadableClusterName(cB, 12);
    if (Math.abs(wA - 0.5) <= 0.03) {
      return {
        code: `${codeA}·${codeB}`,
        label: `${nameA} ↔ ${nameB}`,
      };
    }
    const pctA = wA >= 0.99 ? 99 : Math.max(1, Math.round(wA * 100));
    const pctB = Math.max(1, 100 - pctA);
    return {
      code: `${codeA}·${codeB}`,
      label: `${pctA}% ${nameA} · ${pctB}% ${nameB}`,
    };
  }

  const topEntries =
    sorted[2] && sorted[2][1] >= 0.14 ? sorted.slice(0, 3) : sorted.slice(0, 2);
  const code = topEntries
    .map(([idx]) => rootClusters[idx]?.code ?? defaultClusterCode(idx))
    .join('·');
  const label = topEntries
    .map(([idx, w]) => {
      const c = rootClusters[idx];
      const name = resolveReadableClusterName(c, 11);
      const pct = w >= 0.99 ? '99' : w < 0.01 ? '<1' : String(Math.round(w * 100));
      return `${pct}% ${name}`;
    })
    .join(' · ');
  return { code, label };
}

export function computeFullScaleStats(
  itemIds: readonly string[],
  itemScaleRatios: ReadonlyMap<string, number>,
  fullScaleThreshold: number,
): {
  readonly fullScaleCount: number;
  readonly ratio: number;
  readonly hasUnderScaled: boolean;
} {
  if (itemIds.length === 0) {
    return { fullScaleCount: 0, ratio: 1, hasUnderScaled: false };
  }
  let fullScaleCount = 0;
  for (const id of itemIds) {
    const ratio = itemScaleRatios.get(id) ?? 1;
    if (ratio >= fullScaleThreshold) {
      fullScaleCount++;
    }
  }
  return {
    fullScaleCount,
    ratio: fullScaleCount / itemIds.length,
    hasUnderScaled: fullScaleCount < itemIds.length,
  };
}

export function evaluateTriangleFrameNeighbors<TItem, TTagMeta, TClusterMeta>(
  parentFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>,
  parentTriIndex: number,
  subMesh: SimplexMesh,
): readonly ZoomNeighborTarget[] {
  const parentTri = parentFrame.mesh.triangles[parentTriIndex];
  if (!parentTri) return [];
  const [v0, v1, v2] = parentTri.vertices;
  const edgeSpecs: readonly {
    readonly a: number;
    readonly b: number;
    readonly localA: number;
    readonly localB: number;
    readonly midVertexIdx: number;
  }[] = [
    { a: v0, b: v1, localA: 0, localB: 1, midVertexIdx: 3 },
    { a: v1, b: v2, localA: 1, localB: 2, midVertexIdx: 4 },
    { a: v2, b: v0, localA: 2, localB: 0, midVertexIdx: 5 },
  ];

  const sv0 = subMesh.vertices[0]!;
  const sv1 = subMesh.vertices[1]!;
  const sv2 = subMesh.vertices[2]!;
  const triCx = (sv0.x + sv1.x + sv2.x) / 3;
  const triCy = (sv0.y + sv1.y + sv2.y) / 3;

  const neighbors: ZoomNeighborTarget[] = [];
  for (const spec of edgeSpecs) {
    const adjTri = parentFrame.mesh.triangles.find(
      (t) =>
        t.index !== parentTriIndex &&
        t.vertices.includes(spec.a) &&
        t.vertices.includes(spec.b),
    );
    if (!adjTri) continue;

    const la = subMesh.vertices[spec.localA]!;
    const lb = subMesh.vertices[spec.localB]!;
    const midPt = subMesh.vertices[spec.midVertexIdx] ?? {
      x: (la.x + lb.x) * 0.5,
      y: (la.y + lb.y) * 0.5,
    };
    const nxRaw = midPt.x - triCx;
    const nyRaw = midPt.y - triCy;
    const nLen = Math.hypot(nxRaw, nyRaw) || 1;

    const vertSet = new Set(adjTri.vertices);
    let itemCount = 0;
    for (const it of parentFrame.items) {
      if (isItemCoveredByVertices(parentFrame, it, vertSet)) itemCount++;
    }
    const cornerClusters = adjTri.vertices.map((vi) => parentFrame.clusters[vi]);
    const cornerNames = cornerClusters.map((c, idx) =>
      c ? resolveReadableClusterName(c, 12) : defaultClusterCode(adjTri.vertices[idx]!),
    );
    const mixed = mixOklabColors(
      cornerClusters
        .filter((c): c is ClusterDescriptor<TItem, TTagMeta, TClusterMeta> =>
          Boolean(c),
        )
        .map((c) => ({ oklab: c.oklab, weight: 1 })),
    );

    neighbors.push({
      id: `tri:${adjTri.index}`,
      targetKind: 'triangle',
      label: `${cornerNames.join(' · ')} (${itemCount})`,
      shortLabel: cornerNames.join(' · '),
      itemCount,
      anchorPoint: { x: midPt.x, y: midPt.y },
      normal: { x: nxRaw / nLen, y: nyRaw / nLen },
      accentHex: mixed.hex,
    });
  }
  return neighbors;
}

export function buildSectorPartitionFrame<TItem, TTagMeta, TClusterMeta>(params: {
  readonly frameId: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly accentHex: string;
  readonly breadcrumbSegments?: readonly ZoomBreadcrumbSegment[];
  readonly parentContextLabel?: string;
  readonly getItemLabel?: (item: TItem) => string;
  readonly coveredItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly baseRootWeights: ReadonlyMap<number, number>;
  readonly helpers: ZoomSharedHelpers<TItem, TTagMeta, TClusterMeta>;
  readonly neighbors: readonly ZoomNeighborTarget[];
  readonly sourceTrianglePoints?: readonly [Point2D, Point2D, Point2D];
  readonly innerPadding?: number;
  readonly meshOrientation?: 'horizontal' | 'vertical';
  readonly sourceCenter?: Point2D;
  readonly sourceSpan?: number;
  readonly contextTriangles?: readonly ZoomContextTriangle<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextEdges?: readonly ZoomContextEdge<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextClusters?: readonly ZoomContextCluster<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextItems?: readonly ZoomContextItem<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
}): ZoomFrameSpec<TItem, TTagMeta, TClusterMeta> {
  const {
    frameId,
    label,
    shortLabel,
    accentHex,
    breadcrumbSegments,
    parentContextLabel,
    getItemLabel,
    coveredItems,
    baseRootWeights,
    helpers,
    neighbors,
    sourceTrianglePoints,
    innerPadding,
    meshOrientation,
    sourceCenter,
    sourceSpan,
    contextTriangles,
    contextEdges,
    contextClusters,
    contextItems,
  } = params;

  const { mesh, transform } = buildOrientedSingleTriangleMeshWithTransform({
    viewportWidth: helpers.viewportWidth,
    viewportHeight: helpers.viewportHeight,
    innerPadding: innerPadding ?? helpers.innerPadding,
    sourceTrianglePoints,
    orientation: meshOrientation ?? 'horizontal',
    sourceCenter,
    sourceSpan,
  });

  const parentToFrameTransform = {
    scale: transform.scale,
    sourceCx: transform.sourceCx,
    sourceCy: transform.sourceCy,
    targetCx: transform.targetCx,
    targetCy: transform.targetCy,
  };

  // Split identical / single-point items evenly into 3 spatial sectors `[S1, S2, S3]`
  // using mild intra-group weights so they fan across the entire viewport triangle at 1.0x scale.
  const baseLab = mixOklabColors(
    [...baseRootWeights.entries()].map(([idx, w]) => ({
      oklab: helpers.rootClusters[idx]!.oklab,
      weight: w,
    })),
  ).oklab;

  const sectorLabs: readonly OklabTuple[] = [
    [
      Math.min(0.84, baseLab[0] + 0.04),
      baseLab[1] * 1.05 + 0.02,
      baseLab[2] * 0.95 - 0.01,
    ],
    [
      Math.max(0.54, baseLab[0] - 0.03),
      baseLab[1] * 0.95 - 0.02,
      baseLab[2] * 1.05 + 0.02,
    ],
    [
      baseLab[0],
      baseLab[1] * 0.98 - 0.01,
      baseLab[2] * 0.98 - 0.02,
    ],
  ];

  const sortedItems = [...coveredItems].sort((a, b) => a.id.localeCompare(b.id));
  const sectorBuckets: ZoomItemAnchorInput<TItem, TTagMeta>[][] = [[], [], []];
  const nextItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = sortedItems.map(
    (item, i) => {
      const s = i % 3;
      const vPos = mesh.vertices[s]!;
      const centroidX =
        (mesh.vertices[0]!.x + mesh.vertices[1]!.x + mesh.vertices[2]!.x) / 3;
      const centroidY =
        (mesh.vertices[0]!.y + mesh.vertices[1]!.y + mesh.vertices[2]!.y) / 3;
      const localX = vPos.x * 0.64 + centroidX * 0.36;
      const localY = vPos.y * 0.64 + centroidY * 0.36;
      const wPrimary = 0.64;
      const wOther = 0.18;
      const unitWeights = [0, 1, 2].map((ci) => ({
        clusterIndex: ci,
        weight: ci === s ? wPrimary : wOther,
        coverage: ci === s ? wPrimary : wOther,
      }));
      const converted: ZoomItemAnchorInput<TItem, TTagMeta> = {
        ...item,
        anchorX: localX,
        anchorY: localY,
        unitWeights,
      };
      sectorBuckets[s]!.push(converted);
      return converted;
    },
  );

  const sectorLetters = ['A', 'B', 'C'] as const;
  const mixWeights = buildMixWeights(baseRootWeights, helpers.rootClusters);
  const baseFmt = formatMixLabel(baseRootWeights, helpers.rootClusters);
  const sectorPrefix = baseFmt.code.length <= 5 ? `${baseFmt.code}·` : '';
  const effectiveParentContext =
    parentContextLabel ?? truncateClean(baseFmt.label, 18);

  const clusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] = [0, 1, 2].map(
    (s) => {
      const lab = sectorLabs[s]!;
      const mixedHex = mixOklabColors([{ oklab: lab, weight: 1 }]).hex;
      const bucket = sectorBuckets[s]!;
      const leadItem = bucket[0];
      const exemplar = leadItem
        ? extractHumanExemplarTitle(leadItem.item, getItemLabel)
        : null;
      let sectorLabel: string;
      if (exemplar) {
        sectorLabel =
          bucket.length > 1
            ? `“${truncateClean(exemplar, 12)}” +${bucket.length - 1}`
            : truncateClean(exemplar, 15);
      } else if (leadItem && leadItem.tags.length > 0) {
        const topTag = leadItem.tags[0]!.tag.replace(/^#+/, '').slice(0, 9);
        sectorLabel = `#${topTag} · ${sectorLetters[s]} (${bucket.length})`;
      } else {
        sectorLabel = `Group ${sectorLetters[s]} (${bucket.length})`;
      }
      const members = nextItems.map((it) => {
        const uw = it.unitWeights[s]!;
        return {
          item: it.item,
          itemId: it.id,
          coverage: uw.coverage,
          normalizedWeight: uw.weight,
          isExclusiveVertexMember: false,
        };
      });
      return buildSynthesizedClusterDescriptor({
        clusterIndex: s,
        clusterUid: helpers.allocateClusterUid(),
        code: `${sectorPrefix}S${s + 1}`,
        defaultLabel: sectorLabel,
        oklab: lab,
        hex: mixedHex,
        vertex: mesh.vertices[s]!,
        coreTags: [],
        sharedTags: [],
        members,
        featureSummary: `Spatial group ${sectorLetters[s]} (${sectorLabel})`,
        role: 'intermediate',
        mixWeights,
        subclusterLabel: sectorLabel,
        parentContextLabel: effectiveParentContext,
        deriveClusterMeta: helpers.deriveClusterMeta,
      });
    },
  );

  return {
    frameId,
    kind: 'cluster-spotlight',
    label,
    shortLabel,
    accentHex,
    breadcrumbSegments,
    mesh,
    clusters,
    items: nextItems,
    neighbors,
    parentToFrameTransform,
    contextTriangles,
    contextEdges,
    contextClusters,
    contextItems,
    strategyData: {
      kind: 'cluster-spotlight',
      vertexWeights: [0, 1, 2].map(() => ({ rootWeights: baseRootWeights })),
    } satisfies InternalFrameMeta,
  };
}

/**
 * Encodes an ancestor-scoped neighbor target (`@<frameId>/<localTarget>`)
 * so dimmed neighborhood elements from any zoom depth remain unambiguously clickable.
 */
export function formatScopedNeighborId(
  frameId: string,
  localTarget: string,
): string {
  return `@${frameId}/${localTarget}`;
}

/**
 * Parses a neighbor ID that may either be ancestor-scoped (`@<frameId>/<localTarget>`)
 * or unqualified (`tri:<idx>`, `cluster:<idx>`).
 */
export function parseScopedNeighborId(neighborId: string): {
  readonly parentFrameId?: string;
  readonly localTarget: string;
} {
  if (neighborId.startsWith('@')) {
    const slashIdx = neighborId.indexOf('/');
    if (slashIdx > 1) {
      return {
        parentFrameId: neighborId.slice(1, slashIdx),
        localTarget: neighborId.slice(slashIdx + 1),
      };
    }
  }
  return { localTarget: neighborId };
}

export function pairEdgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function buildNeighborhoodContext<TItem, TTagMeta, TClusterMeta>(params: {
  readonly parentFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>;
  readonly excludedTriangleIndices: ReadonlySet<number>;
  readonly excludedVertexIndices: ReadonlySet<number>;
  readonly activeParentEdgeKeys: ReadonlySet<string>;
  readonly activeItemIds: ReadonlySet<string>;
  readonly parentSettledItems?: ReadonlyMap<
    string,
    { readonly x: number; readonly y: number; readonly scale: number }
  >;
  readonly transform: ViewportAffineTransform;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly allowClusterDrill: boolean;
}): {
  readonly contextTriangles: readonly ZoomContextTriangle<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextEdges: readonly ZoomContextEdge<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextClusters: readonly ZoomContextCluster<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
  readonly contextItems: readonly ZoomContextItem<
    TItem,
    TTagMeta,
    TClusterMeta
  >[];
} {
  const {
    parentFrame,
    excludedTriangleIndices,
    excludedVertexIndices,
    activeParentEdgeKeys,
    activeItemIds,
    parentSettledItems,
    transform,
    viewportWidth: vw,
    viewportHeight: vh,
  } = params;

  const fallbackOklab = mixOklabColors([]);
  const contextTriangles: ZoomContextTriangle<TItem, TTagMeta, TClusterMeta>[] = [];
  const nonExcludedParentTris: Array<{
    readonly index: number;
    readonly vSet: ReadonlySet<number>;
  }> = [];

  if (parentFrame.contextTriangles) {
    for (const pct of parentFrame.contextTriangles) {
      const pa = transform.apply(pct.points[0]);
      const pb = transform.apply(pct.points[1]);
      const pc = transform.apply(pct.points[2]);
      if (!bboxOverlapsViewport([pa, pb, pc], vw, vh)) continue;
      contextTriangles.push({
        ...pct,
        id: `anc-${pct.id}`,
        neighborId: pct.neighborId,
        points: [pa, pb, pc],
        centroid: {
          x: (pa.x + pb.x + pc.x) / 3,
          y: (pa.y + pb.y + pc.y) / 3,
        },
      });
    }
  }

  for (const tri of parentFrame.mesh.triangles) {
    if (excludedTriangleIndices.has(tri.index)) continue;
    const [va, vb, vc] = tri.vertices;
    const vSet = new Set<number>([va, vb, vc]);
    nonExcludedParentTris.push({ index: tri.index, vSet });

    const pa = transform.apply(parentFrame.mesh.vertices[va]!);
    const pb = transform.apply(parentFrame.mesh.vertices[vb]!);
    const pc = transform.apply(parentFrame.mesh.vertices[vc]!);
    if (!bboxOverlapsViewport([pa, pb, pc], vw, vh)) continue;

    const cA = parentFrame.clusters[va];
    const cB = parentFrame.clusters[vb];
    const cC = parentFrame.clusters[vc];
    const mixed = mixOklabColors(
      [cA, cB, cC]
        .filter((c): c is ClusterDescriptor<TItem, TTagMeta, TClusterMeta> =>
          Boolean(c),
        )
        .map((c) => ({ oklab: c.oklab, weight: 1 })),
    );

    let coveredItemCount = 0;
    let interiorItemCount = 0;
    for (const it of parentFrame.items) {
      if (isItemCoveredByVertices(parentFrame, it, vSet)) {
        coveredItemCount++;
        if (it.unitWeights.length === 3) interiorItemCount++;
      }
    }

    contextTriangles.push({
      id: `ctx-tri-${parentFrame.frameId}-${tri.index}`,
      neighborId: formatScopedNeighborId(parentFrame.frameId, `tri:${tri.index}`),
      points: [pa, pb, pc],
      centroid: {
        x: (pa.x + pb.x + pc.x) / 3,
        y: (pa.y + pb.y + pc.y) / 3,
      },
      clusters: [cA, cB, cC],
      mixedColorHex:
        cA || cB || cC ? mixed.hex : fallbackOklab.hex,
      coveredItemCount,
      interiorItemCount,
    });
  }

  const contextEdges: ZoomContextEdge<TItem, TTagMeta, TClusterMeta>[] = [];
  const seenEdgeGeoKeys = new Set<string>();

  const edgeGeoKey = (p1: Point2D, p2: Point2D): string => {
    const k1 = `${Math.round(p1.x)},${Math.round(p1.y)}`;
    const k2 = `${Math.round(p2.x)},${Math.round(p2.y)}`;
    return k1 < k2 ? `${k1}-${k2}` : `${k2}-${k1}`;
  };

  for (const edge of parentFrame.mesh.edges) {
    if (activeParentEdgeKeys.has(pairEdgeKey(edge.a, edge.b))) continue;
    const pa = transform.apply(parentFrame.mesh.vertices[edge.a]!);
    const pb = transform.apply(parentFrame.mesh.vertices[edge.b]!);
    if (!bboxOverlapsViewport([pa, pb], vw, vh)) continue;
    const gKey = edgeGeoKey(pa, pb);
    if (seenEdgeGeoKeys.has(gKey)) continue;
    seenEdgeGeoKeys.add(gKey);
    const cA = parentFrame.clusters[edge.a];
    const cB = parentFrame.clusters[edge.b];
    const mixed = mixOklabColors(
      [cA, cB]
        .filter((c): c is ClusterDescriptor<TItem, TTagMeta, TClusterMeta> =>
          Boolean(c),
        )
        .map((c) => ({ oklab: c.oklab, weight: 1 })),
    );
    contextEdges.push({
      a: pa,
      b: pb,
      mixedColorHex: mixed.hex,
      clusters: [cA, cB],
    });
  }

  if (parentFrame.contextEdges) {
    for (const pce of parentFrame.contextEdges) {
      const pa = transform.apply(pce.a);
      const pb = transform.apply(pce.b);
      if (!bboxOverlapsViewport([pa, pb], vw, vh)) continue;
      const gKey = edgeGeoKey(pa, pb);
      if (seenEdgeGeoKeys.has(gKey)) continue;
      seenEdgeGeoKeys.add(gKey);
      contextEdges.push({
        ...pce,
        a: pa,
        b: pb,
      });
    }
  }

  const contextClusters: ZoomContextCluster<TItem, TTagMeta, TClusterMeta>[] = [];
  const seenClusterUids = new Set<string>();

  for (let vIdx = 0; vIdx < parentFrame.mesh.vertices.length; vIdx++) {
    if (excludedVertexIndices.has(vIdx)) continue;
    const cluster = parentFrame.clusters[vIdx];
    const vert = parentFrame.mesh.vertices[vIdx];
    if (!cluster || !vert) continue;
    const pt = transform.apply(vert);
    if (!pointNearViewport(pt, vw, vh)) continue;
    seenClusterUids.add(cluster.clusterUid);
    contextClusters.push({
      id: `ctx-cl-${parentFrame.frameId}-${cluster.clusterUid}`,
      neighborId: formatScopedNeighborId(parentFrame.frameId, `cluster:${vIdx}`),
      cluster,
      x: pt.x,
      y: pt.y,
    });
  }

  if (parentFrame.contextClusters) {
    for (const pcc of parentFrame.contextClusters) {
      if (seenClusterUids.has(pcc.cluster.clusterUid)) continue;
      const pt = transform.apply({ x: pcc.x, y: pcc.y });
      if (!pointNearViewport(pt, vw, vh)) continue;
      seenClusterUids.add(pcc.cluster.clusterUid);
      contextClusters.push({
        id: `anc-cl-${pcc.cluster.clusterUid}`,
        neighborId: pcc.neighborId,
        cluster: pcc.cluster,
        x: pt.x,
        y: pt.y,
      });
    }
  }

  const contextItems: ZoomContextItem<TItem, TTagMeta, TClusterMeta>[] = [];
  const seenItemRawIds = new Set<string>(activeItemIds);

  for (const it of parentFrame.items) {
    if (seenItemRawIds.has(it.id)) continue;
    const settled = parentSettledItems?.get(it.id);
    const srcPt = settled
      ? { x: settled.x, y: settled.y }
      : { x: it.anchorX, y: it.anchorY };
    const pt = transform.apply(srcPt);
    if (!pointNearViewport(pt, vw, vh)) continue;

    seenItemRawIds.add(it.id);

    let localTarget = 'frame';
    for (const candTri of nonExcludedParentTris) {
      if (isItemCoveredByVertices(parentFrame, it, candTri.vSet)) {
        localTarget = `tri:${candTri.index}`;
        break;
      }
    }
    if (localTarget === 'frame' && it.unitWeights.length >= 1) {
      let bestClusterIdx: number | null = null;
      let bestWeight = -Infinity;
      for (const uw of it.unitWeights) {
        if (!excludedVertexIndices.has(uw.clusterIndex) && uw.weight > bestWeight) {
          bestWeight = uw.weight;
          bestClusterIdx = uw.clusterIndex;
        }
      }
      if (bestClusterIdx !== null) {
        localTarget = `cluster:${bestClusterIdx}`;
      }
    }
    const neighborId = formatScopedNeighborId(parentFrame.frameId, localTarget);

    const validUnitClusters = it.unitWeights
      .map((uw) => {
        const cluster = parentFrame.clusters[uw.clusterIndex];
        return cluster
          ? {
              cluster,
              weight: uw.weight,
              coverage: uw.coverage,
            }
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    contextItems.push({
      id: `ctx-it-${it.id}`,
      rawId: it.id,
      neighborId,
      item: it.item,
      layoutContext: {
        id: it.id,
        tags: it.tags,
        mixedColorHex: it.mixedColorHex,
        mixedOklab: it.mixedOklab,
        unitClusters: validUnitClusters,
        residualDistance: it.residualDistance,
        featureSummary: it.featureSummary,
      },
      x: pt.x,
      y: pt.y,
      scale: settled ? settled.scale * transform.scale : undefined,
    });
  }

  if (parentFrame.contextItems) {
    for (const pci of parentFrame.contextItems) {
      if (seenItemRawIds.has(pci.rawId)) continue;
      const pt = transform.apply({ x: pci.x, y: pci.y });
      if (!pointNearViewport(pt, vw, vh)) continue;
      seenItemRawIds.add(pci.rawId);
      contextItems.push({
        ...pci,
        id: `ctx-it-${pci.rawId}`,
        neighborId: pci.neighborId,
        x: pt.x,
        y: pt.y,
        scale:
          pci.scale !== undefined ? pci.scale * transform.scale : undefined,
      });
    }
  }

  return { contextTriangles, contextEdges, contextClusters, contextItems };
}

/**
 * Shared helper computing the local triangle source geometry, padding, and surrounding
 * neighborhood context for direct `'spotlight'` cluster drills in Barycentric and Subspace zoom.
 */
export function buildClusterSpotlightSetup<TItem, TTagMeta, TClusterMeta>(params: {
  readonly clusterIndex: number;
  readonly parentFrame: ZoomFrameSpec<TItem, TTagMeta, TClusterMeta>;
  readonly directItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly helpers: ZoomSharedHelpers<TItem, TTagMeta, TClusterMeta>;
}) {
  const { clusterIndex, parentFrame, directItems, helpers } = params;
  const targetVert = parentFrame.mesh.vertices[clusterIndex];
  const clusterIncTris = parentFrame.mesh.triangles.filter((t) =>
    t.vertices.includes(clusterIndex),
  );
  const sourceSpan = Math.max(40, parentFrame.mesh.sideLength * 0.58);
  let sourceTrianglePoints:
    | readonly [Point2D, Point2D, Point2D]
    | undefined;
  if (clusterIncTris.length === 1 && targetVert) {
    const [va, vb, vc] = clusterIncTris[0]!.vertices;
    const qa = parentFrame.mesh.vertices[va]!;
    const qb = parentFrame.mesh.vertices[vb]!;
    const qc = parentFrame.mesh.vertices[vc]!;
    const qLen = Math.max(1, Math.hypot(qb.x - qa.x, qb.y - qa.y));
    const ratio = sourceSpan / qLen;
    const qCx = (qa.x + qb.x + qc.x) / 3;
    const qCy = (qa.y + qb.y + qc.y) / 3;
    sourceTrianglePoints = [
      { x: targetVert.x + (qa.x - qCx) * ratio, y: targetVert.y + (qa.y - qCy) * ratio },
      { x: targetVert.x + (qb.x - qCx) * ratio, y: targetVert.y + (qb.y - qCy) * ratio },
      { x: targetVert.x + (qc.x - qCx) * ratio, y: targetVert.y + (qc.y - qCy) * ratio },
    ];
  }
  const hasSurroundingContext =
    parentFrame.mesh.triangles.length > 1 ||
    (parentFrame.contextTriangles?.length ?? 0) > 0;
  const focusPadding = computeContextAwarePadding(
    helpers.viewportWidth,
    helpers.viewportHeight,
    helpers.innerPadding,
    hasSurroundingContext,
  );
  const { transform: spotTransform } = buildOrientedSingleTriangleMeshWithTransform({
    viewportWidth: helpers.viewportWidth,
    viewportHeight: helpers.viewportHeight,
    innerPadding: focusPadding,
    sourceTrianglePoints,
    orientation: parentFrame.mesh.orientation,
    sourceCenter: targetVert ? { x: targetVert.x, y: targetVert.y } : undefined,
    sourceSpan,
  });
  const spotContext = buildNeighborhoodContext({
    parentFrame,
    excludedTriangleIndices: new Set<number>(),
    excludedVertexIndices: new Set<number>([clusterIndex]),
    activeParentEdgeKeys: new Set<string>(),
    activeItemIds: new Set(directItems.map((it) => it.id)),
    parentSettledItems: helpers.parentSettledItems,
    transform: spotTransform,
    viewportWidth: helpers.viewportWidth,
    viewportHeight: helpers.viewportHeight,
    allowClusterDrill: true,
  });

  return {
    targetVert,
    sourceSpan,
    sourceTrianglePoints,
    focusPadding,
    spotContext,
  };
}

export function executeSingleTriangleFocusDrill<TItem, TTagMeta, TClusterMeta>(
  ctx: ZoomTriangleDrillContext<TItem, TTagMeta, TClusterMeta>,
  allowClusterDrill = true,
): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null {
  if (ctx.parentDepth > MAX_ZOOM_DRILL_DEPTH) return null;
  const { triangleIndex, parentFrame, helpers } = ctx;
  if (
    parentFrame.mesh.triangles.length <= 1 ||
    parentFrame.kind === 'triangle-focus' ||
    parentFrame.kind === 'cluster-spotlight'
  ) {
    return null;
  }
  const tri = parentFrame.mesh.triangles[triangleIndex];
  if (!tri) return null;

  const [v0, v1, v2] = tri.vertices;
  const oldToNew = new Map<number, number>([
    [v0, 0],
    [v1, 1],
    [v2, 2],
  ]);
  const vSet = new Set<number>([v0, v1, v2]);
  const coveredItems = parentFrame.items.filter((it) =>
    isItemCoveredByVertices(parentFrame, it, vSet),
  );

  const c0 = parentFrame.clusters[v0];
  const c1 = parentFrame.clusters[v1];
  const c2 = parentFrame.clusters[v2];
  const p0 = parentFrame.mesh.vertices[v0]!;
  const p1 = parentFrame.mesh.vertices[v1]!;
  const p2 = parentFrame.mesh.vertices[v2]!;

  const focusPadding = computeContextAwarePadding(
    helpers.viewportWidth,
    helpers.viewportHeight,
    helpers.innerPadding,
    true,
  );
  const { mesh: focusMesh, transform } =
    buildOrientedSingleTriangleMeshWithTransform({
      viewportWidth: helpers.viewportWidth,
      viewportHeight: helpers.viewportHeight,
      innerPadding: focusPadding,
      sourceTrianglePoints: [p0, p1, p2],
      orientation: parentFrame.mesh.orientation,
    });

  const neighbors = evaluateTriangleFrameNeighbors(
    parentFrame,
    triangleIndex,
    focusMesh,
  );
  const context = buildNeighborhoodContext({
    parentFrame,
    excludedTriangleIndices: new Set([triangleIndex]),
    excludedVertexIndices: vSet,
    activeParentEdgeKeys: new Set([
      pairEdgeKey(v0, v1),
      pairEdgeKey(v1, v2),
      pairEdgeKey(v2, v0),
    ]),
    activeItemIds: new Set(coveredItems.map((it) => it.id)),
    parentSettledItems: helpers.parentSettledItems,
    transform,
    viewportWidth: helpers.viewportWidth,
    viewportHeight: helpers.viewportHeight,
    allowClusterDrill,
  });

  const focusItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = coveredItems.map(
    (it) => {
      const unitWeights = it.unitWeights.map((uw) => ({
        clusterIndex: oldToNew.get(uw.clusterIndex) ?? 0,
        weight: uw.weight,
        coverage: uw.coverage,
      }));
      let anchorX = 0;
      let anchorY = 0;
      for (const uw of unitWeights) {
        const v = focusMesh.vertices[uw.clusterIndex]!;
        anchorX += v.x * uw.weight;
        anchorY += v.y * uw.weight;
      }
      return {
        ...it,
        anchorX,
        anchorY,
        unitWeights,
      };
    },
  );

  const oldVertices = [v0, v1, v2];
  const focusClusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] =
    oldVertices.map((oldIdx, newIdx) => {
      const origCluster = parentFrame.clusters[oldIdx]!;
      const vert = focusMesh.vertices[newIdx]!;
      const memberEntries: Array<
        ClusterDescriptor<TItem, TTagMeta, TClusterMeta>['members'][number]
      > = [];
      for (const fItem of focusItems) {
        const uw = fItem.unitWeights.find((u) => u.clusterIndex === newIdx);
        if (!uw) continue;
        memberEntries.push({
          item: fItem.item,
          itemId: fItem.id,
          coverage: uw.coverage,
          normalizedWeight: uw.weight,
          isExclusiveVertexMember: fItem.unitWeights.length === 1,
        });
      }
      return buildSynthesizedClusterDescriptor({
        clusterIndex: newIdx,
        clusterUid: helpers.allocateClusterUid(),
        code: origCluster.code,
        defaultLabel: origCluster.defaultLabel,
        oklab: origCluster.oklab,
        hex: origCluster.colorHex,
        vertex: vert,
        coreTags: origCluster.coreTags,
        sharedTags: origCluster.sharedTags,
        members: memberEntries,
        featureSummary: origCluster.featureSummary,
        role: origCluster.role ?? 'primary',
        mixWeights: origCluster.mixWeights,
        subclusterLabel: origCluster.subclusterLabel,
        parentContextLabel: origCluster.parentContextLabel,
        preservePrimaryTitle:
          (origCluster.role ?? 'primary') === 'primary'
            ? resolveReadableClusterName(origCluster, 32)
            : undefined,
        deriveClusterMeta: helpers.deriveClusterMeta,
      });
    });

  const triCodes = [
    c0?.code ?? defaultClusterCode(v0),
    c1?.code ?? defaultClusterCode(v1),
    c2?.code ?? defaultClusterCode(v2),
  ];
  const triCrumb = buildTriangleBreadcrumbInfo([c0, c1, c2], triCodes);
  const triMixed = mixOklabColors(
    [c0, c1, c2]
      .filter((c): c is ClusterDescriptor<TItem, TTagMeta, TClusterMeta> =>
        Boolean(c),
      )
      .map((c) => ({ oklab: c.oklab, weight: 1 })),
  );

  const vWeights = oldVertices.map((oldIdx) => ({
    rootWeights: getFrameVertexRootWeights(parentFrame, oldIdx),
  }));
  const itemRootMap = new Map<string, ReadonlyMap<number, number>>();
  for (const it of coveredItems) {
    itemRootMap.set(it.id, getItemRootWeights(parentFrame, it));
  }

  return {
    nextFrame: {
      frameId: `tri-focus-${parentFrame.frameId}-t${triangleIndex}`,
      kind: 'triangle-focus',
      label: triCrumb.label,
      shortLabel: triCrumb.shortLabel,
      accentHex: triMixed.hex,
      breadcrumbSegments: triCrumb.segments,
      mesh: focusMesh,
      clusters: focusClusters,
      items: focusItems,
      neighbors,
      parentToFrameTransform: {
        scale: transform.scale,
        sourceCx: transform.sourceCx,
        sourceCy: transform.sourceCy,
        targetCx: transform.targetCx,
        targetCy: transform.targetCy,
      },
      contextTriangles: context.contextTriangles,
      contextEdges: context.contextEdges,
      contextClusters: context.contextClusters,
      contextItems: context.contextItems,
      cornerClusterNeighborIds: allowClusterDrill
        ? oldVertices.map((oldIdx) => `@${parentFrame.frameId}/cluster:${oldIdx}`)
        : undefined,
      strategyData: {
        kind: 'triangle-focus',
        parentTriIndex: triangleIndex,
        vertexWeights: vWeights,
        itemRootWeights: itemRootMap,
      } satisfies InternalFrameMeta,
    },
  };
}

export function executeClusterStarDrill<TItem, TTagMeta, TClusterMeta>(
  ctx: ZoomClusterDrillContext<TItem, TTagMeta, TClusterMeta>,
  allowClusterDrill = true,
): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null {
  const { clusterIndex, parentFrame, helpers } = ctx;
  const incidentTris = parentFrame.mesh.triangles.filter((t) =>
    t.vertices.includes(clusterIndex),
  );
  const hasSurroundingContext =
    parentFrame.mesh.triangles.length > incidentTris.length ||
    (parentFrame.contextTriangles?.length ?? 0) > 0;
  const focusPadding = computeContextAwarePadding(
    helpers.viewportWidth,
    helpers.viewportHeight,
    helpers.innerPadding,
    hasSurroundingContext,
  );
  const star = buildIncidentStarMesh(
    parentFrame.mesh,
    clusterIndex,
    helpers.viewportWidth,
    helpers.viewportHeight,
    focusPadding,
  );
  if (!star) return null;

  const oldVertexSet = new Set(star.newToOldVertex);
  const coveredItems = parentFrame.items.filter((it) =>
    isItemCoveredByVertices(parentFrame, it, oldVertexSet),
  );

  const excludedTriangleIndices = new Set(incidentTris.map((t) => t.index));
  const activeParentEdgeKeys = new Set(
    star.mesh.edges.map((e) =>
      pairEdgeKey(star.newToOldVertex[e.a]!, star.newToOldVertex[e.b]!),
    ),
  );
  const context = buildNeighborhoodContext({
    parentFrame,
    excludedTriangleIndices,
    excludedVertexIndices: oldVertexSet,
    activeParentEdgeKeys,
    activeItemIds: new Set(coveredItems.map((it) => it.id)),
    parentSettledItems: helpers.parentSettledItems,
    transform: star.transform,
    viewportWidth: helpers.viewportWidth,
    viewportHeight: helpers.viewportHeight,
    allowClusterDrill,
  });

  const starItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = coveredItems.map((it) => {
    const unitWeights = it.unitWeights.map((uw) => ({
      clusterIndex: star.oldToNewVertex.get(uw.clusterIndex) ?? 0,
      weight: uw.weight,
      coverage: uw.coverage,
    }));
    let anchorX = 0;
    let anchorY = 0;
    for (const uw of unitWeights) {
      const v = star.mesh.vertices[uw.clusterIndex]!;
      anchorX += v.x * uw.weight;
      anchorY += v.y * uw.weight;
    }
    return {
      ...it,
      anchorX,
      anchorY,
      unitWeights,
    };
  });

  const starClusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] =
    star.newToOldVertex.map((oldIdx, newIdx) => {
      const origCluster = parentFrame.clusters[oldIdx]!;
      const vert = star.mesh.vertices[newIdx]!;
      const memberEntries: Array<
        ClusterDescriptor<TItem, TTagMeta, TClusterMeta>['members'][number]
      > = [];
      for (const stItem of starItems) {
        const uw = stItem.unitWeights.find((u) => u.clusterIndex === newIdx);
        if (!uw) continue;
        memberEntries.push({
          item: stItem.item,
          itemId: stItem.id,
          coverage: uw.coverage,
          normalizedWeight: uw.weight,
          isExclusiveVertexMember: stItem.unitWeights.length === 1,
        });
      }
      return buildSynthesizedClusterDescriptor({
        clusterIndex: newIdx,
        clusterUid: helpers.allocateClusterUid(),
        code: origCluster.code,
        defaultLabel: origCluster.defaultLabel,
        oklab: origCluster.oklab,
        hex: origCluster.colorHex,
        vertex: vert,
        coreTags: origCluster.coreTags,
        sharedTags: origCluster.sharedTags,
        members: memberEntries,
        featureSummary: origCluster.featureSummary,
        role: origCluster.role ?? 'primary',
        mixWeights: origCluster.mixWeights,
        subclusterLabel: origCluster.subclusterLabel,
        parentContextLabel: origCluster.parentContextLabel,
        deriveClusterMeta: helpers.deriveClusterMeta,
      });
    });

  const centerVert = star.mesh.vertices[0]!;
  const neighbors: ZoomNeighborTarget[] = [];
  for (let newIdx = 1; newIdx < star.newToOldVertex.length; newIdx++) {
    const oldIdx = star.newToOldVertex[newIdx]!;
    const adjCluster = parentFrame.clusters[oldIdx];
    const adjVert = star.mesh.vertices[newIdx]!;
    if (!adjCluster) continue;
    const dx = adjVert.x - centerVert.x;
    const dy = adjVert.y - centerVert.y;
    const len = Math.hypot(dx, dy) || 1;
    const adjName = resolveReadableClusterName(adjCluster, 16);
    neighbors.push({
      id: `cluster:${oldIdx}`,
      targetKind: 'cluster',
      label: `${adjCluster.code} · ${adjName}`,
      shortLabel: adjName,
      itemCount: adjCluster.members.length,
      anchorPoint: { x: adjVert.x, y: adjVert.y },
      normal: { x: dx / len, y: dy / len },
      accentHex: adjCluster.colorHex,
    });
  }

  const centerOrig = parentFrame.clusters[clusterIndex]!;
  const starCrumb = buildClusterBreadcrumbInfo(centerOrig);
  const vWeights = star.newToOldVertex.map((oldIdx) => ({
    rootWeights: getFrameVertexRootWeights(parentFrame, oldIdx),
  }));
  const itemRootMap = new Map<string, ReadonlyMap<number, number>>();
  for (const it of coveredItems) {
    itemRootMap.set(it.id, getItemRootWeights(parentFrame, it));
  }

  return {
    nextFrame: {
      frameId: `star-${parentFrame.frameId}-c${clusterIndex}`,
      kind: 'cluster-star',
      label: starCrumb.label,
      shortLabel: starCrumb.shortLabel,
      accentHex: centerOrig.colorHex,
      breadcrumbSegments: starCrumb.segments,
      mesh: star.mesh,
      clusters: starClusters,
      items: starItems,
      neighbors,
      parentToFrameTransform: {
        scale: star.transform.scale,
        sourceCx: star.transform.sourceCx,
        sourceCy: star.transform.sourceCy,
        targetCx: star.transform.targetCx,
        targetCy: star.transform.targetCy,
      },
      contextTriangles: context.contextTriangles,
      contextEdges: context.contextEdges,
      contextClusters: context.contextClusters,
      contextItems: context.contextItems,
      strategyData: {
        kind: 'cluster-star',
        parentClusterIndex: clusterIndex,
        vertexWeights: vWeights,
        itemRootWeights: itemRootMap,
      } satisfies InternalFrameMeta,
    },
  };
}
