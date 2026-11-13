import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

interface VertexSpec {
  readonly cx: number;
  readonly cy: number;
  readonly fill: string;
  readonly ringFill: string;
  readonly edgeTint: string;
}

interface BannerLogoSpec {
  readonly svgPath: string;
  readonly pngPath: string;
  readonly width: number;
  readonly height: number;
  readonly pngWidth: number;
  readonly titleXml: string;
  readonly subtitle: string;
  readonly subtitleFontSize: number;
  readonly subtitleLetterSpacing: number;
  readonly wordmarkComment: string;
}

interface StaticPreviewSpec {
  readonly svgPath: string;
  readonly pngPath: string;
  readonly width: number;
}

interface SceneSvgTarget {
  readonly svgPath: string;
  readonly pngOutputs: ReadonlyArray<{ readonly pngPath: string; readonly width: number }>;
}

interface FileDiff {
  readonly filePath: string;
  readonly reason: 'missing' | 'outdated';
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');

/**
 * Canonical 3-vertex SimplexViz brand palette:
 * - Top (Cyan): `#06B6D4` (`Viz`, `@simplex-viz/core`)
 * - Bottom-Left (Amber): `#F59E0B` (`@simplex-viz/svg`)
 * - Bottom-Right (Magenta): `#D946EF` (`@simplex-viz/react`)
 */
export const BRAND_COLORS = {
  cyan: {
    core: '#06B6D4',
    ring: '#155E75',
    brightEdge: '#22D3EE',
  },
  amber: {
    core: '#F59E0B',
    ring: '#92400E',
    brightEdge: '#FBBF24',
  },
  magenta: {
    core: '#D946EF',
    ring: '#86198F',
    brightEdge: '#E879F9',
  },
  neutral: {
    wordmark: '#6B7F99',
    slate: '#64748B',
  },
} as const;

/**
 * Single Source of Truth for the SimplexViz 60° equilateral triangle mark (512×512 viewBox).
 */
const MARK_GEOMETRY = {
  viewBox: '0 0 512 512',
  trianglePoints: '256,95 70,417.2 442,417.2',
  triangleStrokeWidth: 28,
  collarRadius: 54,
  dotRadius: 37,
  baseWashFill: BRAND_COLORS.neutral.slate,
  baseWashOpacity: 0.08,
  gradientIds: {
    cyan: 'svCyan',
    amber: 'svAmber',
    magenta: 'svMagenta',
    edgeTopLeft: 'svEdgeTopLeft',
    edgeTopRight: 'svEdgeTopRight',
    edgeBottom: 'svEdgeBottom',
    tile: 'svTile',
  },
  vertices: [
    {
      cx: 256,
      cy: 95,
      fill: BRAND_COLORS.cyan.core,
      ringFill: BRAND_COLORS.cyan.ring,
      edgeTint: BRAND_COLORS.cyan.brightEdge,
    },
    {
      cx: 70,
      cy: 417.2,
      fill: BRAND_COLORS.amber.core,
      ringFill: BRAND_COLORS.amber.ring,
      edgeTint: BRAND_COLORS.amber.brightEdge,
    },
    {
      cx: 442,
      cy: 417.2,
      fill: BRAND_COLORS.magenta.core,
      ringFill: BRAND_COLORS.magenta.ring,
      edgeTint: BRAND_COLORS.magenta.brightEdge,
    },
  ] as readonly [VertexSpec, VertexSpec, VertexSpec],
} as const;

const DEFS_START_MARKER = '<!-- @simplex-mark-defs:start -->';
const DEFS_END_MARKER = '<!-- @simplex-mark-defs:end -->';
const NODE_START_MARKER = '<!-- @simplex-mark-node:start -->';
const NODE_END_MARKER = '<!-- @simplex-mark-node:end -->';

function indentLines(lines: readonly string[], indent: string): string {
  return lines.map((line) => (line.length === 0 ? '' : `${indent}${line}`)).join('\n');
}

function getMarkGradientLines(includeTileGradient: boolean): readonly string[] {
  const [top, left, right] = MARK_GEOMETRY.vertices;
  const tileLines: readonly string[] = includeTileGradient
    ? [
        `<linearGradient id="${MARK_GEOMETRY.gradientIds.tile}" x1="0%" y1="0%" x2="100%" y2="100%">`,
        '  <stop offset="0%" stop-color="#111B2E"/>',
        '  <stop offset="55%" stop-color="#090E17"/>',
        '  <stop offset="100%" stop-color="#05070C"/>',
        '</linearGradient>',
      ]
    : [];

  return [
    ...tileLines,
    `<radialGradient id="${MARK_GEOMETRY.gradientIds.cyan}" cx="50%" cy="22%" r="72%">`,
    `  <stop offset="0%" stop-color="${top.fill}" stop-opacity="0.44"/>`,
    `  <stop offset="100%" stop-color="${top.fill}" stop-opacity="0"/>`,
    '</radialGradient>',
    `<radialGradient id="${MARK_GEOMETRY.gradientIds.amber}" cx="20%" cy="78%" r="70%">`,
    `  <stop offset="0%" stop-color="${left.fill}" stop-opacity="0.42"/>`,
    `  <stop offset="100%" stop-color="${left.fill}" stop-opacity="0"/>`,
    '</radialGradient>',
    `<radialGradient id="${MARK_GEOMETRY.gradientIds.magenta}" cx="80%" cy="78%" r="70%">`,
    `  <stop offset="0%" stop-color="${right.fill}" stop-opacity="0.42"/>`,
    `  <stop offset="100%" stop-color="${right.fill}" stop-opacity="0"/>`,
    '</radialGradient>',
    `<linearGradient id="${MARK_GEOMETRY.gradientIds.edgeTopLeft}" gradientUnits="userSpaceOnUse" x1="${top.cx}" y1="${top.cy}" x2="${left.cx}" y2="${left.cy}">`,
    `  <stop offset="0%" stop-color="${top.edgeTint}" stop-opacity="0.92"/>`,
    `  <stop offset="100%" stop-color="${left.edgeTint}" stop-opacity="0.92"/>`,
    '</linearGradient>',
    `<linearGradient id="${MARK_GEOMETRY.gradientIds.edgeTopRight}" gradientUnits="userSpaceOnUse" x1="${top.cx}" y1="${top.cy}" x2="${right.cx}" y2="${right.cy}">`,
    `  <stop offset="0%" stop-color="${top.edgeTint}" stop-opacity="0.92"/>`,
    `  <stop offset="100%" stop-color="${right.edgeTint}" stop-opacity="0.92"/>`,
    '</linearGradient>',
    `<linearGradient id="${MARK_GEOMETRY.gradientIds.edgeBottom}" gradientUnits="userSpaceOnUse" x1="${left.cx}" y1="${left.cy}" x2="${right.cx}" y2="${right.cy}">`,
    `  <stop offset="0%" stop-color="${left.edgeTint}" stop-opacity="0.92"/>`,
    `  <stop offset="100%" stop-color="${right.edgeTint}" stop-opacity="0.92"/>`,
    '</linearGradient>',
  ];
}

function getMarkGeometryLines(): readonly string[] {
  const pts = MARK_GEOMETRY.trianglePoints;
  const [top, left, right] = MARK_GEOMETRY.vertices;
  const vertexLines = MARK_GEOMETRY.vertices.flatMap((v, idx) => {
    const lines = [
      `<circle cx="${v.cx}" cy="${v.cy}" r="${MARK_GEOMETRY.collarRadius}" fill="${v.ringFill}"/>`,
      `<circle cx="${v.cx}" cy="${v.cy}" r="${MARK_GEOMETRY.dotRadius}" fill="${v.fill}"/>`,
    ];
    return idx < MARK_GEOMETRY.vertices.length - 1 ? [...lines, ''] : lines;
  });

  return [
    `<polygon points="${pts}" fill="${MARK_GEOMETRY.baseWashFill}" fill-opacity="${MARK_GEOMETRY.baseWashOpacity}"/>`,
    `<polygon points="${pts}" fill="url(#${MARK_GEOMETRY.gradientIds.cyan})"/>`,
    `<polygon points="${pts}" fill="url(#${MARK_GEOMETRY.gradientIds.amber})"/>`,
    `<polygon points="${pts}" fill="url(#${MARK_GEOMETRY.gradientIds.magenta})"/>`,
    `<line x1="${top.cx}" y1="${top.cy}" x2="${left.cx}" y2="${left.cy}" stroke="url(#${MARK_GEOMETRY.gradientIds.edgeTopLeft})" stroke-width="${MARK_GEOMETRY.triangleStrokeWidth}" stroke-linecap="round"/>`,
    `<line x1="${top.cx}" y1="${top.cy}" x2="${right.cx}" y2="${right.cy}" stroke="url(#${MARK_GEOMETRY.gradientIds.edgeTopRight})" stroke-width="${MARK_GEOMETRY.triangleStrokeWidth}" stroke-linecap="round"/>`,
    `<line x1="${left.cx}" y1="${left.cy}" x2="${right.cx}" y2="${right.cy}" stroke="url(#${MARK_GEOMETRY.gradientIds.edgeBottom})" stroke-width="${MARK_GEOMETRY.triangleStrokeWidth}" stroke-linecap="round"/>`,
    '',
    '<!-- 3 Topic Vertex Nodes -->',
    ...vertexLines,
  ];
}

function renderFaviconSvg(): string {
  const defs = indentLines(getMarkGradientLines(false), '    ');
  const body = indentLines(getMarkGeometryLines(), '  ');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_GEOMETRY.viewBox}" width="512" height="512">`,
    '  <defs>',
    defs,
    '  </defs>',
    '',
    body,
    '</svg>',
    '',
  ].join('\n');
}

