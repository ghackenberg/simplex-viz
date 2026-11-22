import type { NormalizedContentItem } from '../clustering.js';
import { mixOklabColors, type OklabTuple } from '../oklab.js';
import type { ClusterDescriptor, Point2D } from '../types.js';
import { createBarycentricZoomStrategy } from './barycentric.js';
import {
  buildOrientedSingleTriangleMeshWithTransform,
  buildSubdividedTriangleMeshWithTransform,
  computeContextAwarePadding,
} from './geometry.js';
import {
  buildClusterBreadcrumbInfo,
  buildClusterSpotlightSetup,
  buildMixWeights,
  buildNeighborhoodContext,
  buildSectorPartitionFrame,
  buildSynthesizedClusterDescriptor,
  buildTriangleBreadcrumbInfo,
  computeFullScaleStats,
  defaultClusterCode,
  deriveCornerParentContextLabel,
  evaluateTriangleFrameNeighbors,
  executeClusterStarDrill,
  executeSingleTriangleFocusDrill,
  formatMixLabel,
  getFrameVertexRootWeights,
  isItemCoveredByVertices,
  mixRootWeightMaps,
  pairEdgeKey,
  parseScopedNeighborId,
  projectItemOntoTriangleBarycentric,
  truncateClean,
} from './shared.js';
import {
  DEFAULT_FULL_SCALE_THRESHOLD,
  MAX_ZOOM_DRILL_DEPTH,
  SUB_MESH_VERTEX_BARY,
  type InternalFrameMeta,
  type SimplexZoomStrategy,
  type SubspaceZoomStrategyOptions,
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

interface LocalSubspaceAxis {
  readonly familyKey: string;
  readonly values: Float64Array;
  readonly rawValues: Float64Array;
  readonly rawMean: number;
  readonly rawStd: number;
  readonly weight: number;
  readonly kind: 'boolean' | 'categorical' | 'numeric' | 'vector' | 'similarity';
  readonly highLabel: string;
  readonly lowLabel?: string;
  readonly formatMean?: (clusterMean: number, subsetMean: number) => string;
}

interface SubspacePrototype {
  readonly centroid: Float64Array;
  readonly memberIndices: readonly number[];
  readonly meanL0: number;
  readonly meanL1: number;
  readonly meanL2: number;
  readonly label: string;
}

const IGNORED_AUTO_KEYS = new Set<string>([
  'id',
  'slug',
  'key',
  'uid',
  'url',
  'href',
  'src',
  'title',
  'shortTitle',
  'name',
  'headline',
  'label',
  'description',
  'subtitle',
  'subtitleMeta',
  'summary',
  'author',
  'primaryAuthor',
  'colorHex',
  'palette',
  'mediaCredit',
  'waveform',
]);

function humanizeFieldKey(key: string): string {
  const cleaned = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(Musd|Mm|Cm|Hz|Pct|Min|Sec|Norm|Log)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return key;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function extractFallbackItemTitle<TItem>(
  item: TItem,
  fallbackId: string,
  getItemLabel?: (item: TItem) => string,
): string {
  if (getItemLabel) {
    const custom = getItemLabel(item)?.trim();
    if (custom) return custom;
  }
  if (typeof item === 'object' && item !== null) {
    const rec = item as Record<string, unknown>;
    for (const k of ['shortTitle', 'title', 'label', 'name', 'headline']) {
      const val = rec[k];
      if (typeof val === 'string' && val.trim().length > 0) {
        return val.trim().replace(/\s*\(\d{4}\)$/, '').slice(0, 18);
      }
    }
  }
  return fallbackId.slice(0, 16);
}

function buildLocalSubspaceAxes<TItem, TTagMeta, TClusterMeta>(params: {
  readonly coveredItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly depth: number;
  readonly kind: 'triangle' | 'cluster-spotlight';
  readonly options?: SubspaceZoomStrategyOptions<TItem>;
  readonly helpers: ZoomSharedHelpers<TItem, TTagMeta, TClusterMeta>;
}): readonly LocalSubspaceAxis[] {
  const { coveredItems, depth, kind, options, helpers } = params;
  const n = coveredItems.length;
  if (n < 2) return [];

  const axes: LocalSubspaceAxis[] = [];
  const rawDomainItems = coveredItems.map((it) => it.item);

  const resolvedFeatures =
    typeof options?.features === 'function'
      ? options.features({ depth, kind, items: rawDomainItems })
      : options?.features;

  if (resolvedFeatures && resolvedFeatures.length > 0) {
    resolvedFeatures.forEach((feat, fIdx) => {
      if ((feat.minDepth ?? 0) > depth) return;
      const baseWeight = Math.max(0.05, feat.weight ?? 1);
      const familyKey = feat.id ?? `feat:${fIdx}:${feat.label}`;
      const extracted = rawDomainItems.map((it) => feat.getValue(it));

      let hasBool = false;
      let hasString = false;
      let hasNumber = false;
      for (const v of extracted) {
        if (typeof v === 'boolean') hasBool = true;
        else if (typeof v === 'string' && v.trim().length > 0) hasString = true;
        else if (typeof v === 'number' && Number.isFinite(v)) hasNumber = true;
      }

      if (hasBool && !hasString && !hasNumber) {
        const raw = new Float64Array(n);
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const b = extracted[i] === true ? 1 : 0;
          raw[i] = b;
          sum += b;
        }
        const p = sum / n;
        if (p <= 1e-6 || p >= 1 - 1e-6) return;
        const std = Math.sqrt(p * (1 - p));
        const balanceFactor = 0.55 + 0.9 * Math.sqrt(4 * p * (1 - p));
        const effW = baseWeight * balanceFactor;
        const z = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          z[i] = ((raw[i]! - p) / std) * effW;
        }
        axes.push({
          familyKey,
          values: z,
          rawValues: raw,
          rawMean: p,
          rawStd: std,
          weight: effW,
          kind: 'boolean',
          highLabel: feat.highLabel ?? feat.label,
          lowLabel: feat.lowLabel,
          formatMean: feat.formatMean,
        });
        return;
      }

      if (hasString && !hasNumber) {
        const counts = new Map<string, number>();
        const cleanStrs = extracted.map((v) =>
          typeof v === 'string' ? v.trim() : '',
        );
        for (const s of cleanStrs) {
          if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
        }
        if (counts.size < 2) return;
        const sortedCats = [...counts.entries()]
          .filter(([, c]) => c > 0 && c < n)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 8);
        const catScale = 1 / Math.sqrt(Math.max(1, sortedCats.length * 0.5));
        for (const [catVal, count] of sortedCats) {
          const p = count / n;
          const std = Math.sqrt(p * (1 - p));
          if (std <= 1e-6) continue;
          const raw = new Float64Array(n);
          const z = new Float64Array(n);
          const effW =
            baseWeight * catScale * (0.55 + 0.9 * Math.sqrt(4 * p * (1 - p)));
          for (let i = 0; i < n; i++) {
            const hit = cleanStrs[i] === catVal ? 1 : 0;
            raw[i] = hit;
            z[i] = ((hit - p) / std) * effW;
          }
          axes.push({
            familyKey: `${familyKey}:${catVal}`,
            values: z,
            rawValues: raw,
            rawMean: p,
            rawStd: std,
            weight: effW,
            kind: 'categorical',
            highLabel: catVal,
          });
        }
        return;
      }

      if (hasNumber) {
        let validCount = 0;
        let sum = 0;
        for (const v of extracted) {
          if (typeof v === 'number' && Number.isFinite(v)) {
            sum += v;
            validCount += 1;
          }
        }
        if (validCount < 2) return;
        const mean = sum / validCount;
        const raw = new Float64Array(n);
        let sq = 0;
        for (let i = 0; i < n; i++) {
          const v = extracted[i];
          const num = typeof v === 'number' && Number.isFinite(v) ? v : mean;
          raw[i] = num;
          const d = num - mean;
          sq += d * d;
        }
        const std = Math.sqrt(sq / n);
        if (std <= 1e-6) return;
        const z = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const clamped = Math.max(-2.75, Math.min(2.75, (raw[i]! - mean) / std));
          z[i] = clamped * baseWeight;
        }
        axes.push({
          familyKey,
          values: z,
          rawValues: raw,
          rawMean: mean,
          rawStd: std,
          weight: baseWeight,
          kind: 'numeric',
          highLabel: feat.highLabel ?? `High ${feat.label}`,
          lowLabel: feat.lowLabel ?? `Low ${feat.label}`,
          formatMean: feat.formatMean,
        });
      }
    });
  }

  if (options?.getVector) {
    const vecs = rawDomainItems.map((it) => options.getVector!(it));
    const dim = vecs.reduce((m, v) => Math.max(m, v.length), 0);
    if (dim > 0) {
      const means = new Float64Array(dim);
      const stds = new Float64Array(dim);
      let maxStd = 0;
      for (let d = 0; d < dim; d++) {
        let sum = 0;
        for (let i = 0; i < n; i++) sum += vecs[i]?.[d] ?? 0;
        const mean = sum / n;
        means[d] = mean;
        let sq = 0;
        for (let i = 0; i < n; i++) {
          const diff = (vecs[i]?.[d] ?? 0) - mean;
          sq += diff * diff;
        }
        const std = Math.sqrt(sq / n);
        stds[d] = std;
        if (std > maxStd) maxStd = std;
      }
      if (maxStd > 1e-6) {
        const vecScale = axes.length > 0 ? 0.55 / Math.sqrt(dim) : 1 / Math.sqrt(dim);
        for (let d = 0; d < dim; d++) {
          const std = stds[d]!;
          if (std <= 1e-6) continue;
          const shrinkage = std / (std + 0.15 * maxStd);
          const effW = vecScale * shrinkage;
          const raw = new Float64Array(n);
          const z = new Float64Array(n);
          const mean = means[d]!;
          for (let i = 0; i < n; i++) {
            const val = vecs[i]?.[d] ?? 0;
            raw[i] = val;
            z[i] =
              Math.max(-2.75, Math.min(2.75, (val - mean) / std)) * effW;
          }
          const dimName = options.vectorDimensionLabels?.[d];
          axes.push({
            familyKey: `vec:${d}`,
            values: z,
            rawValues: raw,
            rawMean: mean,
            rawStd: std,
            weight: effW,
            kind: dimName ? 'numeric' : 'vector',
            highLabel: dimName ? `${dimName} +` : `Axis ${d + 1}+`,
            lowLabel: dimName ? `${dimName} −` : `Axis ${d + 1}−`,
          });
        }
      }
    }
  }

  if (options?.getSimilarity && axes.length === 0) {
    const simMatrix: Float64Array[] = Array.from(
      { length: n },
      () => new Float64Array(n),
    );
    let minSim = 1;
    let maxSim = 0;
    for (let i = 0; i < n; i++) {
      simMatrix[i]![i] = 1;
      for (let j = i + 1; j < n; j++) {
        const s = Math.max(
          0,
          Math.min(1, options.getSimilarity(rawDomainItems[i]!, rawDomainItems[j]!)),
        );
        simMatrix[i]![j] = s;
        simMatrix[j]![i] = s;
        if (s < minSim) minSim = s;
        if (s > maxSim) maxSim = s;
      }
    }
    if (maxSim - minSim > 1e-5) {
      const landmarkCount = Math.min(n, 8);
      const landmarks: number[] = [0];
      while (landmarks.length < landmarkCount) {
        let bestIdx = -1;
        let bestMinDist = -1;
        for (let i = 0; i < n; i++) {
          if (landmarks.includes(i)) continue;
          let minDist = Infinity;
          for (const lm of landmarks) {
            const dist = 1 - simMatrix[i]![lm]!;
            if (dist < minDist) minDist = dist;
          }
          if (minDist > bestMinDist) {
            bestMinDist = minDist;
            bestIdx = i;
          }
        }
        if (bestIdx < 0 || bestMinDist <= 1e-5) break;
        landmarks.push(bestIdx);
      }
      const lmScale = 1 / Math.sqrt(Math.max(1, landmarks.length));
      landmarks.forEach((lmIdx, k) => {
        const raw = new Float64Array(n);
        let sum = 0;
        for (let i = 0; i < n; i++) {
          raw[i] = simMatrix[i]![lmIdx]!;
          sum += raw[i]!;
        }
        const mean = sum / n;
        let sq = 0;
        for (let i = 0; i < n; i++) {
          const d = raw[i]! - mean;
          sq += d * d;
        }
        const std = Math.sqrt(sq / n);
        if (std <= 1e-6) return;
        const z = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          z[i] = ((raw[i]! - mean) / std) * lmScale;
        }
        const exLabel = extractFallbackItemTitle(
          rawDomainItems[lmIdx]!,
          coveredItems[lmIdx]!.id,
          options.getItemLabel,
        );
        axes.push({
          familyKey: `sim:${k}`,
          values: z,
          rawValues: raw,
          rawMean: mean,
          rawStd: std,
          weight: lmScale,
          kind: 'similarity',
          highLabel: exLabel,
        });
      });
    }
  }

  if (axes.length === 0) {
    const normById = new Map<string, NormalizedContentItem<TItem>>();
    for (const ni of helpers.normalizedItems) normById.set(ni.id, ni);

    const tagCounts = new Map<string, number>();
    const itemTagSets = coveredItems.map((it) => {
      const norm = normById.get(it.id);
      const list = norm && norm.tags.length > 0 ? norm.tags : it.tags.map((t) => t.tag);
      const set = new Set(list);
      for (const t of set) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      return set;
    });

    const discTags = [...tagCounts.entries()]
      .filter(([, c]) => c >= 1 && c < n)
      .sort((a, b) => {
        const pa = a[1] / n;
        const pb = b[1] / n;
        const ba = pa * (1 - pa);
        const bb = pb * (1 - pb);
        return Math.abs(bb - ba) > 1e-4 ? bb - ba : a[0].localeCompare(b[0]);
      })
      .slice(0, 12);

    for (const [tag, count] of discTags) {
      const p = count / n;
      const std = Math.sqrt(p * (1 - p));
      if (std <= 1e-6) continue;
      const effW = 0.65 + 0.85 * Math.sqrt(4 * p * (1 - p));
      const raw = new Float64Array(n);
      const z = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const hit = itemTagSets[i]!.has(tag) ? 1 : 0;
        raw[i] = hit;
        z[i] = ((hit - p) / std) * effW;
      }
      axes.push({
        familyKey: `tag:${tag}`,
        values: z,
        rawValues: raw,
        rawMean: p,
        rawStd: std,
        weight: effW,
        kind: 'categorical',
        highLabel: tag.replace(/^#+/, ''),
      });
    }

    const unwrapRecord = (val: unknown): Record<string, unknown> | null => {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) return null;
      const top = val as Record<string, unknown>;
      for (const k of Object.keys(top)) {
        if (k === 'mediaCredit' || k === 'proportions') continue;
        const child = top[k];
        if (
          typeof child === 'object' &&
          child !== null &&
          !Array.isArray(child) &&
          Object.keys(child).length >= 4
        ) {
          return child as Record<string, unknown>;
        }
      }
      return top;
    };

    const records = rawDomainItems.map(unwrapRecord);
    if (records.every((r) => r !== null)) {
      const candidateKeys = Object.keys(records[0]!).filter(
        (k) =>
          !IGNORED_AUTO_KEYS.has(k) &&
          !k.endsWith('Url') &&
          !k.endsWith('Path') &&
          !k.endsWith('Id'),
      );

      for (const key of candidateKeys.slice(0, 16)) {
        const vals = records.map((r) => r![key]);
        const niceLabel = humanizeFieldKey(key);
        if (vals.every((v) => typeof v === 'boolean')) {
          let sum = 0;
          const raw = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            const b = vals[i] === true ? 1 : 0;
            raw[i] = b;
            sum += b;
          }
          const p = sum / n;
          if (p > 1e-6 && p < 1 - 1e-6) {
            const std = Math.sqrt(p * (1 - p));
            const effW = 0.6 + 0.8 * Math.sqrt(4 * p * (1 - p));
            const z = new Float64Array(n);
            for (let i = 0; i < n; i++) z[i] = ((raw[i]! - p) / std) * effW;
            axes.push({
              familyKey: `auto-b:${key}`,
              values: z,
              rawValues: raw,
              rawMean: p,
              rawStd: std,
              weight: effW,
              kind: 'boolean',
              highLabel: niceLabel,
              lowLabel: `Non-${niceLabel}`,
            });
          }
        } else if (vals.every((v) => typeof v === 'number' && Number.isFinite(v as number))) {
          const raw = new Float64Array(n);
          let sum = 0;
          for (let i = 0; i < n; i++) {
            raw[i] = vals[i] as number;
            sum += raw[i]!;
          }
          const mean = sum / n;
          let sq = 0;
          for (let i = 0; i < n; i++) {
            const d = raw[i]! - mean;
            sq += d * d;
          }
          const std = Math.sqrt(sq / n);
          if (std > 1e-6) {
            const z = new Float64Array(n);
            for (let i = 0; i < n; i++) {
              z[i] = Math.max(-2.75, Math.min(2.75, (raw[i]! - mean) / std));
            }
            axes.push({
              familyKey: `auto-n:${key}`,
              values: z,
              rawValues: raw,
              rawMean: mean,
              rawStd: std,
              weight: 1,
              kind: 'numeric',
              highLabel: `High ${niceLabel}`,
              lowLabel: `Low ${niceLabel}`,
            });
          }
        } else if (vals.every((v) => typeof v === 'string')) {
          const counts = new Map<string, number>();
          for (const v of vals) {
            const s = (v as string).trim();
            if (s.length > 0 && s.length <= 24) {
              counts.set(s, (counts.get(s) ?? 0) + 1);
            }
          }
          if (counts.size >= 2 && counts.size <= Math.min(8, Math.ceil(n * 0.75))) {
            for (const [catVal, count] of counts) {
              if (count <= 0 || count >= n) continue;
              const p = count / n;
              const std = Math.sqrt(p * (1 - p));
              const raw = new Float64Array(n);
              const z = new Float64Array(n);
              const effW = 0.65 * Math.sqrt(4 * p * (1 - p) + 0.25);
              for (let i = 0; i < n; i++) {
                const hit = (vals[i] as string).trim() === catVal ? 1 : 0;
                raw[i] = hit;
                z[i] = ((hit - p) / std) * effW;
              }
              axes.push({
                familyKey: `auto-s:${key}:${catVal}`,
                values: z,
                rawValues: raw,
                rawMean: p,
                rawStd: std,
                weight: effW,
                kind: 'categorical',
                highLabel: catVal,
              });
            }
          }
        } else if (
          axes.length === 0 &&
          vals.every(
            (v) =>
              Array.isArray(v) &&
              v.length >= 2 &&
              v.length <= 64 &&
              typeof v[0] === 'number',
          )
        ) {
          const arrs = vals as readonly (readonly number[])[];
          const dim = arrs[0]!.length;
          const vScale = 1 / Math.sqrt(dim);
          for (let d = 0; d < dim; d++) {
            const raw = new Float64Array(n);
            let sum = 0;
            for (let i = 0; i < n; i++) {
              raw[i] = arrs[i]![d] ?? 0;
              sum += raw[i]!;
            }
            const mean = sum / n;
            let sq = 0;
            for (let i = 0; i < n; i++) {
              const diff = raw[i]! - mean;
              sq += diff * diff;
            }
            const std = Math.sqrt(sq / n);
            if (std <= 1e-6) continue;
            const z = new Float64Array(n);
            for (let i = 0; i < n; i++) {
              z[i] = ((raw[i]! - mean) / std) * vScale;
            }
            axes.push({
              familyKey: `auto-v:${key}:${d}`,
              values: z,
              rawValues: raw,
              rawMean: mean,
              rawStd: std,
              weight: vScale,
              kind: 'vector',
              highLabel: `${niceLabel} ${d + 1}+`,
              lowLabel: `${niceLabel} ${d + 1}−`,
            });
          }
        }
      }
    }
  }

  return axes;
}

