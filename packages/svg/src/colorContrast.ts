import { hexToOklab, oklabToHex } from '@simplex-viz/core';

export interface ClusterSurfacePalette {
  /** Saturated OKLab-calibrated background hex guaranteed >= 4.85:1 WCAG AA contrast with `#ffffff` text. */
  readonly solidFillHex: string;
  /** Luminous (dark theme) or crisp (light theme) outer docking halo ring hex preserving cluster hue. */
  readonly haloHex: string;
  /** Soft ~20–24% hue-tinted background hex for intermediate `1:4` sub-cluster bridge plaques. */
  readonly intermediateFillHex: string;
  /** Calibrated border hex for intermediate `1:4` sub-cluster bridge plaques. */
  readonly intermediateStrokeHex: string;
}

const PALETTE_CACHE = new Map<string, ClusterSurfacePalette>();

function srgbChannelToLinear(byteVal: number): number {
  const c = Math.max(0, Math.min(255, byteVal)) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Computes WCAG 2.1 relative luminance Y in [0, 1] for a `#rrggbb` hex string.
 */
export function getHexRelativeLuminance(hex: string): number {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length < 6) return 0.12;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 0.12;
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

/**
 * Derives a perceptual OKLab surface palette for cluster landmarks:
 * - `solidFillHex`: Richly saturated jewel-tone fill guaranteed to maintain >= 4.85:1 contrast with `#ffffff` text.
 * - `haloHex`: Outer docking ring color calibrated for dark or light canvas visibility.
 * - `intermediateFillHex` / `intermediateStrokeHex`: Subdued ~20% tinted bridge plaque colors for zoomed sub-clusters.
 */
export function resolveClusterSurfaceColors(
  colorHex: string,
  theme: 'dark' | 'light' = 'dark',
): ClusterSurfacePalette {
  const cacheKey = `${theme}:${colorHex}`;
  const cached = PALETTE_CACHE.get(cacheKey);
  if (cached) return cached;

  const [L, a, b] = hexToOklab(colorHex);
  const chroma = Math.hypot(a, b);
  const hue = Math.atan2(b, a);

  // Preserve rich saturation while clamping within sRGB gamut via oklabToHex
  const solidChroma =
    chroma > 0.012 ? Math.min(0.175, Math.max(chroma * 1.05, 0.118)) : chroma;
  let curL = Math.max(0.43, Math.min(L, theme === 'light' ? 0.54 : 0.56));
  let solidFillHex = oklabToHex([
    curL,
    solidChroma * Math.cos(hue),
    solidChroma * Math.sin(hue),
  ]);

  // Step down OKLab lightness until relative luminance <= 0.165 (WCAG contrast >= 4.88:1 vs #ffffff)
  while (getHexRelativeLuminance(solidFillHex) > 0.165 && curL > 0.28) {
    curL -= 0.014;
    solidFillHex = oklabToHex([
      curL,
      solidChroma * Math.cos(hue),
      solidChroma * Math.sin(hue),
    ]);
  }

  const haloL =
    theme === 'light' ? Math.min(Math.max(L, 0.46), 0.58) : Math.max(L, 0.7);
  const haloChroma = chroma > 0.012 ? Math.max(chroma, 0.13) : chroma;
  const haloHex = oklabToHex([
    haloL,
    haloChroma * Math.cos(hue),
    haloChroma * Math.sin(hue),
  ]);

  const intL = theme === 'light' ? 0.945 : 0.245;
  const intChroma = chroma * (theme === 'light' ? 0.24 : 0.3);
  const intermediateFillHex = oklabToHex([
    intL,
    intChroma * Math.cos(hue),
    intChroma * Math.sin(hue),
  ]);

  const intStrokeL =
    theme === 'light' ? Math.min(L, 0.54) : Math.max(L, 0.66);
  const intermediateStrokeHex = oklabToHex([
    intStrokeL,
    haloChroma * Math.cos(hue),
    haloChroma * Math.sin(hue),
  ]);

  const result: ClusterSurfacePalette = {
    solidFillHex,
    haloHex,
    intermediateFillHex,
    intermediateStrokeHex,
  };

  if (PALETTE_CACHE.size >= 512) {
    PALETTE_CACHE.clear();
  }
  PALETTE_CACHE.set(cacheKey, result);
  return result;
}

/**
 * Generates an SVG path string for a rounded rectangle (including full capsules when `radius >= height / 2`).
 */
export function roundedRectSvgPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const cr = Math.max(0, Math.min(radius, width / 2, height / 2));
  const x2 = x + width;
  const y2 = y + height;
  return [
    `M ${(x + cr).toFixed(2)} ${y.toFixed(2)}`,
    `H ${(x2 - cr).toFixed(2)}`,
    `A ${cr.toFixed(2)} ${cr.toFixed(2)} 0 0 1 ${x2.toFixed(2)} ${(y + cr).toFixed(2)}`,
    `V ${(y2 - cr).toFixed(2)}`,
    `A ${cr.toFixed(2)} ${cr.toFixed(2)} 0 0 1 ${(x2 - cr).toFixed(2)} ${y2.toFixed(2)}`,
    `H ${(x + cr).toFixed(2)}`,
    `A ${cr.toFixed(2)} ${cr.toFixed(2)} 0 0 1 ${x.toFixed(2)} ${(y2 - cr).toFixed(2)}`,
    `V ${(y + cr).toFixed(2)}`,
    `A ${cr.toFixed(2)} ${cr.toFixed(2)} 0 0 1 ${(x + cr).toFixed(2)} ${y.toFixed(2)}`,
    'Z',
  ].join(' ');
}