function renderTileIconSvg(): string {
  const defs = indentLines(getMarkGradientLines(true), '    ');
  const body = indentLines(getMarkGeometryLines(), '    ');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_GEOMETRY.viewBox}" width="512" height="512">`,
    '  <defs>',
    defs,
    '  </defs>',
    `  <rect x="16" y="16" width="480" height="480" rx="116" fill="url(#${MARK_GEOMETRY.gradientIds.tile})" stroke="#24324A" stroke-width="14"/>`,
    '  <g transform="translate(46.08, 46.08) scale(0.82)">',
    body,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

function renderBannerLogoSvg(spec: BannerLogoSpec): string {
  const defs = indentLines(getMarkGradientLines(false), '    ');
  const body = indentLines(getMarkGeometryLines(), '    ');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.width} ${spec.height}" width="${spec.width}" height="${spec.height}">`,
    '  <defs>',
    defs,
    '  </defs>',
    '',
    '  <!-- Freestanding Maximized 60-degree Simplex Mark -->',
    '  <g transform="translate(16, 16) scale(0.25)">',
    body,
    '  </g>',
    '',
    `  <!-- ${spec.wordmarkComment} -->`,
    '  <text x="166" y="76" font-family="Noto Sans, sans-serif" font-size="44" font-weight="700" letter-spacing="-0.8">',
    `    ${spec.titleXml}`,
    '  </text>',
    '',
    '  <!-- Subtitle -->',
    `  <text x="168" y="114" font-family="JetBrains Mono, monospace" font-size="${spec.subtitleFontSize}" font-weight="600" letter-spacing="${spec.subtitleLetterSpacing}" fill="${BRAND_COLORS.neutral.slate}">`,
    `    ${spec.subtitle}`,
    '  </text>',
    '</svg>',
    '',
  ].join('\n');
}