function assignDistinctPrototypeLabels<TItem, TTagMeta>(params: {
  readonly prototypes: ReadonlyArray<{
    readonly centroid: Float64Array;
    readonly memberIndices: readonly number[];
  }>;
  readonly axes: readonly LocalSubspaceAxis[];
  readonly coveredItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly getItemLabel?: (item: TItem) => string;
}): readonly string[] {
  const { prototypes, axes, coveredItems, getItemLabel } = params;
  const k = prototypes.length;
  const m = axes.length;
  const assigned = new Array<string>(k).fill('');
  const usedLabels = new Set<string>();

  interface CandidateLabel {
    readonly protoIdx: number;
    readonly label: string;
    readonly familyKey: string;
    readonly score: number;
  }

  const perProtoCandidates: CandidateLabel[][] = Array.from(
    { length: k },
    () => [],
  );

  for (let pIdx = 0; pIdx < k; pIdx++) {
    const proto = prototypes[pIdx]!;
    const members = proto.memberIndices;

    for (let aIdx = 0; aIdx < m; aIdx++) {
      const axis = axes[aIdx]!;
      if (axis.kind === 'vector') continue;

      let rawClusterMean: number;
      let zMean: number;
      if (members.length > 0) {
        let rSum = 0;
        let zSum = 0;
        for (const i of members) {
          rSum += axis.rawValues[i]!;
          zSum += axis.values[i]!;
        }
        rawClusterMean = rSum / members.length;
        zMean = zSum / (members.length * Math.max(0.1, axis.weight));
      } else {
        zMean = proto.centroid[aIdx]! / Math.max(0.1, axis.weight);
        rawClusterMean = axis.rawMean + zMean * axis.rawStd;
      }

      if (axis.kind === 'categorical') {
        if (rawClusterMean >= Math.max(0.34, axis.rawMean + 0.12)) {
          perProtoCandidates[pIdx]!.push({
            protoIdx: pIdx,
            label: axis.highLabel,
            familyKey: axis.familyKey,
            score: zMean * axis.weight + rawClusterMean * 0.65,
          });
        }
      } else if (axis.kind === 'boolean') {
        if (rawClusterMean >= Math.max(0.45, axis.rawMean + 0.12)) {
          perProtoCandidates[pIdx]!.push({
            protoIdx: pIdx,
            label: axis.highLabel,
            familyKey: axis.familyKey,
            score: zMean * axis.weight + rawClusterMean * 0.45,
          });
        } else if (
          axis.lowLabel &&
          rawClusterMean <= Math.min(0.55, axis.rawMean - 0.12)
        ) {
          perProtoCandidates[pIdx]!.push({
            protoIdx: pIdx,
            label: axis.lowLabel,
            familyKey: `${axis.familyKey}:low`,
            score: -zMean * axis.weight + (1 - rawClusterMean) * 0.45,
          });
        }
      } else if (axis.kind === 'numeric') {
        if (Math.abs(zMean) >= 0.22) {
          const customFormatted = axis.formatMean
            ? axis.formatMean(rawClusterMean, axis.rawMean)
            : undefined;
          const lbl =
            customFormatted ??
            (zMean >= 0
              ? axis.highLabel
              : (axis.lowLabel ?? axis.highLabel));
          perProtoCandidates[pIdx]!.push({
            protoIdx: pIdx,
            label: lbl,
            familyKey: `${axis.familyKey}:${zMean >= 0 ? 'hi' : 'lo'}`,
            score: Math.abs(zMean) * axis.weight,
          });
        }
      } else if (axis.kind === 'similarity' && zMean >= 0.25) {
        perProtoCandidates[pIdx]!.push({
          protoIdx: pIdx,
          label: axis.highLabel,
          familyKey: axis.familyKey,
          score: zMean * axis.weight * 0.85,
        });
      }
    }

    perProtoCandidates[pIdx]!.sort(
      (a, b) => b.score - a.score || a.label.localeCompare(b.label),
    );
  }

  const flatCandidates = perProtoCandidates
    .flat()
    .sort((a, b) => b.score - a.score || a.protoIdx - b.protoIdx);

  for (const cand of flatCandidates) {
    if (assigned[cand.protoIdx]) continue;
    const normKey = cand.label.toLowerCase();
    if (usedLabels.has(normKey)) continue;
    assigned[cand.protoIdx] = cand.label;
    usedLabels.add(normKey);
  }

  for (let pIdx = 0; pIdx < k; pIdx++) {
    if (assigned[pIdx]) continue;
    const cands = perProtoCandidates[pIdx]!;
    if (cands.length >= 2) {
      const cA = cands[0]!;
      const cB = cands.find((c) => c.familyKey !== cA.familyKey && c.label !== cA.label);
      if (cB) {
        const combo = `${cA.label.slice(0, 9)} · ${cB.label.slice(0, 9)}`;
        if (!usedLabels.has(combo.toLowerCase())) {
          assigned[pIdx] = combo;
          usedLabels.add(combo.toLowerCase());
          continue;
        }
      }
    }

    const proto = prototypes[pIdx]!;
    let bestItemIdx = proto.memberIndices[0] ?? pIdx % coveredItems.length;
    let bestDistSq = Infinity;
    for (const idx of proto.memberIndices) {
      let dSq = 0;
      for (let a = 0; a < m; a++) {
        const diff = axes[a]!.values[idx]! - proto.centroid[a]!;
        dSq += diff * diff;
      }
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestItemIdx = idx;
      }
    }
    const exItem = coveredItems[bestItemIdx]!;
    let fallback = extractFallbackItemTitle(exItem.item, exItem.id, getItemLabel);
    if (usedLabels.has(fallback.toLowerCase())) {
      fallback = `${fallback.slice(0, 13)} #${pIdx + 1}`;
    }
    assigned[pIdx] = fallback;
    usedLabels.add(fallback.toLowerCase());
  }

  return assigned;
}

