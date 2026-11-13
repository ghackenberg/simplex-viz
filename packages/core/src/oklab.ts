import type { MeshEdge } from './types';

export type OklabTuple = readonly [number, number, number];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const clamped = clamp01(c);
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

/**
 * Converts a CSS hex color (`#rrggbb`) to OKLab `[L, a, b]`.
 */
export function hexToOklab(hex: string): OklabTuple {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = srgbToLinear(parseInt(clean.slice(0, 2), 16) / 255);
  const g = srgbToLinear(parseInt(clean.slice(2, 4), 16) / 255);
  const b = srgbToLinear(parseInt(clean.slice(4, 6), 16) / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * Converts OKLab `[L, a, b]` back into a valid sRGB hex string with gamut clamping.
 */
export function oklabToHex(lab: OklabTuple): string {
  const [L, a, b] = lab;
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

  const toByte = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toByte(r)}${toByte(g)}${toByte(bl)}`;
}

/**
 * Converts OKLCH `[L, C, hueRad]` to OKLab `[L, a, b]`.
 */
export function oklchToOklab(L: number, C: number, hueRad: number): OklabTuple {
  return [L, C * Math.cos(hueRad), C * Math.sin(hueRad)];
}

/**
 * Euclidean perceptual distance in OKLab space.
 */
export function oklabDistance(x: OklabTuple, y: OklabTuple): number {
  const dL = x[0] - y[0];
  const da = x[1] - y[1];
  const db = x[2] - y[2];
  return Math.hypot(dL, da, db);
}

/**
 * Generates `count` perceptually distinct, high-contrast colors in OKLab
 * tuned for dark scientific backgrounds while maintaining chroma & legibility.
 */
export function buildDistinctOklabPalette(count: number): readonly {
  readonly hex: string;
  readonly oklab: OklabTuple;
}[] {
  const n = Math.max(1, count);
  const goldenAngle = 2.399963229728653;
  const result: { hex: string; oklab: OklabTuple }[] = [];
  for (let i = 0; i < n; i++) {
    const hue = (i * goldenAngle + 0.35) % (Math.PI * 2);
    const lightness = 0.71 + (i % 3 === 0 ? 0.04 : i % 3 === 1 ? -0.02 : 0.01);
    const chroma = 0.145 + (i % 2 === 0 ? 0.015 : -0.008);
    const rawLab = oklchToOklab(lightness, chroma, hue);
    const hex = oklabToHex(rawLab);
    result.push({ hex, oklab: hexToOklab(hex) });
  }
  return result;
}

/**
 * Assigns palette colors to `K` mesh vertices, optimizing minimum edge contrast
 * along simplex mesh edges while optionally preserving previous matched colors.
 */
export function assignMeshClusterColors(
  clusterCount: number,
  edges: readonly MeshEdge[],
  preservedColors?: ReadonlyMap<number, { readonly hex: string; readonly oklab: OklabTuple }>,
): readonly { readonly hex: string; readonly oklab: OklabTuple }[] {
  const palette = buildDistinctOklabPalette(Math.max(clusterCount, 12));
  const assigned: ({ hex: string; oklab: OklabTuple } | undefined)[] = new Array(
    clusterCount,
  ).fill(undefined);
  const usedPaletteIdx = new Set<number>();

  if (preservedColors) {
    for (const [clusterIdx, color] of preservedColors) {
      if (clusterIdx >= 0 && clusterIdx < clusterCount) {
        assigned[clusterIdx] = color;
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let p = 0; p < palette.length; p++) {
          if (usedPaletteIdx.has(p)) continue;
          const entry = palette[p];
          if (!entry) continue;
          const d = oklabDistance(entry.oklab, color.oklab);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = p;
          }
        }
        if (bestIdx >= 0 && bestDist < 0.08) {
          usedPaletteIdx.add(bestIdx);
        }
      }
    }
  }

  const adj: number[][] = Array.from({ length: clusterCount }, () => []);
  for (const e of edges) {
    adj[e.a]?.push(e.b);
    adj[e.b]?.push(e.a);
  }

  for (let k = 0; k < clusterCount; k++) {
    if (assigned[k]) continue;
    const neighbors = adj[k] ?? [];
    let bestCandidateIdx = 0;
    let bestScore = -Infinity;
    for (let p = 0; p < palette.length; p++) {
      if (usedPaletteIdx.has(p)) continue;
      const cand = palette[p];
      if (!cand) continue;
      let minNeighborDist = Infinity;
      let sumNeighborDist = 0;
      let neighborCount = 0;
      for (const nb of neighbors) {
        const nbColor = assigned[nb];
        if (!nbColor) continue;
        const d = oklabDistance(cand.oklab, nbColor.oklab);
        if (d < minNeighborDist) minNeighborDist = d;
        sumNeighborDist += d;
        neighborCount++;
      }
      const score =
        neighborCount > 0 ? minNeighborDist * 2 + sumNeighborDist / neighborCount : 1;
      if (score > bestScore) {
        bestScore = score;
        bestCandidateIdx = p;
      }
    }
    usedPaletteIdx.add(bestCandidateIdx);
    const chosen = palette[bestCandidateIdx] ?? { hex: '#38bdf8', oklab: hexToOklab('#38bdf8') };
    assigned[k] = chosen;
  }

  return assigned.map(
    (c) => c ?? { hex: '#38bdf8', oklab: hexToOklab('#38bdf8') },
  );
}

/**
 * Perceptual OKLab color mixing with chroma preservation to avoid muddy gray midpoints
 * when blending 2 or 3 cluster colors on edges or triangles.
 */
export function mixOklabColors(
  weightedColors: ReadonlyArray<{ readonly oklab: OklabTuple; readonly weight: number }>,
): { readonly hex: string; readonly oklab: OklabTuple } {
  if (weightedColors.length === 0) {
    const fallback = hexToOklab('#94a3b8');
    return { hex: '#94a3b8', oklab: fallback };
  }
  if (weightedColors.length === 1) {
    const only = weightedColors[0]!;
    return { hex: oklabToHex(only.oklab), oklab: only.oklab };
  }

  let totalWeight = 0;
  let L = 0;
  let a = 0;
  let b = 0;
  let targetChroma = 0;

  for (const wc of weightedColors) {
    const w = Math.max(0, wc.weight);
    totalWeight += w;
    L += wc.oklab[0] * w;
    a += wc.oklab[1] * w;
    b += wc.oklab[2] * w;
    targetChroma += Math.hypot(wc.oklab[1], wc.oklab[2]) * w;
  }

  if (totalWeight <= 1e-9) {
    const first = weightedColors[0]!;
    return { hex: oklabToHex(first.oklab), oklab: first.oklab };
  }

  L /= totalWeight;
  a /= totalWeight;
  b /= totalWeight;
  targetChroma /= totalWeight;

  const mixedChroma = Math.hypot(a, b);
  if (mixedChroma > 1e-5 && targetChroma > mixedChroma) {
    // Preserve vibrant chroma against perceptual cancellation across opposing hues
    const boost = Math.min(2.2, (mixedChroma * 0.35 + targetChroma * 0.65) / mixedChroma);
    a *= boost;
    b *= boost;
  }

  const mixed: OklabTuple = [clamp01(L), a, b];
  const hex = oklabToHex(mixed);
  return { hex, oklab: hexToOklab(hex) };
}

/**
 * Linearly interpolates between two OKLab colors and outputs sRGB hex.
 */
export function lerpOklabHex(a: OklabTuple, b: OklabTuple, t: number): string {
  const clamped = clamp01(t);
  return oklabToHex([
    a[0] + (b[0] - a[0]) * clamped,
    a[1] + (b[1] - a[1]) * clamped,
    a[2] + (b[2] - a[2]) * clamped,
  ]);
}
