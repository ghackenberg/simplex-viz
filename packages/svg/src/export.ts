import { SVG_NS } from './hullMeasure.js';
import type { SimplexTheme } from './presets.js';

/**
 * Options for `controller.exportSvg(options?)` client-side standalone SVG serialization.
 */
export interface ExportSvgOptions {
  /**
   * Whether to inject an opaque canvas background `<rect>` matching the active theme
   * (`#07090e` dark / `#ffffff` light) or `backgroundColor`. Default: `true`.
   */
  readonly includeBackground?: boolean;
  /**
   * Explicit CSS color override for the exported background `<rect>` (for example `'#0b0f17'`
   * or `'#f8fafc'`). Ignored when `includeBackground` is `false`.
   */
  readonly backgroundColor?: string;
  /**
   * Extra uniform margin (in SVG coordinate units) expanded around all four sides of the
   * exported `viewBox`. Default: `0`.
   */
  readonly padding?: number;
  /**
   * Explicit output `width` attribute (in pixels) on the root `<svg>`.
   * When omitted, derived from the exported `viewBox` width (or scaled proportionally
   * if only `height` is provided).
   */
  readonly width?: number;
  /**
   * Explicit output `height` attribute (in pixels) on the root `<svg>`.
   * When omitted, derived from the exported `viewBox` height (or scaled proportionally
   * if only `width` is provided).
   */
  readonly height?: number;
  /**
   * Whether to inline resolved computed CSS visual styles (such as `font-family`, `fill`,
   * `stroke`, `opacity`, and CSS custom properties) from host stylesheets onto cloned SVG
   * elements so custom views render identically outside the page. Default: `true`.
   */
  readonly inlineStyles?: boolean;
  /**
   * Whether to include the high-contrast keyboard accessibility focus ring
   * (`g.sv-a11y-focus-ring`) in the exported graphic. Default: `false`.
   */
  readonly includeFocusRing?: boolean;
  /**
   * Optional `<title>` element injected at the top of the exported `<svg>`.
   */
  readonly title?: string;
  /**
   * Whether to prepend an `<?xml version="1.0" encoding="UTF-8"?>` header for strict
   * standalone SVG files. Default: `false`.
   */
  readonly xmlDeclaration?: boolean;
}

/**
 * Common options shared by `controller.exportPng(options?)` output formats.
 */
export interface ExportPngBaseOptions extends ExportSvgOptions {
  /**
   * HiDPI / pixel-density scale factor applied to the rasterized output canvas.
   * For example, `scale: 2` (default) renders a `960×620` graph at `1920×1240` physical
   * pixels for crisp Retina displays, slide decks, and academic publications.
   */
  readonly scale?: number;
  /**
   * Raster output MIME type forwarded to canvas serialization. Default: `'image/png'`.
   */
  readonly mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  /**
   * Compression quality in `[0, 1]` used for lossy MIME types (`'image/jpeg'`, `'image/webp'`).
   */
  readonly quality?: number;
}

/**
 * Options for `controller.exportPng()` returning a binary `Blob` (default).
 */
export interface ExportPngBlobOptions extends ExportPngBaseOptions {
  /** Output format (`'blob'` default returns `Promise<Blob>`). */
  readonly format?: 'blob';
}

/**
 * Options for `controller.exportPng()` returning a base64 `data:` URL string.
 */
export interface ExportPngDataUrlOptions extends ExportPngBaseOptions {
  /** Output format (`'dataUrl'` returns a `data:image/png;base64,...` string). */
  readonly format: 'dataUrl';
}

/**
 * Union of options accepted by `controller.exportPng(options?)`.
 */
export type ExportPngOptions = ExportPngBlobOptions | ExportPngDataUrlOptions;

/**
 * Returns the canonical canvas surface background hex matching the active theme.
 */
export function resolveThemeBackgroundColor(theme: SimplexTheme): string {
  return theme === 'light' ? '#ffffff' : '#07090e';
}

