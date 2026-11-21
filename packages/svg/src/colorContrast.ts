export {
  getHexRelativeLuminance,
  resolveClusterSurfaceColors,
  type ClusterSurfacePalette,
} from '@simplex-viz/core';

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