function renderSimplexLogoMarkTsx(): string {
  const pts = MARK_GEOMETRY.trianglePoints;
  const [top, left, right] = MARK_GEOMETRY.vertices;
  const vertexNodes = MARK_GEOMETRY.vertices
    .map(
      (v) =>
        `      <circle cx={${v.cx}} cy={${v.cy}} r={${MARK_GEOMETRY.collarRadius}} fill="${v.ringFill}" />\n` +
        `      <circle cx={${v.cx}} cy={${v.cy}} r={${MARK_GEOMETRY.dotRadius}} fill="${v.fill}" />`,
    )
    .join('\n\n');

  return `// GENERATED FILE — DO NOT EDIT MANUALLY. Run \`npm run sync:brand\` instead.
import { useId } from 'react';

interface SimplexLogoMarkProps {
  readonly className?: string;
}

export function SimplexLogoMark({ className = 'h-7 w-7 shrink-0' }: SimplexLogoMarkProps) {
  const uid = useId().replace(/:/g, '');
  const fillCyanId = \`\${uid}-cyan\`;
  const fillAmberId = \`\${uid}-amber\`;
  const fillMagentaId = \`\${uid}-magenta\`;
  const edgeTopLeftId = \`\${uid}-edge-tl\`;
  const edgeTopRightId = \`\${uid}-edge-tr\`;
  const edgeBottomId = \`\${uid}-edge-bm\`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="${MARK_GEOMETRY.viewBox}"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <radialGradient id={fillCyanId} cx="50%" cy="22%" r="72%">
          <stop offset="0%" stopColor="${top.fill}" stopOpacity={0.44} />
          <stop offset="100%" stopColor="${top.fill}" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={fillAmberId} cx="20%" cy="78%" r="70%">
          <stop offset="0%" stopColor="${left.fill}" stopOpacity={0.42} />
          <stop offset="100%" stopColor="${left.fill}" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={fillMagentaId} cx="80%" cy="78%" r="70%">
          <stop offset="0%" stopColor="${right.fill}" stopOpacity={0.42} />
          <stop offset="100%" stopColor="${right.fill}" stopOpacity={0} />
        </radialGradient>
        <linearGradient
          id={edgeTopLeftId}
          gradientUnits="userSpaceOnUse"
          x1={${top.cx}}
          y1={${top.cy}}
          x2={${left.cx}}
          y2={${left.cy}}
        >
          <stop offset="0%" stopColor="${top.edgeTint}" stopOpacity={0.92} />
          <stop offset="100%" stopColor="${left.edgeTint}" stopOpacity={0.92} />
        </linearGradient>
        <linearGradient
          id={edgeTopRightId}
          gradientUnits="userSpaceOnUse"
          x1={${top.cx}}
          y1={${top.cy}}
          x2={${right.cx}}
          y2={${right.cy}}
        >
          <stop offset="0%" stopColor="${top.edgeTint}" stopOpacity={0.92} />
          <stop offset="100%" stopColor="${right.edgeTint}" stopOpacity={0.92} />
        </linearGradient>
        <linearGradient
          id={edgeBottomId}
          gradientUnits="userSpaceOnUse"
          x1={${left.cx}}
          y1={${left.cy}}
          x2={${right.cx}}
          y2={${right.cy}}
        >
          <stop offset="0%" stopColor="${left.edgeTint}" stopOpacity={0.92} />
          <stop offset="100%" stopColor="${right.edgeTint}" stopOpacity={0.92} />
        </linearGradient>
      </defs>

      {/* Single maximized equilateral 60° simplex with subtle vertex color wash */}
      <polygon points="${pts}" fill="${MARK_GEOMETRY.baseWashFill}" fillOpacity={${MARK_GEOMETRY.baseWashOpacity}} />
      <polygon points="${pts}" fill={\`url(#\${fillCyanId})\`} />
      <polygon points="${pts}" fill={\`url(#\${fillAmberId})\`} />
      <polygon points="${pts}" fill={\`url(#\${fillMagentaId})\`} />

      {/* Brightened gradient edges matching each adjacent vertex pair */}
      <line
        x1={${top.cx}}
        y1={${top.cy}}
        x2={${left.cx}}
        y2={${left.cy}}
        stroke={\`url(#\${edgeTopLeftId})\`}
        strokeWidth={${MARK_GEOMETRY.triangleStrokeWidth}}
        strokeLinecap="round"
      />
      <line
        x1={${top.cx}}
        y1={${top.cy}}
        x2={${right.cx}}
        y2={${right.cy}}
        stroke={\`url(#\${edgeTopRightId})\`}
        strokeWidth={${MARK_GEOMETRY.triangleStrokeWidth}}
        strokeLinecap="round"
      />
      <line
        x1={${left.cx}}
        y1={${left.cy}}
        x2={${right.cx}}
        y2={${right.cy}}
        stroke={\`url(#\${edgeBottomId})\`}
        strokeWidth={${MARK_GEOMETRY.triangleStrokeWidth}}
        strokeLinecap="round"
      />

      {/* 3 Corner Vertex Nodes with shaded hue-matched ring */}
${vertexNodes}
    </svg>
  );
}
`;
}

