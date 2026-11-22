import { getHullBoundingRadius } from '../geometry.js';
import { clampPointToTriangles } from './geometry.js';
import type { LayoutSeeder, TrianglePoints } from './types.js';

export interface PhyllotaxisSeederOptions {
  /** Reuse `previousItemPositions` when provided. Default: `false`. */
  readonly warmStart?: boolean;
  /** Radial spacing factor in px for co-located anchors. Default: `2.5`. */
  readonly stepRadiusPx?: number;
}

/**
 * Deterministic golden-angle phyllotaxis spiral around each item's barycentric anchor,
 * clamped inside covering mesh triangles when present.
 */
export function createPhyllotaxisSeeder(
  options?: PhyllotaxisSeederOptions,
): LayoutSeeder {
  const warmStart = options?.warmStart ?? false;
  const stepRadiusPx = options?.stepRadiusPx ?? 2.5;
  return {
    name: warmStart ? 'phyllotaxis-warm' : 'phyllotaxis',
    seed(ctx) {
      const { scaledItems, placedClusters, itemCoveringTriangles, previousItemPositions } = ctx;
      const anchorBuckets = new Map<string, number>();
      return scaledItems.map((it, itemIdx) => {
        const triGroup = itemCoveringTriangles[itemIdx];
        if (warmStart && previousItemPositions) {
          const prev = previousItemPositions.get(it.id);
          if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
            return triGroup
              ? clampPointToTriangles(prev.x, prev.y, triGroup)
              : { x: prev.x, y: prev.y };
          }
        }
        const singleV =
          !triGroup && it.unitVertexIndices?.length === 1
            ? it.unitVertexIndices[0]
            : undefined;
        const hostCluster =
          singleV !== undefined ? placedClusters[singleV] : undefined;
        const baseX = hostCluster ? hostCluster.x : it.anchorX;
        const baseY = hostCluster ? hostCluster.y : it.anchorY;

        const key = `${Math.round(baseX * 2)}:${Math.round(baseY * 2)}`;
        const idx = anchorBuckets.get(key) ?? 0;
        anchorBuckets.set(key, idx + 1);
        if (idx === 0 && !hostCluster) {
          return triGroup
            ? clampPointToTriangles(baseX, baseY, triGroup)
            : { x: baseX, y: baseY };
        }
        const angle = (idx + 0.5) * 2.399963229728653;
        const orbitBase = hostCluster
          ? getHullBoundingRadius(hostCluster.hull) * hostCluster.scale * 0.45 + 4
          : 0;
        const radius = orbitBase + stepRadiusPx * Math.sqrt(idx);
        const px = baseX + Math.cos(angle) * radius;
        const py = baseY + Math.sin(angle) * radius;
        return triGroup ? clampPointToTriangles(px, py, triGroup) : { x: px, y: py };
      });
    },
  };
}

export interface MeshInwardFanSeederOptions {
  /** Reuse `previousItemPositions` when provided. Default: `false`. */
  readonly warmStart?: boolean;
  /** Radial fan step in px. Default: `5.5`. */
  readonly stepRadiusPx?: number;
  /** Angular cone width in radians for multi-cluster triangle items. Default: `Math.PI * 1.15`. */
  readonly coneRadians?: number;
}

/**
 * Mesh-aware seeder:
 * - Multi-cluster items (`triGroup !== null`) fan inward toward the centroid of their covering
 *   mesh triangle(s).
 * - Single-cluster items (`triGroup === null`) are exempt from triangle cones and arrange in a
 *   full `360°` golden-angle halo all around their topic cluster (even at boundary/corner
 *   triangulation vertices that only border a single triangle).
 */