interface ParsedViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export interface PreparedExportSvgResult {
  readonly svgString: string;
  readonly width: number;
  readonly height: number;
  readonly viewBox: ParsedViewBox;
}

const DEFAULT_FALLBACK_FONT =
  'Plus Jakarta Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const GEOMETRY_TAGS = new Set([
  'path',
  'circle',
  'rect',
  'polygon',
  'polyline',
  'ellipse',
  'line',
]);

const TEXT_TAGS = new Set(['text', 'tspan']);

const VISUAL_STYLE_PROPS: ReadonlyArray<{
  readonly attr: string;
  readonly cssProp: string;
  readonly defaultValues: ReadonlySet<string>;
}> = [
  {
    attr: 'fill',
    cssProp: 'fill',
    defaultValues: new Set(['', 'rgb(0, 0, 0)', '#000000', '#000', 'black']),
  },
  {
    attr: 'fill-opacity',
    cssProp: 'fill-opacity',
    defaultValues: new Set(['', '1']),
  },
  {
    attr: 'stroke',
    cssProp: 'stroke',
    defaultValues: new Set(['', 'none']),
  },
  {
    attr: 'stroke-width',
    cssProp: 'stroke-width',
    defaultValues: new Set(['', '1px', '1']),
  },
  {
    attr: 'stroke-opacity',
    cssProp: 'stroke-opacity',
    defaultValues: new Set(['', '1']),
  },
  {
    attr: 'stroke-dasharray',
    cssProp: 'stroke-dasharray',
    defaultValues: new Set(['', 'none']),
  },
  {
    attr: 'stroke-linecap',
    cssProp: 'stroke-linecap',
    defaultValues: new Set(['', 'butt']),
  },
  {
    attr: 'stroke-linejoin',
    cssProp: 'stroke-linejoin',
    defaultValues: new Set(['', 'miter']),
  },
  {
    attr: 'opacity',
    cssProp: 'opacity',
    defaultValues: new Set(['', '1']),
  },
  {
    attr: 'visibility',
    cssProp: 'visibility',
    defaultValues: new Set(['', 'visible']),
  },
  {
    attr: 'display',
    cssProp: 'display',
    defaultValues: new Set(['', 'inline']),
  },
];

const TEXT_STYLE_PROPS: ReadonlyArray<{
  readonly attr: string;
  readonly cssProp: string;
  readonly defaultValues: ReadonlySet<string>;
}> = [
  {
    attr: 'font-family',
    cssProp: 'font-family',
    defaultValues: new Set(['']),
  },
  {
    attr: 'font-size',
    cssProp: 'font-size',
    defaultValues: new Set(['']),
  },
  {
    attr: 'font-weight',
    cssProp: 'font-weight',
    defaultValues: new Set(['', '400', 'normal']),
  },
  {
    attr: 'font-style',
    cssProp: 'font-style',
    defaultValues: new Set(['', 'normal']),
  },
  {
    attr: 'letter-spacing',
    cssProp: 'letter-spacing',
    defaultValues: new Set(['', 'normal', '0px', '0']),
  },
  {
    attr: 'text-anchor',
    cssProp: 'text-anchor',
    defaultValues: new Set(['', 'start']),
  },
  {
    attr: 'dominant-baseline',
    cssProp: 'dominant-baseline',
    defaultValues: new Set(['', 'auto']),
  },
];

