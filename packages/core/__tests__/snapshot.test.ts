import { describe, expect, it } from 'vitest';
import {
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
});
