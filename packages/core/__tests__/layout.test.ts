import { describe, expect, it } from 'vitest';
import {
  computeConvexMtv,
  rectToConvexPolygon,
  regularPolygon,
  starConvexHull,
} from '../src/geometry';
import { measureLayoutOverlaps, solveTwoPhaseLayout } from '../src/layout';
import { buildSimplexMesh } from '../src/mesh';
import { DeterministicRng } from '../src/prng';

describe('SAT & Two-Phase Overlap-Free Layout Solver', () => {
  it('computes exact SAT MTV for overlapping and disjoint convex polygons & circles', () => {
    const rectA = rectToConvexPolygon(40, 24, 4);
    const polyB = regularPolygon(6, 18);

    const overlap = computeConvexMtv(rectA, 100, 100, 1, polyB, 118, 100, 1, 0);
    expect(overlap).not.toBeNull();
    expect(overlap!.depth).toBeGreaterThan(0);

    const disjoint = computeConvexMtv(rectA, 100, 100, 1, polyB, 150, 100, 1, 2);
    expect(disjoint).toBeNull();
  });

  it('guarantees 0.0px overlap across dense mixed hulls (circles + rects + stars) and cluster obstacles', () => {
    const rng = new DeterministicRng(12345);
    const width = 920;
    const height = 580;
    const mesh = buildSimplexMesh(width, height, 20, { maxClusters: 8 });

    const clusterInputs = mesh.vertices.map((v, i) => ({
      id: `cluster-${i}`,
      targetX: v.x,
      targetY: v.y,
      hull:
        i % 2 === 0
          ? rectToConvexPolygon(142, 42, 8)
          : { kind: 'circle' as const, radius: 28 },
    }));

    // 140 densely packed content items clustered tightly around vertices & edge midpoints
    const itemInputs = Array.from({ length: 140 }, (_, i) => {
      const vA = mesh.vertices[i % mesh.vertices.length]!;
      const vB = mesh.vertices[(i * 3 + 1) % mesh.vertices.length]!;
      const w = rng.next();
      const hull =
        i % 3 === 0
          ? { kind: 'circle' as const, radius: 13 }
          : i % 3 === 1
            ? rectToConvexPolygon(74, 24, 4)
            : starConvexHull(5, 14);
      return {
        id: `item-${i}`,
        anchorX: vA.x * w + vB.x * (1 - w),
        anchorY: vA.y * w + vB.y * (1 - w),
        hull,
      };
    });

    const solved = solveTwoPhaseLayout({
      clusters: clusterInputs,
      items: itemInputs,
      viewportWidth: width,
      viewportHeight: height,
      viewportMargin: 8,
      options: {
        clusterGapPx: 12,
        itemGapPx: 4,
        sizeMultiplier: 1.35,
      },
    });

    expect(solved.overlapCount).toBe(0);
    expect(solved.maxPenetrationPx).toBeLessThanOrEqual(1e-4);

    const verification = measureLayoutOverlaps(
      solved.clusters,
      solved.items,
      width,
      height,
      8,
    );
    expect(verification.overlapCount).toBe(0);
    expect(verification.maxPenetrationPx).toBeLessThanOrEqual(1e-4);
  });
});
