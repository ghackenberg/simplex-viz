import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import decompress from 'woff2-encoder/decompress';

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
  readonly reason: 'missing' | 'outdated' | 'orphaned';
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
    '  <text x="166" y="76" font-family="Plus Jakarta Sans, Noto Sans, Noto Sans Symbols, sans-serif" font-size="44" font-weight="700" letter-spacing="-0.8">',
    `    ${spec.titleXml}`,
    '  </text>',
    '',
    '  <!-- Subtitle -->',
    `  <text x="168" y="114" font-family="IBM Plex Mono, Noto Sans, Noto Sans Symbols, monospace" font-size="${spec.subtitleFontSize}" font-weight="600" letter-spacing="${spec.subtitleLetterSpacing}" fill="${BRAND_COLORS.neutral.slate}">`,
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

const require = createRequire(import.meta.url);

const FONT_PACKAGE_SPECIFIERS: readonly string[] = [
  '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2',
  '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2',
  '@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2',
  '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
  '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2',
  '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2',
  '@fontsource/noto-sans/files/noto-sans-greek-400-normal.woff2',
  '@fontsource/noto-sans/files/noto-sans-greek-600-normal.woff2',
  '@fontsource/noto-sans/files/noto-sans-greek-700-normal.woff2',
  '@fontsource/noto-sans-symbols/files/noto-sans-symbols-symbols-400-normal.woff2',
  '@fontsource/noto-sans-symbols/files/noto-sans-symbols-symbols-600-normal.woff2',
  '@fontsource/noto-sans-symbols/files/noto-sans-symbols-symbols-700-normal.woff2',
];

async function prepareFontFiles(): Promise<{
  readonly tempDir: string;
  readonly fontFiles: readonly string[];
}> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'simplex-viz-fonts-'));
  const fontFiles: string[] = [];

  for (const specifier of FONT_PACKAGE_SPECIFIERS) {
    const woff2Path = require.resolve(specifier);
    const woff2Buffer = await readFile(woff2Path);
    const ttfData = await decompress(woff2Buffer);
    const ttfPath = path.join(tempDir, `${path.basename(woff2Path, '.woff2')}.ttf`);
    await writeFile(ttfPath, ttfData);
    fontFiles.push(ttfPath);
  }

  return { tempDir, fontFiles };
}

function renderPng(
  svgContent: string,
  targetWidth: number,
  fontFiles: readonly string[],
): Buffer {
  const resvg = new Resvg(svgContent, {
    fitTo: {
      mode: 'width',
      value: targetWidth,
    },
    font: {
      loadSystemFonts: false,
      fontFiles: [...fontFiles],
      defaultFontFamily: 'Plus Jakarta Sans',
      sansSerifFamily: 'Plus Jakarta Sans',
      monospaceFamily: 'IBM Plex Mono',
    },
  });
  return resvg.render().asPng();
}

type NoteCategory = 'Release' | 'Geometry' | 'Architecture';

interface BundleMeta {
  readonly slug: string;
  readonly section: 'notes' | 'examples';
  readonly badgeLabel: string;
  readonly stageCardHeader: string;
  readonly stageCardFooterTitle: string;
  readonly stageCardFooterUrl: string;
  readonly title: string;
  readonly description: string;
  readonly footerLeft: string;
  readonly footerMiddle: string;
  readonly theme: CategoryVisualTheme;
}

interface CategoryVisualTheme {
  readonly label: string;
  readonly accent: string;
  readonly bright: string;
  readonly ring: string;
}

const CATEGORY_THEMES: Readonly<Record<NoteCategory, CategoryVisualTheme>> = {
  Release: {
    label: 'RELEASE NOTE',
    accent: BRAND_COLORS.cyan.core,
    bright: BRAND_COLORS.cyan.brightEdge,
    ring: BRAND_COLORS.cyan.ring,
  },
  Geometry: {
    label: 'GEOMETRY',
    accent: BRAND_COLORS.amber.core,
    bright: BRAND_COLORS.amber.brightEdge,
    ring: BRAND_COLORS.amber.ring,
  },
  Architecture: {
    label: 'ARCHITECTURE',
    accent: BRAND_COLORS.magenta.core,
    bright: BRAND_COLORS.magenta.brightEdge,
    ring: BRAND_COLORS.magenta.ring,
  },
};

