import { describe, expect, it } from 'vitest';
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
