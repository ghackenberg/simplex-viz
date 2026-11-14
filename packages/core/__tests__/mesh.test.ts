import { describe, expect, it, vi } from 'vitest';
import {
  SimplexGraphEngine,
  isPointInTriangle,
  type DefaultTaggedItem,
  type SceneFrameSnapshot,
  type SimplexRendererAdapter,
  type VisualResolver,
} from '../src/index';
import { buildSimplexMesh } from '../src/mesh';

describe('buildSimplexMesh', () => {
  const viewports: readonly [number, number][] = [
    [1200, 760],
    [800, 800],
    [480, 720],
    [1440, 520],
  ];

  it.each(viewports)(
    'produces strictly equilateral 60-degree triangles within padded viewport %ix%i',
    (width, height) => {
      const padding = 48;
      const mesh = buildSimplexMesh(width, height, 24, {
        innerPadding: padding,
        minSideLength: 120,
        maxSideLength: 280,
        maxClusters: 12,
      });

      expect(mesh.vertices.length).toBeGreaterThanOrEqual(3);
      expect(mesh.triangles.length).toBeGreaterThanOrEqual(1);

      for (const v of mesh.vertices) {
        expect(v.x).toBeGreaterThanOrEqual(padding - 1e-3);
        expect(v.x).toBeLessThanOrEqual(width - padding + 1e-3);
        expect(v.y).toBeGreaterThanOrEqual(padding - 1e-3);
        expect(v.y).toBeLessThanOrEqual(height - padding + 1e-3);
      }

      for (const tri of mesh.triangles) {
        const a = mesh.vertices[tri.vertices[0]]!;
        const b = mesh.vertices[tri.vertices[1]]!;
        const c = mesh.vertices[tri.vertices[2]]!;

        const dab = Math.hypot(b.x - a.x, b.y - a.y);
        const dbc = Math.hypot(c.x - b.x, c.y - b.y);
        const dca = Math.hypot(a.x - c.x, a.y - c.y);

        expect(Math.abs(dab - dbc)).toBeLessThan(1e-3);
        expect(Math.abs(dbc - dca)).toBeLessThan(1e-3);

        // Law of cosines check for 60 degrees (pi / 3)
        const angleA = Math.acos((dab * dab + dca * dca - dbc * dbc) / (2 * dab * dca));
        const angleB = Math.acos((dab * dab + dbc * dbc - dca * dca) / (2 * dab * dbc));
        const angleC = Math.acos((dbc * dbc + dca * dca - dab * dab) / (2 * dbc * dca));

        const deg60 = Math.PI / 3;
        expect(Math.abs(angleA - deg60)).toBeLessThan(1e-4);
        expect(Math.abs(angleB - deg60)).toBeLessThan(1e-4);
        expect(Math.abs(angleC - deg60)).toBeLessThan(1e-4);
      }
    },
  );
});

describe('isPointInTriangle & engine triangle interactions', () => {
  it('checks exact 2D containment regardless of winding order', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const c = { x: 50, y: 86.6 };

    expect(isPointInTriangle(50, 30, a, b, c)).toBe(true);
    expect(isPointInTriangle(50, 30, a, c, b)).toBe(true); // CW order
    expect(isPointInTriangle(50, 0, a, b, c)).toBe(true); // Boundary edge
    expect(isPointInTriangle(50, -10, a, b, c)).toBe(false);
    expect(isPointInTriangle(120, 40, a, b, c)).toBe(false);
  });

  it('supports triangle hitTest, hover notifications, and focus dimming', () => {
    let lastSnapshot: SceneFrameSnapshot<string, string, DefaultTaggedItem> | null =
      null;
    const onTriangleHover = vi.fn();

    const items: DefaultTaggedItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: `doc-${i}`,
      tags: [`t-${i % 4}`, `t-${(i + 1) % 4}`, `t-${(i + 2) % 4}`],
    }));

    const visualResolver: VisualResolver<DefaultTaggedItem, string, string> = {
      resolveContentVisual: (item) => item.id,
      resolveClusterVisual: (cluster) => cluster.code,
      getVisualCacheKey: (v) => v,
    };

    const renderer: SimplexRendererAdapter<string, string, DefaultTaggedItem> = {
      measureContentHull: () => ({ kind: 'circle', radius: 6 }),
      measureClusterHull: () => ({ kind: 'circle', radius: 14 }),
      renderFrame: (snapshot) => {
        lastSnapshot = snapshot;
      },
      destroy: () => {},
    };

    const engine = new SimplexGraphEngine({
      items,
      visualResolver,
      renderer,
      viewportWidth: 900,
      viewportHeight: 600,
      layoutOptions: { seed: 42 },
      interactions: {
        onTriangleHover,
      },
    });

    expect(lastSnapshot).not.toBeNull();
    const tri = lastSnapshot!.triangles[0]!;
    expect(tri.clusters.length).toBe(3);
    expect(tri.coveredItemCount).toBeGreaterThanOrEqual(0);

    // Pick a point near centroid slightly nudged away from center items if needed
    const hit = engine.hitTest(tri.centroid.x, tri.centroid.y);
    expect(['triangle', 'content', 'cluster']).toContain(hit.kind);

    // Search a tiny spiral inside the triangle for an uncovered spot so we always hit triangle
    let triHitPoint = tri.centroid;
    for (let dx = -30; dx <= 30; dx += 6) {
      for (let dy = -30; dy <= 30; dy += 6) {
        const px = tri.centroid.x + dx;
        const py = tri.centroid.y + dy;
        const candidate = engine.hitTest(px, py);
        if (candidate.kind === 'triangle' && candidate.triangle.index === tri.index) {
          triHitPoint = { x: px, y: py };
          break;
        }
      }
    }

    const triHit = engine.hitTest(triHitPoint.x, triHitPoint.y);
    expect(triHit.kind).toBe('triangle');
    if (triHit.kind === 'triangle') {
      expect(triHit.triangle.index).toBe(tri.index);
    }

    engine.handlePointerMove(triHitPoint.x, triHitPoint.y);
    expect(onTriangleHover).toHaveBeenCalled();
    const hoverPayload = onTriangleHover.mock.calls.at(-1)?.[0];
    expect(hoverPayload).not.toBeNull();
    expect(hoverPayload.triangle.index).toBe(tri.index);

    engine.setFocusedTriangleIndex(tri.index);
    engine.renderNow();
    const focusedTri = lastSnapshot!.triangles.find((t) => t.index === tri.index)!;
    expect(focusedTri.interaction.isFocused).toBe(true);
    const highlightedEdges = lastSnapshot!.edges.filter((e) => e.isHighlighted);
    expect(highlightedEdges.length).toBe(3);

    if (lastSnapshot!.triangles.length > 1) {
      const otherTri = lastSnapshot!.triangles.find((t) => t.index !== tri.index)!;
      expect(otherTri.interaction.isDimmed).toBe(true);
    }

    engine.handlePointerLeave();
    expect(onTriangleHover).toHaveBeenLastCalledWith(null);
    engine.destroy();
  });
});