function clusterItemsInLocalSubspace<TItem, TTagMeta>(params: {
  readonly coveredItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly axes: readonly LocalSubspaceAxis[];
  readonly localBary: ReadonlyArray<{
    readonly l0: number;
    readonly l1: number;
    readonly l2: number;
  }>;
  readonly targetK: number;
  readonly getItemLabel?: (item: TItem) => string;
}): readonly SubspacePrototype[] {
  const { coveredItems, axes, localBary, targetK, getItemLabel } = params;
  const n = coveredItems.length;
  const m = axes.length;

  const points: Float64Array[] = Array.from({ length: n }, (_, i) => {
    const vec = new Float64Array(m);
    for (let a = 0; a < m; a++) {
      vec[a] = axes[a]!.values[i]!;
    }
    return vec;
  });

  const distSq = (u: Float64Array, v: Float64Array): number => {
    let s = 0;
    for (let d = 0; d < m; d++) {
      const diff = u[d]! - v[d]!;
      s += diff * diff;
    }
    return s;
  };

  const centroids: Float64Array[] = [];
  let firstIdx = 0;
  let maxNormSq = -1;
  for (let i = 0; i < n; i++) {
    let normSq = 0;
    for (let d = 0; d < m; d++) normSq += points[i]![d]! * points[i]![d]!;
    if (normSq > maxNormSq + 1e-9) {
      maxNormSq = normSq;
      firstIdx = i;
    }
  }
  centroids.push(new Float64Array(points[firstIdx]!));

  while (centroids.length < targetK) {
    let bestIdx = -1;
    let bestMinD = -1;
    for (let i = 0; i < n; i++) {
      let minD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const b = localBary[i]!;
        const spatialTie =
          0.02 *
          ((b.l0 - 1 / 3) * (b.l0 - 1 / 3) +
            (b.l1 - 1 / 3) * (b.l1 - 1 / 3) +
            (b.l2 - 1 / 3) * (b.l2 - 1 / 3));
        const d = distSq(points[i]!, centroids[c]!) + spatialTie;
        if (d < minD) minD = d;
      }
      if (minD > bestMinD + 1e-9) {
        bestMinD = minD;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || bestMinD <= 1e-6) break;
    centroids.push(new Float64Array(points[bestIdx]!));
  }

  while (centroids.length < targetK && centroids.length >= 2) {
    let bestPair: [number, number] = [0, 1];
    let bestPairD = -1;
    for (let a = 0; a < centroids.length; a++) {
      for (let b = a + 1; b < centroids.length; b++) {
        const mid = new Float64Array(m);
        for (let d = 0; d < m; d++) {
          mid[d] = 0.5 * (centroids[a]![d]! + centroids[b]![d]!);
        }
        let minToExisting = Infinity;
        for (const ex of centroids) {
          const de = distSq(mid, ex);
          if (de < minToExisting) minToExisting = de;
        }
        if (minToExisting > bestPairD) {
          bestPairD = minToExisting;
          bestPair = [a, b];
        }
      }
    }
    if (bestPairD <= 1e-7) break;
    const mid = new Float64Array(m);
    for (let d = 0; d < m; d++) {
      mid[d] = 0.5 * (centroids[bestPair[0]]![d]! + centroids[bestPair[1]]![d]!);
    }
    centroids.push(mid);
  }

  const kActual = centroids.length;
  const assignments = new Int32Array(n);

  for (let iter = 0; iter < 10; iter++) {
    const counts = new Int32Array(kActual);
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bestC = 0;
      let bestCost = Infinity;
      for (let c = 0; c < kActual; c++) {
        const cost = distSq(points[i]!, centroids[c]!) + counts[c]! * 0.035;
        if (cost < bestCost) {
          bestCost = cost;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) changed = true;
      assignments[i] = bestC;
      counts[bestC] = (counts[bestC] ?? 0) + 1;
    }
    if (!changed && iter > 0) break;

    for (let c = 0; c < kActual; c++) {
      if (counts[c]! === 0) continue;
      const next = new Float64Array(m);
      for (let i = 0; i < n; i++) {
        if (assignments[i] === c) {
          for (let d = 0; d < m; d++) next[d] = next[d]! + points[i]![d]!;
        }
      }
      for (let d = 0; d < m; d++) next[d] = next[d]! / counts[c]!;
      centroids[c] = next;
    }
  }

  const rawProtos = centroids.map((cent, cIdx) => {
    const memberIndices: number[] = [];
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      if (assignments[i] === cIdx) {
        memberIndices.push(i);
        s0 += localBary[i]!.l0;
        s1 += localBary[i]!.l1;
        s2 += localBary[i]!.l2;
      }
    }
    const cnt = memberIndices.length;
    return {
      centroid: cent,
      memberIndices,
      meanL0: cnt > 0 ? s0 / cnt : 1 / 3,
      meanL1: cnt > 0 ? s1 / cnt : 1 / 3,
      meanL2: cnt > 0 ? s2 / cnt : 1 / 3,
    };
  });

  const labels = assignDistinctPrototypeLabels({
    prototypes: rawProtos,
    axes,
    coveredItems,
    getItemLabel,
  });

  return rawProtos.map((p, idx) => ({
    ...p,
    label: labels[idx]!,
  }));
}