function getExampleTheme(fields: ReadonlyMap<string, string>): CategoryVisualTheme {
  const requiresTags = fields.get('requiresTags') === 'true';
  const colorStrategy = fields.get('colorStrategy') ?? '';
  if (requiresTags) {
    return {
      label: (fields.get('domainLabel') ?? 'INTERACTIVE EXAMPLE').toUpperCase(),
      accent: BRAND_COLORS.cyan.core,
      bright: BRAND_COLORS.cyan.brightEdge,
      ring: BRAND_COLORS.cyan.ring,
    };
  }
  if (colorStrategy === 'oklab-edge-contrast' || colorStrategy === 'custom-brand-palette') {
    return {
      label: (fields.get('domainLabel') ?? 'INTERACTIVE EXAMPLE').toUpperCase(),
      accent: BRAND_COLORS.amber.core,
      bright: BRAND_COLORS.amber.brightEdge,
      ring: BRAND_COLORS.amber.ring,
    };
  }
  return {
    label: (fields.get('domainLabel') ?? 'INTERACTIVE EXAMPLE').toUpperCase(),
    accent: BRAND_COLORS.magenta.core,
    bright: BRAND_COLORS.magenta.brightEdge,
    ring: BRAND_COLORS.magenta.ring,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripYamlQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return trimmed;
}

function normalizeNoteCategory(raw: string): NoteCategory {
  if (raw === 'Release' || raw === 'Geometry' || raw === 'Architecture') {
    return raw;
  }
  return 'Architecture';
}

function parseYamlFields(label: string, mdxSource: string): Map<string, string> {
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(mdxSource);
  if (!fmMatch) {
    throw new Error(`Missing YAML frontmatter in ${label}`);
  }

  const fields = new Map<string, string>();
  const lines = (fmMatch[1] ?? '').split(/\r?\n/);
  for (const line of lines) {
    const kvMatch = /^([A-Za-z][A-Za-z0-9_]*):\s*(.+)$/.exec(line);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawValue = kvMatch[2];
      if (key && rawValue !== undefined && !rawValue.startsWith('[')) {
        fields.set(key, stripYamlQuotes(rawValue));
      }
    }
  }
  return fields;
}

function parseNoteFrontmatter(slug: string, mdxSource: string): BundleMeta {
  const fields = parseYamlFields(`note "${slug}"`, mdxSource);
  const category = normalizeNoteCategory(fields.get('category') ?? 'Architecture');
  const theme = CATEGORY_THEMES[category];
  return {
    slug,
    section: 'notes',
    badgeLabel: theme.label,
    stageCardHeader: `${category.toUpperCase()} · PREVIEW`,
    stageCardFooterTitle: 'SIMPLEXVIZ ENGINEERING NOTES',
    stageCardFooterUrl: 'hackenberg.tech/simplex-viz/notes',
    title: fields.get('title') ?? slug,
    description: fields.get('description') ?? '',
    footerLeft: fields.get('publishedDate') ?? '2026-11-18',
    footerMiddle: fields.get('author') ?? 'Dr. Georg Hackenberg',
    theme,
  };
}

