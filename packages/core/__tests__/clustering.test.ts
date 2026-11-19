import { describe, expect, it } from 'vitest';
import {
  computeSimplexClustering,
  extractNormalizedItems,
  resolveTagDisplayLabel,
  type PreviousClusterSnapshot,
} from '../src/clustering';
import { buildSimplexMesh } from '../src/mesh';
import { solveSimplexSnapshot } from '../src/snapshot';

interface RawArticle {
  readonly slug: string;
  readonly topics: readonly string[];
}

const SAMPLE_CORPUS: readonly RawArticle[] = [
  { slug: 'a1', topics: ['Rust', 'Wasm'] },
  { slug: 'a2', topics: ['rust', 'Compilers'] },
  { slug: 'a3', topics: ['TypeScript', 'Compilers', 'AST'] },
  { slug: 'a4', topics: ['TypeScript', 'React', 'SVG'] },
  { slug: 'a5', topics: ['SVG', 'Animation', 'Geometry'] },
  { slug: 'a6', topics: ['Geometry', 'Triangulation', 'SAT'] },
  { slug: 'a7', topics: ['OKLab', 'Color', 'SVG'] },
  { slug: 'a8', topics: ['CRDT', 'Distributed', 'Consensus'] },
  { slug: 'a9', topics: ['Embeddings', 'Clustering', 'Triangulation'] },
  { slug: 'a10', topics: ['Testing', 'TypeScript', 'SAT'] },
  { slug: 'a11', topics: ['WebGL', 'Shaders', 'OKLab'] },
  { slug: 'a12', topics: ['React', 'Accessibility', 'Typography'] },
  { slug: 'a13', topics: ['Rust', 'Geometry', 'WebGL'] },
  { slug: 'a14', topics: ['  ', ''] }, // Empty tags only -> safely ignored
];