const SIX_VERTEX_EDGES: readonly (readonly [number, number])[] = [
  [0, 3],
  [3, 1],
  [1, 4],
  [4, 2],
  [2, 5],
  [5, 0],
  [3, 4],
  [4, 5],
  [5, 3],
];

/**
 * Solves exact global optimum over all `6! = 720` bijections mapping 6 local subspace
 * prototypes onto the 6 vertices `[V0, V1, V2, M01, M12, M20]` of the `1:4` subdivided mesh.
 */
function alignSixPrototypesToSubMesh(
  prototypes: readonly SubspacePrototype[],
  totalItems: number,
): readonly SubspacePrototype[] {
  const m = prototypes[0]?.centroid.length ?? 0;
  const padded: SubspacePrototype[] = [...prototypes];
  while (padded.length < 6) {
    const src = padded[padded.length % prototypes.length]!;
    padded.push({
      ...src,
      memberIndices: [],
      label: `${src.label} · ${padded.length + 1}`,
    });
  }

  const sim: number[][] = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (let a = 0; a < 6; a++) {
    for (let b = a + 1; b < 6; b++) {
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let d = 0; d < m; d++) {
        const ua = padded[a]!.centroid[d]!;
        const ub = padded[b]!.centroid[d]!;
        dot += ua * ub;
        na += ua * ua;
        nb += ub * ub;
      }
      const cos =
        na > 1e-9 && nb > 1e-9 ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
      sim[a]![b] = cos;
      sim[b]![a] = cos;
    }
  }

  const unaryCost: number[][] = Array.from({ length: 6 }, (_, pIdx) => {
    const p = padded[pIdx]!;
    const loadFrac = p.memberIndices.length / Math.max(1, totalItems);
    return SUB_MESH_VERTEX_BARY.map((vb, vIdx) => {
      const geoSq =
        (p.meanL0 - vb[0]) * (p.meanL0 - vb[0]) +
        (p.meanL1 - vb[1]) * (p.meanL1 - vb[1]) +
        (p.meanL2 - vb[2]) * (p.meanL2 - vb[2]);
      const degreeBonus = vIdx >= 3 ? loadFrac * 0.32 : 0;
      return geoSq * 0.85 - degreeBonus;
    });
  });

  const bestPerm = [0, 1, 2, 3, 4, 5];
  let bestScore = Infinity;
  const cur = [0, 1, 2, 3, 4, 5];
  const used = new Uint8Array(6);

  const search = (depth: number, partialUnary: number): void => {
    if (depth === 6) {
      let edgeBonus = 0;
      for (const [va, vb] of SIX_VERTEX_EDGES) {
        edgeBonus += sim[cur[va]!]![cur[vb]!]! * 0.14;
      }
      const totalCost = partialUnary - edgeBonus;
      if (totalCost < bestScore) {
        bestScore = totalCost;
        for (let i = 0; i < 6; i++) bestPerm[i] = cur[i]!;
      }
      return;
    }
    for (let p = 0; p < 6; p++) {
      if (used[p]) continue;
      used[p] = 1;
      cur[depth] = p;
      search(depth + 1, partialUnary + unaryCost[p]![depth]!);
      used[p] = 0;
    }
  };

  search(0, 0);
  return bestPerm.map((pIdx) => padded[pIdx]!);
}