function replaceBetweenMarkers(
  source: string,
  startMarker: string,
  endMarker: string,
  replacementLines: readonly string[],
  filePath: string,
): string {
  const pattern = new RegExp(
    `([ \\t]*)${escapeRegExp(startMarker)}[\\s\\S]*?([ \\t]*)${escapeRegExp(endMarker)}`,
    'm',
  );
  const match = pattern.exec(source);
  if (!match) {
    throw new Error(`Missing marker block ${startMarker} ... ${endMarker} in ${filePath}`);
  }

  const indent = match[1] ?? '';
  const body = indentLines(replacementLines, indent);
  const replacement = `${indent}${startMarker}\n${body}\n${indent}${endMarker}`;
  return source.replace(pattern, replacement);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderPng(svgContent: string, targetWidth: number): Buffer {
  const resvg = new Resvg(svgContent, {
    fitTo: {
      mode: 'width',
      value: targetWidth,
    },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Noto Sans',
    },
  });
  return resvg.render().asPng();
}

const BANNER_LOGOS: readonly BannerLogoSpec[] = [
  {
    svgPath: 'docs/assets/logo-simplex-viz.svg',
    pngPath: 'docs/assets/logo-simplex-viz.png',
    width: 508,
    height: 160,
    pngWidth: 1016,
    wordmarkComment: 'Dual-Contrast Wordmark synced to top vertex Cyan',
    titleXml: `<tspan fill="${BRAND_COLORS.neutral.wordmark}">Simplex</tspan><tspan fill="${BRAND_COLORS.cyan.core}">Viz</tspan>`,
    subtitle: '60° TRIANGULATION CONTENT ATLAS',
    subtitleFontSize: 13.5,
    subtitleLetterSpacing: 1.0,
  },
  {
    svgPath: 'docs/assets/logo-core.svg',
    pngPath: 'docs/assets/logo-core.png',
    width: 580,
    height: 160,
    pngWidth: 1160,
    wordmarkComment: 'Wordmark synced to top vertex Cyan',
    titleXml: `<tspan fill="${BRAND_COLORS.neutral.wordmark}">SimplexViz</tspan><tspan fill="${BRAND_COLORS.neutral.slate}" font-weight="400"> / </tspan><tspan fill="${BRAND_COLORS.cyan.core}" font-family="JetBrains Mono, monospace" font-size="38" font-weight="700">core</tspan>`,
    subtitle: 'HEADLESS MESH · CLUSTERING · SAT SOLVER',
    subtitleFontSize: 13,
    subtitleLetterSpacing: 0.9,
  },
  {
    svgPath: 'docs/assets/logo-svg.svg',
    pngPath: 'docs/assets/logo-svg.png',
    width: 580,
    height: 160,
    pngWidth: 1160,
    wordmarkComment: 'Wordmark synced to bottom-left vertex Amber',
    titleXml: `<tspan fill="${BRAND_COLORS.neutral.wordmark}">SimplexViz</tspan><tspan fill="${BRAND_COLORS.neutral.slate}" font-weight="400"> / </tspan><tspan fill="${BRAND_COLORS.amber.core}" font-family="JetBrains Mono, monospace" font-size="38" font-weight="700">svg</tspan>`,
    subtitle: 'FRAMEWORK-AGNOSTIC SVG SCENE GRAPH',
    subtitleFontSize: 13,
    subtitleLetterSpacing: 0.9,
  },
  {
    svgPath: 'docs/assets/logo-react.svg',
    pngPath: 'docs/assets/logo-react.png',
    width: 580,
    height: 160,
    pngWidth: 1160,
    wordmarkComment: 'Wordmark synced to bottom-right vertex Magenta',
    titleXml: `<tspan fill="${BRAND_COLORS.neutral.wordmark}">SimplexViz</tspan><tspan fill="${BRAND_COLORS.neutral.slate}" font-weight="400"> / </tspan><tspan fill="${BRAND_COLORS.magenta.core}" font-family="JetBrains Mono, monospace" font-size="38" font-weight="700">react</tspan>`,
    subtitle: 'TYPE-SAFE REACT BINDINGS &amp; JSX RENDERERS',
    subtitleFontSize: 13,
    subtitleLetterSpacing: 0.9,
  },
];

