import {
  rectToConvexPolygon,
  regularPolygon,
  starConvexHull,
  type ConvexGeometry,
  type NodeRenderState,
} from '@simplex-viz/core';
import type { CanvasNodeRenderer } from '@simplex-viz/canvas';
import {
  resolveClusterSurfaceColors,
  type BadgeClusterVisual,
  type GeometricShapeKind,
} from '@simplex-viz/svg';
import type { DemoClusterVisual, DemoContentVisual } from './presets';
import { ZOO_SYMBOL_PRIMITIVES, type ZooSymbolKind } from './zooSymbols';

const TAU = Math.PI * 2;

// ============================================================================
// Coalesced Async Image Cache for Movie Posters & Animal Photographs
// ============================================================================

interface CachedCanvasImage {
  readonly img: HTMLImageElement;
  status: 'loading' | 'loaded' | 'error';
}

const imageCache = new Map<string, CachedCanvasImage>();
const imageLoadListeners = new Set<() => void>();
const svgPathCache = new Map<string, Path2D>();

/**
 * Subscribe to image decode notifications so live Canvas controllers can trigger
 * a zero-relayout repaint as soon as movie posters or animal photos load.
 */
export function subscribeCanvasImageLoads(listener: () => void): () => void {
  imageLoadListeners.add(listener);
  return () => {
    imageLoadListeners.delete(listener);
  };
}

function notifyCanvasImageLoaded(): void {
  for (const listener of imageLoadListeners) {
    listener();
  }
}

function getCachedCanvasImage(url: string | undefined): HTMLImageElement | null {
  if (!url || typeof Image === 'undefined') return null;

  const existing = imageCache.get(url);
  if (existing) {
    if (
      existing.status === 'loaded' &&
      existing.img.complete &&
      existing.img.naturalWidth > 0
    ) {
      return existing.img;
    }
    return null;
  }

  const img = new Image();
  img.decoding = 'async';
  if (
    url.startsWith('/') ||
    url.startsWith('./') ||
    url.includes('wikimedia.org')
  ) {
    img.crossOrigin = 'anonymous';
  }

  const entry: CachedCanvasImage = { img, status: 'loading' };
  imageCache.set(url, entry);

  img.onload = () => {
    entry.status = 'loaded';
    notifyCanvasImageLoaded();
  };
  img.onerror = () => {
    entry.status = 'error';
  };
  img.src = url;

  // Already synchronously cached by the browser?
  if (img.complete && img.naturalWidth > 0) {
    entry.status = 'loaded';
    return img;
  }
  return null;
}

function getCachedPath2D(d: string): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  let path = svgPathCache.get(d);
  if (!path) {
    path = new Path2D(d);
    svgPathCache.set(d, path);
  }
  return path;
}

// ============================================================================
// Low-Level Canvas 2D Geometry & Typography Helpers
// ============================================================================

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | readonly [number, number, number, number],
): void {
  const maxR = Math.min(w / 2, h / 2);
  const [tl, tr, br, bl] =
    typeof r === 'number'
      ? [
          Math.min(r, maxR),
          Math.min(r, maxR),
          Math.min(r, maxR),
          Math.min(r, maxR),
        ]
      : [
          Math.min(r[0], maxR),
          Math.min(r[1], maxR),
          Math.min(r[2], maxR),
          Math.min(r[3], maxR),
        ];

  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr > 0) ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  if (br > 0) ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl > 0) ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  if (tl > 0) ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function traceChamferHex(
  ctx: CanvasRenderingContext2D,
  hw: number,
  hh: number,
  cut: number,
  dy = 0,
): void {
  ctx.beginPath();
  ctx.moveTo(-hw + cut, -hh + dy);
  ctx.lineTo(hw - cut, -hh + dy);
  ctx.lineTo(hw, dy);
  ctx.lineTo(hw - cut, hh + dy);
  ctx.lineTo(-hw + cut, hh + dy);
  ctx.lineTo(-hw, dy);
  ctx.closePath();
}

/**
 * Draws an image with `preserveAspectRatio="xMidYMid slice"` (`object-fit: cover`)
 * inside the destination box `(dx, dy, dw, dh)`.
 */