function formatNumber(val: number): string {
  if (!Number.isFinite(val)) return '0';
  const rounded = Math.round(val * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function parseSvgViewBox(svgEl: SVGSVGElement): ParsedViewBox {
  const raw = svgEl.getAttribute('viewBox');
  if (raw) {
    const parts = raw
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      parts.length === 4 &&
      parts.every((n) => Number.isFinite(n)) &&
      parts[2]! > 0 &&
      parts[3]! > 0
    ) {
      return {
        minX: parts[0]!,
        minY: parts[1]!,
        width: parts[2]!,
        height: parts[3]!,
      };
    }
  }

  const rect =
    typeof svgEl.getBoundingClientRect === 'function'
      ? svgEl.getBoundingClientRect()
      : null;
  const width =
    rect && rect.width > 0
      ? rect.width
      : svgEl.clientWidth > 0
        ? svgEl.clientWidth
        : 960;
  const height =
    rect && rect.height > 0
      ? rect.height
      : svgEl.clientHeight > 0
        ? svgEl.clientHeight
        : 620;
  return { minX: 0, minY: 0, width, height };
}

function normalizeColorForComparison(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(trimmed);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    if (hex.length === 3) {
      const r = parseInt(hex[0]! + hex[0]!, 16);
      const g = parseInt(hex[1]! + hex[1]!, 16);
      const b = parseInt(hex[2]! + hex[2]!, 16);
      return `rgb(${r}, ${g}, ${b})`;
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const rgbMatch = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(trimmed);
  if (rgbMatch) {
    return `rgb(${Number(rgbMatch[1])}, ${Number(rgbMatch[2])}, ${Number(rgbMatch[3])})`;
  }
  return trimmed;
}

function shouldSkipInliningSubtree(
  el: Element,
  includeFocusRing: boolean,
): boolean {
  const cls = el.getAttribute('class') ?? '';
  if (!cls) return false;
  const tokens = cls.split(/\s+/);
  if (tokens.includes('sv-measure-bin')) return true;
  if (!includeFocusRing && tokens.includes('sv-a11y-focus-ring')) return true;
  return false;
}

function inlineComputedStylesRecursive(
  origEl: Element,
  cloneEl: Element,
  win: Window,
  includeFocusRing: boolean,
): void {
  if (shouldSkipInliningSubtree(origEl, includeFocusRing)) {
    return;
  }

  const tag = origEl.tagName.toLowerCase();
  const isGeometry = GEOMETRY_TAGS.has(tag);
  const isText = TEXT_TAGS.has(tag);
  const isGroup = tag === 'g';

  if (isGeometry || isText || isGroup) {
    const computed = win.getComputedStyle(origEl);
    const hasCustomStyleOrClass =
      origEl.hasAttribute('style') ||
      ((origEl.getAttribute('class') ?? '')
        .split(/\s+/)
        .some((c) => c.length > 0 && !c.startsWith('sv-')));

    const propList = isText
      ? [...VISUAL_STYLE_PROPS, ...TEXT_STYLE_PROPS]
      : isGeometry
        ? VISUAL_STYLE_PROPS
        : VISUAL_STYLE_PROPS.filter(
            (p) =>
              p.attr === 'opacity' ||
              p.attr === 'visibility' ||
              p.attr === 'display',
          );

    for (const spec of propList) {
      const existingAttr = cloneEl.getAttribute(spec.attr);
      // Preserve paint server references like `url(#sv-grad-...)` verbatim
      if (existingAttr && existingAttr.trim().toLowerCase().startsWith('url(')) {
        continue;
      }

      const rawComputed = computed.getPropertyValue(spec.cssProp).trim();
      const usesCssVarOrCurrentColor =
        existingAttr !== null &&
        (/\bvar\s*\(/i.test(existingAttr) ||
          existingAttr.trim().toLowerCase() === 'currentcolor');

      if (usesCssVarOrCurrentColor) {
        const resolvedVal =
          rawComputed && rawComputed.toLowerCase() !== 'currentcolor'
            ? rawComputed
            : computed.getPropertyValue('color').trim();
        if (resolvedVal) {
          cloneEl.setAttribute(spec.attr, resolvedVal);
        }
        continue;
      }

      if (existingAttr !== null) {
        // Only override an explicit presentation attribute if host CSS actually changed its value
        if (
          rawComputed &&
          hasCustomStyleOrClass &&
          normalizeColorForComparison(existingAttr) !==
            normalizeColorForComparison(rawComputed) &&
          !(
            spec.attr === 'stroke-width' &&
            parseFloat(existingAttr) === parseFloat(rawComputed)
          )
        ) {
          cloneEl.setAttribute(spec.attr, rawComputed);
        }
        continue;
      }

      if (isText && spec.attr === 'font-family') {
        cloneEl.setAttribute(
          'font-family',
          rawComputed || DEFAULT_FALLBACK_FONT,
        );
        continue;
      }

      if (!rawComputed || spec.defaultValues.has(rawComputed.toLowerCase())) {
        continue;
      }

      // Skip default inherited black fill on non-CSS-styled geometry/text unless explicitly needed
      if (
        spec.attr === 'fill' &&
        !hasCustomStyleOrClass &&
        normalizeColorForComparison(rawComputed) === 'rgb(0, 0, 0)'
      ) {
        continue;
      }

      cloneEl.setAttribute(spec.attr, rawComputed);
    }

    // Remove raw inline CSS `style` once visual properties are promoted, unless custom non-standard styles exist
    if (cloneEl.hasAttribute('style') && hasCustomStyleOrClass) {
      // Keep inline style on custom user elements only if it holds properties not in our promoted set
      const styleAttr = cloneEl.getAttribute('style') ?? '';
      if (!/filter|clip-path|mix-blend-mode|transform/i.test(styleAttr)) {
        cloneEl.removeAttribute('style');
      }
    }
  }

  const origChildren = origEl.children;
  const cloneChildren = cloneEl.children;
  const count = Math.min(origChildren.length, cloneChildren.length);
  for (let i = 0; i < count; i++) {
    inlineComputedStylesRecursive(
      origChildren[i]!,
      cloneChildren[i]!,
      win,
      includeFocusRing,
    );
  }
}

function serializeSvgNode(clone: SVGSVGElement): string {
  const doc = clone.ownerDocument;
  const win = doc?.defaultView;
  let markup: string;
  const SerializerCtor =
    win && typeof win.XMLSerializer === 'function'
      ? win.XMLSerializer
      : typeof XMLSerializer === 'function'
        ? XMLSerializer
        : null;

  if (SerializerCtor) {
    markup = new SerializerCtor().serializeToString(clone);
  } else {
    markup = clone.outerHTML;
  }

  // Ensure root <svg> carries a single valid SVG namespace declaration
  if (!/^<svg\b[^>]*\bxmlns=/.test(markup)) {
    markup = markup.replace(
      /^<svg\b/,
      `<svg xmlns="${SVG_NS}"`,
    );
  }
  return markup;
}

/**
 * Clones, cleans, style-inlines, and serializes a live `SVGSVGElement` into a standalone
 * publication-ready SVG string along with resolved pixel dimensions.
 */
export function prepareStandaloneSvg(
  svgEl: SVGSVGElement,
  context: {
    readonly theme: SimplexTheme;
  },
  options: ExportSvgOptions = {},
): PreparedExportSvgResult {
  const doc = svgEl.ownerDocument;
  const win = doc?.defaultView ?? null;
  const baseVb = parseSvgViewBox(svgEl);

  const padding =
    options.padding !== undefined &&
    Number.isFinite(options.padding) &&
    options.padding > 0
      ? options.padding
      : 0;

  let vbX = baseVb.minX - padding;
  let vbY = baseVb.minY - padding;
  let vbW = baseVb.width + padding * 2;
  let vbH = baseVb.height + padding * 2;

  const hasCustomW =
    options.width !== undefined &&
    Number.isFinite(options.width) &&
    options.width > 0;
  const hasCustomH =
    options.height !== undefined &&
    Number.isFinite(options.height) &&
    options.height > 0;

  let outW: number;
  let outH: number;
  if (hasCustomW && hasCustomH) {
    outW = options.width!;
    outH = options.height!;
    const targetAspect = outW / outH;
    const srcAspect = vbW / vbH;
    if (Math.abs(targetAspect - srcAspect) > 1e-4) {
      if (targetAspect > srcAspect) {
        const expandedW = vbH * targetAspect;
        vbX -= (expandedW - vbW) / 2;
        vbW = expandedW;
      } else {
        const expandedH = vbW / targetAspect;
        vbY -= (expandedH - vbH) / 2;
        vbH = expandedH;
      }
    }
  } else if (hasCustomW) {
    outW = options.width!;
    outH = (outW * vbH) / vbW;
  } else if (hasCustomH) {
    outH = options.height!;
    outW = (outH * vbW) / vbH;
  } else {
    outW = vbW;
    outH = vbH;
  }

  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  const includeFocusRing = options.includeFocusRing === true;
  const shouldInlineStyles = options.inlineStyles !== false;

  if (shouldInlineStyles && win && typeof win.getComputedStyle === 'function') {
    inlineComputedStylesRecursive(svgEl, clone, win, includeFocusRing);
  }

  // Strip internal measurement bin (positioned at translate(-99999, -99999))
  for (const bin of Array.from(clone.querySelectorAll('g.sv-measure-bin'))) {
    bin.remove();
  }

  // Strip keyboard focus ring unless explicitly requested
  if (!includeFocusRing) {
    for (const ring of Array.from(clone.querySelectorAll('g.sv-a11y-focus-ring'))) {
      ring.remove();
    }
  }

  // Strip empty debug hull overlay group to keep exported markup clean
  for (const hullOverlay of Array.from(clone.querySelectorAll('g.sv-hull-overlay'))) {
    if (hullOverlay.children.length === 0) {
      hullOverlay.remove();
    }
  }

  // Strip transient DOM-only interactive attributes and collision-prone a11y IDs
  clone.removeAttribute('tabindex');
  clone.removeAttribute('role');
  clone.removeAttribute('aria-activedescendant');
  clone.removeAttribute('aria-roledescription');
  clone.removeAttribute('style');

  let usesXlinkHref = false;
  for (const el of Array.from(clone.querySelectorAll('*'))) {
    const id = el.getAttribute('id');
    if (id && id.startsWith('sv-a11y-')) {
      el.removeAttribute('id');
    }
    el.removeAttribute('data-keyboard-focused');
    if (el.hasAttribute('xlink:href')) {
      usesXlinkHref = true;
    }
  }

  clone.setAttribute('xmlns', SVG_NS);
  if (usesXlinkHref) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
  clone.setAttribute(
    'viewBox',
    `${formatNumber(vbX)} ${formatNumber(vbY)} ${formatNumber(vbW)} ${formatNumber(vbH)}`,
  );
  clone.setAttribute('width', formatNumber(outW));
  clone.setAttribute('height', formatNumber(outH));

  // Insert background <rect> behind scene layers when requested (default: true)
  const includeBackground = options.includeBackground !== false;
  if (includeBackground) {
    const bgFill =
      options.backgroundColor?.trim() ||
      resolveThemeBackgroundColor(context.theme);
    const bgRect = doc.createElementNS(SVG_NS, 'rect');
    bgRect.setAttribute('class', 'sv-export-background');
    bgRect.setAttribute('x', formatNumber(vbX));
    bgRect.setAttribute('y', formatNumber(vbY));
    bgRect.setAttribute('width', formatNumber(vbW));
    bgRect.setAttribute('height', formatNumber(vbH));
    bgRect.setAttribute('fill', bgFill);
    clone.insertBefore(bgRect, clone.firstChild);
  }

  if (options.title && options.title.trim().length > 0) {
    const titleEl = doc.createElementNS(SVG_NS, 'title');
    titleEl.textContent = options.title.trim();
    clone.insertBefore(titleEl, clone.firstChild);
  }

  let svgString = serializeSvgNode(clone);
  if (options.xmlDeclaration === true) {
    svgString = `<?xml version="1.0" encoding="UTF-8"?>\n${svgString}`;
  }

  return {
    svgString,
    width: Math.round(outW * 100) / 100,
    height: Math.round(outH * 100) / 100,
    viewBox: { minX: vbX, minY: vbY, width: vbW, height: vbH },
  };
}

function dataUrlToBlob(dataUrl: string, fallbackMime: string): Blob {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) {
    return new Blob([], { type: fallbackMime });
  }
  const header = dataUrl.slice(0, commaIdx);
  const body = dataUrl.slice(commaIdx + 1);
  const mimeMatch = /^data:([^;]+)/.exec(header);
  const mime = mimeMatch?.[1] || fallbackMime;
  if (/;base64$/i.test(header)) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(body)], { type: mime });
}