function buildSubspaceSpotlightFrame<TItem, TTagMeta, TClusterMeta>(params: {
  readonly frameId: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly accentHex: string;
  readonly breadcrumbSegments?: readonly ZoomBreadcrumbSegment[];
  readonly parentContextLabel?: string;
  readonly coveredItems: readonly ZoomItemAnchorInput<TItem, TTagMeta>[];
  readonly baseRootWeights: ReadonlyMap<number, number>;
  readonly parentDepth: number;
  readonly options?: SubspaceZoomStrategyOptions<TItem>;
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
    coveredItems,
    baseRootWeights,
    parentDepth,
    options,
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

  const axes = buildLocalSubspaceAxes({
    coveredItems,
    depth: parentDepth,
    kind: 'cluster-spotlight',
    options,
    helpers,
  });

  if (axes.length === 0 || coveredItems.length < 2) {
    return buildSectorPartitionFrame({
      frameId,
      label,
      shortLabel,
      accentHex,
      breadcrumbSegments,
      parentContextLabel,
      getItemLabel: options?.getItemLabel,
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
    });
  }

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

  const uniformBary = coveredItems.map(() => ({
    l0: 1 / 3,
    l1: 1 / 3,
    l2: 1 / 3,
  }));
  const rawProtos = clusterItemsInLocalSubspace({
    coveredItems,
    axes,
    localBary: uniformBary,
    targetK: 3,
    getItemLabel: options?.getItemLabel,
  });

  const protos: SubspacePrototype[] = [...rawProtos];
  while (protos.length < 3) {
    const base = protos[protos.length % rawProtos.length]!;
    protos.push({
      ...base,
      memberIndices: [],
      label: `${base.label} · ${protos.length + 1}`,
    });
  }

  const baseLab = mixOklabColors(
    [...baseRootWeights.entries()].map(([idx, w]) => ({
      oklab: helpers.rootClusters[idx]!.oklab,
      weight: w,
    })),
  ).oklab;

  const spotLabs: readonly OklabTuple[] = [
    [
      Math.min(0.84, baseLab[0] + 0.045),
      baseLab[1] * 1.04 + 0.032,
      baseLab[2] * 0.94 - 0.022,
    ],
    [
      Math.max(0.54, baseLab[0] - 0.035),
      baseLab[1] * 0.94 - 0.028,
      baseLab[2] * 1.05 + 0.03,
    ],
    [
      baseLab[0] + 0.01,
      baseLab[1] * 0.96 - 0.012,
      baseLab[2] * 0.95 - 0.032,
    ],
  ];

  const m = axes.length;
  const vertexMembers = Array.from(
    { length: 3 },
    () =>
      new Map<
        string,
        {
          readonly item: TItem;
          readonly weight: number;
          readonly coverage: number;
          readonly isExclusive: boolean;
        }
      >(),
  );

  const nextItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = coveredItems.map(
    (it, itemIdx) => {
      const dists = [0, 1, 2].map((s) => {
        let dSq = 0;
        for (let a = 0; a < m; a++) {
          const diff = axes[a]!.values[itemIdx]! - protos[s]!.centroid[a]!;
          dSq += diff * diff;
        }
        return Math.sqrt(dSq);
      });
      const minD = Math.min(...dists);
      const scaleD = Math.max(0.35, (dists[0]! + dists[1]! + dists[2]!) / 3);
      const rawW = dists.map((d) =>
        Math.exp(-((d - minD) / (scaleD * 0.72)) * 1.55) + 0.08,
      );
      const sumW = rawW[0]! + rawW[1]! + rawW[2]! || 1;
      const unitWeights = [0, 1, 2].map((s) => ({
        clusterIndex: s,
        weight: rawW[s]! / sumW,
        coverage: rawW[s]! / sumW,
      }));

      let anchorX = 0;
      let anchorY = 0;
      for (const uw of unitWeights) {
        const vp = mesh.vertices[uw.clusterIndex]!;
        anchorX += vp.x * uw.weight;
        anchorY += vp.y * uw.weight;
        vertexMembers[uw.clusterIndex]!.set(it.id, {
          item: it.item,
          weight: uw.weight,
          coverage: uw.coverage,
          isExclusive: false,
        });
      }

      const itemCol = mixOklabColors(
        unitWeights.map((uw) => ({
          oklab: spotLabs[uw.clusterIndex]!,
          weight: uw.weight,
        })),
      );

      return {
        ...it,
        anchorX,
        anchorY,
        unitWeights,
        mixedColorHex: itemCol.hex,
        mixedOklab: itemCol.oklab,
      };
    },
  );

  const mixWeights = buildMixWeights(baseRootWeights, helpers.rootClusters);
  const baseFmt = formatMixLabel(baseRootWeights, helpers.rootClusters);
  const codePrefix = baseFmt.code.length <= 5 ? `${baseFmt.code}·` : '';
  const effectiveParentContext =
    parentContextLabel ?? truncateClean(baseFmt.label, 18);

  const clusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] = [0, 1, 2].map(
    (s) => {
      const lab = spotLabs[s]!;
      const hex = mixOklabColors([{ oklab: lab, weight: 1 }]).hex;
      const subLabel = protos[s]!.label;
      const members = [...vertexMembers[s]!.entries()].map(([itemId, rec]) => ({
        item: rec.item,
        itemId,
        coverage: rec.coverage,
        normalizedWeight: rec.weight,
        isExclusiveVertexMember: rec.isExclusive,
      }));
      return buildSynthesizedClusterDescriptor({
        clusterIndex: s,
        clusterUid: helpers.allocateClusterUid(),
        code: `${codePrefix}S${s + 1}`,
        defaultLabel: subLabel,
        oklab: lab,
        hex,
        vertex: mesh.vertices[s]!,
        coreTags: [],
        sharedTags: [],
        members,
        featureSummary: `Subspace cluster (${subLabel})`,
        role: 'intermediate',
        mixWeights,
        subclusterLabel: subLabel,
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
 * Local subspace re-clustering & facet lens zoom strategy (`mode: 'drill-down'`):
 *
 * - Projects out features that are locally constant inside the focused triangle/cluster
 *   (zero intra-subset variance, such as `milk = true` inside *Mammals* or `species = Gentoo`)
 *   and re-clusters covered items over the highest-variance local features, facets, embeddings,
 *   or similarity kernels (`requiresTags: false`, with automatic zero-config introspection).
 * - Aligns up to 6 local prototypes onto the `1:4` equilateral sub-mesh via exact `6! = 720`
 *   spatial + QAP permutation optimization, labeling each sub-vertex with its strongest
 *   distinguishing attribute (`subclusterLabel`).
 * - Replaces arbitrary `Sector A / B / C` cluster spotlights with a genuine 3-way local
 *   subspace partition while strictly guaranteeing leaf termination (`0` infinite drill loops).
 */
export function createSubspaceZoomStrategy<
  TItem = unknown,
  TTagMeta = undefined,
  TClusterMeta = undefined,
>(
  options?: SubspaceZoomStrategyOptions<TItem>,
): SimplexZoomStrategy<TItem, TTagMeta, TClusterMeta> {
  const clusterZoomMode = options?.clusterZoomMode ?? 'incident-star';
  const stopWhenFullScale = options?.stopWhenFullScale ?? true;
  const fullScaleThreshold = options?.fullScaleThreshold ?? DEFAULT_FULL_SCALE_THRESHOLD;
  const leafTriangleFocus = options?.leafTriangleFocus ?? true;
  const allowClusterDrill = clusterZoomMode !== 'none';

  const baseBarycentric = createBarycentricZoomStrategy<
    TItem,
    TTagMeta,
    TClusterMeta
  >({
    clusterZoomMode,
    adaptiveContrastStretch: true,
    enableSectorFallback: true,
    stopWhenFullScale,
    fullScaleThreshold,
    leafTriangleFocus,
  });

  const drillTriangleSubspace = (
    ctx: ZoomTriangleDrillContext<TItem, TTagMeta, TClusterMeta>,
  ): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null => {
    const { triangleIndex, parentFrame, itemScaleRatios, helpers } = ctx;
    const tri = parentFrame.mesh.triangles[triangleIndex];
    if (!tri) return null;

    if (ctx.parentDepth >= MAX_ZOOM_DRILL_DEPTH) {
      return leafTriangleFocus
        ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
        : null;
    }

    const [v0, v1, v2] = tri.vertices;
    const vSet = new Set<number>([v0, v1, v2]);
    const coveredItems = parentFrame.items.filter((it) =>
      isItemCoveredByVertices(parentFrame, it, vSet),
    );
    if (coveredItems.length <= 1) {
      return leafTriangleFocus
        ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
        : null;
    }

    if (stopWhenFullScale) {
      const stats = computeFullScaleStats(
        coveredItems.map((it) => it.id),
        itemScaleRatios,
        fullScaleThreshold,
      );
      if (!stats.hasUnderScaled) {
        return leafTriangleFocus
          ? executeSingleTriangleFocusDrill(ctx, allowClusterDrill)
          : null;
      }
    }

    const c0 = parentFrame.clusters[v0];
    const c1 = parentFrame.clusters[v1];
    const c2 = parentFrame.clusters[v2];
    const p0 = parentFrame.mesh.vertices[v0]!;
    const p1 = parentFrame.mesh.vertices[v1]!;
    const p2 = parentFrame.mesh.vertices[v2]!;

    const w0Base = getFrameVertexRootWeights(parentFrame, v0);
    const w1Base = getFrameVertexRootWeights(parentFrame, v1);
    const w2Base = getFrameVertexRootWeights(parentFrame, v2);

    const localBary = coveredItems.map((it) =>
      projectItemOntoTriangleBarycentric(
        parentFrame,
        it,
        v0,
        v1,
        v2,
        w0Base,
        w1Base,
        w2Base,
      ),
    );

    const hasSurroundingContext =
      parentFrame.mesh.triangles.length > 1 ||
      (parentFrame.contextTriangles?.length ?? 0) > 0;
    const focusPadding = computeContextAwarePadding(
      helpers.viewportWidth,
      helpers.viewportHeight,
      helpers.innerPadding,
      hasSurroundingContext,
    );
    const { mesh: subMesh, transform } = buildSubdividedTriangleMeshWithTransform(
      p0,
      p1,
      p2,
      helpers.viewportWidth,
      helpers.viewportHeight,
      focusPadding,
      parentFrame.mesh.orientation,
    );
    const neighbors = evaluateTriangleFrameNeighbors(
      parentFrame,
      triangleIndex,
      subMesh,
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
      allowClusterDrill: clusterZoomMode !== 'none',
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

    const axes = buildLocalSubspaceAxes({
      coveredItems,
      depth: ctx.parentDepth,
      kind: 'triangle',
      options,
      helpers,
    });

    const makeSpotlightFallback = (): ZoomDrillOutcome<
      TItem,
      TTagMeta,
      TClusterMeta
    > => {
      const meanWeights =
        localBary[0]?.rootWeights ?? mixRootWeightMaps(w0Base, 1, w1Base, 0);
      return {
        nextFrame: buildSubspaceSpotlightFrame({
          frameId: `sub-spot-${parentFrame.frameId}-t${triangleIndex}`,
          label: triCrumb.label,
          shortLabel: triCrumb.shortLabel,
          accentHex: triMixed.hex,
          breadcrumbSegments: triCrumb.segments,
          parentContextLabel: truncateClean(triCrumb.shortLabel, 20),
          coveredItems,
          baseRootWeights: meanWeights,
          parentDepth: ctx.parentDepth,
          options,
          helpers,
          neighbors,
          sourceTrianglePoints: [p0, p1, p2],
          innerPadding: focusPadding,
          meshOrientation: parentFrame.mesh.orientation,
          contextTriangles: context.contextTriangles,
          contextEdges: context.contextEdges,
          contextClusters: context.contextClusters,
          contextItems: context.contextItems,
        }),
      };
    };

    if (axes.length === 0 || coveredItems.length <= 3) {
      if (axes.length > 0) {
        return makeSpotlightFallback();
      }
      return baseBarycentric.drillIntoTriangle!(ctx);
    }

    const rawProtos = clusterItemsInLocalSubspace({
      coveredItems,
      axes,
      localBary,
      targetK: Math.min(6, coveredItems.length),
      getItemLabel: options?.getItemLabel,
    });

    if (rawProtos.length < 3) {
      return makeSpotlightFallback();
    }

    const alignedProtos = alignSixPrototypesToSubMesh(
      rawProtos,
      coveredItems.length,
    );
    const m = axes.length;

    const faceCounts = [0, 0, 0, 0];
    const itemAssignments = coveredItems.map((_, itemIdx) => {
      const b = localBary[itemIdx]!;
      const dists = alignedProtos.map((proto, vIdx) => {
        let dSq = 0;
        for (let a = 0; a < m; a++) {
          const diff = axes[a]!.values[itemIdx]! - proto.centroid[a]!;
          dSq += diff * diff;
        }
        const vb = SUB_MESH_VERTEX_BARY[vIdx]!;
        const spatialPrior =
          0.08 *
          ((b.l0 - vb[0]) * (b.l0 - vb[0]) +
            (b.l1 - vb[1]) * (b.l1 - vb[1]) +
            (b.l2 - vb[2]) * (b.l2 - vb[2]));
        return Math.sqrt(dSq + spatialPrior);
      });

      const minD = Math.min(...dists);
      const meanD =
        dists.reduce((acc, d) => acc + d, 0) / Math.max(1, dists.length);
      const kernelBandwidth = Math.max(0.32, meanD * 0.68);
      const vAff = dists.map(
        (d) => Math.exp(-((d - minD) / kernelBandwidth) * 1.65) + 0.03,
      );

      let bestFaceIdx = 0;
      let bestFaceScore = -Infinity;
      for (let fIdx = 0; fIdx < subMesh.triangles.length; fIdx++) {
        const [va, vb, vc] = subMesh.triangles[fIdx]!.vertices;
        const maxCornerAff = Math.max(vAff[va]!, vAff[vb]!, vAff[vc]!);
        const sumFaceAff = vAff[va]! + vAff[vb]! + vAff[vc]!;
        const crowdPenalty = 1 + 0.12 * (faceCounts[fIdx] ?? 0);
        const score = (0.58 * sumFaceAff + 0.42 * maxCornerAff) / crowdPenalty;
        if (score > bestFaceScore) {
          bestFaceScore = score;
          bestFaceIdx = fIdx;
        }
      }

      faceCounts[bestFaceIdx] = (faceCounts[bestFaceIdx] ?? 0) + 1;
      const [va, vb, vc] = subMesh.triangles[bestFaceIdx]!.vertices;
      const rawTriW = [vAff[va]!, vAff[vb]!, vAff[vc]!];
      const sumTriW = rawTriW[0]! + rawTriW[1]! + rawTriW[2]! || 1;
      const unitWeights = [va, vb, vc].map((vIdx, pos) => {
        const w = 0.84 * (rawTriW[pos]! / sumTriW) + 0.16 * (1 / 3);
        return {
          clusterIndex: vIdx,
          weight: w,
          coverage: w,
        };
      });
      return { faceIndex: bestFaceIdx, unitWeights };
    });

    const maxFaceCount = Math.max(...faceCounts);
    if (maxFaceCount >= coveredItems.length) {
      return makeSpotlightFallback();
    }

    const vWeights: ReadonlyMap<number, number>[] = [
      w0Base,
      w1Base,
      w2Base,
      mixRootWeightMaps(w0Base, 0.5, w1Base, 0.5),
      mixRootWeightMaps(w1Base, 0.5, w2Base, 0.5),
      mixRootWeightMaps(w2Base, 0.5, w0Base, 0.5),
    ];

    const vertexColors = vWeights.map((vw, vIdx) => {
      if (vIdx < 3) {
        const corner = [c0, c1, c2][vIdx];
        if (corner) return { hex: corner.colorHex, oklab: corner.oklab };
      }
      return mixOklabColors(
        [...vw.entries()].map(([rIdx, rw]) => ({
          oklab: helpers.rootClusters[rIdx]!.oklab,
          weight: rw,
        })),
      );
    });

    const vertexMembers = Array.from(
      { length: 6 },
      () =>
        new Map<
          string,
          {
            readonly item: TItem;
            readonly weight: number;
            readonly coverage: number;
            readonly isExclusive: boolean;
          }
        >(),
    );

    const subItems: ZoomItemAnchorInput<TItem, TTagMeta>[] = coveredItems.map(
      (it, idx) => {
        const assign = itemAssignments[idx]!;
        let anchorX = 0;
        let anchorY = 0;
        for (const uw of assign.unitWeights) {
          const vp = subMesh.vertices[uw.clusterIndex]!;
          anchorX += vp.x * uw.weight;
          anchorY += vp.y * uw.weight;
          vertexMembers[uw.clusterIndex]!.set(it.id, {
            item: it.item,
            weight: uw.weight,
            coverage: uw.coverage,
            isExclusive: assign.unitWeights.length === 1,
          });
        }
        const itemMix = mixOklabColors(
          assign.unitWeights.map((uw) => ({
            oklab: vertexColors[uw.clusterIndex]!.oklab,
            weight: uw.weight,
          })),
        );
        return {
          ...it,
          anchorX,
          anchorY,
          unitWeights: assign.unitWeights,
          mixedColorHex: itemMix.hex,
          mixedOklab: itemMix.oklab,
        };
      },
    );

    const parentCorners = [c0, c1, c2];
    const subClusters: ClusterDescriptor<TItem, TTagMeta, TClusterMeta>[] =
      vWeights.map((vw, vIdx) => {
        const vert = subMesh.vertices[vIdx]!;
        const parentCorner = vIdx < 3 ? parentCorners[vIdx] : undefined;
        const vCol = vertexColors[vIdx]!;
        const proto = alignedProtos[vIdx]!;
        const fmt = formatMixLabel(vw, helpers.rootClusters);
        const mixWeights = buildMixWeights(vw, helpers.rootClusters);
        const members = [...vertexMembers[vIdx]!.entries()].map(
          ([itemId, rec]) => ({
            item: rec.item,
            itemId,
            coverage: rec.coverage,
            normalizedWeight: rec.weight,
            isExclusiveVertexMember: rec.isExclusive,
          }),
        );

        return buildSynthesizedClusterDescriptor({
          clusterIndex: vIdx,
          clusterUid: helpers.allocateClusterUid(),
          code: parentCorner ? parentCorner.code : fmt.code,
          defaultLabel: proto.label,
          oklab: vCol.oklab,
          hex: vCol.hex,
          vertex: vert,
          coreTags: [],
          sharedTags: [],
          members,
          featureSummary: `Subspace cluster (${proto.label})`,
          role: 'intermediate',
          mixWeights,
          subclusterLabel: proto.label,
          parentContextLabel: parentCorner
            ? deriveCornerParentContextLabel(parentCorner)
            : undefined,
          deriveClusterMeta: helpers.deriveClusterMeta,
        });
      });

    const itemRootMap = new Map<string, ReadonlyMap<number, number>>();
    coveredItems.forEach((it, idx) => {
      itemRootMap.set(it.id, localBary[idx]!.rootWeights);
    });

    return {
      nextFrame: {
        frameId: `sub-${parentFrame.frameId}-t${triangleIndex}`,
        kind: 'triangle',
        label: triCrumb.label,
        shortLabel: triCrumb.shortLabel,
        accentHex: triMixed.hex,
        breadcrumbSegments: triCrumb.segments,
        mesh: subMesh,
        clusters: subClusters,
        items: subItems,
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
        strategyData: {
          kind: 'triangle',
          parentTriIndex: triangleIndex,
          vertexWeights: vWeights.map((rw) => ({ rootWeights: rw })),
          itemRootWeights: itemRootMap,
        } satisfies InternalFrameMeta,
      },
    };
  };

  const drillClusterSubspace = (
    ctx: ZoomClusterDrillContext<TItem, TTagMeta, TClusterMeta>,
  ): ZoomDrillOutcome<TItem, TTagMeta, TClusterMeta> | null => {
    if (clusterZoomMode === 'none') {
      return null;
    }
    if (
      clusterZoomMode === 'spotlight' &&
      ctx.parentDepth >= MAX_ZOOM_DRILL_DEPTH
    ) {
      return null;
    }
    if (ctx.parentDepth > MAX_ZOOM_DRILL_DEPTH) {
      return null;
    }
    const { clusterIndex, parentFrame, itemScaleRatios, helpers } = ctx;
    const meta = parentFrame.strategyData as InternalFrameMeta | undefined;
    if (meta?.kind === 'cluster-spotlight') return null;

    const cluster = parentFrame.clusters[clusterIndex];
    if (!cluster) return null;

    const incTris = parentFrame.mesh.triangles.filter((t) =>
      t.vertices.includes(clusterIndex),
    );

    if (clusterZoomMode === 'incident-star') {
      if (incTris.length === 0) return null;
      if (meta?.kind === 'cluster-star' && clusterIndex === 0) {
        return null;
      }
      return executeClusterStarDrill(ctx, true);
    }

    const directItems = parentFrame.items.filter((it) =>
      it.unitWeights.some(
        (uw) => uw.clusterIndex === clusterIndex && uw.weight >= 0.45,
      ),
    );
    if (directItems.length <= 1) return null;
    if (stopWhenFullScale) {
      const stats = computeFullScaleStats(
        directItems.map((it) => it.id),
        itemScaleRatios,
        fullScaleThreshold,
      );
      if (!stats.hasUnderScaled) return null;
    }

    const {
      targetVert,
      sourceSpan,
      sourceTrianglePoints,
      focusPadding,
      spotContext,
    } = buildClusterSpotlightSetup({
      clusterIndex,
      parentFrame,
      directItems,
      helpers,
    });

    const spotCrumb = buildClusterBreadcrumbInfo(cluster);
    return {
      nextFrame: buildSubspaceSpotlightFrame({
        frameId: `sub-spotlight-${parentFrame.frameId}-c${clusterIndex}`,
        label: spotCrumb.label,
        shortLabel: spotCrumb.shortLabel,
        accentHex: cluster.colorHex,
        breadcrumbSegments: spotCrumb.segments,
        parentContextLabel: deriveCornerParentContextLabel(cluster),
        coveredItems: directItems,
        baseRootWeights: getFrameVertexRootWeights(parentFrame, clusterIndex),
        parentDepth: ctx.parentDepth,
        options,
        helpers,
        neighbors: [],
        sourceTrianglePoints,
        innerPadding: focusPadding,
        meshOrientation: parentFrame.mesh.orientation,
        sourceCenter: targetVert
          ? { x: targetVert.x, y: targetVert.y }
          : undefined,
        sourceSpan,
        contextTriangles: spotContext.contextTriangles,
        contextEdges: spotContext.contextEdges,
        contextClusters: spotContext.contextClusters,
        contextItems: spotContext.contextItems,
      }),
    };
  };

  return {
    name: 'subspace-recluster',
    mode: 'drill-down',
    evaluateTargets: baseBarycentric.evaluateTargets,
    drillIntoTriangle: drillTriangleSubspace,
    drillIntoCluster: drillClusterSubspace,
    drillToNeighbor(ctx) {
      const { localTarget } = parseScopedNeighborId(ctx.neighborId);
      const { parentFrame, itemScaleRatios, helpers } = ctx;
      if (localTarget.startsWith('tri:')) {
        const triIdx = parseInt(localTarget.slice(4), 10);
        if (!Number.isFinite(triIdx)) return null;
        const outcome = drillTriangleSubspace({
          triangleIndex: triIdx,
          parentFrame,
          parentDepth: ctx.currentDepth - 1,
          itemScaleRatios,
          helpers,
        });
        return outcome ? { ...outcome, replaceTop: true } : null;
      }
      if (localTarget.startsWith('cluster:')) {
        const cIdx = parseInt(localTarget.slice(8), 10);
        if (!Number.isFinite(cIdx)) return null;
        const targetCluster = parentFrame.clusters[cIdx];
        if (!targetCluster) return null;
        const outcome = drillClusterSubspace({
          clusterUid: targetCluster.clusterUid,
          clusterIndex: cIdx,
          parentFrame,
          parentDepth: ctx.currentDepth - 1,
          itemScaleRatios,
          helpers,
        });
        return outcome ? { ...outcome, replaceTop: true } : null;
      }
      return null;
    },
  };
}