function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw <= 0 || nh <= 0 || dw <= 0 || dh <= 0) return;

  const imgAspect = nw / nh;
  const boxAspect = dw / dh;
  let sx = 0;
  let sy = 0;
  let sw = nw;
  let sh = nh;

  if (imgAspect > boxAspect) {
    sw = nh * boxAspect;
    sx = (nw - sw) * 0.5;
  } else {
    sh = nw / boxAspect;
    sy = (nh - sh) * 0.5;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function resolveStateStroke<V>(
  state: NodeRenderState<V>,
  isLight: boolean,
  fallbackHex: string,
): { stroke: string; strokeWidth: number; accentHalo: string | null } {
  const accent = isLight ? '#0891b2' : '#22d3ee';
  if (state.interaction.isPinned || state.interaction.isSelected) {
    return { stroke: '#f59e0b', strokeWidth: 2.15, accentHalo: '#f59e0b' };
  }
  if (state.interaction.isHovered) {
    return {
      stroke: isLight ? '#0f172a' : '#f8fafc',
      strokeWidth: 2.0,
      accentHalo: accent,
    };
  }
  if (state.interaction.isHighlighted) {
    return { stroke: fallbackHex, strokeWidth: 1.85, accentHalo: accent };
  }
  return {
    stroke: isLight ? '#cbd5e1' : '#293548',
    strokeWidth: 1.05,
    accentHalo: null,
  };
}

function drawZooSilhouette(
  ctx: CanvasRenderingContext2D,
  symbolKind: ZooSymbolKind,
  fillHex: string,
  bgFill: string,
  scale: number,
  baseAlpha: number,
): void {
  const primitives = ZOO_SYMBOL_PRIMITIVES[symbolKind];
  ctx.save();
  ctx.scale(scale, scale);
  for (const prim of primitives) {
    ctx.fillStyle = prim.cutout ? bgFill : fillHex;
    ctx.globalAlpha = baseAlpha * (prim.cutout ? 0.96 : 0.92);

    if (prim.tag === 'path') {
      const d = String(prim.attrs.d ?? '');
      const path = getCachedPath2D(d);
      if (path) {
        ctx.fill(path);
      }
    } else if (prim.tag === 'circle') {
      ctx.beginPath();
      ctx.arc(
        Number(prim.attrs.cx ?? 0),
        Number(prim.attrs.cy ?? 0),
        Number(prim.attrs.r ?? 1),
        0,
        TAU,
      );
      ctx.fill();
    } else if (prim.tag === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(
        Number(prim.attrs.cx ?? 0),
        Number(prim.attrs.cy ?? 0),
        Number(prim.attrs.rx ?? 1),
        Number(prim.attrs.ry ?? 1),
        0,
        0,
        TAU,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}

function traceGeometricKind(
  ctx: CanvasRenderingContext2D,
  shape: GeometricShapeKind,
  r: number,
): void {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(0, 0, r, 0, TAU);
    return;
  }
  if (shape === 'star') {
    const inner = r * 0.48;
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = Math.cos(a) * rad;
      const py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    return;
  }
  const sides =
    shape === 'triangle'
      ? 3
      : shape === 'square' || shape === 'diamond'
        ? 4
        : shape === 'pentagon'
          ? 5
          : shape === 'hexagon'
            ? 6
            : shape === 'heptagon'
              ? 7
              : shape === 'octagon'
                ? 8
                : 6;
  const rot =
    shape === 'square'
      ? Math.PI / 4
      : shape === 'hexagon'
        ? -Math.PI / 6
        : shape === 'octagon'
          ? Math.PI / 8
          : -Math.PI / 2;
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * TAU) / sides;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function measureGeometricKindHull(
  shape: GeometricShapeKind,
  r: number,
): ConvexGeometry {
  if (shape === 'circle') return { kind: 'circle', radius: r };
  if (shape === 'star') return starConvexHull(5, r);
  const sides =
    shape === 'triangle'
      ? 3
      : shape === 'square' || shape === 'diamond'
        ? 4
        : shape === 'pentagon'
          ? 5
          : shape === 'hexagon'
            ? 6
            : shape === 'heptagon'
              ? 7
              : 8;
  const rot =
    shape === 'square'
      ? Math.PI / 4
      : shape === 'hexagon'
        ? -Math.PI / 6
        : shape === 'octagon'
          ? Math.PI / 8
          : -Math.PI / 2;
  return regularPolygon(sides, r, rot);
}

// ============================================================================
// Domain-Specific Canvas 2D Content Node Renderer
// ============================================================================

export const demoCanvasContentRenderer: CanvasNodeRenderer<DemoContentVisual> = {
  hoverScale: 1.12,
  dimmedOpacity: 0.28,

  measureConvexHull: (v) => {
    if (
      v.kind === 'domain-media' ||
      v.kind === 'domain-voice' ||
      v.kind === 'domain-repo' ||
      v.kind === 'domain-knowledge'
    ) {
      return rectToConvexPolygon(v.width + 3.5, v.height + 3.5);
    }
    if (v.kind === 'domain-zoo' || v.kind === 'domain-body') {
      return { kind: 'circle', radius: v.radius + 2.5 };
    }
    if (v.kind === 'geometric') {
      const pad = (v.shape.strokeWidth ?? 1.4) * 0.5;
      return measureGeometricKindHull(v.shape.shape, v.shape.radius + pad);
    }
    if (v.kind === 'multisector') {
      return { kind: 'circle', radius: v.glyph.outerRadius + 1.5 };
    }
    if (v.kind === 'react-card') {
      const w = Math.max(76, Math.min(138, Math.round(v.headline.length * 6.0 + 26)));
      const h = v.showMeta && v.metaLine ? 36 : 24;
      return rectToConvexPolygon(w + 4, h + 4, 6);
    }
    return { kind: 'circle', radius: 13 };
  },

  draw: (ctx, v, state, renderCtx) => {
    const baseAlpha = ctx.globalAlpha;

    // Fast-path Level-of-Detail when heavily zoomed out
    if (renderCtx.simplifiedLod) {
      ctx.fillStyle =
        v.kind === 'geometric'
          ? v.shape.fillHex
          : v.kind === 'multisector'
            ? (v.glyph.sectors[0]?.colorHex ?? '#38bdf8')
            : v.colorHex;
      ctx.beginPath();
      if (v.kind === 'domain-zoo' || v.kind === 'domain-body') {
        ctx.arc(0, 0, v.radius, 0, TAU);
      } else if (v.kind === 'geometric') {
        ctx.arc(0, 0, v.shape.radius, 0, TAU);
      } else if (v.kind === 'multisector') {
        ctx.arc(0, 0, v.glyph.outerRadius, 0, TAU);
      } else if (
        v.kind === 'domain-media' ||
        v.kind === 'domain-voice' ||
        v.kind === 'domain-repo' ||
        v.kind === 'domain-knowledge'
      ) {
        ctx.rect(-v.width / 2, -v.height / 2, v.width, v.height);
      } else {
        ctx.arc(0, 0, 8, 0, TAU);
      }
      ctx.fill();
      return;
    }

    // ------------------------------------------------------------------------
    // 1. UCI ZOO: Circular Wikimedia Commons Animal Photo Medallion
    // ------------------------------------------------------------------------
    if (v.kind === 'domain-zoo') {
      const isLight = v.theme === 'light';
      const r = v.radius;
      const bgFill = isLight ? '#ffffff' : '#0b111e';
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        ctx.beginPath();
        ctx.arc(0, 0, r + 3.4, 0, TAU);
        ctx.strokeStyle = accentHalo;
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = baseAlpha * 0.92;
        ctx.stroke();
      }

      // Base circular medallion
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fillStyle = bgFill;
      ctx.globalAlpha = baseAlpha * (isLight ? 0.98 : 0.96);
      ctx.fill();

      // Soft taxonomic wash + instant vector silhouette fallback
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(3, r - 1.5), 0, TAU);
      ctx.fillStyle = v.colorHex;
      ctx.globalAlpha = baseAlpha * (isLight ? 0.12 : 0.16);
      ctx.fill();

      const photoImg = getCachedCanvasImage(v.photoUrl);
      if (photoImg) {
        const innerR = Math.max(4, r - 1.35);
        ctx.save();
        ctx.globalAlpha = baseAlpha;
        ctx.beginPath();
        ctx.arc(0, 0, innerR, 0, TAU);
        ctx.clip();
        drawCoverImage(ctx, photoImg, -innerR, -innerR, innerR * 2, innerR * 2);
        ctx.restore();
      } else {
        drawZooSilhouette(ctx, v.symbolKind, v.colorHex, bgFill, r / 13.0, baseAlpha);
      }

      // Specimen bezel ring
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.globalAlpha = baseAlpha;
      ctx.stroke();
      return;
    }

    // ------------------------------------------------------------------------
    // 2. VEGA CINEMA: 2:3 Vertical Public-Domain Theatrical Poster
    // ------------------------------------------------------------------------
    if (v.kind === 'domain-media') {
      const isLight = v.theme === 'light';
      const hw = v.width / 2;
      const hh = v.height / 2;
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        traceRoundedRect(ctx, -hw - 3, -hh - 3, v.width + 6, v.height + 6, 4.8);
        ctx.strokeStyle = accentHalo;
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = baseAlpha * 0.92;
        ctx.stroke();
      }

      // Instant palette fallback backdrop before poster decode
      ctx.globalAlpha = baseAlpha;
      traceRoundedRect(ctx, -hw, -hh, v.width, v.height, 3.0);
      ctx.fillStyle = v.palette[1];
      ctx.fill();

      ctx.save();
      traceRoundedRect(ctx, -hw, -hh, v.width, v.height, 3.0);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(-hw, -hh);
      ctx.lineTo(hw, -hh);
      ctx.lineTo(-hw, hh);
      ctx.closePath();
      ctx.fillStyle = v.palette[0];
      ctx.globalAlpha = baseAlpha * 0.35;
      ctx.fill();
      ctx.restore();

      // Authentic theatrical poster (68x96 WebP)
      const inset = 0.65;
      const innerX = -hw + inset;
      const innerY = -hh + inset;
      const innerW = v.width - inset * 2;
      const innerH = v.height - inset * 2;
      const posterImg = getCachedCanvasImage(v.thumbnailUrl);
      if (posterImg) {
        ctx.save();
        ctx.globalAlpha = baseAlpha;
        traceRoundedRect(ctx, innerX, innerY, innerW, innerH, 2.5);
        ctx.clip();
        drawCoverImage(ctx, posterImg, innerX, innerY, innerW, innerH);
        ctx.restore();
      }

      // Dark bottom marquee scrim
      const scrimH = 10.4;
      ctx.save();
      traceRoundedRect(ctx, innerX, innerY, innerW, innerH, 2.5);
      ctx.clip();
      ctx.fillStyle = '#050811';
      ctx.globalAlpha = baseAlpha * 0.86;
      ctx.fillRect(innerX, hh - scrimH, innerW, scrimH - inset);
      ctx.restore();

      // Centered concise poster title
      const posterTitle =
        v.shortTitle.length > 10
          ? `${v.shortTitle.slice(0, 9).trim()}…`
          : v.shortTitle;
      ctx.globalAlpha = baseAlpha;
      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 5.3px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(posterTitle, 0, hh - 3.0);

      // Top-left square cluster color swatch pip
      traceRoundedRect(ctx, -hw + 2.3, -hh + 2.3, 3.5, 3.5, 0.9);
      ctx.fillStyle = v.colorHex;
      ctx.fill();
      ctx.strokeStyle = '#050811';
      ctx.lineWidth = 0.7;
      ctx.stroke();

      // Gold micro-star for acclaimed classics (IMDb >= 8.0)
      if (v.imdbRating >= 8.0) {
        ctx.font = '700 5.8px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#050811';
        ctx.lineWidth = 1.4;
        ctx.strokeText('★', hw - 2.9, -hh + 6.2);
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('★', hw - 2.9, -hh + 6.2);
      }

      // Outer gallery frame border
      traceRoundedRect(ctx, -hw, -hh, v.width, v.height, 3.0);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.globalAlpha = baseAlpha;
      ctx.stroke();
      return;
    }

    // ------------------------------------------------------------------------
    // 3. ARXIV KNOWLEDGE PAPERS: Scientific Manuscript Page Glyph
    // ------------------------------------------------------------------------
    if (v.kind === 'domain-knowledge') {
      const isLight = v.theme === 'light';
      const hw = v.width / 2;
      const hh = v.height / 2;
      const bgFill = isLight ? '#ffffff' : '#0c1220';
      const ruleColor = isLight ? '#94a3b8' : '#475569';
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        traceRoundedRect(ctx, -hw - 3, -hh - 3, v.width + 6, v.height + 6, 4.5);
        ctx.strokeStyle = accentHalo;
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = baseAlpha * 0.9;
        ctx.stroke();
      }

      // Manuscript page body
      traceRoundedRect(ctx, -hw, -hh, v.width, v.height, 2.5);
      ctx.fillStyle = bgFill;
      ctx.globalAlpha = baseAlpha * (isLight ? 0.98 : 0.96);
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.globalAlpha = baseAlpha;
      ctx.stroke();

      // Multi-category barycentric color header bar
      const innerW = v.width - 2.4;
      let cursorX = -hw + 1.2;
      const totalWeight = v.sectors.reduce((acc, s) => acc + s.weight, 0) || 1;
      for (const sec of v.sectors) {
        const segW = (sec.weight / totalWeight) * innerW;
        if (segW > 0.4) {
          traceRoundedRect(ctx, cursorX, -hh + 1.2, segW, 3.1, 0.9);
          ctx.fillStyle = sec.colorHex;
          ctx.fill();
          cursorX += segW;
        }
      }

      // Miniature scientific figure matching primary arXiv discipline
      const figY = -2.4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (v.figureKind === 'geometry') {
        ctx.beginPath();
        ctx.moveTo(0, figY - 5.2);
        ctx.lineTo(6.2, figY + 3.4);
        ctx.lineTo(-6.2, figY + 3.4);
        ctx.closePath();
        ctx.fillStyle = v.colorHex;
        ctx.globalAlpha = baseAlpha * 0.18;
        ctx.fill();
        ctx.globalAlpha = baseAlpha;
        ctx.strokeStyle = v.colorHex;
        ctx.lineWidth = 1.05;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, figY - 5.2);
        ctx.lineTo(1.2, figY + 3.4);
        ctx.lineWidth = 0.85;
        ctx.stroke();
      } else if (v.figureKind === 'graphics') {
        ctx.beginPath();
        ctx.moveTo(0, figY - 5.4);
        ctx.lineTo(5.8, figY - 2.2);
        ctx.lineTo(5.8, figY + 2.6);
        ctx.lineTo(0, figY + 5.2);
        ctx.lineTo(-5.8, figY + 2.6);
        ctx.lineTo(-5.8, figY - 2.2);
        ctx.closePath();
        ctx.fillStyle = v.colorHex;
        ctx.globalAlpha = baseAlpha * 0.16;
        ctx.fill();
        ctx.globalAlpha = baseAlpha;
        ctx.strokeStyle = v.colorHex;
        ctx.lineWidth = 1.0;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-5.8, figY - 2.2);
        ctx.lineTo(0, figY + 0.8);
        ctx.lineTo(5.8, figY - 2.2);
        ctx.moveTo(0, figY + 0.8);
        ctx.lineTo(0, figY + 5.2);
        ctx.lineWidth = 0.85;
        ctx.stroke();
      } else if (v.figureKind === 'vision') {
        ctx.beginPath();
        ctx.moveTo(-6.4, figY);
        ctx.quadraticCurveTo(0, figY - 5.4, 6.4, figY);
        ctx.quadraticCurveTo(0, figY + 5.4, -6.4, figY);
        ctx.closePath();
        ctx.fillStyle = v.colorHex;
        ctx.globalAlpha = baseAlpha * 0.16;
        ctx.fill();
        ctx.globalAlpha = baseAlpha;
        ctx.strokeStyle = v.colorHex;
        ctx.lineWidth = 1.05;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(0, figY, 1.9, 0, TAU);
        ctx.fillStyle = v.colorHex;
        ctx.fill();
      } else if (v.figureKind === 'ml') {
        ctx.beginPath();
        ctx.moveTo(-6.2, figY + 3.4);
        ctx.bezierCurveTo(-2.2, figY + 3.2, -1.2, figY - 4.4, 6.2, figY - 4.2);
        ctx.strokeStyle = v.colorHex;
        ctx.lineWidth = 1.35;
        ctx.stroke();

        ctx.fillStyle = v.colorHex;
        ctx.beginPath();
        ctx.arc(-3.6, figY + 1.8, 1.2, 0, TAU);
        ctx.arc(3.4, figY - 3.6, 1.2, 0, TAU);
        ctx.fill();
      } else {
        ctx.strokeStyle = v.colorHex;
        ctx.lineWidth = 1.05;
        ctx.beginPath();
        ctx.moveTo(0, figY - 4.2);
        ctx.lineTo(-4.4, figY + 2.6);
        ctx.moveTo(0, figY - 4.2);
        ctx.lineTo(4.4, figY + 2.6);
        ctx.stroke();

        ctx.fillStyle = v.colorHex;
        ctx.beginPath();
        ctx.arc(0, figY - 4.2, 1.7, 0, TAU);
        ctx.arc(-4.4, figY + 2.6, 1.5, 0, TAU);
        ctx.arc(4.4, figY + 2.6, 1.5, 0, TAU);
        ctx.fill();
      }

      // Abstract manuscript text rule lines
      ctx.strokeStyle = ruleColor;
      ctx.lineWidth = 1.0;
      ctx.lineCap = 'round';
      ctx.globalAlpha = baseAlpha * 0.55;
      ctx.beginPath();
      ctx.moveTo(-hw + 3.4, 5.0);
      ctx.lineTo(hw - 3.4, 5.0);
      ctx.stroke();

      ctx.globalAlpha = baseAlpha * 0.45;
      ctx.beginPath();
      ctx.moveTo(-hw + 3.4, 7.6);
      ctx.lineTo(hw - 6.8, 7.6);
      ctx.stroke();

      // Discipline short code at bottom
      ctx.globalAlpha = baseAlpha;
      ctx.fillStyle = isLight ? '#334155' : '#cbd5e1';
      ctx.font = '700 5.8px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(v.codeTag, 0, hh - 2.6);
      return;
    }

    // ------------------------------------------------------------------------
    // 4. GITHUB REPOS: Rectangular Open-Source Code Tile
    // ------------------------------------------------------------------------
    if (v.kind === 'domain-repo') {
      const isLight = v.theme === 'light';
      const hw = v.width / 2;
      const hh = v.height / 2;
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        traceRoundedRect(ctx, -hw - 3, -hh - 3, v.width + 6, v.height + 6, 5.0);
        ctx.strokeStyle = accentHalo;
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = baseAlpha * 0.9;
        ctx.stroke();
      }

      traceRoundedRect(ctx, -hw, -hh, v.width, v.height, 3.0);
      ctx.fillStyle = isLight ? '#ffffff' : '#0c1220';
      ctx.globalAlpha = baseAlpha * (isLight ? 0.98 : 0.96);
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.globalAlpha = baseAlpha;
      ctx.stroke();

      // Square language swatch
      traceRoundedRect(ctx, -hw + 5.0, -2.4, 4.8, 4.8, 1.1);
      ctx.fillStyle = v.langColorHex;
      ctx.fill();

      // Repo short name
      ctx.fillStyle = isLight ? '#0f172a' : '#f1f5f9';
      ctx.font = '600 8.0px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(v.repoName, -hw + 13.4, 2.8);

      // Compact star count
      ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
      ctx.font = '600 6.7px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${v.starsLabel}★`, hw - 5.2, 2.5);
      return;
    }

    // ------------------------------------------------------------------------
    // 5. UCI VOWELS: Acoustic Spectrogram Tile (IPA + LPC Formant Bars)
    // ------------------------------------------------------------------------
    if (v.kind === 'domain-voice') {
      const isLight = v.theme === 'light';
      const hw = v.width / 2;
      const hh = v.height / 2;
      const rx = 3.2;
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        traceRoundedRect(ctx, -hw - 3, -hh - 3, v.width + 6, v.height + 6, rx + 2.4);
        ctx.strokeStyle = accentHalo;
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = baseAlpha * 0.9;
        ctx.stroke();
      }

      traceRoundedRect(ctx, -hw, -hh, v.width, v.height, rx);
      ctx.fillStyle = isLight ? '#ffffff' : '#0b101b';
      ctx.globalAlpha = baseAlpha * (isLight ? 0.98 : 0.96);
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.globalAlpha = baseAlpha;
      ctx.stroke();

      // Subtle recessed oscilloscope well behind LPC formant bars
      const divX = -hw + 18.8;
      traceRoundedRect(
        ctx,
        divX + 0.6,
        -hh + 1.8,
        Math.max(8, hw - divX - 2.4),
        v.height - 3.6,
        1.8,
      );
      ctx.fillStyle = isLight ? '#f1f5f9' : '#060a12';
      ctx.fill();

      // Left IPA phoneme symbol
      const cleanIpa = v.ipaSymbol.replace(/\//g, '');
      ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
      ctx.font = '700 8.2px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(cleanIpa, -hw + 9.8, 2.9);

      // Hairline divider between IPA symbol and LPC spectrum
      ctx.beginPath();
      ctx.moveTo(divX, -hh + 2.5);
      ctx.lineTo(divX, hh - 2.5);
      ctx.strokeStyle = isLight ? '#e2e8f0' : '#1e293b';
      ctx.lineWidth = 0.85;
      ctx.stroke();

      // LPC formant frequency bars
      const startX = divX + 2.8;
      const rightPad = v.showPitchLabel ? 22 : 4.5;
      const waveSpan = Math.max(14, hw - rightPad - startX);
      const count = Math.max(4, Math.min(v.waveform.length, v.barCount));
      const step = waveSpan / count;
      const barW = Math.max(1.5, Math.min(2.6, step * 0.62));
      const maxBarH = v.height - 6.6;

      ctx.fillStyle = v.colorHex;
      ctx.globalAlpha = baseAlpha * 0.94;
      for (let i = 0; i < count; i++) {
        const sampleIdx = Math.min(
          v.waveform.length - 1,
          Math.floor((i * v.waveform.length) / count),
        );
        const amp = v.waveform[sampleIdx] ?? 0.4;
        const barH = Math.max(2.6, amp * maxBarH);
        const bx = startX + i * step + (step - barW) / 2;
        traceRoundedRect(ctx, bx, -barH / 2, barW, barH, 0.7);
        ctx.fill();
      }

      if (v.showPitchLabel) {
        ctx.globalAlpha = baseAlpha;
        ctx.fillStyle = isLight ? '#334155' : '#cbd5e1';
        ctx.font = '600 6.4px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(`${v.pitchHz}Hz`, hw - 4.8, 2.3);
      }
      return;
    }

    // ------------------------------------------------------------------------
    // 6. PALMER PENGUINS: Biometric Morphometric Medallion
    // ------------------------------------------------------------------------
    if (v.kind === 'domain-body') {
      const isLight = v.theme === 'light';
      const r = v.radius;
      const bgFill = isLight ? '#ffffff' : '#0b101b';
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        ctx.beginPath();
        ctx.arc(0, 0, r + 3.4, 0, TAU);
        ctx.strokeStyle = accentHalo;
        ctx.lineWidth = 1.35;
        ctx.globalAlpha = baseAlpha * 0.9;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fillStyle = bgFill;
      ctx.globalAlpha = baseAlpha * (isLight ? 0.98 : 0.96);
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.globalAlpha = baseAlpha;
      ctx.stroke();

      if (v.showCalibrationRing) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(4, r - 2.3), 0, TAU);
        ctx.strokeStyle = v.colorHex;
        ctx.globalAlpha = baseAlpha * 0.2;
        ctx.lineWidth = 0.7;
        ctx.setLineDash([2, 2.4]);
        ctx.stroke();
        ctx.restore();
      }

      const s = r / 15.5;
      const massFactor = Math.max(0.82, Math.min(1.22, v.bodyMassG / 4200));
      const flipperSpan = Math.max(0.85, Math.min(1.25, v.flipperLengthMm / 200));
      const billLen =
        Math.max(2.6, Math.min(5.2, ((v.billLengthMm - 32) / 26) * 2.6 + 2.6)) * s;
      const billHalfDepth =
        Math.max(0.85, Math.min(1.65, ((v.billDepthMm - 13) / 8.5) * 0.8 + 0.85)) * s;
      const bodyRx = 4.3 * massFactor * s;
      const bodyRy = 6.4 * s;
      const headR = 2.9 * s;
      const headY = -5.6 * s;
      const bodyY = 1.4 * s;

      ctx.save();
      ctx.translate(-0.5 * s, 0.3 * s);

      // Left & right flippers scaled by flipperLengthMm
      ctx.fillStyle = v.colorHex;
      ctx.globalAlpha = baseAlpha * 0.92;
      ctx.beginPath();
      ctx.moveTo(-bodyRx * 0.75, -2.0 * s);
      ctx.quadraticCurveTo(
        -bodyRx - 2.8 * flipperSpan * s,
        1.6 * s,
        -bodyRx - 1.1 * flipperSpan * s,
        5.6 * s,
      );
      ctx.quadraticCurveTo(-bodyRx * 0.5, 3.6 * s, -bodyRx * 0.55, 0.4 * s);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(bodyRx * 0.75, -2.0 * s);
      ctx.quadraticCurveTo(
        bodyRx + 2.4 * flipperSpan * s,
        1.6 * s,
        bodyRx + 0.9 * flipperSpan * s,
        5.4 * s,
      );
      ctx.quadraticCurveTo(bodyRx * 0.5, 3.6 * s, bodyRx * 0.55, 0.4 * s);
      ctx.closePath();
      ctx.fill();

      // Dorsal body & head
      ctx.globalAlpha = baseAlpha;
      ctx.beginPath();
      ctx.ellipse(0, bodyY, bodyRx, bodyRy, 0, 0, TAU);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, headY, headR, 0, TAU);
      ctx.fill();

      // Parameterized culmen (beak)
      ctx.fillStyle = v.species === 'Gentoo' ? '#f97316' : v.colorHex;
      ctx.beginPath();
      ctx.moveTo(headR * 0.65, headY - billHalfDepth);
      ctx.lineTo(headR * 0.65 + billLen, headY + 0.25 * s);
      ctx.lineTo(headR * 0.65, headY + billHalfDepth);
      ctx.closePath();
      ctx.fill();

      // Countershaded white belly
      ctx.fillStyle = bgFill;
      ctx.globalAlpha = baseAlpha * 0.95;
      ctx.beginPath();
      ctx.ellipse(0.45 * s, bodyY + 0.9 * s, bodyRx * 0.62, bodyRy * 0.74, 0, 0, TAU);
      ctx.fill();

      // Species-distinctive cranial markings
      ctx.globalAlpha = baseAlpha;
      if (v.species === 'Gentoo') {
        ctx.fillStyle = bgFill;
        ctx.beginPath();
        ctx.ellipse(-0.2 * s, headY - 0.8 * s, 1.5 * s, 0.85 * s, 0, 0, TAU);
        ctx.fill();
      } else if (v.species === 'Chinstrap') {
        ctx.fillStyle = bgFill;
        ctx.beginPath();
        ctx.arc(0.55 * s, headY + 0.2 * s, 1.45 * s, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = v.colorHex;
        ctx.lineWidth = Math.max(0.75, 0.85 * s);
        ctx.beginPath();
        ctx.moveTo(-0.5 * s, headY + 1.1 * s);
        ctx.quadraticCurveTo(0.6 * s, headY + 2.1 * s, 1.7 * s, headY + 0.6 * s);
        ctx.stroke();
      } else {
        ctx.fillStyle = bgFill;
        ctx.beginPath();
        ctx.arc(0.75 * s, headY - 0.25 * s, 0.9 * s, 0, TAU);
        ctx.fill();
      }

      ctx.restore();
      return;
    }

    // ------------------------------------------------------------------------
    // 7. GEOMETRIC FALLBACK
    // ------------------------------------------------------------------------
    if (v.kind === 'geometric') {
      const { shape, radius, fillHex, strokeHex, strokeWidth } = v.shape;
      const isLight = renderCtx.theme === 'light';
      if (state.interaction.isHovered || state.interaction.isPinned || state.interaction.isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, radius + 3.2, 0, TAU);
        ctx.strokeStyle =
          state.interaction.isPinned || state.interaction.isSelected
            ? '#f59e0b'
            : isLight
              ? '#0891b2'
              : '#22d3ee';
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = baseAlpha * 0.9;
        ctx.stroke();
      }
      ctx.globalAlpha = baseAlpha;
      traceGeometricKind(ctx, shape, radius);
      ctx.fillStyle = fillHex;
      ctx.fill();
      if (strokeHex && (strokeWidth ?? 0) > 0) {
        ctx.strokeStyle = strokeHex;
        ctx.lineWidth = strokeWidth ?? 1.2;
        ctx.stroke();
      }
      return;
    }

    // ------------------------------------------------------------------------
    // 8. MULTISECTOR BARYCENTRIC DONUT GLYPH
    // ------------------------------------------------------------------------
    if (v.kind === 'multisector') {
      const { outerRadius, innerRadius, sectors } = v.glyph;
      const isLight = renderCtx.theme === 'light';
      const total = sectors.reduce((acc, s) => acc + Math.max(0, s.weight), 0) || 1;
      const midR = (outerRadius + innerRadius) * 0.5;
      const thickness = Math.max(1.8, outerRadius - innerRadius);

      if (state.interaction.isHovered || state.interaction.isPinned || state.interaction.isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, outerRadius + 3.0, 0, TAU);
        ctx.strokeStyle =
          state.interaction.isPinned || state.interaction.isSelected
            ? '#f59e0b'
            : isLight
              ? '#0891b2'
              : '#22d3ee';
        ctx.lineWidth = 1.4;
        ctx.globalAlpha = baseAlpha * 0.9;
        ctx.stroke();
      }

      ctx.globalAlpha = baseAlpha;
      ctx.lineWidth = thickness;
      ctx.lineCap = 'butt';
      let angle = -Math.PI / 2;
      for (const sec of sectors) {
        const span = (Math.max(0, sec.weight) / total) * TAU;
        if (span <= 0.005) continue;
        ctx.beginPath();
        ctx.arc(0, 0, midR, angle, angle + span);
        ctx.strokeStyle = sec.colorHex;
        ctx.stroke();
        angle += span;
      }

      ctx.beginPath();
      ctx.arc(0, 0, innerRadius, 0, TAU);
      ctx.fillStyle = isLight ? '#ffffff' : '#0b101b';
      ctx.fill();
      return;
    }

    // ------------------------------------------------------------------------
    // 9. REACT-CARD COMPACT CANVAS EQUIVALENT
    // ------------------------------------------------------------------------
    if (v.kind === 'react-card') {
      const isLight = v.theme === 'light';
      const w = Math.max(76, Math.min(138, Math.round(v.headline.length * 6.0 + 26)));
      const hasMeta = Boolean(v.showMeta && v.metaLine);
      const h = hasMeta ? 36 : 24;
      const hw = w / 2;
      const hh = h / 2;
      const { stroke, strokeWidth, accentHalo } = resolveStateStroke(
        state,
        isLight,
        v.colorHex,
      );

      if (accentHalo) {
        traceRoundedRect(ctx, -hw - 3, -hh - 3, w + 6, h + 6, 8);
        ctx.strokeStyle = accentHalo;
        ctx.lineWidth = 1.35;
        ctx.globalAlpha = baseAlpha * 0.9;
        ctx.stroke();
      }

      traceRoundedRect(ctx, -hw, -hh, w, h, 5.5);
      ctx.fillStyle = isLight ? '#ffffff' : '#0c1220';
      ctx.globalAlpha = baseAlpha * 0.97;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      ctx.globalAlpha = baseAlpha;
      ctx.stroke();

      // Left accent bar
      traceRoundedRect(ctx, -hw + 2.5, -hh + 3.5, 3, h - 7, 1.5);
      ctx.fillStyle = v.colorHex;
      ctx.fill();

      ctx.fillStyle = isLight ? '#0f172a' : '#f1f5f9';
      ctx.font = '600 8.5px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(v.headline, -hw + 9, hasMeta ? -2 : 3);

      if (hasMeta) {
        ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
        ctx.font = '500 6.8px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillText(v.metaLine.slice(0, 22), -hw + 9, 10);
      }
    }
  },
};

