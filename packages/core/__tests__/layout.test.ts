import { describe, expect, it } from 'vitest';
import {
  computeConvexMtv,
  isPointInTriangle,
  rectToConvexPolygon,
  regularPolygon,
  starConvexHull,
} from '../src/geometry';
import {
  measureLayoutOverlaps,
  solveCollisionDrivenLayout,
  solveTwoPhaseLayout,
} from '../src/layout';
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

  it('shrinks only locally colliding pockets in solveCollisionDrivenLayout while sparse items remain 1.0x', () => {
    const width = 880;
    const height = 560;
    const mesh = buildSimplexMesh(width, height, 12, { maxClusters: 6 });

    const clusterInputs = mesh.vertices.map((v, i) => ({
      id: `cluster-${i}`,
      targetX: v.x,
      targetY: v.y,
      hull: rectToConvexPolygon(140, 42, 8),
    }));

    const vHot = mesh.vertices[0]!;
    const vSparseA = mesh.vertices[mesh.vertices.length - 1]!;
    const triLast = mesh.triangles[mesh.triangles.length - 1]!;
    const tA = mesh.vertices[triLast.vertices[0]]!;
    const tB = mesh.vertices[triLast.vertices[1]]!;
    const tC = mesh.vertices[triLast.vertices[2]]!;
    const triCentroidX = (tA.x + tB.x + tC.x) / 3;
    const triCentroidY = (tA.y + tB.y + tC.y) / 3;

    const hotspotItems = Array.from({ length: 24 }, (_, i) => ({
      id: `hot-${i}`,
      anchorX: vHot.x,
      anchorY: vHot.y,
      hull: rectToConvexPolygon(52, 24, 4),
    }));
    const sparseItems = [
      {
        id: 'sparse-tri',
        anchorX: triCentroidX,
        anchorY: triCentroidY,
        hull: rectToConvexPolygon(48, 24, 4),
      },
      {
        id: 'sparse-vertex',
        anchorX: vSparseA.x + 36,
        anchorY: vSparseA.y - 28,
        hull: { kind: 'circle' as const, radius: 16 },
      },
    ];

    const solved = solveCollisionDrivenLayout({
      clusters: clusterInputs,
      items: [...hotspotItems, ...sparseItems],
      mesh,
      viewportWidth: width,
      viewportHeight: height,
      viewportMargin: 8,
      minLocalScale: 0.3,
      shrinkFactor: 0.85,
    });

    expect(solved.overlapCount).toBe(0);
    expect(solved.maxPenetrationPx).toBeLessThanOrEqual(1e-4);

    const sparseSolved = solved.items.find((it) => it.id === 'sparse-tri')!;
    expect(sparseSolved.scale).toBeCloseTo(1.0, 5);

    const minHotScale = Math.min(
      ...solved.items.filter((it) => it.id.startsWith('hot-')).map((it) => it.scale),
    );
    expect(minHotScale).toBeLessThan(1.0);
  });

  it('keeps multi-cluster item centers strictly inside a covering triangle while allowing single-cluster items to roam freely', () => {
    const width = 880;
    const height = 560;
    const mesh = buildSimplexMesh(width, height, 12, { maxClusters: 6 });

    const clusterInputs = mesh.vertices.map((v, i) => ({
      id: `cluster-${i}`,
      targetX: v.x,
      targetY: v.y,
      hull: rectToConvexPolygon(136, 40, 8),
    }));

    const tri0 = mesh.triangles[0]!;
    const [a0, b0, c0] = tri0.vertices;
    const va0 = mesh.vertices[a0]!;
    const vb0 = mesh.vertices[b0]!;
    const vc0 = mesh.vertices[c0]!;
    const tri0Cx = (va0.x + vb0.x + vc0.x) / 3;
    const tri0Cy = (va0.y + vb0.y + vc0.y) / 3;

    // Dense 3-cluster pocket inside tri0 (would easily spill outside without triangle clamping)
    const triItems = Array.from({ length: 18 }, (_, i) => ({
      id: `tri-${i}`,
      anchorX: tri0Cx,
      anchorY: tri0Cy,
      hull: rectToConvexPolygon(46, 22, 4),
      unitVertexIndices: [a0, b0, c0] as readonly number[],
    }));

    // Dense 2-cluster edge pocket on [a0, b0]
    const edgeMidX = (va0.x + vb0.x) * 0.5;
    const edgeMidY = (va0.y + vb0.y) * 0.5;
    const edgeItems = Array.from({ length: 10 }, (_, i) => ({
      id: `edge-${i}`,
      anchorX: edgeMidX,
      anchorY: edgeMidY,
      hull: { kind: 'circle' as const, radius: 15 },
      unitVertexIndices: [a0, b0] as readonly number[],
    }));

    // Single-cluster items centered right on vertex c0 (unconstrained around their cluster)
    const singleItems = Array.from({ length: 8 }, (_, i) => ({
      id: `single-${i}`,
      anchorX: vc0.x,
      anchorY: vc0.y,
      hull: { kind: 'circle' as const, radius: 14 },
      unitVertexIndices: [c0] as readonly number[],
    }));

    const allItems = [...triItems, ...edgeItems, ...singleItems];

    const verifyContainment = (
      solvedItems: readonly { readonly id: string; readonly x: number; readonly y: number }[],
    ) => {
      for (const it of solvedItems) {
        if (it.id.startsWith('tri-')) {
          expect(isPointInTriangle(it.x, it.y, va0, vb0, vc0, 1e-4)).toBe(true);
        } else if (it.id.startsWith('edge-')) {
          const edgeCoveringTris = mesh.triangles.filter(
            (tr) => tr.vertices.includes(a0) && tr.vertices.includes(b0),
          );
          const insideAny = edgeCoveringTris.some((tr) =>
            isPointInTriangle(
              it.x,
              it.y,
              mesh.vertices[tr.vertices[0]]!,
              mesh.vertices[tr.vertices[1]]!,
              mesh.vertices[tr.vertices[2]]!,
              1e-4,
            ),
          );
          expect(insideAny).toBe(true);
        }
      }
    };

    const twoPhase = solveTwoPhaseLayout({
      clusters: clusterInputs,
      items: allItems,
      mesh,
      viewportWidth: width,
      viewportHeight: height,
      viewportMargin: 8,
    });
    expect(twoPhase.overlapCount).toBe(0);
    expect(twoPhase.maxPenetrationPx).toBeLessThanOrEqual(1e-4);
    verifyContainment(twoPhase.items);

    const collisionDriven = solveCollisionDrivenLayout({
      clusters: clusterInputs,
      items: allItems,
      mesh,
      viewportWidth: width,
      viewportHeight: height,
      viewportMargin: 8,
      minLocalScale: 0.3,
      shrinkFactor: 0.85,
    });
    expect(collisionDriven.overlapCount).toBe(0);
    expect(collisionDriven.maxPenetrationPx).toBeLessThanOrEqual(1e-4);
    verifyContainment(collisionDriven.items);
  });
});