function parseExampleFrontmatter(slug: string, mdxSource: string): BundleMeta {
  const fields = parseYamlFields(`example "${slug}"`, mdxSource);
  const theme = getExampleTheme(fields);
  const requiresTags = fields.get('requiresTags') === 'true';
  return {
    slug,
    section: 'examples',
    badgeLabel: theme.label,
    stageCardHeader: `${requiresTags ? 'TAGGED' : 'VECTOR / KERNEL'} · PREVIEW`,
    stageCardFooterTitle: 'SIMPLEXVIZ INTERACTIVE EXAMPLES',
    stageCardFooterUrl: 'hackenberg.tech/simplex-viz/examples',
    title: fields.get('title') ?? slug,
    description: fields.get('description') ?? '',
    footerLeft: fields.get('representationLabel') ?? '60° Simplex Atlas',
    footerMiddle: requiresTags ? 'Tagged Dataset' : 'Tag-Free Vectors',
    theme,
  };
}

function wrapTextLines(
  text: string,
  maxCharsPerLine: number,
  maxLines: number,
): readonly string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    const candidate = current.length === 0 ? word : `${current} ${word}`;

    if (candidate.length <= maxCharsPerLine || current.length === 0) {
      current = candidate;
    } else {
      if (lines.length + 1 >= maxLines) {
        const clipped =
          current.length > maxCharsPerLine - 1
            ? `${current.slice(0, maxCharsPerLine - 2).trimEnd()}…`
            : `${current}…`;
        lines.push(clipped);
        return lines;
      }
      lines.push(current);
      current = word;
    }
  }

  if (current.length > 0) {
    if (lines.length >= maxLines) {
      const prev = lines[lines.length - 1] ?? '';
      lines[lines.length - 1] = prev.endsWith('…') ? prev : `${prev}…`;
    } else {
      lines.push(current);
    }
  }

  return lines;
}

function extractSvgFragment(
  svgSource: string,
  sourceLabel: string,
): { readonly viewBox: string; readonly innerXml: string } {
  const stripped = svgSource.replace(/<\?xml[\s\S]*?\?>\s*/i, '').trim();
  const openMatch = /^<svg\b([^>]*)>/i.exec(stripped);
  const closeIdx = stripped.lastIndexOf('</svg>');
  if (!openMatch || closeIdx === -1) {
    throw new Error(
      `Invalid preview.svg in ${sourceLabel}: expected a root <svg>...</svg> element.`,
    );
  }

  const attrs = openMatch[1] ?? '';
  const vbMatch = /\bviewBox=(?:"([^"]+)"|'([^']+)')/i.exec(attrs);
  const viewBox = vbMatch?.[1] ?? vbMatch?.[2] ?? '0 0 800 450';
  const innerXml = stripped.slice(openMatch[0].length, closeIdx).trim();
  return { viewBox, innerXml };
}