// ============================================================================
// Domain-Specific Canvas 2D Cluster Node Renderer (1:1 Parity with SVG Badges)
// ============================================================================

function computeMinimalBadgeDimensions(badge: BadgeClusterVisual): {
  readonly width: number;
  readonly height: number;
} {
  if (badge.variant === 'intermediate') {
    const label = (badge.title || badge.code).trim();
    const parentCtx = (badge.parentContextLabel ?? '').trim();
    if (parentCtx.length > 0) {
      const topW = Math.round(parentCtx.length * 5.25 + 24);
      const botW = Math.round(label.length * 5.9 + 22);
      return {
        width: Math.max(66, topW, botW),
        height: 32,
      };
    }
    return {
      width: Math.max(48, Math.round(label.length * 5.8 + 20)),
      height: 22,
    };
  }
  const hasMeta = badge.metaLine.trim().length > 0;
  const labelW = Math.round(badge.title.length * 6.35 + 26);
  if (!hasMeta) {
    return {
      width: Math.max(54, labelW),
      height: 25,
    };
  }
  const metaW = Math.round(badge.metaLine.length * 5.3 + 26);
  return {
    width: Math.max(96, labelW, metaW),
    height: 38,
  };
}

export const demoCanvasClusterRenderer: CanvasNodeRenderer<DemoClusterVisual> = {
  hoverScale: 1.05,
  dimmedOpacity: 0.34,

  measureConvexHull: (v) => {
    if (v.kind === 'badge') {
      const { width, height } = computeMinimalBadgeDimensions(v.badge);
      const pad = v.badge.variant === 'intermediate' ? 8 : 9;
      return rectToConvexPolygon(width + pad, height + pad);
    }
    if (v.kind === 'anchor') {
      return { kind: 'circle', radius: v.anchor.radius + 4 };
    }
    const w = Math.max(66, Math.round(v.title.length * 6.4 + 28));
    return rectToConvexPolygon(w + 8, (v.showMeta ? 38 : 26) + 8);
  },

  draw: (ctx, v, state, renderCtx) => {
    const baseAlpha = ctx.globalAlpha;

    if (v.kind === 'anchor') {
      const { radius, colorHex, label } = v.anchor;
      const anchorTheme =
        v.anchor.theme === 'light' || renderCtx.theme === 'light' ? 'light' : 'dark';
      const anchorPalette = resolveClusterSurfaceColors(colorHex, anchorTheme);

      ctx.beginPath();
      ctx.arc(0, 0, radius + 3.2, 0, TAU);
      ctx.strokeStyle = anchorPalette.haloHex;
      ctx.lineWidth = 1.3;
      ctx.globalAlpha = baseAlpha * 0.6;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.fillStyle = anchorPalette.solidFillHex;
      ctx.globalAlpha = baseAlpha;
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 9.5px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0.5);
      return;
    }

    // Normalize both `'badge'` and `'react-card'` cluster visuals into jewel-tone badges
    const badge: BadgeClusterVisual =
      v.kind === 'badge'
        ? v.badge
        : {
            title: v.title,
            code: v.code,
            metaLine: v.showMeta ? v.subtitle : '',
            colorHex: v.colorHex,
            theme: v.theme,
            variant: v.isIntermediate ? 'intermediate' : 'primary',
            parentContextLabel: v.parentContextLabel,
          };

    const theme = badge.theme === 'light' || renderCtx.theme === 'light' ? 'light' : 'dark';
    const isLight = theme === 'light';
    const { width, height } = computeMinimalBadgeDimensions(badge);
    const halfW = width / 2;
    const halfH = height / 2;
    const isActive = state.interaction.isHovered || state.interaction.isHighlighted;
    const isPinned = state.interaction.isPinned || state.interaction.isSelected;
    const palette = resolveClusterSurfaceColors(badge.colorHex, theme);

    if (badge.variant === 'intermediate') {
      const label = (badge.title || badge.code).trim();
      const parentCtx = (badge.parentContextLabel ?? '').trim();
      const hasParentCtx = parentCtx.length > 0;
      const cut = hasParentCtx ? 6.4 : 5.4;
      const haloPad = hasParentCtx ? 2.5 : 2.3;

      // 1. Subtle grounding shadow
      traceChamferHex(ctx, halfW, halfH, cut, 1.4);
      ctx.fillStyle = '#020617';
      ctx.globalAlpha = baseAlpha * (isLight ? 0.15 : 0.42);
      ctx.fill();

      // 2. Dashed outer chamfered docking halo
      ctx.save();
      traceChamferHex(ctx, halfW + haloPad, halfH + haloPad, cut + 1.0);
      ctx.strokeStyle = isPinned ? '#f59e0b' : palette.haloHex;
      ctx.lineWidth = isActive ? 1.75 : 1.15;
      ctx.lineJoin = 'round';
      ctx.globalAlpha =
        baseAlpha * (isActive || isPinned ? 0.96 : isLight ? 0.54 : 0.68);
      if (!isActive) ctx.setLineDash([3, 2]);
      ctx.stroke();
      ctx.restore();

      // 3. Saturated jewel-tone chamfered body
      traceChamferHex(ctx, halfW, halfH, cut);
      ctx.fillStyle = palette.solidFillHex;
      ctx.globalAlpha = baseAlpha;
      ctx.fill();
      ctx.strokeStyle = isPinned ? '#fef08a' : '#ffffff';
      ctx.lineWidth = isActive ? 1.5 : 0.95;
      ctx.lineJoin = 'round';
      ctx.globalAlpha = baseAlpha * (isActive ? 0.92 : 0.28);
      ctx.stroke();

      // 4. Typography
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      if (hasParentCtx) {
        ctx.globalAlpha = baseAlpha * 0.78;
        ctx.font = '700 7.3px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillText(parentCtx.toUpperCase(), 0, -4.2);

        ctx.globalAlpha = baseAlpha;
        ctx.font = '700 9.2px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.fillText(label, 0, 7.5);
      } else {
        ctx.globalAlpha = baseAlpha;
        ctx.font = '700 9.1px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.fillText(label, 0, 3.2);
      }
      return;
    }

    // Primary cluster: jewel-tone capsule + solid outer halo
    const hasMeta = badge.metaLine.trim().length > 0;
    const rx = halfH;
    const haloPad = 2.6;

    // 1. Subtle grounding shadow
    traceRoundedRect(ctx, -halfW, -halfH + 1.6, width, height, rx);
    ctx.fillStyle = '#020617';
    ctx.globalAlpha = baseAlpha * (isLight ? 0.16 : 0.45);
    ctx.fill();

    // 2. Outer docking halo ring
    traceRoundedRect(
      ctx,
      -halfW - haloPad,
      -halfH - haloPad,
      width + haloPad * 2,
      height + haloPad * 2,
      rx + haloPad,
    );
    ctx.strokeStyle = isPinned ? '#f59e0b' : palette.haloHex;
    ctx.lineWidth = isActive ? 1.85 : 1.2;
    ctx.globalAlpha =
      baseAlpha * (isActive || isPinned ? 0.96 : isLight ? 0.48 : 0.64);
    ctx.stroke();

    // 3. Saturated OKLab-calibrated jewel-tone capsule body
    traceRoundedRect(ctx, -halfW, -halfH, width, height, rx);
    ctx.fillStyle = palette.solidFillHex;
    ctx.globalAlpha = baseAlpha;
    ctx.fill();
    ctx.strokeStyle = isPinned ? '#fef08a' : '#ffffff';
    ctx.lineWidth = isActive ? 1.6 : 1.0;
    ctx.globalAlpha = baseAlpha * (isActive ? 0.92 : 0.28);
    ctx.stroke();

    // 4. Centered high-contrast white typography
    ctx.globalAlpha = baseAlpha;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 10.5px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(badge.title, 0, hasMeta ? -2.2 : 3.7);

    if (hasMeta) {
      ctx.globalAlpha = baseAlpha * 0.85;
      ctx.font = '500 8.3px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(badge.metaLine, 0, 10.6);
    }
  },
};
