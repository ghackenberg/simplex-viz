// @vitest-environment node
import { Resvg } from '@resvg/resvg-js';
import { solveSimplexSnapshot, type DefaultTaggedItem } from '@simplex-viz/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createSsrPresetHullMeasurers,
  estimateSsrTextWidth,
  renderSimplexSvgString,
} from '../src/ssr';

const SAMPLE_ITEMS: readonly DefaultTaggedItem[] = [
  { id: 'doc-1', label: 'Simplex Geometry & Hulls', tags: ['geometry', 'math', 'sat'] },
  { id: 'doc-2', label: 'OKLab Perceptual Blending', tags: ['color', 'oklab', 'math'] },
  { id: 'doc-3', label: 'Delaunay Hexagonal Mesh', tags: ['geometry', 'mesh', 'layout'] },
  { id: 'doc-4', label: 'Collision-Free PBD Solver', tags: ['layout', 'sat', 'physics'] },
  { id: 'doc-5', label: 'WCAG Contrast Surfaces', tags: ['color', 'accessibility', 'oklab'] },
  { id: 'doc-6', label: 'Zero-DOM SSR Rendering', tags: ['svg', 'ssr', 'layout'] },
  { id: 'doc-7', label: 'Subspace Semantic Zoom', tags: ['geometry', 'svg', 'mesh'] },
  { id: 'doc-8', label: 'Timeline Final Seeding', tags: ['layout', 'svg', 'physics'] },
];

