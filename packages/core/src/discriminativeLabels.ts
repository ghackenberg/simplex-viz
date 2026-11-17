import type { ClusterDerivationContext, PeerClusterContext } from './types';
import type { SubspaceZoomFeature } from './zoom';

/**
 * Input cluster descriptor accepted by `assignDiscriminativeClusterLabels`.
 */
export interface DiscriminativeClusterInput<TItem> {
  readonly code?: string;
  readonly defaultLabel?: string;
  readonly members: ReadonlyArray<{
    readonly item: TItem;
    readonly normalizedWeight?: number;
    readonly isExclusiveVertexMember?: boolean;
  }>;
  readonly representativeItems?: ReadonlyArray<{
    readonly item: TItem;
  }>;
}

/**
 * Options controlling base-rate specificity scoring and collision-free sibling cluster labeling.
 */
export interface DiscriminativeClusterLabelOptions<TItem> {
  /** Interpretable numeric, boolean, or categorical features evaluated across the corpus. */
  readonly features: readonly SubspaceZoomFeature<TItem>[];
  /** Optional human-readable item title extractor used as exemplar fallback. */
  readonly getItemLabel?: (item: TItem) => string;
  /** Maximum character budget when joining a primary group and secondary qualifier (`A · B`). Default: `24`. */
  readonly maxCompoundLength?: number;
}

interface ScoredCandidate {
  readonly clusterIdx: number;
  readonly label: string;
  readonly familyKey: string;
  readonly score: number;
  readonly purity: number;
  readonly isPrimaryTaxonomic: boolean;
}