const SCENE_SVGS: readonly SceneSvgTarget[] = [
  {
    svgPath: 'docs/assets/preview-demo.svg',
    pngOutputs: [{ pngPath: 'docs/assets/preview-demo.png', width: 1600 }],
  },
  {
    svgPath: 'docs/assets/og-demo-preview.svg',
    pngOutputs: [
      { pngPath: 'docs/assets/og-demo-preview.png', width: 1200 },
      { pngPath: 'public/og-preview.png', width: 1200 },
    ],
  },
  {
    svgPath: 'docs/assets/social-preview-github.svg',
    pngOutputs: [{ pngPath: 'docs/assets/social-preview-github.png', width: 1280 }],
  },
];

const STATIC_PREVIEWS: readonly StaticPreviewSpec[] = [
  {
    svgPath: 'docs/assets/preview-core.svg',
    pngPath: 'docs/assets/preview-core.png',
    width: 1600,
  },
  {
    svgPath: 'docs/assets/preview-svg.svg',
    pngPath: 'docs/assets/preview-svg.png',
    width: 1600,
  },
  {
    svgPath: 'docs/assets/preview-react.svg',
    pngPath: 'docs/assets/preview-react.png',
    width: 1600,
  },
];

async function readOptionalBinary(absPath: string): Promise<Buffer | null> {
  try {
    return await readFile(absPath);
  } catch {
    return null;
  }
}