describe('computeSimplexClustering', () => {
  it('retains 100% of normalized tags with disjoint core sets and 100% planar triangle coverage', () => {
    const normalized = extractNormalizedItems(
      SAMPLE_CORPUS,
      (x) => x.slug,
      (x) => x.topics,
    );

    // Item a14 had only empty tags and must be filtered cleanly
    expect(normalized.length).toBe(13);

    const uniqueInputTags = new Set(normalized.flatMap((n) => n.tags));
    const mesh = buildSimplexMesh(1000, 680, uniqueInputTags.size, { maxClusters: 9 });

    const seq = { value: 0 };
    const result = computeSimplexClustering({
      normalizedItems: normalized,
      mesh,
      deriveClusterMeta: (ctx) => ({ count: ctx.members.length }),
      nextClusterUidSeq: seq,
      seed: 42,
    });

    // Every unique input tag must exist in exactly one core partition
    const coreTagsSeen = new Set<string>();
    for (const c of result.clusters) {
      for (const t of c.coreTags) {
        expect(coreTagsSeen.has(t.tag)).toBe(false);
        coreTagsSeen.add(t.tag);
      }
    }
    expect(coreTagsSeen.size).toBe(uniqueInputTags.size);
    for (const tag of uniqueInputTags) {
      expect(coreTagsSeen.has(tag)).toBe(true);
    }

    // 100% of items must be completely covered by their assigned simplex unit (1, 2, or 3 vertices)
    for (const placed of result.items) {
      const unitTags = new Set<string>();
      for (const uc of placed.layoutContext.unitClusters) {
        for (const t of uc.cluster.coreTags) unitTags.add(t.tag);
        for (const t of uc.cluster.sharedTags) unitTags.add(t.tag);
      }
      for (const itemTag of placed.layoutContext.tags) {
        expect(unitTags.has(itemTag.tag)).toBe(true);
      }
      const weightSum = placed.layoutContext.unitClusters.reduce((s, u) => s + u.weight, 0);
      expect(Math.abs(weightSum - 1)).toBeLessThan(1e-5);
    }
  });

  it('preserves clusterUid across incremental mutations via Hungarian bipartite matching', () => {
    const normalized1 = extractNormalizedItems(
      SAMPLE_CORPUS.slice(0, 12),
      (x) => x.slug,
      (x) => x.topics,
    );
    const mesh = buildSimplexMesh(1000, 680, 16, { maxClusters: 6 });
    const seq = { value: 0 };

    const first = computeSimplexClustering({
      normalizedItems: normalized1,
      mesh,
      deriveClusterMeta: () => undefined,
      nextClusterUidSeq: seq,
      seed: 99,
    });

    const prevSnapshots: PreviousClusterSnapshot[] = first.clusters.map((c) => {
      const tags = new Set<string>();
      for (const t of c.coreTags) tags.add(t.tag);
      for (const t of c.sharedTags) tags.add(t.tag);
      return {
        clusterUid: c.clusterUid,
        tags,
        x: c.gridNode.x,
        y: c.gridNode.y,
        colorHex: c.colorHex,
        oklab: c.oklab,
      };
    });

    const normalized2 = extractNormalizedItems(
      SAMPLE_CORPUS,
      (x) => x.slug,
      (x) => x.topics,
    );
    const second = computeSimplexClustering({
      normalizedItems: normalized2,
      mesh,
      deriveClusterMeta: () => undefined,
      previousClusters: prevSnapshots,
      nextClusterUidSeq: seq,
      seed: 99,
    });

    const prevUids = new Set(first.clusters.map((c) => c.clusterUid));
    const preservedCount = second.clusters.filter((c) => prevUids.has(c.clusterUid)).length;
    expect(preservedCount).toBeGreaterThanOrEqual(4);
  });

  it('decouples canonical tag IDs from human-readable display labels via formatTagLabel (Issue #7)', () => {
    const slugCorpus = [
      { id: 'p1', tags: ['autonomous-driving', 'computer-vision'] },
      { id: 'p2', tags: ['autonomous-driving', 'sensor-fusion'] },
      { id: 'p3', tags: ['computer-vision', 'sensor-fusion'] },
      { id: 'p4', tags: ['model-predictive-control', 'sensor-fusion'] },
      { id: 'p5', tags: ['model-predictive-control', 'autonomous-driving'] },
      { id: 'p6', tags: ['formal-verification', 'model-predictive-control'] },
      { id: 'p7', tags: ['formal-verification', 'safety-assurance'] },
      { id: 'p8', tags: ['safety-assurance', 'autonomous-driving'] },
    ] as const;

    const tagNames: Record<string, string> = {
      'autonomous-driving': 'Autonomous Driving',
      'computer-vision': 'Computer Vision',
      'sensor-fusion': 'Sensor Fusion',
      'model-predictive-control': 'Model Predictive Control',
      'formal-verification': 'Formal Verification',
      'safety-assurance': 'Safety Assurance',
    };
    const formatTagLabel = (tag: string): string => tagNames[tag] ?? tag;

    const baseline = solveSimplexSnapshot(slugCorpus, {
      width: 900,
      height: 600,
      layoutOptions: { seed: 42 },
    });
    const formatted = solveSimplexSnapshot(slugCorpus, {
      width: 900,
      height: 600,
      layoutOptions: { seed: 42 },
      formatTagLabel,
    });

    // Clustering geometry & canonical tag assignments must be 100% invariant to display formatting
    expect(formatted.clusters.length).toBe(baseline.clusters.length);
    for (let i = 0; i < baseline.clusters.length; i++) {
      const b = baseline.clusters[i]!.cluster;
      const f = formatted.clusters[i]!.cluster;
      expect(f.coreTags.map((t) => t.tag)).toEqual(b.coreTags.map((t) => t.tag));
      expect(f.sharedTags.map((t) => t.tag)).toEqual(b.sharedTags.map((t) => t.tag));
      expect(f.members.map((m) => m.id)).toEqual(b.members.map((m) => m.id));

      for (const t of f.coreTags) {
        expect(t.label).toBe(tagNames[t.tag]);
        expect(resolveTagDisplayLabel(t)).toBe(tagNames[t.tag]);
      }
      // Formatted cluster defaultLabel must never leak raw hyphenated slugs
      expect(f.defaultLabel).not.toMatch(/[a-z]-[a-z]/);
      expect(Object.values(tagNames).some((name) => f.defaultLabel.includes(name))).toBe(true);
    }

    // Item tags carry canonical IDs + display labels while coordinates stay identical
    for (let i = 0; i < baseline.items.length; i++) {
      const bi = baseline.items[i]!;
      const fi = formatted.items[i]!;
      expect(fi.id).toBe(bi.id);
      expect(fi.x).toBeCloseTo(bi.x, 5);
      expect(fi.y).toBeCloseTo(bi.y, 5);
      for (const td of fi.layoutContext.tags) {
        expect(td.label).toBe(tagNames[td.tag]);
      }
    }
  });
});