function truncateSegmentClean(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(2, maxLen - 1)).trimEnd()}…`;
}

function formatCompoundClusterLabel(
  primary: string,
  qualifier: string,
  maxCompoundLength: number,
): string {
  const joined = `${primary} · ${qualifier}`;
  if (joined.length <= maxCompoundLength) return joined;
  const halfBudget = Math.max(6, Math.floor((maxCompoundLength - 3) / 2));
  const pShort = truncateSegmentClean(primary, Math.max(halfBudget, primary.length <= 12 ? primary.length : halfBudget + 1));
  const rem = Math.max(5, maxCompoundLength - 3 - pShort.length);
  const qShort = truncateSegmentClean(qualifier, rem);
  return `${pShort} · ${qShort}`;
}

function extractExemplarTitle<TItem>(
  item: TItem,
  fallbackIndex: number,
  getItemLabel?: (item: TItem) => string,
): string {
  if (getItemLabel) {
    const custom = getItemLabel(item)?.trim();
    if (custom) return truncateSegmentClean(custom, 20);
  }
  if (item && typeof item === 'object') {
    const rec = item as Record<string, unknown>;
    for (const key of ['shortTitle', 'title', 'speciesName', 'name', 'label', 'headline']) {
      const val = rec[key];
      if (typeof val === 'string' && val.trim().length > 0) {
        const cleaned = val.trim().replace(/\s*\(\d{4}\)\s*$/, '');
        return truncateSegmentClean(cleaned, 20);
      }
    }
  }
  return `Group ${fallbackIndex + 1}`;
}

function memberEffectiveWeight(member: {
  readonly normalizedWeight?: number;
  readonly isExclusiveVertexMember?: boolean;
}): number {
  const nw = Math.max(0.05, Math.min(1, member.normalizedWeight ?? 1));
  const base = Math.pow(nw, 1.5);
  return member.isExclusiveVertexMember ? base * 1.25 : base;
}

/**
 * Jointly assigns concise, human-readable, **100% collision-free** labels to a set of sibling
 * clusters (`0 .. K-1`) by scoring each feature against the corpus base rate:
 *
 * - **Numeric features**: Standardized z-score of the weighted cluster mean vs. corpus mean/std.
 * - **Boolean features**: Over-/under-representation lift above/below corpus prevalence.
 * - **Categorical features**: Specificity lift over corpus base rate (suppressing ubiquitous
 *   background categories such as a 77% `"Drama"` majority while highlighting genuine category poles).
 * - **Shared taxonomic disambiguation**: When two or more sibling clusters share the same high-purity
 *   primary category (e.g. two `"Chinstrap"` penguin clusters), all sharing clusters retain their
 *   category name and append their strongest orthogonal secondary trait (`"Chinstrap · Male"` vs.
 *   `"Chinstrap · Female"`).
 */
export function assignDiscriminativeClusterLabels<TItem>(
  clusters: readonly DiscriminativeClusterInput<TItem>[],
  options: DiscriminativeClusterLabelOptions<TItem>,
  allItems?: readonly TItem[],
): readonly string[] {
  const k = clusters.length;
  if (k === 0) return [];

  const maxCompoundLength = options.maxCompoundLength ?? 24;
  const corpusItems: TItem[] = [];
  if (allItems && allItems.length > 0) {
    for (const it of allItems) corpusItems.push(it);
  } else {
    const seen = new Set<TItem>();
    for (const c of clusters) {
      for (const m of c.members) {
        if (!seen.has(m.item)) {
          seen.add(m.item);
          corpusItems.push(m.item);
        }
      }
    }
  }

  if (corpusItems.length === 0) {
    return clusters.map((c, idx) => c.defaultLabel || c.code || `Cluster ${idx + 1}`);
  }

  const perClusterMembers: ReadonlyArray<
    ReadonlyArray<{ readonly item: TItem; readonly weight: number }>
  > = clusters.map((c) => {
    if (c.members.length > 0) {
      return c.members.map((m) => ({
        item: m.item,
        weight: memberEffectiveWeight(m),
      }));
    }
    if (c.representativeItems && c.representativeItems.length > 0) {
      return c.representativeItems.map((r) => ({ item: r.item, weight: 1 }));
    }
    return [];
  });

  const candidatesByCluster: ScoredCandidate[][] = Array.from({ length: k }, () => []);

  options.features.forEach((feat, featIdx) => {
    if ((feat.minDepth ?? 0) > 0) return;
    const weight = Math.max(0.1, feat.weight ?? 1.0);
    const familyKey = feat.id ?? `feat-${featIdx}-${feat.label}`;

    // Inspect value type across corpusItems
    const rawCorpusVals = corpusItems.map((it) => feat.getValue(it));
    let detectedKind: 'numeric' | 'boolean' | 'categorical' | null = null;
    for (const v of rawCorpusVals) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'number' && Number.isFinite(v)) {
        detectedKind = 'numeric';
        break;
      }
      if (typeof v === 'boolean') {
        detectedKind = 'boolean';
        break;
      }
      if (typeof v === 'string' && v.trim().length > 0) {
        detectedKind = 'categorical';
        break;
      }
    }
    if (!detectedKind) return;

    if (detectedKind === 'numeric') {
      const validNums: number[] = [];
      for (const v of rawCorpusVals) {
        if (typeof v === 'number' && Number.isFinite(v)) validNums.push(v);
      }
      if (validNums.length < 2) return;
      const mean0 = validNums.reduce((s, x) => s + x, 0) / validNums.length;
      const variance0 =
        validNums.reduce((s, x) => s + (x - mean0) * (x - mean0), 0) / validNums.length;
      const std0 = Math.sqrt(variance0);
      if (std0 <= 1e-9) return;

      for (let cIdx = 0; cIdx < k; cIdx++) {
        const ms = perClusterMembers[cIdx]!;
        let wSum = 0;
        let valSum = 0;
        for (const m of ms) {
          const v = feat.getValue(m.item);
          if (typeof v === 'number' && Number.isFinite(v)) {
            wSum += m.weight;
            valSum += m.weight * v;
          }
        }
        if (wSum <= 1e-9) continue;
        const meanK = valSum / wSum;
        const z = (meanK - mean0) / std0;
        if (Math.abs(z) >= 0.18) {
          const custom = feat.formatMean ? feat.formatMean(meanK, mean0) : undefined;
          const label =
            custom ??
            (z >= 0
              ? (feat.highLabel ?? `High ${feat.label}`)
              : (feat.lowLabel ?? `Low ${feat.label}`));
          candidatesByCluster[cIdx]!.push({
            clusterIdx: cIdx,
            label,
            familyKey,
            score: Math.abs(z) * weight,
            purity: 0,
            isPrimaryTaxonomic: false,
          });
        }
      }
    } else if (detectedKind === 'boolean') {
      let nValid = 0;
      let nTrue = 0;
      for (const v of rawCorpusVals) {
        if (typeof v === 'boolean') {
          nValid += 1;
          if (v) nTrue += 1;
        }
      }
      if (nValid < 2) return;
      const p0 = nTrue / nValid;
      if (p0 <= 0 || p0 >= 1) return;
      const std0 = Math.sqrt(p0 * (1 - p0));

      for (let cIdx = 0; cIdx < k; cIdx++) {
        const ms = perClusterMembers[cIdx]!;
        let wSum = 0;
        let trueSum = 0;
        for (const m of ms) {
          const v = feat.getValue(m.item);
          if (typeof v === 'boolean') {
            wSum += m.weight;
            if (v) trueSum += m.weight;
          }
        }
        if (wSum <= 1e-9) continue;
        const pK = trueSum / wSum;
        const z = (pK - p0) / std0;

        if (pK >= 0.40 && pK - p0 >= 0.10) {
          candidatesByCluster[cIdx]!.push({
            clusterIdx: cIdx,
            label: feat.highLabel ?? feat.label,
            familyKey,
            score: z * weight + pK * 0.45,
            purity: pK,
            isPrimaryTaxonomic: false,
          });
        } else if (feat.lowLabel && pK <= 0.55 && p0 - pK >= 0.12) {
          candidatesByCluster[cIdx]!.push({
            clusterIdx: cIdx,
            label: feat.lowLabel,
            familyKey,
            score: -z * weight + (1 - pK) * 0.45,
            purity: 1 - pK,
            isPrimaryTaxonomic: false,
          });
        }
      }
    } else if (detectedKind === 'categorical') {
      const catCounts = new Map<string, number>();
      let nValid = 0;
      for (const v of rawCorpusVals) {
        if (typeof v === 'string' && v.trim().length > 0) {
          const clean = v.trim();
          catCounts.set(clean, (catCounts.get(clean) ?? 0) + 1);
          nValid += 1;
        }
      }
      if (nValid < 2 || catCounts.size < 2) return;

      for (const [catVal, count0] of catCounts.entries()) {
        if (count0 < 2) continue;
        const p0 = count0 / nValid;
        if (p0 <= 0 || p0 >= 1) continue;
        const std0 = Math.sqrt(p0 * (1 - p0));

        const clusterShares = new Float64Array(k);
        const validClusterFlags = new Uint8Array(k);
        let minShare = 1;
        for (let cIdx = 0; cIdx < k; cIdx++) {
          const ms = perClusterMembers[cIdx]!;
          let wSum = 0;
          let matchSum = 0;
          for (const m of ms) {
            const v = feat.getValue(m.item);
            if (typeof v === 'string' && v.trim().length > 0) {
              wSum += m.weight;
              if (v.trim() === catVal) matchSum += m.weight;
            }
          }
          if (wSum > 1e-9) {
            const share = matchSum / wSum;
            clusterShares[cIdx] = share;
            validClusterFlags[cIdx] = 1;
            if (share < minShare) minShare = share;
          }
        }

        const isUbiquitousBackground = p0 > 0.68 || (p0 > 0.52 && minShare >= 0.30);

        for (let cIdx = 0; cIdx < k; cIdx++) {
          if (!validClusterFlags[cIdx]) continue;
          const pK = clusterShares[cIdx]!;
          const z = (pK - p0) / std0;

          if (isUbiquitousBackground) {
            // High-base-rate background category present across clusters (e.g. 76.6% "Drama"):
            // Require substantial positive lift above base rate and discount background prevalence.
            if (pK >= p0 + 0.15) {
              candidatesByCluster[cIdx]!.push({
                clusterIdx: cIdx,
                label: catVal,
                familyKey,
                score: (z * weight + pK * 0.35) * (1 - p0) * 1.5,
                purity: pK,
                isPrimaryTaxonomic: false,
              });
            }
          } else if (
            (pK >= 0.45 && pK >= p0 + 0.08) ||
            (pK >= 0.40 && z >= 1.25)
          ) {
            candidatesByCluster[cIdx]!.push({
              clusterIdx: cIdx,
              label: catVal,
              familyKey,
              score: z * weight + pK * (0.85 - 0.5 * p0),
              purity: pK,
              isPrimaryTaxonomic:
                pK >= 0.55 && minShare < 0.30 && weight >= 1.25,
            });
          }
        }
      }
    }
  });

  for (let cIdx = 0; cIdx < k; cIdx++) {
    candidatesByCluster[cIdx]!.sort(
      (a, b) => b.score - a.score || a.label.localeCompare(b.label),
    );
  }

  const assigned = new Array<string>(k).fill('');
  const usedLabels = new Set<string>();

  // Pass 1: Primary Taxonomic Groups — keep singletons unadorned ("Gentoo") and
  // symmetrically disambiguate shared primary groups ("Chinstrap · Male" vs "Chinstrap · Female").
  const primaryGroups = new Map<string, { label: string; familyKey: string; indices: number[] }>();
  for (let cIdx = 0; cIdx < k; cIdx++) {
    const top = candidatesByCluster[cIdx]!.find((c) => c.isPrimaryTaxonomic);
    if (top) {
      const key = top.label.toLowerCase();
      const existing = primaryGroups.get(key);
      if (existing) {
        existing.indices.push(cIdx);
      } else {
        primaryGroups.set(key, {
          label: top.label,
          familyKey: top.familyKey,
          indices: [cIdx],
        });
      }
    }
  }

  for (const group of primaryGroups.values()) {
    if (group.indices.length === 1) {
      const idx = group.indices[0]!;
      const norm = group.label.toLowerCase();
      if (!usedLabels.has(norm)) {
        assigned[idx] = group.label;
        usedLabels.add(norm);
      }
    } else {
      // Multiple sibling clusters share this primary taxonomic identity (e.g. two "Chinstrap" clusters):
      // Evaluate secondary features WITHIN the union of these sibling clusters so constant intra-group
      // traits (like "Dream" island for all Chinstraps) drop out and true contrasting traits win!
      const groupClusterInputs = group.indices.map((idx) => clusters[idx]!);
      const groupItemSet = new Set<TItem>();
      const groupAllItems: TItem[] = [];
      for (const idx of group.indices) {
        for (const m of clusters[idx]!.members) {
          if (!groupItemSet.has(m.item)) {
            groupItemSet.add(m.item);
            groupAllItems.push(m.item);
          }
        }
      }
      const secondaryFeatures = options.features.filter(
        (feat, fIdx) => (feat.id ?? `feat-${fIdx}-${feat.label}`) !== group.familyKey,
      );
      if (secondaryFeatures.length > 0 && groupAllItems.length >= 2) {
        const subLabels = assignDiscriminativeClusterLabels(
          groupClusterInputs,
          {
            features: secondaryFeatures,
            getItemLabel: options.getItemLabel,
            maxCompoundLength: Math.max(10, maxCompoundLength - group.label.length - 3),
          },
          groupAllItems,
        );
        group.indices.forEach((cIdx, localIdx) => {
          const qual = subLabels[localIdx];
          if (qual) {
            const compound = formatCompoundClusterLabel(
              group.label,
              qual,
              maxCompoundLength,
            );
            if (!usedLabels.has(compound.toLowerCase())) {
              assigned[cIdx] = compound;
              usedLabels.add(compound.toLowerCase());
            }
          }
        });
      }
    }
  }

  // Pass 2: Greedy maximum-contrast unique single-facet assignment for remaining clusters
  const flatRemaining: ScoredCandidate[] = [];
  for (let cIdx = 0; cIdx < k; cIdx++) {
    if (assigned[cIdx]) continue;
    for (const cand of candidatesByCluster[cIdx]!) {
      flatRemaining.push(cand);
    }
  }
  flatRemaining.sort((a, b) => b.score - a.score || a.clusterIdx - b.clusterIdx);

  for (const cand of flatRemaining) {
    if (assigned[cand.clusterIdx]) continue;
    const norm = cand.label.toLowerCase();
    if (usedLabels.has(norm)) continue;
    assigned[cand.clusterIdx] = cand.label;
    usedLabels.add(norm);
  }

  // Pass 3: Orthogonal compound facet combination or highest-weight exemplar fallback
  for (let cIdx = 0; cIdx < k; cIdx++) {
    if (assigned[cIdx]) continue;
    const cands = candidatesByCluster[cIdx]!;
    let foundCompound = false;
    for (let i = 0; i < cands.length && !foundCompound; i++) {
      for (let j = i + 1; j < cands.length; j++) {
        if (cands[i]!.familyKey === cands[j]!.familyKey) continue;
        const combo = formatCompoundClusterLabel(
          cands[i]!.label,
          cands[j]!.label,
          maxCompoundLength,
        );
        if (!usedLabels.has(combo.toLowerCase())) {
          assigned[cIdx] = combo;
          usedLabels.add(combo.toLowerCase());
          foundCompound = true;
          break;
        }
      }
    }
    if (foundCompound) continue;

    // Exemplar fallback from representativeItems or highest-weight member
    const cluster = clusters[cIdx]!;
    const exemplarCandidates: TItem[] = [];
    if (cluster.representativeItems) {
      for (const r of cluster.representativeItems) exemplarCandidates.push(r.item);
    }
    const sortedMembers = [...cluster.members].sort(
      (a, b) => (b.normalizedWeight ?? 0) - (a.normalizedWeight ?? 0),
    );
    for (const m of sortedMembers) exemplarCandidates.push(m.item);

    let chosen = '';
    for (const item of exemplarCandidates) {
      const exTitle = `“${extractExemplarTitle(item, cIdx, options.getItemLabel)}”`;
      if (!usedLabels.has(exTitle.toLowerCase())) {
        chosen = exTitle;
        break;
      }
    }
    if (!chosen) {
      const base = cluster.defaultLabel || cluster.code || `Group ${cIdx + 1}`;
      chosen = usedLabels.has(base.toLowerCase()) ? `${base} · ${cIdx + 1}` : base;
    }
    assigned[cIdx] = chosen;
    usedLabels.add(chosen.toLowerCase());
  }

  return assigned;
}

const PEER_LABEL_CACHE = new WeakMap<
  readonly PeerClusterContext<unknown>[],
  Map<readonly SubspaceZoomFeature<unknown>[], readonly string[]>
>();

/**
 * Ergonomic per-cluster helper designed to be called directly inside `deriveClusterMeta(ctx)`.
 * Computes `assignDiscriminativeClusterLabels` jointly across `ctx.peerClusters` once per frame
 * (cached via `WeakMap`) and returns the collision-free label for `ctx.clusterIndex`.
 */
export function resolveDiscriminativeClusterLabel<TItem, TTagMeta = undefined>(
  ctx: ClusterDerivationContext<TItem, TTagMeta>,
  options: DiscriminativeClusterLabelOptions<TItem>,
): string {
  const peers = ctx.peerClusters;
  if (!peers || peers.length <= 1) {
    return assignDiscriminativeClusterLabels([ctx], options, ctx.allItems)[0]!;
  }

  const peerKey = peers as unknown as readonly PeerClusterContext<unknown>[];
  const featKey = options.features as unknown as readonly SubspaceZoomFeature<unknown>[];
  let byFeatures = PEER_LABEL_CACHE.get(peerKey);
  if (!byFeatures) {
    byFeatures = new Map();
    PEER_LABEL_CACHE.set(peerKey, byFeatures);
  }
  let cached = byFeatures.get(featKey);
  if (!cached) {
    cached = assignDiscriminativeClusterLabels(peers, options, ctx.allItems);
    byFeatures.set(featKey, cached);
  }
  return cached[ctx.clusterIndex] ?? ctx.defaultLabel ?? ctx.code;
}

const CUSTOM_TITLE_CACHE = new WeakMap<
  readonly PeerClusterContext<unknown>[],
  readonly string[]
>();

/**
 * Ensures custom heuristic cluster titles (e.g. IPA vowel pairs or tag combinations) are unique
 * across all sibling `ctx.peerClusters`, appending `computeQualifier(peer)` only when two or more
 * sibling clusters collide on the same primary title.
 */
export function disambiguatePeerClusterTitle<TItem, TTagMeta = undefined>(
  ctx: ClusterDerivationContext<TItem, TTagMeta>,
  computeTitle: (peer: PeerClusterContext<TItem, TTagMeta>) => string,
  computeQualifier?: (peer: PeerClusterContext<TItem, TTagMeta>) => string | undefined,
): string {
  const peers = ctx.peerClusters;
  if (!peers || peers.length <= 1) {
    return computeTitle(ctx);
  }
  const peerKey = peers as unknown as readonly PeerClusterContext<unknown>[];
  const existing = CUSTOM_TITLE_CACHE.get(peerKey);
  if (existing) {
    return existing[ctx.clusterIndex] ?? computeTitle(ctx);
  }

  const rawTitles = peers.map((p) => computeTitle(p).trim() || p.defaultLabel || p.code);
  const counts = new Map<string, number>();
  for (const t of rawTitles) {
    const key = t.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const used = new Set<string>();
  const resolved = rawTitles.map((raw, idx) => {
    const key = raw.toLowerCase();
    if ((counts.get(key) ?? 0) === 1 && !used.has(key)) {
      used.add(key);
      return raw;
    }
    const qual = computeQualifier ? computeQualifier(peers[idx]!)?.trim() : undefined;
    if (qual) {
      const compound = formatCompoundClusterLabel(raw, qual, 24);
      if (!used.has(compound.toLowerCase())) {
        used.add(compound.toLowerCase());
        return compound;
      }
    }
    let suffix = 2;
    let candidate = !used.has(key) ? raw : `${raw} · ${suffix}`;
    while (used.has(candidate.toLowerCase())) {
      suffix += 1;
      candidate = `${raw} · ${suffix}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });

  CUSTOM_TITLE_CACHE.set(peerKey, resolved);
  return resolved[ctx.clusterIndex]!;
}