async function readOptionalText(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, 'utf8');
  } catch {
    return null;
  }
}

async function syncBinaryOutput(
  relPath: string,
  expected: Buffer,
  checkOnly: boolean,
  diffs: FileDiff[],
): Promise<boolean> {
  const absPath = path.join(ROOT_DIR, relPath);
  const current = await readOptionalBinary(absPath);

  if (current !== null && current.equals(expected)) {
    return false;
  }

  if (checkOnly) {
    diffs.push({ filePath: relPath, reason: current === null ? 'missing' : 'outdated' });
    return false;
  }

  await writeFile(absPath, expected);
  return true;
}

async function syncTextOutput(
  relPath: string,
  expected: string,
  checkOnly: boolean,
  diffs: FileDiff[],
): Promise<boolean> {
  const absPath = path.join(ROOT_DIR, relPath);
  const current = await readOptionalText(absPath);

  if (current === expected) {
    return false;
  }

  if (checkOnly) {
    diffs.push({ filePath: relPath, reason: current === null ? 'missing' : 'outdated' });
    return false;
  }

  await writeFile(absPath, expected, 'utf8');
  return true;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const diffs: FileDiff[] = [];
  let updatedCount = 0;

  const markDefsLines = getMarkGradientLines(false);
  const markNodeLines = getMarkGeometryLines();

  // 1. Standalone freestanding mark assets
  const faviconSvg = renderFaviconSvg();
  if (await syncTextOutput('public/favicon.svg', faviconSvg, checkOnly, diffs)) {
    updatedCount += 1;
  }

  // 2. React inline logo mark component
  const logoMarkTsx = renderSimplexLogoMarkTsx();
  if (
    await syncTextOutput('src/demo/components/SimplexLogoMark.tsx', logoMarkTsx, checkOnly, diffs)
  ) {
    updatedCount += 1;
  }

  // 3. Tile-boxed app icon SVG + raster PNGs (icon-512, icon-192, apple-touch-icon)
  const tileIconSvg = renderTileIconSvg();
  if (await syncTextOutput('docs/assets/icon.svg', tileIconSvg, checkOnly, diffs)) {
    updatedCount += 1;
  }
  const tilePngSpecs: ReadonlyArray<{ readonly pngPath: string; readonly width: number }> = [
    { pngPath: 'docs/assets/icon-512.png', width: 512 },
    { pngPath: 'public/icon-192.png', width: 192 },
    { pngPath: 'public/apple-touch-icon.png', width: 180 },
  ];
  for (const spec of tilePngSpecs) {
    const pngBuffer = renderPng(tileIconSvg, spec.width);
    if (await syncBinaryOutput(spec.pngPath, pngBuffer, checkOnly, diffs)) {
      updatedCount += 1;
    }
  }

  // 4. Project & package banner logos (SVG + PNG)
  for (const spec of BANNER_LOGOS) {
    const bannerSvg = renderBannerLogoSvg(spec);
    if (await syncTextOutput(spec.svgPath, bannerSvg, checkOnly, diffs)) {
      updatedCount += 1;
    }
    const pngBuffer = renderPng(bannerSvg, spec.pngWidth);
    if (await syncBinaryOutput(spec.pngPath, pngBuffer, checkOnly, diffs)) {
      updatedCount += 1;
    }
  }

  // 5. Composite scene SVGs (preview-demo, og-demo-preview, social-preview-github)
  for (const target of SCENE_SVGS) {
    const absPath = path.join(ROOT_DIR, target.svgPath);
    const originalSvg = await readFile(absPath, 'utf8');
    const withDefs = replaceBetweenMarkers(
      originalSvg,
      DEFS_START_MARKER,
      DEFS_END_MARKER,
      markDefsLines,
      target.svgPath,
    );
    const syncedSvg = replaceBetweenMarkers(
      withDefs,
      NODE_START_MARKER,
      NODE_END_MARKER,
      markNodeLines,
      target.svgPath,
    );

    if (await syncTextOutput(target.svgPath, syncedSvg, checkOnly, diffs)) {
      updatedCount += 1;
    }

    for (const pngSpec of target.pngOutputs) {
      const pngBuffer = renderPng(syncedSvg, pngSpec.width);
      if (await syncBinaryOutput(pngSpec.pngPath, pngBuffer, checkOnly, diffs)) {
        updatedCount += 1;
      }
    }
  }

  // 6. Static package preview SVGs -> PNGs (preview-core, preview-svg, preview-react)
  for (const preview of STATIC_PREVIEWS) {
    const svgContent = await readFile(path.join(ROOT_DIR, preview.svgPath), 'utf8');
    const pngBuffer = renderPng(svgContent, preview.width);
    if (await syncBinaryOutput(preview.pngPath, pngBuffer, checkOnly, diffs)) {
      updatedCount += 1;
    }
  }

  if (checkOnly) {
    if (diffs.length > 0) {
      console.error('Brand assets are out of sync with scripts/sync-brand.ts:');
      for (const diff of diffs) {
        console.error(`  - ${diff.filePath} (${diff.reason})`);
      }
      console.error('Run `npm run sync:brand` to regenerate all brand assets.');
      process.exitCode = 1;
      return;
    }
    console.log('Brand asset check passed: all SVGs, PNGs, and components are in sync.');
    return;
  }

  console.log(`Brand sync complete (${updatedCount} file(s) updated).`);
}

await main();