describe('@simplex-viz/svg/ssr headless renderer (Issue #18)', () => {
  it('executes in pure Node.js without any DOM globals and renders all 3 built-in presets', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');

    // 1. Default 'geometric' dark preset
    const geomSvg = renderSimplexSvgString(SAMPLE_ITEMS, {
      width: 800,
      height: 520,
      layoutOptions: { seed: 42 },
    });
    expect(geomSvg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(geomSvg).toContain('viewBox="0 0 800 520"');
    expect(geomSvg).toContain('width="800"');
    expect(geomSvg).toContain('height="520"');
    expect(geomSvg).toContain('data-preset="geometric"');
    expect(geomSvg).toContain('data-theme="dark"');
    expect(geomSvg).toContain('class="sv-export-background"');
    expect(geomSvg).toContain('fill="#07090e"');
    expect(geomSvg).toContain('<style>');
    expect(geomSvg.match(/class="sv-node sv-node-item"/g)?.length).toBe(SAMPLE_ITEMS.length);
    expect(geomSvg).toContain('class="sv-geom-shape"');

    // 2. 'glyphs' light preset with padding, title, ariaLabel, and xmlDeclaration
    const glyphsSvg = renderSimplexSvgString(SAMPLE_ITEMS, {
      preset: 'glyphs',
      theme: 'light',
      width: 720,
      height: 480,
      padding: 16,
      title: 'Topic Map <2026> & "Preview"',
      ariaLabel: 'Static topic map',
      xmlDeclaration: true,
      layoutOptions: { seed: 42 },
    });
    expect(glyphsSvg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(glyphsSvg).toContain('<title>Topic Map &lt;2026&gt; &amp; &quot;Preview&quot;</title>');
    expect(glyphsSvg).toContain('role="img" aria-label="Static topic map"');
    expect(glyphsSvg).toContain('viewBox="-16 -16 752 512"');
    expect(glyphsSvg).toContain('fill="#ffffff"');
    expect(glyphsSvg).toContain('data-preset="glyphs"');
    expect(glyphsSvg).toContain('data-theme="light"');

    // 3. 'badges' preset with badgeOptions & pluggable measureText callback (no getBBox!)
    const measureSpy = vi.fn((input) => estimateSsrTextWidth(input) * 1.05);
    const badgesSvg = renderSimplexSvgString(SAMPLE_ITEMS, {
      preset: 'badges',
      theme: 'dark',
      width: 960,
      height: 600,
      badgeOptions: {
        showCode: false,
        maxTitleChars: 14,
      },
      measureText: measureSpy,
      layoutOptions: { seed: 42 },
    });
    expect(measureSpy).toHaveBeenCalled();
    expect(badgesSvg).toContain('data-preset="badges"');
    expect(badgesSvg).toContain('<rect ');
    expect(badgesSvg).toContain('text-anchor="middle"');
  });

  it('produces zero-overlap badge layouts using deterministic SSR font metrics and supports pre-solved snapshots', () => {
    const measurers = createSsrPresetHullMeasurers({
      preset: 'badges',
      badgeOptions: { maxTitleChars: 18 },
    });
    const snapshot = solveSimplexSnapshot(SAMPLE_ITEMS, {
      width: 960,
      height: 600,
      theme: 'light',
      layoutOptions: { seed: 19 },
      ...measurers,
    });
    expect(snapshot.metrics.overlapCount).toBe(0);
    expect(snapshot.clusters.length).toBeGreaterThanOrEqual(3);

    // Render from pre-solved snapshot with widescreen aspect adjustment, highlights, filtering, and hull overlay
    const svg = renderSimplexSvgString(snapshot, {
      preset: 'badges',
      theme: 'light',
      width: 1200,
      height: 630,
      includeBackground: true,
      backgroundColor: '#f8fafc',
      highlightedIds: ['doc-1', 'doc-3'],
      itemFilter: (it) => it.id !== 'doc-8',
      itemFilterMode: 'hide',
      getShape: 'hexagon',
      shapeOptions: { strokeColor: '#0f172a', strokeWidth: 2, dimmedOpacity: 0.25 },
      showHulls: true,
    });

    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain('fill="#f8fafc"');
    expect(svg).toContain('class="sv-geom-ring"');
    expect(svg).toContain('opacity="0.250"');
    expect(svg).toContain('stroke="#0f172a"');
    expect(svg).toContain('class="sv-hull-overlay"');
    // Filtered-out doc-8 is omitted in 'hide' mode
    expect(svg).not.toContain('data-node-id="doc-8"');
    expect(svg).toContain('data-node-id="doc-1"');
  });

  it('supports custom SVG string hooks (renderTriangle, renderEdge, renderCluster, renderContent) and transparent output', () => {
    const svg = renderSimplexSvgString(SAMPLE_ITEMS, {
      width: 640,
      height: 400,
      includeBackground: false,
      includeEmbeddedStyles: false,
      renderTriangle: ({ defaultMarkup }) => `${defaultMarkup}<g class="custom-tri-hook"/>`,
      renderEdge: ({ defaultMarkup }) => `${defaultMarkup}<g class="custom-edge-hook"/>`,
      renderCluster: ({ node, defaultMarkup }) =>
        `${defaultMarkup}<circle class="custom-cluster-hook" data-code="${node.cluster.code}" r="2"/>`,
      renderContent: ({ node, defaultMarkup }) =>
        `${defaultMarkup}<circle class="custom-item-hook" data-id="${node.id}" r="1"/>`,
    });

    expect(svg).not.toContain('sv-export-background');
    expect(svg).not.toContain('<style>');
    expect(svg).toContain('class="custom-tri-hook"');
    expect(svg).toContain('class="custom-edge-hook"');
    expect(svg).toContain('class="custom-cluster-hook"');
    expect(svg).toContain('class="custom-item-hook"');
  });

  it('estimates proportional, monospace, bold, and fullwidth text widths deterministically', () => {
    const narrow = estimateSsrTextWidth({
      text: 'iiiiii',
      fontSize: 12,
      fontFamily: 'Plus Jakarta Sans, sans-serif',
    });
    const wide = estimateSsrTextWidth({
      text: 'WWWWWW',
      fontSize: 12,
      fontFamily: 'Plus Jakarta Sans, sans-serif',
    });
    const monoNarrow = estimateSsrTextWidth({
      text: 'iiiiii',
      fontSize: 12,
      fontFamily: 'IBM Plex Mono, monospace',
    });
    const monoWide = estimateSsrTextWidth({
      text: 'WWWWWW',
      fontSize: 12,
      fontFamily: 'IBM Plex Mono, monospace',
    });
    const cjk = estimateSsrTextWidth({
      text: '日本語',
      fontSize: 12,
      fontFamily: 'Plus Jakarta Sans, sans-serif',
    });

    expect(wide).toBeGreaterThan(narrow * 1.8);
    expect(monoWide).toBeCloseTo(monoNarrow, 5);
    expect(cjk).toBeGreaterThan(30);
    expect(
      estimateSsrTextWidth({ text: '', fontSize: 12, fontFamily: 'sans-serif' }),
    ).toBe(0);
  });

  it('rasterizes headless SSR SVG output directly to PNG via @resvg/resvg-js without Puppeteer', () => {
    const svg = renderSimplexSvgString(SAMPLE_ITEMS, {
      preset: 'badges',
      theme: 'dark',
      width: 600,
      height: 360,
      layoutOptions: { seed: 77 },
    });

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 1200 },
    });
    const rendered = resvg.render();
    const pngBuffer = rendered.asPng();

    expect(rendered.width).toBe(1200);
    expect(rendered.height).toBe(720);
    expect(pngBuffer.byteLength).toBeGreaterThan(2000);
    // Standard PNG 8-byte magic header: 89 50 4E 47 0D 0A 1A 0A
    expect(pngBuffer[0]).toBe(0x89);
    expect(pngBuffer[1]).toBe(0x50);
    expect(pngBuffer[2]).toBe(0x4e);
    expect(pngBuffer[3]).toBe(0x47);
  });
});