function loadSvgImage(
  svgString: string,
  win: Window | null,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const winWithImage = win as (Window & { readonly Image?: typeof Image }) | null;
    const ImageCtor =
      winWithImage && typeof winWithImage.Image === 'function'
        ? winWithImage.Image
        : typeof Image === 'function'
          ? Image
          : null;
    if (!ImageCtor) {
      reject(
        new Error(
          'SimplexSvgController.exportPng: Image constructor is unavailable in this environment.',
        ),
      );
      return;
    }

    const canUseObjectUrl =
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function' &&
      typeof URL.revokeObjectURL === 'function' &&
      typeof Blob !== 'undefined';

    let objectUrl: string | null = null;
    const cleanup = (): void => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };

    const img = new ImageCtor();
    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(
        new Error(
          'SimplexSvgController.exportPng: failed to decode serialized SVG image.',
        ),
      );
    };

    if (canUseObjectUrl) {
      const svgBlob = new Blob([svgString], {
        type: 'image/svg+xml;charset=utf-8',
      });
      objectUrl = URL.createObjectURL(svgBlob);
      img.src = objectUrl;
    } else {
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
    }
  });
}

/**
 * Serializes the live `SVGSVGElement`, rasterizes it onto an offscreen HiDPI `<canvas>`,
 * and returns a `Blob` (default) or `data:` URL string.
 */
