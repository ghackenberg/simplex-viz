import { describe, expect, it } from 'vitest';
import {
  createEmbeddingClusteringStrategy,
  rectToConvexPolygon,
  solveSimplexSnapshot,
  type DefaultTaggedItem,
} from '../src/index';

describe('solveSimplexSnapshot one-shot helper', () => {
  it('computes a settled, overlap-free snapshot with zero configuration for DefaultTaggedItem[]', () => {
    const items: DefaultTaggedItem[] = Array.from({ length: 14 }, (_, i) => ({
      id: `item-${i}`,
      tags: [`topic-${i % 4}`, `topic-${(i + 1) % 4}`],
    }));

    const snapshot = solveSimplexSnapshot(items);

    expect(snapshot.items.length).toBe(14);
    expect(snapshot.clusters.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.mesh.triangles.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.triangles.length).toBe(snapshot.mesh.triangles.length);
    expect(snapshot.metrics.isSettled).toBe(true);
    expect(snapshot.metrics.overlapCount).toBe(0);
    expect(snapshot.items.every((n) => n.colorHex.startsWith('#'))).toBe(true);
  });

  it('supports custom domain models, custom hull callbacks, and derived cluster metadata', () => {
    interface Paper {
      readonly doi: string;
      readonly keywords: readonly string[];
      readonly citations: number;
    }

    const papers: Paper[] = Array.from({ length: 10 }, (_, i) => ({
      doi: `10.1000/${i}`,
      keywords: [`field-${i % 3}`, `field-${(i + 1) % 3}`],
      citations: (i + 1) * 5,
    }));

    const snapshot = solveSimplexSnapshot(papers, {
      width: 1000,
      height: 700,
      getId: (p) => p.doi,
      getTags: (p) => p.keywords,
      deriveClusterMeta: (ctx) => ({
        totalCitations: ctx.members.reduce((sum, m) => sum + m.item.citations, 0),
      }),
      measureContentHull: () => rectToConvexPolygon(42, 18, 4),
      layoutOptions: { seed: 7 },
    });

    expect(snapshot.metrics.overlapCount).toBe(0);
    expect(snapshot.clusters.every((c) => c.cluster.meta.totalCitations > 0)).toBe(true);
    expect(snapshot.items[0]?.item.doi).toBe('10.1000/0');
  });

  it('computes overlap-free snapshots for completely untagged objects with embedding vectors', () => {
    interface ImageAsset {
      readonly assetId: string;
      readonly embedding: readonly number[];
    }

    const assets: ImageAsset[] = [
      { assetId: 'img-1', embedding: [1, 0, 0, 0] },
      { assetId: 'img-2', embedding: [0.95, 0.1, 0, 0] },
      { assetId: 'img-3', embedding: [0, 1, 0, 0] },
      { assetId: 'img-4', embedding: [0.05, 0.96, 0.1, 0] },
      { assetId: 'img-5', embedding: [0, 0, 1, 0] },
      { assetId: 'img-6', embedding: [0.1, 0, 0.94, 0.05] },
      { assetId: 'img-7', embedding: [0.45, 0.45, 0.45, 0.1] },
    ];

    const snapshot = solveSimplexSnapshot(assets, {
      getId: (a) => a.assetId,
      clusteringStrategy: createEmbeddingClusteringStrategy<ImageAsset>({
        getEmbedding: (a) => a.embedding,
      }),
    });

    expect(snapshot.metrics.overlapCount).toBe(0);
    expect(snapshot.items.length).toBe(7);
    expect(snapshot.clusters.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.items[0]?.item.assetId).toBe('img-1');
  });
});