export function createMeshInwardFanSeeder(
  options?: MeshInwardFanSeederOptions,
): LayoutSeeder {
  const warmStart = options?.warmStart ?? false;
  const stepRadiusPx = options?.stepRadiusPx ?? 5.5;
  const coneRadians = options?.coneRadians ?? Math.PI * 1.15;

  return {
    name: warmStart ? 'mesh-inward-fan-warm' : 'mesh-inward-fan',
    seed(ctx) {
      const { scaledItems, placedClusters, itemCoveringTriangles, previousItemPositions } = ctx;
      const anchorBuckets = new Map<string, number>();

      const resolveTriangleDir = (
        ax: number,
        ay: number,
        triGroup: readonly TrianglePoints[],
      ): { dx: number; dy: number } => {
        let sumCx = 0;
        let sumCy = 0;
        for (let t = 0; t < triGroup.length; t++) {
          const [va, vb, vc] = triGroup[t]!;
          sumCx += (va.x + vb.x + vc.x) / 3;
          sumCy += (va.y + vb.y + vc.y) / 3;
        }
        const tx = sumCx / triGroup.length - ax;
        const ty = sumCy / triGroup.length - ay;
        const len = Math.hypot(tx, ty);
        if (len > 1e-6) return { dx: tx / len, dy: ty / len };
        return { dx: 1, dy: 0 };
      };

      return scaledItems.map((it, itemIdx) => {
        const triGroup = itemCoveringTriangles[itemIdx];
        if (warmStart && previousItemPositions) {
          const prev = previousItemPositions.get(it.id);
          if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
            return triGroup
              ? clampPointToTriangles(prev.x, prev.y, triGroup)
              : { x: prev.x, y: prev.y };
          }
        }

        // Single-cluster / unconstrained items: 360° isotropic golden-angle halo around their cluster
        if (!triGroup || triGroup.length === 0) {
          const singleV =
            it.unitVertexIndices?.length === 1 ? it.unitVertexIndices[0] : undefined;
          let hostCluster =
            singleV !== undefined ? placedClusters[singleV] : undefined;
          if (!hostCluster && !it.unitVertexIndices) {
            for (let cIdx = 0; cIdx < placedClusters.length; cIdx++) {
              const cand = placedClusters[cIdx]!;
              if (Math.hypot(cand.x - it.anchorX, cand.y - it.anchorY) <= 4) {
                hostCluster = cand;
                break;
              }
            }
          }
          const cx = hostCluster ? hostCluster.x : it.anchorX;
          const cy = hostCluster ? hostCluster.y : it.anchorY;
          const key = `halo:${Math.round(cx * 0.5)}:${Math.round(cy * 0.5)}`;
          const idx = anchorBuckets.get(key) ?? 0;
          anchorBuckets.set(key, idx + 1);

          if (!hostCluster && idx === 0) {
            return { x: cx, y: cy };
          }
          const angle = (idx + 0.5) * 2.399963229728653;
          const orbitBase = hostCluster
            ? getHullBoundingRadius(hostCluster.hull) * hostCluster.scale * 0.55 +
              getHullBoundingRadius(it.hull) * 0.75 +
              4
            : 0;
          const radius = orbitBase + stepRadiusPx * Math.sqrt(idx);
          return {
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius,
          };
        }

        // Multi-cluster items (2 or 3 clusters): inward cone into covering mesh triangle(s)
        const key = `tri:${Math.round(it.anchorX * 0.5)}:${Math.round(it.anchorY * 0.5)}`;
        const idx = anchorBuckets.get(key) ?? 0;
        anchorBuckets.set(key, idx + 1);
        if (idx === 0) {
          return clampPointToTriangles(it.anchorX, it.anchorY, triGroup);
        }

        const inward = resolveTriangleDir(it.anchorX, it.anchorY, triGroup);
        const baseAngle = Math.atan2(inward.dy, inward.dx);
        const offsetAngle = (((idx * 0.61803398875) % 1) - 0.5) * coneRadians;
        const angle = baseAngle + offsetAngle;
        const radius = stepRadiusPx * Math.sqrt(idx);
        const fx = it.anchorX + Math.cos(angle) * radius;
        const fy = it.anchorY + Math.sin(angle) * radius;
        return clampPointToTriangles(fx, fy, triGroup);
      });
    },
  };
}

/**
 * Wraps any `LayoutSeeder` so existing items reuse their settled coordinates from the
 * previous layout frame (clamped to their current covering triangles), while newly added
 * items fall back to `baseSeeder`.
 */
export function withWarmStartSeeder(baseSeeder: LayoutSeeder): LayoutSeeder {
  return {
    name: `${baseSeeder.name}:warm-start`,
    seed(ctx) {
      const seeded = baseSeeder.seed(ctx);
      if (!ctx.previousItemPositions || ctx.previousItemPositions.size === 0) {
        return seeded;
      }
      return ctx.scaledItems.map((it, idx) => {
        const prev = ctx.previousItemPositions?.get(it.id);
        if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
          const triGroup = ctx.itemCoveringTriangles[idx];
          return triGroup
            ? clampPointToTriangles(prev.x, prev.y, triGroup)
            : { x: prev.x, y: prev.y };
        }
        return seeded[idx]!;
      });
    },
  };
}
