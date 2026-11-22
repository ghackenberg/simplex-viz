import {
  assignGreedyEdgeContrastColors,
  assignMeshClusterColors,
  hexToOklab,
  mixOklabColors,
} from '../oklab.js';
import type { DefaultTaggedItem } from '../types.js';
import type { SimplexColorStrategy } from './types.js';

/**
 * Default OKLab edge-contrast cluster coloring + chroma-preserving OKLab item mixing.
 */
export function createOklabContrastColorStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(): SimplexColorStrategy<TItem, TTagMeta> {
  return {
    name: 'oklab-contrast',
    assignClusterColors(ctx) {
      const preserved =
        ctx.reason === 'strategy' ? undefined : ctx.preservedColors;
      return assignMeshClusterColors(ctx.clusters.length, ctx.mesh.edges, preserved, {
        theme: 'dark',
      });
    },
    mixItemColor(ctx) {
      return mixOklabColors(
        ctx.unitColors.map((uc) => ({
          oklab: uc.color.oklab,
          weight: uc.weight,
        })),
      );
    },
  };
}

/**
 * Theme-adaptive OKLab contrast strategy that automatically adjusts perceptual lightness & chroma
 * for dark vs. light canvases whenever `theme` changes.
 */
export function createThemeAdaptiveOklabColorStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(): SimplexColorStrategy<TItem, TTagMeta> {
  return {
    name: 'theme-adaptive-oklab',
    assignClusterColors(ctx) {
      const themeChanged =
        ctx.previousTheme !== undefined && ctx.previousTheme !== ctx.theme;
      const preserved =
        ctx.reason === 'strategy' || themeChanged ? undefined : ctx.preservedColors;
      return assignMeshClusterColors(ctx.clusters.length, ctx.mesh.edges, preserved, {
        theme: ctx.theme,
      });
    },
    mixItemColor(ctx) {
      return mixOklabColors(
        ctx.unitColors.map((uc) => ({
          oklab: uc.color.oklab,
          weight: uc.weight,
        })),
      );
    },
  };
}

/**
 * Custom hex palette cluster coloring strategy (optimizing OKLab contrast along mesh edges
 * or assigning sequentially).
 */
export function createPaletteColorStrategy<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(
  hexColors: readonly string[],
  options?: {
    readonly mode?: 'edge-contrast' | 'sequential';
    readonly preserveMatchedColors?: boolean;
  },
): SimplexColorStrategy<TItem, TTagMeta> {
  const sanitized = (hexColors.length > 0 ? hexColors : ['#38bdf8', '#f472b6', '#34d399']).map(
    (hex) => {
      const normalizedHex = hex.startsWith('#') ? hex : `#${hex}`;
      return {
        hex: normalizedHex,
        oklab: hexToOklab(normalizedHex),
      };
    },
  );
  const mode = options?.mode ?? 'edge-contrast';
  const preserveMatched = options?.preserveMatchedColors ?? false;

  return {
    name: 'custom-palette',
    assignClusterColors(ctx) {
      const K = ctx.clusters.length;
      if (mode === 'sequential') {
        return Array.from({ length: K }, (_, idx) => sanitized[idx % sanitized.length]!);
      }
      const preserved =
        preserveMatched && ctx.reason !== 'strategy' ? ctx.preservedColors : undefined;
      return assignGreedyEdgeContrastColors(K, ctx.mesh.edges, sanitized, preserved);
    },
    mixItemColor(ctx) {
      return mixOklabColors(
        ctx.unitColors.map((uc) => ({
          oklab: uc.color.oklab,
          weight: uc.weight,
        })),
      );
    },
  };
}