export async function exportSvgElementToPng(
  svgEl: SVGSVGElement,
  context: {
    readonly theme: SimplexTheme;
  },
  options: ExportPngDataUrlOptions,
): Promise<string>;
export async function exportSvgElementToPng(
  svgEl: SVGSVGElement,
  context: {
    readonly theme: SimplexTheme;
  },
  options?: ExportPngBlobOptions,
): Promise<Blob>;
export async function exportSvgElementToPng(
  svgEl: SVGSVGElement,
  context: {
    readonly theme: SimplexTheme;
  },
  options?: ExportPngOptions,
): Promise<Blob | string>;
export async function exportSvgElementToPng(
  svgEl: SVGSVGElement,
  context: {
    readonly theme: SimplexTheme;
  },
  options: ExportPngOptions = {},
): Promise<Blob | string> {
  const doc = svgEl.ownerDocument;
  const win = doc?.defaultView ?? null;
  if (!doc) {
    throw new Error(
      'SimplexSvgController.exportPng: cannot rasterize SVG outside a DOM document.',
    );
  }

  const prepared = prepareStandaloneSvg(svgEl, context, options);
  const scale =
    options.scale !== undefined &&
    Number.isFinite(options.scale) &&
    options.scale > 0
      ? options.scale
      : 2;
  const pixelWidth = Math.max(1, Math.round(prepared.width * scale));
  const pixelHeight = Math.max(1, Math.round(prepared.height * scale));
  const mimeType = options.mimeType ?? 'image/png';
  const quality = options.quality;

  const img = await loadSvgImage(prepared.svgString, win);

  const canvas = doc.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error(
      'SimplexSvgController.exportPng: 2D canvas rendering context is unavailable.',
    );
  }

  ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  if ('imageSmoothingEnabled' in ctx) {
    ctx.imageSmoothingEnabled = true;
  }
  if ('imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.drawImage(img, 0, 0, pixelWidth, pixelHeight);

  if (options.format === 'dataUrl') {
    return canvas.toDataURL(mimeType, quality);
  }

  if (typeof canvas.toBlob === 'function') {
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(
              new Error(
                'SimplexSvgController.exportPng: canvas.toBlob() returned null.',
              ),
            );
          }
        },
        mimeType,
        quality,
      );
    });
  }

  return dataUrlToBlob(canvas.toDataURL(mimeType, quality), mimeType);
}