function renderSocialPreviewSvg(
  meta: BundleMeta,
  contentRelDir: string,
  previewSvgSource: string,
): string {
  const theme = meta.theme;
  const markDefs = indentLines(getMarkGradientLines(false), '    ');
  const markNodes = indentLines(getMarkGeometryLines(), '        ');
  const fragment = extractSvgFragment(
    previewSvgSource,
    `${contentRelDir}/${meta.slug}/preview.svg`,
  );

  const titleLines = wrapTextLines(meta.title, 27, 4);
  const titleFontSize = titleLines.length >= 4 ? 31 : 33;
  const titleLineHeight = titleLines.length >= 4 ? 39 : 42;
  const titleStartY = 148;
  const titleTspans = titleLines
    .map(
      (line, index) =>
        `<text x="0" y="${titleStartY + index * titleLineHeight}" font-family="Plus Jakarta Sans, Noto Sans, Noto Sans Symbols, sans-serif" font-size="${titleFontSize}" font-weight="700" letter-spacing="-0.6" fill="#F8FAFC">${escapeXml(line)}</text>`,
    )
    .join('\n    ');

  const descLines = wrapTextLines(meta.description, 49, 4);
  const descStartY = titleStartY + (titleLines.length - 1) * titleLineHeight + 44;
  const descTspans = descLines
    .map(
      (line, index) =>
        `<text x="0" y="${descStartY + index * 26}" font-family="Plus Jakarta Sans, Noto Sans, Noto Sans Symbols, sans-serif" font-size="17" font-weight="400" fill="#94A3B8">${escapeXml(line)}</text>`,
    )
    .join('\n    ');

  const badgeWidth = Math.max(120, Math.round(meta.badgeLabel.length * 8.6 + 46));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bundleOgBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0B111E"/>
      <stop offset="60%" stop-color="#07090E"/>
      <stop offset="100%" stop-color="#05070C"/>
    </linearGradient>
    <radialGradient id="bundleOgGlow" cx="76%" cy="48%" r="52%">
      <stop offset="0%" stop-color="${theme.accent}" stop-opacity="0.20"/>
      <stop offset="55%" stop-color="${BRAND_COLORS.cyan.core}" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#07090E" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bundleStageGlow" cx="50%" cy="50%" r="58%">
      <stop offset="0%" stop-color="${theme.accent}" stop-opacity="0.16"/>
      <stop offset="60%" stop-color="${BRAND_COLORS.cyan.core}" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#090D16" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="bundleStageClip">
      <rect x="0" y="0" width="466" height="400" rx="16"/>
    </clipPath>
${markDefs}
  </defs>

  <rect width="1200" height="630" fill="url(#bundleOgBg)"/>
  <rect width="1200" height="630" fill="url(#bundleOgGlow)"/>

  <!-- Left Editorial Info Column -->
  <g transform="translate(56, 56)">
    <!-- Compact Brand Header -->
    <g transform="translate(0, 0)">
      <g transform="scale(0.088)">
${markNodes}
      </g>
      <text x="58" y="30" font-family="Plus Jakarta Sans, Noto Sans, sans-serif" font-size="24" font-weight="700" letter-spacing="-0.4">
        <tspan fill="#F8FAFC">Simplex</tspan><tspan fill="${BRAND_COLORS.cyan.core}">Viz</tspan><tspan fill="#64748B" font-weight="400"> / </tspan><tspan fill="#CBD5E1" font-family="IBM Plex Mono, Noto Sans, monospace" font-size="19" font-weight="600">${escapeXml(meta.section)}</tspan>
      </text>
    </g>

    <!-- Category / Domain Badge -->
    <rect x="0" y="70" width="${badgeWidth}" height="30" rx="6" fill="${theme.accent}" fill-opacity="0.14" stroke="${theme.accent}" stroke-opacity="0.65" stroke-width="1.2"/>
    <circle cx="16" cy="85" r="4.2" fill="${theme.accent}"/>
    <text x="30" y="89.5" font-family="IBM Plex Mono, Noto Sans, Noto Sans Symbols, monospace" font-size="12" font-weight="700" letter-spacing="0.8" fill="${theme.bright}">${escapeXml(meta.badgeLabel)}</text>

    <!-- Title -->
    ${titleTspans}

    <!-- Description -->
    ${descTspans}

    <!-- Footer Metadata -->
    <line x1="0" y1="472" x2="584" y2="472" stroke="#1E293B" stroke-width="1.2"/>
    <text x="0" y="502" font-family="IBM Plex Mono, Noto Sans, Noto Sans Symbols, monospace" font-size="13.5" fill="#94A3B8">
      <tspan fill="${theme.bright}" font-weight="600">${escapeXml(meta.footerLeft)}</tspan><tspan fill="#475569">  ·  </tspan><tspan fill="#CBD5E1">${escapeXml(meta.footerMiddle)}</tspan><tspan fill="#475569">  ·  </tspan><tspan fill="#64748B">hackenberg.tech</tspan>
    </text>
  </g>

  <!-- Right Geometric Preview Card (embeds colocated preview.svg 16:9) -->
  <g transform="translate(678, 115)">
    <rect x="0" y="0" width="466" height="400" rx="16" fill="#090D16" stroke="#1E293B" stroke-width="2"/>
    <g clip-path="url(#bundleStageClip)">
      <rect x="0" y="0" width="466" height="40" fill="#0B0F17"/>
      <line x1="0" y1="40" x2="466" y2="40" stroke="#1E293B" stroke-width="1.2"/>
      <circle cx="20" cy="20" r="4.5" fill="${theme.accent}"/>
      <text x="34" y="24" font-family="IBM Plex Mono, Noto Sans, monospace" font-size="11.5" font-weight="600" fill="#CBD5E1">${escapeXml(meta.stageCardHeader)}</text>
      <text x="448" y="24" text-anchor="end" font-family="IBM Plex Mono, Noto Sans, monospace" font-size="11" fill="#64748B">60° SIMPLEX</text>

      <rect x="0" y="40" width="466" height="262.125" fill="url(#bundleStageGlow)"/>
      <svg x="0" y="40" width="466" height="262.125" viewBox="${escapeXml(fragment.viewBox)}" preserveAspectRatio="xMidYMid meet">
        ${fragment.innerXml}
      </svg>

      <line x1="0" y1="302.125" x2="466" y2="302.125" stroke="#1E293B" stroke-width="1.2"/>
      <rect x="0" y="302.125" width="466" height="98" fill="#0B0F17"/>
      <text x="22" y="338" font-family="IBM Plex Mono, Noto Sans, monospace" font-size="11.5" font-weight="600" fill="#64748B">${escapeXml(meta.stageCardFooterTitle)}</text>
      <text x="22" y="366" font-family="IBM Plex Mono, Noto Sans, monospace" font-size="13" font-weight="600" fill="${theme.bright}">${escapeXml(meta.stageCardFooterUrl)}</text>
    </g>
  </g>
</svg>
`;
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
    titleXml: `<tspan fill="${BRAND_COLORS.neutral.wordmark}">SimplexViz</tspan><tspan fill="${BRAND_COLORS.neutral.slate}" font-weight="400"> / </tspan><tspan fill="${BRAND_COLORS.cyan.core}" font-family="IBM Plex Mono, Noto Sans, Noto Sans Symbols, monospace" font-size="38" font-weight="700">core</tspan>`,
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
    titleXml: `<tspan fill="${BRAND_COLORS.neutral.wordmark}">SimplexViz</tspan><tspan fill="${BRAND_COLORS.neutral.slate}" font-weight="400"> / </tspan><tspan fill="${BRAND_COLORS.amber.core}" font-family="IBM Plex Mono, Noto Sans, Noto Sans Symbols, monospace" font-size="38" font-weight="700">svg</tspan>`,
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
    titleXml: `<tspan fill="${BRAND_COLORS.neutral.wordmark}">SimplexViz</tspan><tspan fill="${BRAND_COLORS.neutral.slate}" font-weight="400"> / </tspan><tspan fill="${BRAND_COLORS.magenta.core}" font-family="IBM Plex Mono, Noto Sans, Noto Sans Symbols, monospace" font-size="38" font-weight="700">react</tspan>`,
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

async function readOptionalDir(absPath: string): Promise<readonly string[]> {
  try {
    return await readdir(absPath);
  } catch {
    return [];
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

  await mkdir(path.dirname(absPath), { recursive: true });
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
  let removedCount = 0;

  const markDefsLines = getMarkGradientLines(false);
  const markNodeLines = getMarkGeometryLines();
  const { tempDir, fontFiles } = await prepareFontFiles();

  try {
    // 1. Standalone freestanding mark assets (transparent SVG + 512px PNG)
    const faviconSvg = renderFaviconSvg();
    if (await syncTextOutput('public/favicon.svg', faviconSvg, checkOnly, diffs)) {
      updatedCount += 1;
    }
    const markPngBuffer = renderPng(faviconSvg, 512, fontFiles);
    if (await syncBinaryOutput('docs/assets/mark-512.png', markPngBuffer, checkOnly, diffs)) {
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
      const pngBuffer = renderPng(tileIconSvg, spec.width, fontFiles);
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
      const pngBuffer = renderPng(bannerSvg, spec.pngWidth, fontFiles);
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
        const pngBuffer = renderPng(syncedSvg, pngSpec.width, fontFiles);
        if (await syncBinaryOutput(pngSpec.pngPath, pngBuffer, checkOnly, diffs)) {
          updatedCount += 1;
        }
      }
    }

    // 6. Static package preview SVGs -> PNGs (preview-core, preview-svg, preview-react)
    for (const preview of STATIC_PREVIEWS) {
      const svgContent = await readFile(path.join(ROOT_DIR, preview.svgPath), 'utf8');
      const pngBuffer = renderPng(svgContent, preview.width, fontFiles);
      if (await syncBinaryOutput(preview.pngPath, pngBuffer, checkOnly, diffs)) {
        updatedCount += 1;
      }
    }

    // 7 & 8. Validate mandatory bundle directories (<slug>/index.mdx + <slug>/preview.svg),
    // generate 1200x630 Social OG PNGs, and prune orphaned assets for both notes and examples.
    const bundlePipelines: ReadonlyArray<{
      readonly label: string;
      readonly contentRelDir: string;
      readonly publicRelDir: string;
      readonly parseMeta: (slug: string, mdxSource: string) => BundleMeta;
    }> = [
      {
        label: 'note',
        contentRelDir: 'src/content/notes',
        publicRelDir: 'public/notes',
        parseMeta: parseNoteFrontmatter,
      },
      {
        label: 'example',
        contentRelDir: 'src/content/datasets',
        publicRelDir: 'public/examples',
        parseMeta: parseExampleFrontmatter,
      },
    ];

    for (const pipeline of bundlePipelines) {
      const contentDir = path.join(ROOT_DIR, pipeline.contentRelDir);
      const entries = (await readdir(contentDir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const expectedAssets = new Set<string>();

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          throw new Error(
            `Invalid entry "${pipeline.contentRelDir}/${entry.name}": every ${pipeline.label} must live in its own directory with index.mdx and preview.svg.`,
          );
        }

        const slug = entry.name;
        const mdxSource = await readOptionalText(path.join(contentDir, slug, 'index.mdx'));
        if (mdxSource === null) {
          throw new Error(
            `${pipeline.label === 'note' ? 'Note' : 'Example'} directory "${pipeline.contentRelDir}/${slug}" is missing mandatory index.mdx.`,
          );
        }

        const previewSvgSource = await readOptionalText(
          path.join(contentDir, slug, 'preview.svg'),
        );
        if (previewSvgSource === null || !previewSvgSource.includes('<svg')) {
          throw new Error(
            `${pipeline.label === 'note' ? 'Note' : 'Example'} directory "${pipeline.contentRelDir}/${slug}" is missing mandatory preview.svg.`,
          );
        }

        const meta = pipeline.parseMeta(slug, mdxSource);
        const ogFileName = `${slug}.png`;
        expectedAssets.add(ogFileName);
        const ogSvg = renderSocialPreviewSvg(meta, pipeline.contentRelDir, previewSvgSource);
        const ogPngBuffer = renderPng(ogSvg, 1200, fontFiles);
        if (
          await syncBinaryOutput(
            `${pipeline.publicRelDir}/${ogFileName}`,
            ogPngBuffer,
            checkOnly,
            diffs,
          )
        ) {
          updatedCount += 1;
        }
      }

      const publicOutDir = path.join(ROOT_DIR, pipeline.publicRelDir);
      const existingPublicFiles = (await readOptionalDir(publicOutDir)).slice().sort();
      for (const existingName of existingPublicFiles) {
        if (!expectedAssets.has(existingName)) {
          if (checkOnly) {
            diffs.push({
              filePath: `${pipeline.publicRelDir}/${existingName}`,
              reason: 'orphaned',
            });
          } else {
            await rm(path.join(publicOutDir, existingName), { recursive: true, force: true });
            removedCount += 1;
          }
        }
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
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

  console.log(
    `Brand sync complete (${updatedCount} file(s) updated, ${removedCount} orphaned file(s) removed).`,
  );
}

await main();
