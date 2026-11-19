// @vitest-environment happy-dom
import type { DefaultTaggedItem, VisualResolver } from '@simplex-viz/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BadgeClusterSvgView,
  ClusterTintedEdgeSvgView,
  GeometricShapeSvgView,
  GradientTriangleSvgView,
  SimplexSvgController,
  SvgRendererAdapter,
  createBarycentricZoomStrategy,
  createEmbeddingClusteringStrategy,
  createFixedLatticeMeshStrategy,
  createLocalAdaptiveLayoutStrategy,
  createPaletteColorStrategy,
  createSimplexSvg,
  createSubspaceZoomStrategy,
  createThemeAdaptiveOklabColorStrategy,
  getHexRelativeLuminance,
  resolveClusterSurfaceColors,
  resolveGeometricShapeSpec,
  truncateBadgeTitle,
  type BadgeClusterVisual,
  type GeometricShapeVisual,
} from '../src/index';

beforeEach(() => {
  // Deterministic getBBox() polyfill for happy-dom SVG measurement
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: function (this: SVGElement) {
      const rect = this.querySelector('rect');
      if (rect) {
        return {
          x: parseFloat(rect.getAttribute('x') ?? '-50'),
          y: parseFloat(rect.getAttribute('y') ?? '-20'),
          width: parseFloat(rect.getAttribute('width') ?? '100'),
          height: parseFloat(rect.getAttribute('height') ?? '40'),
        };
      }
      const poly = this.querySelector('polygon');
      if (poly) {
        let maxX = 20;
        let maxY = 10;
        for (const pair of (poly.getAttribute('points') ?? '').trim().split(/\s+/)) {
          const [px, py] = pair.split(',').map(Number);
          if (Number.isFinite(px)) maxX = Math.max(maxX, Math.abs(px!));
          if (Number.isFinite(py)) maxY = Math.max(maxY, Math.abs(py!));
        }
        return { x: -maxX, y: -maxY, width: maxX * 2, height: maxY * 2 };
      }
      return { x: -20, y: -20, width: 40, height: 40 };
    },
  });
});

describe('@simplex-viz/svg integration', () => {
  it('mounts keyed SVG groups, runs Dual-Layer Crossfade on visual changes, and removes exited nodes', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${i}`,
      tags: [`t-${i % 4}`, `t-${(i + 1) % 4}`],
    }));

    const makeResolver = (
      mode: 'a' | 'b',
    ): VisualResolver<DefaultTaggedItem, GeometricShapeVisual, BadgeClusterVisual> => ({
      resolveContentVisual: (item, ctx) => ({
        shape: mode === 'a' ? 'circle' : 'star',
        radius: mode === 'a' ? 9 : 12,
        fillHex: ctx.mixedColorHex,
        label: item.id,
      }),
      resolveClusterVisual: (cluster) => ({
        code: cluster.code,
        title: `${mode === 'a' ? 'Alpha' : 'Beta'} ${cluster.code}`,
        metaLine: `${cluster.members.length}n`,
        colorHex: cluster.colorHex,
      }),
      getVisualCacheKey: (v) =>
        'shape' in v ? `c:${v.shape}:${v.radius}` : `b:${v.code}:${v.title}:${v.metaLine}`,
    });

    const controller = new SimplexSvgController(container, {
      items,
      visualResolver: makeResolver('a'),
      contentView: new GeometricShapeSvgView(),
      clusterView: new BadgeClusterSvgView(),
      layoutOptions: { seed: 10 },
    });

    const svg = controller.getSvgElement();
    expect(svg.querySelectorAll('g.sv-node-item').length).toBe(10);
    expect(svg.querySelectorAll('g.sv-node-cluster').length).toBeGreaterThanOrEqual(3);

    // Trigger resolver change -> BadgeClusterSvgView has no morph(), so Dual-Layer Crossfade activates!
    controller.setVisualResolver(makeResolver('b'));
    controller.stepForTest(16);

    const clusterGroups = svg.querySelectorAll('g.sv-node-cluster');
    const firstCluster = clusterGroups[0]!;
    expect(firstCluster.querySelector('g.sv-layer-from')).not.toBeNull();
    expect(firstCluster.querySelector('g.sv-layer-to')).not.toBeNull();

    // Advance past transition duration -> layer-from must be cleanly removed
    for (let i = 0; i < 40; i++) {
      controller.stepForTest(20);
    }
    expect(firstCluster.querySelector('g.sv-layer-from')).toBeNull();
    expect(firstCluster.querySelector('g.sv-layer-main')).not.toBeNull();
    expect(controller.getMetrics().overlapCount).toBe(0);

    controller.destroy();
    container.remove();
  });

  it('supports zero-config createSimplexSvg(selector, items) and live setPreset() switching', () => {
    const container = document.createElement('div');
    container.id = 'quick-graph';
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = Array.from({ length: 8 }, (_, i) => ({
      id: `q-${i}`,
      tags: [`k-${i % 3}`, `k-${(i + 1) % 3}`],
    }));

    const controller = createSimplexSvg('#quick-graph', items);
    expect(controller.getSvgElement().querySelectorAll('g.sv-node-item').length).toBe(8);
    expect(controller.getMetrics().overlapCount).toBe(0);

    controller.setPreset('glyphs');
    for (let i = 0; i < 30; i++) controller.stepForTest(20);
    expect(controller.getMetrics().overlapCount).toBe(0);

    controller.setPreset('badges');
    for (let i = 0; i < 30; i++) controller.stepForTest(20);
    expect(controller.getMetrics().overlapCount).toBe(0);

    controller.destroy();
    container.remove();
  });

  it('applies camera zoomToCursor, panBy, and reset to SVG transform immediately when idle', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = Array.from({ length: 6 }, (_, i) => ({
      id: `cam-${i}`,
      tags: [`a-${i % 3}`, `a-${(i + 1) % 3}`],
    }));

    const controller = createSimplexSvg(container, items);
    for (let i = 0; i < 40; i++) controller.stepForTest(20);

    const worldGroup = controller.getSvgElement().querySelector('g.sv-world')!;
    expect(worldGroup.getAttribute('transform')).toBe('translate(0.00, 0.00) scale(1.0000)');

    controller.camera.zoomToCursor(400, 300, 1.5);
    expect(worldGroup.getAttribute('transform')).toContain('scale(1.5000)');

    controller.camera.panBy(25, -15);
    expect(worldGroup.getAttribute('transform')).toContain('translate(-175.00, -165.00)');

    controller.camera.reset();
    expect(worldGroup.getAttribute('transform')).toBe('translate(0.00, 0.00) scale(1.0000)');

    controller.destroy();
    container.remove();
  });

  it('supports two-finger touch pinch-to-zoom and cleans up on pointercancel', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = Array.from({ length: 6 }, (_, i) => ({
      id: `pinch-${i}`,
      tags: [`p-${i % 3}`, `p-${(i + 1) % 3}`],
    }));

    const controller = createSimplexSvg(container, items);
    for (let i = 0; i < 40; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });

    const firePointer = (
      type: string,
      pointerId: number,
      clientX: number,
      clientY: number,
    ) => {
      svg.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          pointerType: 'touch',
          clientX,
          clientY,
          bubbles: true,
        }),
      );
    };

    firePointer('pointerdown', 1, 350, 300);
    firePointer('pointerdown', 2, 450, 300);
    // Double finger distance from 100px to 200px => ~2.0x zoom
    firePointer('pointermove', 1, 300, 300);
    firePointer('pointermove', 2, 500, 300);

    const worldGroup = svg.querySelector('g.sv-world')!;
    const match = worldGroup.getAttribute('transform')?.match(/scale\(([0-9.]+)\)/);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1]!)).toBeGreaterThan(1.5);

    firePointer('pointercancel', 1, 300, 300);
    firePointer('pointerup', 2, 500, 300);

    controller.camera.reset();
    expect(worldGroup.getAttribute('transform')).toBe('translate(0.00, 0.00) scale(1.0000)');

    controller.destroy();
    container.remove();
  });

  it('supports pluggable SvgTriangleView and SvgEdgeView, hover tooltips, click-focus, and pan-on-drag', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: `tri-${i}`,
      tags: [`g-${i % 4}`, `g-${(i + 1) % 4}`],
    }));

    const customTriMount = { count: 0 };
    const hoveredIndices: Array<number | null> = [];
    const clickedKinds: string[] = [];

    const controller = new SimplexSvgController(container, {
      items,
      tooltip: true,
      layoutOptions: { seed: 99 },
      interactions: {
        onTriangleHover: (ev) => {
          hoveredIndices.push(ev ? ev.triangle.index : null);
        },
        onLeftClick: (target) => {
          clickedKinds.push(target.kind);
        },
      },
    });

    for (let i = 0; i < 40; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });

    const triGroups = svg.querySelectorAll('g.sv-mesh-triangle');
    const edgeGroups = svg.querySelectorAll('g.sv-mesh-edge');
    expect(triGroups.length).toBeGreaterThanOrEqual(1);
    expect(edgeGroups.length).toBeGreaterThanOrEqual(3);

    // Swap in custom SvgTriangleView and SvgEdgeView at runtime
    controller.setTriangleView({
      cacheKey: 'custom-tri',
      mountOrUpdate: (g, tri) => {
        customTriMount.count += 1;
        while (g.firstChild) g.removeChild(g.firstChild);
        const poly = g.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('data-custom-tri', String(tri.index));
        poly.setAttribute(
          'points',
          tri.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
        );
        poly.setAttribute('fill', tri.fillHex);
        g.appendChild(poly);
      },
    });
    controller.setEdgeView({
      cacheKey: 'custom-edge',
      mountOrUpdate: (g, edge) => {
        while (g.firstChild) g.removeChild(g.firstChild);
        const line = g.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('data-custom-edge', String(edge.index));
        line.setAttribute('x1', String(edge.a.x));
        line.setAttribute('y1', String(edge.a.y));
        line.setAttribute('x2', String(edge.b.x));
        line.setAttribute('y2', String(edge.b.y));
        g.appendChild(line);
      },
    });

    expect(customTriMount.count).toBeGreaterThanOrEqual(triGroups.length);
    expect(svg.querySelectorAll('[data-custom-tri]').length).toBe(triGroups.length);
    expect(svg.querySelectorAll('[data-custom-edge]').length).toBe(edgeGroups.length);

    // Find coordinates of triangle #0 centroid and probe nearby for an open triangle spot
    const firstPoly = svg.querySelector('polygon[data-custom-tri="0"]')!;
    const coords = firstPoly
      .getAttribute('points')!
      .split(' ')
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x: x!, y: y! };
      });
    const cx = (coords[0]!.x + coords[1]!.x + coords[2]!.x) / 3;
    const cy = (coords[0]!.y + coords[1]!.y + coords[2]!.y) / 3;

    let probeX = cx;
    let probeY = cy;
    for (let dx = -36; dx <= 36; dx += 6) {
      for (let dy = -36; dy <= 36; dy += 6) {
        svg.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: cx + dx,
            clientY: cy + dy,
            bubbles: true,
          }),
        );
        if (hoveredIndices.at(-1) === 0) {
          probeX = cx + dx;
          probeY = cy + dy;
          break;
        }
      }
      if (hoveredIndices.at(-1) === 0) break;
    }

    expect(hoveredIndices.at(-1)).toBe(0);
    const tooltipEl = container.querySelector('.sv-tooltip') as HTMLDivElement | null;
    expect(tooltipEl).not.toBeNull();
    expect(tooltipEl!.style.display).toBe('block');
    expect(tooltipEl!.textContent).toContain('Triangle #1');

    // Click without dragging dispatches triangle click
    svg.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: probeX,
        clientY: probeY,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: probeX,
        clientY: probeY,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new MouseEvent('click', {
        button: 0,
        clientX: probeX,
        clientY: probeY,
        bubbles: true,
      }),
    );
    expect(clickedKinds.at(-1)).toBe('triangle');

    // Dragging on triangle pans the camera instead of firing click
    svg.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: probeX,
        clientY: probeY,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: probeX + 40,
        clientY: probeY + 20,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: probeX + 40,
        clientY: probeY + 20,
        bubbles: true,
      }),
    );
    expect(controller.camera.getState().panX).toBeCloseTo(40, 1);

    controller.destroy();
    container.remove();
  });

  it('renders continuous barycentric GradientTriangleSvgView with 3 linearGradients and isolated plus-lighter blending', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: `grad-${i}`,
      tags: [`c-${i % 4}`, `c-${(i + 1) % 4}`],
    }));

    const controller = new SimplexSvgController(container, {
      items,
      triangleView: new GradientTriangleSvgView({ baseOpacity: 0.2 }),
      layoutOptions: { seed: 42 },
    });

    for (let i = 0; i < 40; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    const triGroups = svg.querySelectorAll('g.sv-mesh-triangle');
    expect(triGroups.length).toBeGreaterThanOrEqual(1);

    const firstTri = triGroups[0]!;
    const grads = firstTri.querySelectorAll('defs linearGradient');
    expect(grads.length).toBe(3);

    const polys = firstTri.querySelectorAll('polygon');
    expect(polys.length).toBe(3);
    for (const poly of polys) {
      expect(poly.getAttribute('fill')).toMatch(/^url\(#sv-tri-grad-/);
      expect(poly.getAttribute('style')).toContain('mix-blend-mode: plus-lighter');
    }

    // Focus first triangle -> adds crisp outline + 3 corner dots
    controller.setFocusedTriangleIndex(0);
    controller.stepForTest(16);
    expect(firstTri.querySelectorAll('polygon').length).toBe(4);
    expect(firstTri.querySelectorAll('circle').length).toBe(3);

    controller.destroy();
    container.remove();
  });

  it('renders untagged vector-embedding objects via createSimplexSvg without getTags and builds weighted anchor tooltips', () => {
    interface AudioSample {
      readonly id: string;
      readonly signature: readonly number[];
    }

    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    document.body.appendChild(container);

    const samples: AudioSample[] = [
      { id: 'aud-1', signature: [1, 0, 0] },
      { id: 'aud-2', signature: [0.95, 0.1, 0] },
      { id: 'aud-3', signature: [0, 1, 0] },
      { id: 'aud-4', signature: [0.1, 0.95, 0] },
      { id: 'aud-5', signature: [0, 0, 1] },
      { id: 'aud-6', signature: [0, 0.1, 0.95] },
      { id: 'aud-7', signature: [0.45, 0.45, 0.2] },
    ];

    const controller = createSimplexSvg(container, {
      items: samples,
      clusteringStrategy: createEmbeddingClusteringStrategy<AudioSample>({
        getEmbedding: (s) => s.signature,
      }),
      tooltip: true,
      layoutOptions: { seed: 9 },
    });

    for (let i = 0; i < 40; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    });
    const itemGroups = svg.querySelectorAll('g.sv-node-item');
    expect(itemGroups.length).toBe(7);
    expect(svg.querySelectorAll('g.sv-node-cluster').length).toBeGreaterThanOrEqual(3);

    const transform = itemGroups[0]!.getAttribute('transform') ?? '';
    const coordsMatch = transform.match(/translate\(\s*([0-9.-]+)[,\s]+([0-9.-]+)/);
    expect(coordsMatch).not.toBeNull();
    const itemX = parseFloat(coordsMatch![1]!);
    const itemY = parseFloat(coordsMatch![2]!);

    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: itemX,
        clientY: itemY,
        bubbles: true,
      }),
    );

    const tooltipEl = container.querySelector('.sv-tooltip') as HTMLDivElement | null;
    expect(tooltipEl).not.toBeNull();
    expect(tooltipEl!.style.display).toBe('block');
    expect(tooltipEl!.textContent).toContain('%');

    controller.destroy();
    container.remove();
  });

  it('handles discrete 2-finger pinch-out/pinch-in, neighbor chevrons, and blocked wheel zoom in barycentric drill-down mode', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 440, right: 600, bottom: 440 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = Array.from({ length: 32 }, (_, i) => ({
      id: `drill-${i}`,
      tags: [`t-${i % 4}`, `t-${(i + 1) % 4}`, `sub-${i % 3}`],
    }));

    const depths: number[] = [];
    const controller = new SimplexSvgController(container, {
      items,
      visualResolver: {
        resolveContentVisual: () => ({ shape: 'circle', radius: 28, fillHex: '#06b6d4' }),
        resolveClusterVisual: (cluster) => ({
          code: cluster.code,
          title: cluster.code,
          metaLine: `${cluster.members.length}n`,
          colorHex: cluster.colorHex,
        }),
        getVisualCacheKey: (v) => ('shape' in v ? `c:${v.radius}` : `b:${v.code}`),
      },
      contentView: new GeometricShapeSvgView(),
      clusterView: new BadgeClusterSvgView(),
      zoomStrategy: createBarycentricZoomStrategy({ fullScaleThreshold: 0.995 }),
      onZoomStateChange: (state) => {
        depths.push(state.depth);
      },
      layoutOptions: { seed: 21 },
    });

    for (let i = 0; i < 45; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 600, height: 440, right: 600, bottom: 440 }),
    });

    expect(controller.getZoomState().mode).toBe('drill-down');
    expect(controller.getZoomState().depth).toBe(0);
    expect(controller.getZoomState().drillableTriangleIndices.length).toBeGreaterThan(0);

    // Wheel scroll in drill-down mode must NOT move/scale the SVG camera
    svg.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -120,
        clientX: 400,
        clientY: 300,
        bubbles: true,
      }),
    );
    const worldGroup = svg.querySelector('g.sv-world')!;
    expect(worldGroup.getAttribute('transform')).toBe('translate(0.00, 0.00) scale(1.0000)');

    // 2-finger pinch-out over viewport center -> triggers discrete drill-down (depth 0 -> 1)
    const fireTouch = (
      type: string,
      pointerId: number,
      clientX: number,
      clientY: number,
    ) => {
      svg.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          pointerType: 'touch',
          clientX,
          clientY,
          bubbles: true,
        }),
      );
    };

    const firstTriPoly = svg.querySelector('g.sv-mesh-triangle polygon');
    expect(firstTriPoly).toBeTruthy();
    const firstPts = (firstTriPoly?.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [px, py] = pair.split(',').map(Number);
        return { x: px ?? 0, y: py ?? 0 };
      });
    const pinchCx = (firstPts[0]!.x + firstPts[1]!.x + firstPts[2]!.x) / 3;
    const pinchCy = (firstPts[0]!.y + firstPts[1]!.y + firstPts[2]!.y) / 3;

    fireTouch('pointerdown', 1, pinchCx - 45, pinchCy);
    fireTouch('pointerdown', 2, pinchCx + 45, pinchCy);
    fireTouch('pointermove', 1, pinchCx - 95, pinchCy);
    fireTouch('pointermove', 2, pinchCx + 95, pinchCy); // 190 / 90 >= 1.28 threshold
    fireTouch('pointerup', 1, pinchCx - 95, pinchCy);
    fireTouch('pointerup', 2, pinchCx + 95, pinchCy);

    for (let i = 0; i < 45; i++) controller.stepForTest(20);
    expect(controller.getZoomState().depth).toBe(1);
    expect(controller.getZoomState().activeFrameKind).toBe('triangle');
    expect(controller.getMetrics().overlapCount).toBe(0);
    // Camera transform stays identity (1.0000) because zoom was handled geometrically
    expect(worldGroup.getAttribute('transform')).toBe('translate(0.00, 0.00) scale(1.0000)');

    // Floating neighbor overlay buttons must be removed; dimmed neighbor faces are rendered directly on canvas
    expect(container.querySelectorAll('button.sv-zoom-neighbor-btn').length).toBe(0);
    const contextTriEls = svg.querySelectorAll(
      'g.sv-mesh-triangle[data-context="true"][data-neighbor-id]',
    );
    expect(contextTriEls.length).toBeGreaterThan(0);

    const clickableTriEl = (Array.from(contextTriEls).find(
      (el) => Number(el.getAttribute('data-covered-items') ?? '0') > 1,
    ) ?? contextTriEls[0]) as SVGGElement;
    const poly = clickableTriEl.querySelector('polygon');
    expect(poly).toBeTruthy();
    const pts = (poly?.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [px, py] = pair.split(',').map(Number);
        return { x: px ?? 0, y: py ?? 0 };
      });
    const cx = (pts[0]!.x + pts[1]!.x + pts[2]!.x) / 3;
    const cy = (pts[0]!.y + pts[1]!.y + pts[2]!.y) / 3;

    const beforeFrameId = controller.getZoomState().breadcrumbs.at(-1)?.frameId;
    svg.dispatchEvent(
      new MouseEvent('click', {
        clientX: cx,
        clientY: cy,
        button: 0,
        bubbles: true,
      }),
    );
    for (let i = 0; i < 45; i++) controller.stepForTest(20);
    expect(controller.getZoomState().depth).toBe(1);
    const afterFrameId = controller.getZoomState().breadcrumbs.at(-1)?.frameId;
    expect(afterFrameId).not.toBe(beforeFrameId);

    // Opposite 2-finger pinch-in -> drills up back to depth 0
    fireTouch('pointerdown', 1, 280, 300);
    fireTouch('pointerdown', 2, 520, 300); // dist 240
    fireTouch('pointermove', 1, 370, 300);
    fireTouch('pointermove', 2, 430, 300); // dist 60 (60 / 240 = 0.25 <= 0.78 threshold)
    fireTouch('pointerup', 1, 370, 300);
    fireTouch('pointerup', 2, 430, 300);

    for (let i = 0; i < 45; i++) controller.stepForTest(20);
    expect(controller.getZoomState().depth).toBe(0);
    expect(depths).toContain(1);
    expect(depths.at(-1)).toBe(0);

    controller.destroy();
    container.remove();
  });

  it('renders intermediate zoom midpoint clusters as compact chamfered bridge tags distinct from primary topic cards', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 480, height: 360, right: 480, bottom: 360 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = Array.from({ length: 56 }, (_, i) => ({
      id: `bridge-${i}`,
      tags: [`topic-${i % 4}`, `topic-${(i + 1) % 4}`, `detail-${i % 3}`],
    }));

    const controller = createSimplexSvg(container, {
      items,
      preset: 'badges',
      zoomStrategy: createBarycentricZoomStrategy(),
      layoutOptions: { seed: 11 },
    });

    for (let i = 0; i < 45; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    // At root depth 0, all cluster badges are primary <rect> cards (height 42)
    const rootActiveClusters = svg.querySelectorAll(
      'g.sv-node-cluster:not([data-context="true"])',
    );
    expect(rootActiveClusters.length).toBeGreaterThanOrEqual(3);
    for (const el of rootActiveClusters) {
      const rect = el.querySelector('rect');
      expect(rect).not.toBeNull();
      expect(Number(rect!.getAttribute('height'))).toBe(42);
    }

    const drillIdx = controller.getZoomState().drillableTriangleIndices[0]!;
    expect(controller.drillDownTriangle(drillIdx)).toBe(true);
    for (let i = 0; i < 45; i++) controller.stepForTest(20);

    // At depth 1, active clusters include both primary <rect> corner cards and compact chamfered <polygon> intermediate bridge tags
    const zoomedActiveClusters = Array.from(
      svg.querySelectorAll('g.sv-node-cluster:not([data-context="true"])'),
    );
    const polygonBridgeTags = zoomedActiveClusters.filter(
      (el) => el.querySelector('rect') === null && el.querySelector('polygon') !== null,
    );
    const primaryRectCards = zoomedActiveClusters.filter(
      (el) => el.querySelector('rect') !== null,
    );

    expect(polygonBridgeTags.length).toBeGreaterThanOrEqual(3);
    expect(primaryRectCards.length).toBeGreaterThanOrEqual(1);
    for (const bridgeEl of polygonBridgeTags) {
      const bgPoly = bridgeEl.querySelector('polygon')!;
      expect(bgPoly.getAttribute('stroke-dasharray')).toBe('3 2');
      const textContent = bridgeEl.textContent ?? '';
      expect(textContent).not.toContain('50%');
    }
    expect(controller.getMetrics().overlapCount).toBe(0);

    controller.destroy();
    container.remove();
  });

  it('renders hover-like perimeter & tint highlight on zoomed-in triangles and highlights non-drillable neighbors after zoom-out', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 640, height: 460, right: 640, bottom: 460 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = [
      ...Array.from({ length: 36 }, (_, i) => ({
        id: `svg-hl-${i}`,
        tags: ['core-a', 'core-b', `detail-${i % 3}`],
      })),
      { id: 'svg-leaf-0', tags: ['leaf-topic-c'] },
    ];

    const controller = createSimplexSvg(container, {
      items,
      preset: 'badges',
      meshStrategy: createFixedLatticeMeshStrategy({ rows: 3, cols: 3 }),
      zoomStrategy: createBarycentricZoomStrategy({
        clusterZoomMode: 'none',
        leafTriangleFocus: false,
      }),
      layoutOptions: { seed: 31, sizeMultiplier: 2.0 },
    });
    for (let i = 0; i < 45; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    const rootDrillable = controller.getZoomState().drillableTriangleIndices;
    const rootDrillableSet = new Set(rootDrillable);
    expect(rootDrillable.length).toBeGreaterThan(0);

    // At root depth 0, rest faces have base fill-opacity (~0.090) and 0 corner marker circles
    const rootTriGroups = Array.from(svg.querySelectorAll('g.sv-mesh-triangle'));
    expect(rootTriGroups.every((g) => g.querySelectorAll('circle').length === 0)).toBe(
      true,
    );

    // Drill into a triangle -> active 1:4 sub-triangles show boosted tint + outer perimeter <path> + 3 outer corner <circle>s
    expect(controller.drillDownTriangle(rootDrillable[0]!)).toBe(true);
    for (let i = 0; i < 45; i++) controller.stepForTest(20);

    const activeZoomedTris = Array.from(
      svg.querySelectorAll('g.sv-mesh-triangle:not([data-context="true"])'),
    );
    expect(activeZoomedTris.length).toBe(4);
    for (const g of activeZoomedTris) {
      const poly = g.querySelector('polygon')!;
      expect(Number(poly.getAttribute('fill-opacity'))).toBeGreaterThan(0.18);
    }
    const outerBoundaryPaths = activeZoomedTris.reduce(
      (acc, g) => acc + g.querySelectorAll('path').length,
      0,
    );
    const outerCornerCircles = activeZoomedTris.reduce(
      (acc, g) => acc + g.querySelectorAll('circle').length,
      0,
    );
    expect(outerBoundaryPaths).toBe(3); // 3 corner sub-triangles draw outer perimeter paths; center sub-triangle has none
    expect(outerCornerCircles).toBe(3); // 3 outer macro-triangle corners

    // Click a non-drillable neighbor triangle -> zooms out to depth 0 and renders hover-style highlight on that neighbor!
    const ctxNeighbors = Array.from(
      svg.querySelectorAll('g.sv-mesh-triangle[data-context="true"][data-neighbor-id]'),
    );
    const leafNeighborEl = ctxNeighbors.find((el) => {
      const m = el.getAttribute('data-neighbor-id')?.match(/tri:(\d+)$/);
      return m ? !rootDrillableSet.has(Number(m[1])) : false;
    });
    expect(leafNeighborEl).toBeDefined();
    const neighborId = leafNeighborEl!.getAttribute('data-neighbor-id')!;
    const targetTriIdx = Number(neighborId.match(/tri:(\d+)$/)![1]);

    expect(controller.drillToNeighbor(neighborId)).toBe(true);
    for (let i = 0; i < 45; i++) controller.stepForTest(20);
    expect(controller.getZoomState().depth).toBe(0);

    const postZoomRootTris = Array.from(svg.querySelectorAll('g.sv-mesh-triangle'));
    const highlightedNeighborEl = postZoomRootTris[targetTriIdx]!;
    expect(highlightedNeighborEl).toBeDefined();
    const hlPoly = highlightedNeighborEl.querySelector('polygon')!;
    expect(Number(hlPoly.getAttribute('fill-opacity'))).toBeGreaterThan(0.2);
    expect(hlPoly.getAttribute('stroke-width')).toBe('1.5');
    expect(highlightedNeighborEl.querySelectorAll('circle').length).toBe(3);

    controller.destroy();
    container.remove();
  });

  it('disables content item pointer capture inside drillable triangles so clicking an item zooms into the triangle until leaf level', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 640, height: 460, right: 640, bottom: 460 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = [
      ...Array.from({ length: 24 }, (_, i) => ({
        id: `pt-dense-${i}`,
        tags: ['t-alpha', 't-beta', 't-gamma'],
      })),
      { id: 'pt-leaf-0', tags: ['t-isolated'] },
    ];

    const controller = createSimplexSvg(container, {
      items,
      preset: 'geometric',
      meshStrategy: createFixedLatticeMeshStrategy({ rows: 3, cols: 3 }),
      zoomStrategy: createBarycentricZoomStrategy({
        subdivision: '1:4',
        clusterZoomMode: 'none',
      }),
      layoutOptions: { seed: 19, sizeMultiplier: 2.2 },
    });
    for (let i = 0; i < 45; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 640, height: 460, right: 640, bottom: 460 }),
    });

    const passThroughEls = svg.querySelectorAll(
      'g.sv-node-item[data-pass-through="true"]',
    );
    expect(passThroughEls.length).toBeGreaterThan(0);
    const targetItemEl = passThroughEls[0] as SVGGElement;
    expect(targetItemEl.getAttribute('pointer-events')).toBe('none');

    const coordsMatch = targetItemEl
      .getAttribute('transform')
      ?.match(/translate\(\s*([0-9.-]+)[,\s]+([0-9.-]+)/);
    expect(coordsMatch).not.toBeNull();
    const itemX = parseFloat(coordsMatch![1]!);
    const itemY = parseFloat(coordsMatch![2]!);

    // Moving pointer directly onto the item inside a drillable triangle sets zoom-in cursor
    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: itemX,
        clientY: itemY,
        bubbles: true,
      }),
    );
    expect(svg.style.cursor).toBe('zoom-in');

    // Clicking directly on that item's coordinates zooms into the triangle (depth 0 -> 1)!
    svg.dispatchEvent(
      new MouseEvent('click', {
        clientX: itemX,
        clientY: itemY,
        button: 0,
        bubbles: true,
      }),
    );
    for (let i = 0; i < 45; i++) controller.stepForTest(20);
    expect(controller.getZoomState().depth).toBe(1);

    // Once zoomed in (depth = 1), all dimmed content items in unfocused neighbor triangles
    // must ALSO be pass-through (`pointer-events="none"`, steady 0.320 opacity, zero hover boost)
    const contextItemEls = Array.from(
      svg.querySelectorAll('g.sv-node-item[data-context="true"]'),
    ) as SVGGElement[];
    expect(contextItemEls.length).toBeGreaterThan(0);
    for (const ctxEl of contextItemEls) {
      expect(ctxEl.getAttribute('pointer-events')).toBe('none');
      expect(ctxEl.getAttribute('data-pass-through')).toBe('true');
      expect(Number(ctxEl.getAttribute('opacity'))).toBeCloseTo(0.32, 2);
    }

    const sampleCtxEl = contextItemEls[0]!;
    const ctxCoords = sampleCtxEl
      .getAttribute('transform')
      ?.match(/translate\(\s*([0-9.-]+)[,\s]+([0-9.-]+)/);
    expect(ctxCoords).not.toBeNull();
    const ctxX = parseFloat(ctxCoords![1]!);
    const ctxY = parseFloat(ctxCoords![2]!);

    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: ctxX,
        clientY: ctxY,
        bubbles: true,
      }),
    );
    controller.stepForTest(16);

    // Dimmed item opacity does NOT brighten on hover; neighbor triangle handles the pointer
    expect(Number(sampleCtxEl.getAttribute('opacity'))).toBeCloseTo(0.32, 2);
    expect(svg.style.cursor).toBe('pointer');

    controller.destroy();
    container.remove();
  });

  it('renders internal 1:4 subdivision edges on drillable triangles using the exact same SvgEdgeView line style as the outer triangulation', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 640, height: 460, right: 640, bottom: 460 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = [
      ...Array.from({ length: 24 }, (_, i) => ({
        id: `aff-dense-${i}`,
        tags: ['t-one', 't-two', 't-three'],
      })),
      { id: 'aff-leaf-0', tags: ['t-solo'] },
    ];

    const controller = createSimplexSvg(container, {
      items,
      preset: 'geometric',
      meshStrategy: createFixedLatticeMeshStrategy({ rows: 3, cols: 3 }),
      zoomStrategy: createBarycentricZoomStrategy({
        subdivision: '1:4',
        clusterZoomMode: 'none',
      }),
      layoutOptions: { seed: 23, sizeMultiplier: 2.2 },
    });
    for (let i = 0; i < 45; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    const parsePolyPoints = (polyEl: Element) =>
      (polyEl.getAttribute('points') ?? '')
        .trim()
        .split(/\s+/)
        .map((pair) => {
          const [px, py] = pair.split(',').map(Number);
          return { x: px ?? 0, y: py ?? 0 };
        });

    const drillableGroups = Array.from(
      svg.querySelectorAll('g.sv-mesh-triangle[data-drillable="true"]'),
    ) as SVGGElement[];
    const nonDrillableGroups = Array.from(
      svg.querySelectorAll('g.sv-mesh-triangle:not([data-drillable="true"])'),
    ) as SVGGElement[];

    expect(drillableGroups.length).toBeGreaterThan(0);
    expect(nonDrillableGroups.length).toBeGreaterThan(0);

    const allDrillEdgeEls = Array.from(
      svg.querySelectorAll('g.sv-drill-edges > g.sv-drill-edge'),
    ) as SVGGElement[];
    expect(allDrillEdgeEls.length).toBe(drillableGroups.length * 3);

    // Non-drillable leaf triangles emit 0 internal subdivision edges
    for (const leafG of nonDrillableGroups) {
      const triIdx = leafG.getAttribute('data-triangle-index');
      expect(
        svg.querySelectorAll(`g.sv-drill-edge[data-triangle-index="${triIdx}"]`).length,
      ).toBe(0);
    }

    // Outer rest edge line attributes (stroke, stroke-width, stroke-opacity, stroke-dasharray)
    const sampleOuterLine = svg.querySelector('g.sv-mesh-edge line')!;
    expect(sampleOuterLine).not.toBeNull();

    // Every drillable triangle emits 3 midpoint-to-midpoint edges with identical line styling
    for (const drillG of drillableGroups) {
      const triIdx = drillG.getAttribute('data-triangle-index');
      const subEdgeGroups = Array.from(
        svg.querySelectorAll(`g.sv-drill-edge[data-triangle-index="${triIdx}"]`),
      );
      expect(subEdgeGroups.length).toBe(3);

      const outerPts = parsePolyPoints(drillG.querySelector('polygon')!);
      const m01 = {
        x: (outerPts[0]!.x + outerPts[1]!.x) / 2,
        y: (outerPts[0]!.y + outerPts[1]!.y) / 2,
      };
      const m12 = {
        x: (outerPts[1]!.x + outerPts[2]!.x) / 2,
        y: (outerPts[1]!.y + outerPts[2]!.y) / 2,
      };
      const m20 = {
        x: (outerPts[2]!.x + outerPts[0]!.x) / 2,
        y: (outerPts[2]!.y + outerPts[0]!.y) / 2,
      };
      const expectedSegments = [
        [m01, m12],
        [m12, m20],
        [m20, m01],
      ] as const;

      subEdgeGroups.forEach((segGroup, k) => {
        const line = segGroup.querySelector('line')!;
        expect(line).not.toBeNull();
        expect(line.getAttribute('stroke')).toBe(sampleOuterLine.getAttribute('stroke'));
        expect(line.getAttribute('stroke-width')).toBe(
          sampleOuterLine.getAttribute('stroke-width'),
        );
        expect(line.getAttribute('stroke-opacity')).toBe(
          sampleOuterLine.getAttribute('stroke-opacity'),
        );
        expect(line.getAttribute('stroke-dasharray')).toBe(
          sampleOuterLine.getAttribute('stroke-dasharray'),
        );

        const [expA, expB] = expectedSegments[k]!;
        expect(Number(line.getAttribute('x1'))).toBeCloseTo(expA.x, 1);
        expect(Number(line.getAttribute('y1'))).toBeCloseTo(expA.y, 1);
        expect(Number(line.getAttribute('x2'))).toBeCloseTo(expB.x, 1);
        expect(Number(line.getAttribute('y2'))).toBeCloseTo(expB.y, 1);
      });
    }

    // Swapping edgeView updates both outer triangulation edges AND internal 1:4 subdivision edges
    controller.setEdgeView(
      new ClusterTintedEdgeSvgView({ strokeWidth: 1.4, opacity: 0.52 }),
    );
    const tintedSubEdge = svg.querySelector('g.sv-drill-edge')!;
    expect(tintedSubEdge.querySelectorAll('line').length).toBe(3);
    expect(
      tintedSubEdge.querySelector('line')!.getAttribute('stroke-width'),
    ).toBe('1.40');

    controller.destroy();
    container.remove();
  });

  it('calibrates saturated cluster fills to guarantee >= 4.5:1 WCAG AA contrast with white text across all hues', () => {
    const testHues = [
      '#22d3ee', // luminous cyan
      '#facc15', // luminous yellow
      '#f59e0b', // bright amber
      '#34d399', // mint emerald
      '#2563eb', // cobalt
      '#e11d48', // crimson
    ];
    for (const theme of ['dark', 'light'] as const) {
      for (const hex of testHues) {
        const pal = resolveClusterSurfaceColors(hex, theme);
        const lum = getHexRelativeLuminance(pal.solidFillHex);
        const contrastWithWhite = 1.05 / (lum + 0.05);
        expect(contrastWithWhite).toBeGreaterThanOrEqual(4.5);
        expect(pal.haloHex).toMatch(/^#[0-9a-f]{6}$/);
        expect(pal.intermediateFillHex).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('renders two-line parent context plaques on outer subspace corners, single-line midpoints, and color-pip breadcrumbs', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 620, height: 440, right: 620, bottom: 440 }),
    });
    document.body.appendChild(container);

    const items = Array.from({ length: 48 }, (_, i) => ({
      id: `film-${i}`,
      title: `Film ${i + 1}`,
      tags: [`genre-${i % 4}`, `sub-${i % 6}`],
      budget: 10 + (i % 5) * 45,
      year: 1980 + (i % 8) * 5,
    }));

    const controller = createSimplexSvg(container, {
      items,
      preset: 'badges',
      zoomStrategy: createSubspaceZoomStrategy(),
      showZoomBreadcrumbs: true,
      layoutOptions: { seed: 17, sizeMultiplier: 1.8 },
    });
    for (let i = 0; i < 45; i++) controller.stepForTest(20);

    const drillIdx = controller.getZoomState().drillableTriangleIndices[0]!;
    expect(controller.drillDownTriangle(drillIdx)).toBe(true);
    for (let i = 0; i < 45; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    const activeClusterEls = Array.from(
      svg.querySelectorAll('g.sv-node-cluster:not([data-context="true"])'),
    );
    expect(activeClusterEls.length).toBe(6);

    // Outer 3 corners have 2 <text> lines (parent context eyebrow + local facet); 3 midpoints have 1 <text> line
    const twoLinePlaques = activeClusterEls.filter(
      (el) => el.querySelectorAll('text').length === 2,
    );
    const oneLinePlaques = activeClusterEls.filter(
      (el) => el.querySelectorAll('text').length === 1,
    );
    expect(twoLinePlaques.length).toBe(3);
    expect(oneLinePlaques.length).toBe(3);
    expect(
      activeClusterEls.every((el) => (el.textContent ?? '').trim().length > 0),
    ).toBe(true);

    // Breadcrumb overlay renders human-readable topic segments with colored indicator pips
    const crumbBar = container.querySelector('.sv-zoom-breadcrumbs');
    expect(crumbBar).not.toBeNull();
    const crumbButtons = crumbBar!.querySelectorAll('button');
    expect(crumbButtons.length).toBe(2);
    expect(crumbButtons[1]!.textContent).toMatch(/genre-\d|sub-\d/);
    expect(crumbButtons[1]!.textContent).not.toMatch(/^C\d+·C\d+·C\d+$/);
    expect(crumbButtons[1]!.querySelectorAll('span').length).toBeGreaterThanOrEqual(6);

    controller.destroy();
    container.remove();
  });

  it('auto-relayouts on document.fonts.ready and loadingdone, respects relayoutOnFontLoad: false, and cleans up on destroy (Issue #9)', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 760, height: 520, right: 760, bottom: 520 }),
    });
    document.body.appendChild(container);

    let resolveFontsReady!: () => void;
    const readyPromise = new Promise<void>((res) => {
      resolveFontsReady = res;
    });
    const listeners = new Map<string, Set<EventListener>>();
    const mockFonts = {
      status: 'loading',
      ready: readyPromise,
      addEventListener: (type: string, fn: EventListener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: EventListener) => {
        listeners.get(type)?.delete(fn);
      },
      dispatchLoadingDone: () => {
        for (const fn of listeners.get('loadingdone') ?? []) {
          fn(new Event('loadingdone'));
        }
      },
    };

    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: mockFonts,
    });

    try {
      let mountCalls = 0;
      const items: DefaultTaggedItem[] = Array.from({ length: 12 }, (_, i) => ({
        id: `font-${i}`,
        tags: [`t-${i % 3}`, `t-${(i + 1) % 3}`],
      }));

      // 1) relayoutOnFontLoad: false does not subscribe to loadingdone
      const disabledCtrl = createSimplexSvg(container, {
        items,
        relayoutOnFontLoad: false,
      });
      expect(listeners.get('loadingdone')?.size ?? 0).toBe(0);
      disabledCtrl.destroy();

      // 2) Default relayoutOnFontLoad: true re-measures hulls on ready and loadingdone
      const controller = new SimplexSvgController(container, {
        items,
        contentView: {
          mountOrUpdate: (g) => {
            mountCalls += 1;
            const c = g.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('r', '9');
            g.replaceChildren(c);
          },
        },
      });
      for (let i = 0; i < 20; i++) controller.stepForTest(20);
      expect(listeners.get('loadingdone')?.size).toBe(1);

      const mountsBeforeReady = mountCalls;
      resolveFontsReady();
      await Promise.resolve();
      await Promise.resolve();
      for (let i = 0; i < 5; i++) controller.stepForTest(20);
      expect(mountCalls).toBeGreaterThan(mountsBeforeReady);

      const mountsBeforeEvent = mountCalls;
      mockFonts.dispatchLoadingDone();
      for (let i = 0; i < 5; i++) controller.stepForTest(20);
      expect(mountCalls).toBeGreaterThan(mountsBeforeEvent);

      // 3) destroy() detaches the loadingdone listener cleanly
      controller.destroy();
      expect(listeners.get('loadingdone')?.size ?? 0).toBe(0);
    } finally {
      if (originalFonts) {
        Object.defineProperty(document, 'fonts', originalFonts);
      } else {
        delete (document as unknown as Record<string, unknown>).fonts;
      }
      container.remove();
    }
  });

  it('composes interactions.onLeftClick and hover handlers with built-in drill-down and tooltips unless returning true (Issue #3)', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 720, height: 500, right: 720, bottom: 500 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = Array.from({ length: 42 }, (_, i) => ({
      id: `comp-${i}`,
      tags: ['alpha', 'beta', 'gamma', `sub-${i % 4}`],
    }));

    const seenClicks: string[] = [];
    let consumeClick = false;
    let suppressTooltip = false;

    const controller = createSimplexSvg(container, {
      items,
      tooltip: true,
      zoomStrategy: createBarycentricZoomStrategy(),
      layoutOptions: { seed: 42, sizeMultiplier: 1.8 },
      interactions: {
        onTriangleHover: () => suppressTooltip,
        onLeftClick: (target) => {
          seenClicks.push(target.kind);
          return consumeClick;
        },
      },
    });
    for (let i = 0; i < 40; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 720, height: 500, right: 720, bottom: 500 }),
    });

    const drillTriIdx = controller.getZoomState().drillableTriangleIndices[0]!;
    const triPoly = svg.querySelector(
      `g.sv-mesh-triangle[data-triangle-index="${drillTriIdx}"] polygon`,
    )!;
    const pts = triPoly
      .getAttribute('points')!
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x: x!, y: y! };
      });
    const cx = (pts[0]!.x + pts[1]!.x + pts[2]!.x) / 3;
    const cy = (pts[0]!.y + pts[1]!.y + pts[2]!.y) / 3;

    // Hovering with suppressTooltip = true hides built-in DOM tooltip
    suppressTooltip = true;
    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: cx,
        clientY: cy,
        bubbles: true,
      }),
    );
    const tooltipEl1 = container.querySelector('.sv-tooltip') as HTMLDivElement | null;
    expect(tooltipEl1 === null || tooltipEl1.style.display === 'none').toBe(true);

    // Hovering with suppressTooltip = false shows built-in DOM tooltip
    suppressTooltip = false;
    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: cx,
        clientY: cy,
        bubbles: true,
      }),
    );
    const tooltipEl2 = container.querySelector('.sv-tooltip') as HTMLDivElement | null;
    expect(tooltipEl2?.style.display).toBe('block');

    // Clicking with consumeClick = true intercepts click and prevents drill-down
    consumeClick = true;
    svg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: cx, clientY: cy, bubbles: true }),
    );
    expect(seenClicks.at(-1)).toBe('triangle');
    expect(controller.getZoomState().depth).toBe(0);

    // Clicking with consumeClick = false runs user handler AND composes with built-in drill-down
    consumeClick = false;
    svg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: cx, clientY: cy, bubbles: true }),
    );
    for (let i = 0; i < 40; i++) controller.stepForTest(20);
    expect(seenClicks.at(-1)).toBe('triangle');
    expect(controller.getZoomState().depth).toBe(1);

    // Clicking empty background (4, 4) with consumeClick = false composes with built-in drillUp
    svg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: 4, clientY: 4, bubbles: true }),
    );
    for (let i = 0; i < 40; i++) controller.stepForTest(20);
    expect(seenClicks.at(-1)).toBe('background');
    expect(controller.getZoomState().depth).toBe(0);

    controller.destroy();
    container.remove();
  });

  it('supports showCode, maxTitleChars, and formatTitle on BadgeClusterSvgView and createSimplexSvg badgeOptions (Issue #4)', () => {
    expect(truncateBadgeTitle('Autonomous Driving Systems', 16)).toBe('Autonomous…');
    expect(truncateBadgeTitle('Short', 16)).toBe('Short');
    expect(truncateBadgeTitle('Supercalifragilistic', 10)).toBe('Supercali…');

    // Direct BadgeClusterSvgView with showCode: false omits code <text>, centers title, and narrows capsule
    const withCodeView = new BadgeClusterSvgView({ showCode: true });
    const noCodeView = new BadgeClusterSvgView({
      showCode: false,
      maxTitleChars: 14,
      formatTitle: (title) => title.toUpperCase(),
    });

    const sampleVisual: BadgeClusterVisual = {
      code: 'T1',
      title: 'Autonomous Driving Systems',
      metaLine: '7 items',
      colorHex: '#60a5fa',
      theme: 'dark',
    };
    const state = {
      id: 'c1',
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      interaction: {
        isHovered: false,
        isFocused: false,
        isHighlighted: false,
        isPinned: false,
        isDimmed: false,
      },
    };

    const gWithCode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const gNoCode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    withCodeView.mountOrUpdate(gWithCode, sampleVisual, state);
    noCodeView.mountOrUpdate(gNoCode, sampleVisual, state);

    expect(gWithCode.querySelectorAll('text').length).toBe(3); // code + title + count
    expect(gNoCode.querySelectorAll('text').length).toBe(2); // title + count only
    const titleEl = gNoCode.querySelectorAll('text')[0]!;
    expect(titleEl.getAttribute('text-anchor')).toBe('middle');
    expect(titleEl.getAttribute('x')).toBe('0');
    expect(titleEl.textContent).toBe('AUTONOMOUS…');
    expect(gNoCode.textContent).not.toContain('T1');

    const wWithCode = parseFloat(gWithCode.querySelector('rect')!.getAttribute('width')!);
    const wNoCode = parseFloat(gNoCode.querySelector('rect')!.getAttribute('width')!);
    expect(wNoCode).toBeLessThan(wWithCode);

    // End-to-end via createSimplexSvg preset + badgeOptions
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 820, height: 540, right: 820, bottom: 540 }),
    });
    document.body.appendChild(container);

    const formattedClusters: string[] = [];
    const controller = createSimplexSvg(container, {
      items: [
        { id: '1', tags: ['autonomous-driving', 'computer-vision'] },
        { id: '2', tags: ['autonomous-driving', 'sensor-fusion'] },
        { id: '3', tags: ['computer-vision', 'sensor-fusion'] },
        { id: '4', tags: ['formal-verification', 'safety-assurance'] },
        { id: '5', tags: ['formal-verification', 'sensor-fusion'] },
      ],
      preset: 'badges',
      formatTagLabel: (tag) =>
        tag
          .split('-')
          .map((w) => w[0]!.toUpperCase() + w.slice(1))
          .join(' '),
      badgeOptions: {
        showCode: false,
        maxTitleChars: 15,
        formatTitle: (title, ctx) => {
          if (ctx.cluster) formattedClusters.push(ctx.cluster.clusterUid);
          return `★ ${title}`;
        },
      },
    });
    for (let i = 0; i < 35; i++) controller.stepForTest(20);

    expect(formattedClusters.length).toBeGreaterThan(0);
    expect(controller.getMetrics().overlapCount).toBe(0);
    const clusterGroups = controller.getSvgElement().querySelectorAll('g.sv-node-cluster');
    expect(clusterGroups.length).toBeGreaterThanOrEqual(3);
    for (const cg of clusterGroups) {
      const texts = cg.querySelectorAll('text');
      expect(texts.length).toBe(2);
      expect(texts[0]!.textContent?.startsWith('★ ')).toBe(true);
      expect(texts[0]!.textContent!.length).toBeLessThanOrEqual(15);
      expect(texts[0]!.getAttribute('text-anchor')).toBe('middle');
    }

    controller.destroy();
    container.remove();
  });

  it('formats cluster titles and hover tooltip tag labels via formatTagLabel while keeping canonical cluster tags (Issue #7)', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 760, height: 500, right: 760, bottom: 500 }),
    });
    document.body.appendChild(container);

    const names: Record<string, string> = {
      'machine-learning': 'Machine Learning',
      'robot-control': 'Robot Control',
      'sensor-fusion': 'Sensor Fusion',
    };
    const controller = createSimplexSvg(container, {
      items: [
        { id: 'item-1', label: 'Sensor Paper', tags: ['machine-learning', 'sensor-fusion'] },
        { id: 'item-2', label: 'Control Paper', tags: ['robot-control', 'sensor-fusion'] },
        { id: 'item-3', label: 'ML Paper', tags: ['machine-learning', 'robot-control'] },
      ],
      preset: 'badges',
      tooltip: true,
      formatTagLabel: (tag) => names[tag] ?? tag,
    });
    for (let i = 0; i < 35; i++) controller.stepForTest(20);

    // Canonical tag IDs stay strictly normalized in cluster descriptors
    for (const cluster of controller.getClusters()) {
      for (const td of cluster.coreTags) {
        expect(names[td.tag]).toBeDefined();
        expect(td.label).toBe(names[td.tag]);
      }
      expect(cluster.defaultLabel).not.toMatch(/[a-z]-[a-z]/);
    }

    const svg = controller.getSvgElement();
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 760, height: 500, right: 760, bottom: 500 }),
    });
    const firstItemGroup = svg.querySelector('g.sv-node-item')!;
    const transform = firstItemGroup.getAttribute('transform') ?? '';
    const match = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(transform);
    expect(match).not.toBeNull();
    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: parseFloat(match![1]!),
        clientY: parseFloat(match![2]!),
        bubbles: true,
      }),
    );

    const tooltip = container.querySelector('.sv-tooltip') as HTMLDivElement | null;
    expect(tooltip?.style.display).toBe('block');
    expect(tooltip?.textContent).not.toMatch(/[a-z]-[a-z]/);
    expect(
      Object.values(names).some((label) => tooltip?.textContent?.includes(label)),
    ).toBe(true);

    controller.destroy();
    container.remove();
  });

  it('supports fixed and item-driven N-gon shapes with exact convex hulls and drill-down invariance (Issue #11)', () => {
    expect(resolveGeometricShapeSpec('triangle')).toEqual({
      shape: 'triangle',
      sides: 3,
      rotationRad: -Math.PI / 2,
    });
    expect(resolveGeometricShapeSpec('pentagon')).toEqual({
      shape: 'pentagon',
      sides: 5,
      rotationRad: -Math.PI / 2,
    });
    expect(resolveGeometricShapeSpec(7)).toEqual({
      shape: 'polygon',
      sides: 7,
      rotationRad: -Math.PI / 2,
    });
    expect(resolveGeometricShapeSpec({ sides: 9, rotationRad: 0.25 })).toEqual({
      shape: 'polygon',
      sides: 9,
      rotationRad: 0.25,
    });

    const fixedPentagonView = new GeometricShapeSvgView({ shape: 'pentagon' });
    const pentHull = fixedPentagonView.measureConvexHull!({
      shape: 'circle',
      radius: 12,
      fillHex: '#38bdf8',
      sides: 5,
    });
    expect(pentHull.kind).toBe('polygon');
    if (pentHull.kind === 'polygon') {
      expect(pentHull.vertices.length).toBe(5);
    }

    const dynamicView = new GeometricShapeSvgView();
    const heptHull = dynamicView.measureConvexHull!({
      shape: 'polygon',
      sides: 7,
      radius: 12,
      fillHex: '#38bdf8',
    });
    expect(heptHull.kind).toBe('polygon');
    if (heptHull.kind === 'polygon') {
      expect(heptHull.vertices.length).toBe(7);
    }

    // Per-item shape binding via getShape stays invariant when drilling 1:4 into a triangle
    interface CategorizedItem {
      readonly id: string;
      readonly category: 'paper' | 'talk' | 'demo';
      readonly tags: readonly string[];
    }
    const categorized: readonly CategorizedItem[] = Array.from({ length: 30 }, (_, i) => ({
      id: `cat-${i}`,
      category: i % 3 === 0 ? 'paper' : i % 3 === 1 ? 'talk' : 'demo',
      tags: ['alpha', 'beta', 'gamma', `sub-${i % 4}`],
    }));

    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 640, height: 460, right: 640, bottom: 460 }),
    });
    document.body.appendChild(container);

    const shapeByCategory = {
      paper: 'triangle',
      talk: 'square',
      demo: { sides: 6, rotationRad: Math.PI / 6 },
    } as const;

    const controller = createSimplexSvg<CategorizedItem>(container, {
      items: categorized,
      preset: 'geometric',
      getShape: (item) => shapeByCategory[item.category],
      zoomStrategy: createBarycentricZoomStrategy({ stopWhenFullScale: false }),
      layoutOptions: { seed: 42 },
    });
    for (let i = 0; i < 40; i++) controller.stepForTest(20);

    expect(controller.getMetrics().overlapCount).toBe(0);
    const rootItemPaths = new Map<string, string>();
    for (const g of controller.getSvgElement().querySelectorAll('g.sv-node-item')) {
      const id = g.getAttribute('data-node-id');
      const d = g.querySelector('path.sv-geom-shape')?.getAttribute('d');
      if (id && d) rootItemPaths.set(id, d);
    }
    expect(rootItemPaths.size).toBe(categorized.length);
    // Distinct categories must produce distinct shape paths
    expect(rootItemPaths.get('cat-0')).not.toBe(rootItemPaths.get('cat-1'));
    expect(rootItemPaths.get('cat-1')).not.toBe(rootItemPaths.get('cat-2'));

    // Drill down 1:4 and confirm active item shapes remain identical to root shapes
    const drillTriIdx = controller.getZoomState().drillableTriangleIndices[0]!;
    expect(controller.drillDownTriangle(drillTriIdx)).toBe(true);
    for (let i = 0; i < 40; i++) controller.stepForTest(20);
    expect(controller.getMetrics().overlapCount).toBe(0);

    let checkedActive = 0;
    for (const g of controller.getSvgElement().querySelectorAll('g.sv-node-item')) {
      const id = g.getAttribute('data-node-id') ?? '';
      if (id.startsWith('ctx-it-')) continue;
      const d = g.querySelector('path.sv-geom-shape')?.getAttribute('d');
      expect(d).toBe(rootItemPaths.get(id));
      checkedActive += 1;
    }
    expect(checkedActive).toBeGreaterThan(0);

    controller.destroy();
    container.remove();
  });

  it('renders optional built-in timeline player controls, advances playback via stepForTest, pins clusters via auto final-seed, and syncs theme (Issue #8)', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 820, height: 540, right: 820, bottom: 540 }),
    });
    document.body.appendChild(container);

    interface DatedDoc {
      readonly id: string;
      readonly title: string;
      readonly tags: readonly string[];
      readonly year?: number;
    }

    const items: readonly DatedDoc[] = [
      { id: 'b0', title: 'Foundation', tags: ['systems', 'theory'] },
      { id: 'd1', title: '2021 Note', tags: ['systems', 'graphics'], year: 2021 },
      { id: 'd2', title: '2021 Extra', tags: ['theory', 'ml'], year: 2021 },
      { id: 'd3', title: '2022 Note', tags: ['graphics', 'ml'], year: 2022 },
      { id: 'd4', title: '2023 Note', tags: ['systems', 'ml'], year: 2023 },
      { id: 'd5', title: '2023 Extra', tags: ['graphics', 'theory'], year: 2023 },
    ];

    const observedSteps: number[] = [];
    const controller = createSimplexSvg<DatedDoc>(container, {
      items,
      preset: 'geometric',
      theme: 'dark',
      layoutOptions: { seed: 42 },
      timeline: {
        getTimestamp: (item) => item.year,
        baselineLabel: 'Base',
        stepIntervalMs: 400,
        onStateChange: (st) => {
          observedSteps.push(st.step);
        },
      },
    });
    for (let i = 0; i < 30; i++) controller.stepForTest(20);

    // Starts at full corpus (step 3 = '2023') and renders built-in .sv-timeline-bar
    expect(controller.timeline).not.toBeNull();
    expect(controller.timeline!.getState().step).toBe(3);
    expect(controller.timeline!.getState().totalSteps).toBe(3);
    expect(controller.getClusteringStrategy().name).toMatch(/^final-seeded\(/);

    const canonicalClusterUids = controller
      .getClusters()
      .map((c) => `${c.vertexIndex}:${c.clusterUid}:${c.colorHex}`);

    const bar = container.querySelector('.sv-timeline-bar') as HTMLDivElement | null;
    expect(bar).not.toBeNull();
    expect(bar!.style.display).toBe('flex');
    const playBtn = bar!.querySelector(
      '[data-sv-timeline-action="toggle"]',
    ) as HTMLButtonElement;
    const prevBtn = bar!.querySelector(
      '[data-sv-timeline-action="prev"]',
    ) as HTMLButtonElement;
    const nextBtn = bar!.querySelector(
      '[data-sv-timeline-action="next"]',
    ) as HTMLButtonElement;
    const scrubber = bar!.querySelector(
      '[data-sv-timeline-action="scrubber"]',
    ) as HTMLInputElement;
    const labelEl = bar!.querySelector('[data-sv-timeline-label]') as HTMLSpanElement;
    const countEl = bar!.querySelector('[data-sv-timeline-count]') as HTMLSpanElement;

    expect(labelEl.textContent).toBe('2023');
    expect(countEl.textContent).toBe('6/6');
    expect(nextBtn.disabled).toBe(true);
    expect(prevBtn.disabled).toBe(false);

    // Clicking prev steps back from 3 -> 2 while keeping clusters pinned
    prevBtn.click();
    for (let i = 0; i < 20; i++) controller.stepForTest(20);
    expect(controller.timeline!.getState().step).toBe(2);
    expect(labelEl.textContent).toBe('2022');
    expect(countEl.textContent).toBe('4/6');
    expect(controller.getItems().length).toBe(4);
    expect(
      controller.getClusters().map((c) => `${c.vertexIndex}:${c.clusterUid}:${c.colorHex}`),
    ).toEqual(canonicalClusterUids);

    // Scrubbing to step 0 shows baseline frame ('Base', 1/6)
    scrubber.value = '0';
    scrubber.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 20; i++) controller.stepForTest(20);
    expect(controller.timeline!.getState().step).toBe(0);
    expect(labelEl.textContent).toBe('Base');
    expect(countEl.textContent).toBe('1/6');
    expect(prevBtn.disabled).toBe(true);

    // Clicking play advances automatically through frames via stepForTest()
    playBtn.click();
    expect(controller.timeline!.getState().playing).toBe(true);
    controller.stepForTest(400);
    expect(controller.timeline!.getState().step).toBe(1);
    controller.stepForTest(400);
    expect(controller.timeline!.getState().step).toBe(2);
    controller.stepForTest(400);
    expect(controller.timeline!.getState().step).toBe(3);
    expect(controller.timeline!.getState().playing).toBe(false);
    expect(observedSteps).toContain(0);
    expect(observedSteps.at(-1)).toBe(3);

    // Switching theme updates built-in timeline bar styling
    const darkBg = bar!.style.background;
    controller.setTheme('light');
    expect(bar!.style.background).not.toBe(darkBg);

    // Disabling timeline hides overlay and restores full corpus
    controller.setTimelineOptions(false);
    expect(controller.timeline).toBeNull();
    expect(bar!.style.display).toBe('none');
    expect(controller.getItems().length).toBe(6);

    controller.destroy();
    expect(container.querySelector('.sv-timeline-bar')).toBeNull();
    container.remove();
  });

  it('supports timeline.autoFinalSeedLayout and configurable emptyClusterBehavior (dim | hide | normal) in SimplexSvgController', () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 780, height: 520, right: 780, bottom: 520 }),
    });
    document.body.appendChild(container);

    interface DatedNode {
      readonly id: string;
      readonly title: string;
      readonly tags: readonly string[];
      readonly year: number;
    }

    const items: readonly DatedNode[] = [
      { id: 'early-1', title: 'Early A', tags: ['alpha', 'beta'], year: 2020 },
      { id: 'early-2', title: 'Early B', tags: ['alpha'], year: 2020 },
      { id: 'late-1', title: 'Late C', tags: ['gamma', 'delta'], year: 2023 },
      { id: 'late-2', title: 'Late D', tags: ['gamma'], year: 2023 },
      { id: 'late-3', title: 'Late E', tags: ['delta', 'beta'], year: 2023 },
      { id: 'late-4', title: 'Late F', tags: ['delta'], year: 2023 },
    ];

    const controller = createSimplexSvg<DatedNode>(container, {
      items,
      preset: 'geometric',
      layoutOptions: { seed: 31 },
      timeline: {
        getTimestamp: (item) => item.year,
        autoFinalSeed: true,
        autoFinalSeedLayout: 'pinned',
        emptyClusterBehavior: 'dim',
      },
    });
    for (let i = 0; i < 45; i++) controller.stepForTest(20);

    expect(controller.getLayoutStrategy().name).toMatch(/^final-seeded\(/);
    expect(controller.getEmptyClusterBehavior()).toBe('dim');

    const parseTranslate = (el: Element) => {
      const m = el
        .getAttribute('transform')
        ?.match(/translate\(\s*([0-9.-]+)[,\s]+([0-9.-]+)/);
      return m ? { x: parseFloat(m[1]!), y: parseFloat(m[2]!) } : null;
    };

    const svg = controller.getSvgElement();
    const earlyFinalEl = svg.querySelector('g.sv-node-item[data-node-id="early-1"]')!;
    const earlyFinalPos = parseTranslate(earlyFinalEl)!;
    expect(earlyFinalPos).not.toBeNull();

    // Seek to step 0 (year 2020): early-1 must stay pinned at its exact final coordinates
    controller.timeline!.seek(0);
    for (let i = 0; i < 45; i++) controller.stepForTest(20);

    const earlyStep0Pos = parseTranslate(
      svg.querySelector('g.sv-node-item[data-node-id="early-1"]')!,
    )!;
    expect(earlyStep0Pos.x).toBeCloseTo(earlyFinalPos.x, 1);
    expect(earlyStep0Pos.y).toBeCloseTo(earlyFinalPos.y, 1);

    // Future empty clusters must render dimmed (opacity ~ 0.34) while populated clusters remain full opacity (1.0)
    const emptyUids = new Set(
      controller
        .getClusters()
        .filter((c) => c.members.length === 0)
        .map((c) => c.clusterUid),
    );
    expect(emptyUids.size).toBeGreaterThan(0);

    for (const cEl of svg.querySelectorAll('g.sv-node-cluster')) {
      const uid = cEl.getAttribute('data-node-id') ?? '';
      const opacity = Number(cEl.getAttribute('opacity'));
      if (emptyUids.has(uid)) {
        expect(opacity).toBeLessThan(0.45);
      } else {
        expect(opacity).toBeGreaterThan(0.95);
      }
    }

    // Switch to 'hide' at runtime: empty clusters fade to 0 opacity & become pass-through
    controller.setEmptyClusterBehavior('hide');
    for (let i = 0; i < 45; i++) controller.stepForTest(20);
    for (const cEl of svg.querySelectorAll('g.sv-node-cluster')) {
      const uid = cEl.getAttribute('data-node-id') ?? '';
      const opacity = Number(cEl.getAttribute('opacity'));
      if (emptyUids.has(uid)) {
        expect(opacity).toBeLessThan(0.05);
        expect(cEl.getAttribute('data-pass-through')).toBe('true');
      } else {
        expect(opacity).toBeGreaterThan(0.95);
      }
    }

    // Disabling timeline unwraps autoFinalSeedLayout and restores full corpus
    controller.setTimelineOptions(false);
    expect(controller.getLayoutStrategy().name).not.toMatch(/^final-seeded\(/);
    expect(controller.getItems().length).toBe(items.length);

    controller.destroy();
    container.remove();
  });

  it('cleanly re-initializes hulls and layout on first non-zero ResizeObserver entry when mounted at 0x0 (Issue #12)', () => {
    const items: DefaultTaggedItem[] = Array.from({ length: 14 }, (_, i) => ({
      id: `hidden-${i}`,
      tags: [`t-${i % 4}`, `t-${(i + 1) % 4}`],
    }));

    type RoCallback = (entries: ResizeObserverEntry[]) => void;
    const observers: Array<{ target: Element; cb: RoCallback }> = [];
    const OriginalResizeObserver = globalThis.ResizeObserver;
    class MockResizeObserver {
      private readonly cb: RoCallback;
      constructor(cb: RoCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        observers.push({ target, cb: this.cb });
      }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    const triggerResize = (target: Element, width: number, height: number) => {
      for (const rec of observers) {
        if (rec.target === target) {
          rec.cb([
            {
              target,
              contentRect: {
                x: 0,
                y: 0,
                width,
                height,
                top: 0,
                left: 0,
                right: width,
                bottom: height,
                toJSON: () => ({}),
              },
            } as ResizeObserverEntry,
          ]);
        }
      }
    };

    const parseItemTransforms = (svg: SVGSVGElement): Map<string, string> => {
      const map = new Map<string, string>();
      for (const el of svg.querySelectorAll('g.sv-node-item')) {
        const id = el.getAttribute('data-node-id');
        const tf = el.getAttribute('transform');
        if (id && tf) map.set(id, tf);
      }
      return map;
    };

    const visibleContainer = document.createElement('div');
    Object.defineProperty(visibleContainer, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 720, height: 480, right: 720, bottom: 480 }),
    });
    document.body.appendChild(visibleContainer);

    const hiddenContainer = document.createElement('div');
    Object.defineProperty(hiddenContainer, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    });
    document.body.appendChild(hiddenContainer);

    const exactFallbackContainer = document.createElement('div');
    Object.defineProperty(exactFallbackContainer, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    });
    document.body.appendChild(exactFallbackContainer);

    try {
      // 1) Reference controller mounted directly in a visible 720x480 container
      const visibleCtrl = createSimplexSvg(visibleContainer, {
        items,
        preset: 'badges',
        layoutOptions: { seed: 42 },
      });

      // 2) Hidden container mounted at 0x0 -> revealed at 720x480
      const hiddenCtrl = createSimplexSvg(hiddenContainer, {
        items,
        preset: 'badges',
        layoutOptions: { seed: 42 },
      });
      // Backwards-compatible synchronous fallback still populates clusters at 960x620
      expect(hiddenCtrl.getClusters().length).toBeGreaterThanOrEqual(3);

      // Reveal container at 720x480: must settle immediately with zero spring flight and match visible mount
      triggerResize(hiddenContainer, 720, 480);

      expect(hiddenCtrl.getMetrics().isSettled).toBe(true);
      expect(hiddenCtrl.getMetrics().overlapCount).toBe(0);
      expect(hiddenCtrl.getMetrics().meshSideLength).toBeCloseTo(
        visibleCtrl.getMetrics().meshSideLength,
        4,
      );
      expect(hiddenCtrl.getClusters().map((c) => c.clusterUid)).toEqual(
        visibleCtrl.getClusters().map((c) => c.clusterUid),
      );
      expect(parseItemTransforms(hiddenCtrl.getSvgElement())).toEqual(
        parseItemTransforms(visibleCtrl.getSvgElement()),
      );

      // 3) Custom BBox-measured view (without analytic measureConvexHull): even when the real
      // container size happens to equal fallback 960x620, first resize invalidates cached hulls
      // and re-runs offscreen __measure__ probes!
      let measureProbeCalls = 0;
      const bboxClusterView = {
        mountOrUpdate: (
          g: SVGGElement,
          _visual: unknown,
          state: { readonly id: string },
        ) => {
          if (state.id === '__measure__') {
            measureProbeCalls += 1;
          }
          const rect = g.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', '-48');
          rect.setAttribute('y', '-18');
          rect.setAttribute('width', '96');
          rect.setAttribute('height', '36');
          g.replaceChildren(rect);
        },
      };
      const exactCtrl = createSimplexSvg(exactFallbackContainer, {
        items,
        clusterView: bboxClusterView,
        layoutOptions: { seed: 42 },
      });
      expect(measureProbeCalls).toBeGreaterThan(0);

      const probesBeforeReveal = measureProbeCalls;
      triggerResize(exactFallbackContainer, 960, 620);
      expect(measureProbeCalls).toBeGreaterThan(probesBeforeReveal);
      expect(exactCtrl.getMetrics().isSettled).toBe(true);
      expect(exactCtrl.getMetrics().overlapCount).toBe(0);

      visibleCtrl.destroy();
      hiddenCtrl.destroy();
      exactCtrl.destroy();
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
      visibleContainer.remove();
      hiddenContainer.remove();
      exactFallbackContainer.remove();
    }
  });

  it('defers initial clustering and layout until first non-zero ResizeObserver entry or fallbackTimeoutMs when deferInitialLayout is enabled (Issue #12)', async () => {
    const items: DefaultTaggedItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: `defer-${i}`,
      tags: [`k-${i % 4}`, `k-${(i + 1) % 4}`],
    }));

    type RoCallback = (entries: ResizeObserverEntry[]) => void;
    const observers: Array<{ target: Element; cb: RoCallback }> = [];
    const OriginalResizeObserver = globalThis.ResizeObserver;
    class MockResizeObserver {
      private readonly cb: RoCallback;
      constructor(cb: RoCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        observers.push({ target, cb: this.cb });
      }
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    const triggerResize = (target: Element, width: number, height: number) => {
      for (const rec of observers) {
        if (rec.target === target) {
          rec.cb([
            {
              target,
              contentRect: {
                x: 0,
                y: 0,
                width,
                height,
                top: 0,
                left: 0,
                right: width,
                bottom: height,
                toJSON: () => ({}),
              },
            } as ResizeObserverEntry,
          ]);
        }
      }
    };

    const hiddenContainer = document.createElement('div');
    Object.defineProperty(hiddenContainer, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    });
    document.body.appendChild(hiddenContainer);

    const timeoutContainer = document.createElement('div');
    Object.defineProperty(timeoutContainer, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    });
    document.body.appendChild(timeoutContainer);

    const destroyedContainer = document.createElement('div');
    Object.defineProperty(destroyedContainer, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    });
    document.body.appendChild(destroyedContainer);

    try {
      // 1) deferInitialLayout: true skips solve completely until first non-zero ResizeObserver
      let metricsCalls = 0;
      const deferredCtrl = createSimplexSvg(hiddenContainer, {
        items: items.slice(0, 8),
        deferInitialLayout: true,
        layoutOptions: { seed: 77 },
        onMetricsChange: () => {
          metricsCalls += 1;
        },
      });

      expect(metricsCalls).toBe(0);
      expect(deferredCtrl.getClusters().length).toBe(0);
      expect(deferredCtrl.getMetrics().meshSideLength).toBe(0);
      expect(deferredCtrl.getSvgElement().querySelectorAll('g.sv-node-item').length).toBe(0);

      // Mutations before container becomes visible stay deferred
      deferredCtrl.setItems(items);
      expect(metricsCalls).toBe(0);
      expect(deferredCtrl.getClusters().length).toBe(0);

      // Zero/tiny ResizeObserver entries are ignored
      triggerResize(hiddenContainer, 0, 0);
      triggerResize(hiddenContainer, 24, 24);
      expect(metricsCalls).toBe(0);

      // First real ResizeObserver entry solves cleanly with all updated items
      triggerResize(hiddenContainer, 720, 480);
      expect(metricsCalls).toBe(1);
      expect(deferredCtrl.getMetrics().isSettled).toBe(true);
      expect(deferredCtrl.getMetrics().itemCount).toBe(items.length);
      expect(deferredCtrl.getMetrics().overlapCount).toBe(0);
      expect(deferredCtrl.getSvgElement().querySelectorAll('g.sv-node-item').length).toBe(
        items.length,
      );

      // 2) deferInitialLayout: { fallbackTimeoutMs } initializes after timeout, and still cleanly re-initializes on subsequent real resize
      const timeoutCtrl = createSimplexSvg(timeoutContainer, {
        items,
        deferInitialLayout: { fallbackTimeoutMs: 25 },
        layoutOptions: { seed: 77 },
      });
      expect(timeoutCtrl.getClusters().length).toBe(0);

      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(timeoutCtrl.getClusters().length).toBeGreaterThanOrEqual(3);
      expect(timeoutCtrl.getMetrics().isSettled).toBe(true);

      // Subsequent real ResizeObserver size still triggers clean initial re-solve
      triggerResize(timeoutContainer, 640, 420);
      expect(timeoutCtrl.getMetrics().isSettled).toBe(true);
      expect(timeoutCtrl.getMetrics().overlapCount).toBe(0);

      // 3) destroy() before fallbackTimeoutMs cancels the timer cleanly
      let destroyedMetricsCalls = 0;
      const destroyedCtrl = createSimplexSvg(destroyedContainer, {
        items,
        deferInitialLayout: { fallbackTimeoutMs: 25 },
        onMetricsChange: () => {
          destroyedMetricsCalls += 1;
        },
      });
      destroyedCtrl.destroy();
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(destroyedMetricsCalls).toBe(0);

      deferredCtrl.destroy();
      timeoutCtrl.destroy();
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
      hiddenContainer.remove();
      timeoutContainer.remove();
      destroyedContainer.remove();
    }
  });

  it('enforces touch scroll direction-locking (touchScrollLockPx) and peak displacement click tolerance (clickTolerancePx) across free-camera and drill-down modes (Issue #13)', () => {
    const items: DefaultTaggedItem[] = Array.from({ length: 18 }, (_, i) => ({
      id: `touch-${i}`,
      tags: ['alpha', 'beta', 'gamma', `sub-${i % 3}`],
    }));

    const makeTouchEvent = (
      type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
      points: Array<{ identifier: number; clientX: number; clientY: number }>,
    ): TouchEvent => {
      const ev = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
      Object.defineProperty(ev, 'touches', { value: points });
      return ev;
    };

    // 1) Free-camera mode with default touchScrollLockPx (8) and clickTolerancePx (12)
    const freeContainer = document.createElement('div');
    Object.defineProperty(freeContainer, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 720, height: 480, right: 720, bottom: 480 }),
    });
    document.body.appendChild(freeContainer);

    const freeClicks: string[] = [];
    const freeCtrl = createSimplexSvg(freeContainer, {
      items,
      layoutOptions: { seed: 42 },
      interactions: {
        onLeftClick: (t) => {
          freeClicks.push(t.kind);
        },
      },
    });
    const freeSvg = freeCtrl.getSvgElement();
    Object.defineProperty(freeSvg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 720, height: 480, right: 720, bottom: 480 }),
    });

    // Default sets touch-action: pan-y so vertical page scrolling is never trapped
    expect(freeSvg.style.touchAction).toBe('pan-y');

    // Vertical single-finger touch swipe (>= 8px, |dy| > |dx|): yields to native scroll (NOT preventDefault), does NOT pan, suppresses trailing click
    freeSvg.dispatchEvent(makeTouchEvent('touchstart', [{ identifier: 1, clientX: 20, clientY: 20 }]));
    freeSvg.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 20,
        clientY: 20,
        bubbles: true,
      }),
    );
    const vMove = makeTouchEvent('touchmove', [{ identifier: 1, clientX: 22, clientY: 31 }]); // |dx|=2, |dy|=11 (>= 8)
    freeSvg.dispatchEvent(vMove);
    freeSvg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 22,
        clientY: 31,
        bubbles: true,
      }),
    );
    freeSvg.dispatchEvent(makeTouchEvent('touchend', []));
    freeSvg.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 22,
        clientY: 31,
        bubbles: true,
      }),
    );
    freeSvg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: 22, clientY: 31, bubbles: true }),
    );
    expect(vMove.defaultPrevented).toBe(false);
    expect(freeCtrl.camera.getState().panX).toBe(0);
    expect(freeCtrl.camera.getState().panY).toBe(0);
    expect(freeClicks.length).toBe(0);

    // Horizontal single-finger touch swipe (>= 8px, |dx| >= |dy|): locks on canvas (preventDefault), pans camera, suppresses click
    freeSvg.dispatchEvent(makeTouchEvent('touchstart', [{ identifier: 2, clientX: 20, clientY: 20 }]));
    freeSvg.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 20,
        clientY: 20,
        bubbles: true,
      }),
    );
    const hMove = makeTouchEvent('touchmove', [{ identifier: 2, clientX: 44, clientY: 22 }]); // |dx|=24 >= 8
    freeSvg.dispatchEvent(hMove);
    freeSvg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 44,
        clientY: 22,
        bubbles: true,
      }),
    );
    freeSvg.dispatchEvent(makeTouchEvent('touchend', []));
    freeSvg.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 2,
        pointerType: 'touch',
        clientX: 44,
        clientY: 22,
        bubbles: true,
      }),
    );
    freeSvg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: 44, clientY: 22, bubbles: true }),
    );
    expect(hMove.defaultPrevented).toBe(true);
    expect(freeCtrl.camera.getState().panX).toBeCloseTo(24, 1);
    expect(freeClicks.length).toBe(0);

    // Two-finger pinch touchmove is always preventDefault-locked
    freeSvg.dispatchEvent(
      makeTouchEvent('touchstart', [
        { identifier: 3, clientX: 200, clientY: 200 },
        { identifier: 4, clientX: 300, clientY: 200 },
      ]),
    );
    const pinchMove = makeTouchEvent('touchmove', [
      { identifier: 3, clientX: 180, clientY: 200 },
      { identifier: 4, clientX: 320, clientY: 200 },
    ]);
    freeSvg.dispatchEvent(pinchMove);
    freeSvg.dispatchEvent(makeTouchEvent('touchend', []));
    expect(pinchMove.defaultPrevented).toBe(true);

    // Explicit opt-out: touchScrollLockPx = 0 restores touch-action: none and allows vertical 1-finger touch pan
    freeCtrl.setTouchScrollLockPx(0);
    expect(freeSvg.style.touchAction).toBe('none');
    const panYBefore = freeCtrl.camera.getState().panY;
    freeSvg.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 5,
        pointerType: 'touch',
        clientX: 20,
        clientY: 20,
        bubbles: true,
      }),
    );
    freeSvg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 5,
        pointerType: 'touch',
        clientX: 20,
        clientY: 50,
        bubbles: true,
      }),
    );
    freeSvg.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 5,
        pointerType: 'touch',
        clientX: 20,
        clientY: 50,
        bubbles: true,
      }),
    );
    expect(freeCtrl.camera.getState().panY).toBeCloseTo(panYBefore + 30, 1);

    // 2) Drill-down mode: peak displacement clickTolerancePx suppresses accidental drill-down on drag (even if returning near origin!)
    const drillContainer = document.createElement('div');
    Object.defineProperty(drillContainer, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 720, height: 480, right: 720, bottom: 480 }),
    });
    document.body.appendChild(drillContainer);

    const drillClicks: string[] = [];
    const drillCtrl = createSimplexSvg(drillContainer, {
      items,
      zoomStrategy: createBarycentricZoomStrategy({ stopWhenFullScale: false }),
      layoutOptions: { seed: 42 },
      interactions: {
        onLeftClick: (t) => {
          drillClicks.push(t.kind);
        },
      },
    });
    const drillSvg = drillCtrl.getSvgElement();
    Object.defineProperty(drillSvg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 720, height: 480, right: 720, bottom: 480 }),
    });

    const drillTriIdx = drillCtrl.getZoomState().drillableTriangleIndices[0]!;
    const triPoly = drillSvg.querySelector(
      `g.sv-mesh-triangle[data-triangle-index="${drillTriIdx}"] polygon`,
    )!;
    const pts = triPoly
      .getAttribute('points')!
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x: x!, y: y! };
      });
    const cx = (pts[0]!.x + pts[1]!.x + pts[2]!.x) / 3;
    const cy = (pts[0]!.y + pts[1]!.y + pts[2]!.y) / 3;

    // Drag 20px away (> 12px default) and return to 2px away -> peak displacement suppresses click & drill-down!
    drillSvg.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 10,
        pointerType: 'mouse',
        button: 0,
        clientX: cx,
        clientY: cy,
        bubbles: true,
      }),
    );
    drillSvg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 10,
        pointerType: 'mouse',
        clientX: cx + 20,
        clientY: cy,
        bubbles: true,
      }),
    );
    drillSvg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 10,
        pointerType: 'mouse',
        clientX: cx + 2,
        clientY: cy,
        bubbles: true,
      }),
    );
    drillSvg.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 10,
        pointerType: 'mouse',
        button: 0,
        clientX: cx + 2,
        clientY: cy,
        bubbles: true,
      }),
    );
    drillSvg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: cx + 2, clientY: cy, bubbles: true }),
    );
    expect(drillClicks.length).toBe(0);
    expect(drillCtrl.getZoomState().depth).toBe(0);

    // Tighter custom clickTolerancePx (5px): a 7px drag suppresses click
    drillCtrl.setClickTolerancePx(5);
    drillSvg.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 11,
        pointerType: 'mouse',
        button: 0,
        clientX: cx,
        clientY: cy,
        bubbles: true,
      }),
    );
    drillSvg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 11,
        pointerType: 'mouse',
        clientX: cx + 7,
        clientY: cy,
        bubbles: true,
      }),
    );
    drillSvg.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 11,
        pointerType: 'mouse',
        button: 0,
        clientX: cx + 7,
        clientY: cy,
        bubbles: true,
      }),
    );
    drillSvg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: cx + 7, clientY: cy, bubbles: true }),
    );
    expect(drillClicks.length).toBe(0);
    expect(drillCtrl.getZoomState().depth).toBe(0);

    // Tap with 4px jitter (<= 5px tolerance) succeeds and drills down!
    drillSvg.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 12,
        pointerType: 'mouse',
        button: 0,
        clientX: cx,
        clientY: cy,
        bubbles: true,
      }),
    );
    drillSvg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 12,
        pointerType: 'mouse',
        clientX: cx + 4,
        clientY: cy,
        bubbles: true,
      }),
    );
    drillSvg.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 12,
        pointerType: 'mouse',
        button: 0,
        clientX: cx + 4,
        clientY: cy,
        bubbles: true,
      }),
    );
    drillSvg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: cx + 4, clientY: cy, bubbles: true }),
    );
    for (let i = 0; i < 45; i++) drillCtrl.stepForTest(20);
    expect(drillClicks.length).toBe(1);
    expect(drillCtrl.getZoomState().depth).toBe(1);

    freeCtrl.destroy();
    drillCtrl.destroy();
    freeContainer.remove();
    drillContainer.remove();
  });

  it('supports lightweight hover, dimming, and stroke styling hooks via GeometricShapeSvgView shapeOptions (Issue #14)', () => {
    // 1) Direct GeometricShapeSvgView unit assertions
    const styledView = new GeometricShapeSvgView({
      hoverScale: 1.42,
      hoverRingColor: '#ff00aa',
      dimmedOpacity: 0.16,
      strokeColor: '#112233',
      strokeWidth: 3.2,
    });
    expect(styledView.hoverScale).toBe(1.42);
    expect(styledView.dimmedOpacity).toBe(0.16);

    const visual = {
      shape: 'circle' as const,
      radius: 10,
      fillHex: '#38bdf8',
      strokeHex: '#ffffff',
      strokeWidth: 1.4,
      theme: 'dark' as const,
    };
    const hull = styledView.measureConvexHull(visual);
    expect(hull.kind).toBe('circle');
    if (hull.kind === 'circle') {
      expect(hull.radius).toBeCloseTo(13.2, 5);
    }

    const baseState = {
      id: 'n1',
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      visual,
      hull,
      cacheKey: 'k1',
      interaction: {
        isHovered: false,
        isFocused: false,
        isHighlighted: false,
        isPinned: false,
        isDimmed: false,
      },
    };
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    styledView.mountOrUpdate(g, visual, baseState);
    const shapePath = g.querySelector('path.sv-geom-shape')!;
    const ringPath = g.querySelector('path.sv-geom-ring')!;
    expect(shapePath.getAttribute('stroke')).toBe('#112233');
    expect(shapePath.getAttribute('stroke-width')).toBe('3.2');
    expect(ringPath.getAttribute('d')).toBe('');

    // Hover state preserves wider strokeWidth (>= 2.2) and applies custom hoverRingColor
    styledView.mountOrUpdate(g, visual, {
      ...baseState,
      interaction: { ...baseState.interaction, isHovered: true },
    });
    expect(shapePath.getAttribute('stroke-width')).toBe('3.2');
    expect(ringPath.getAttribute('stroke')).toBe('#ff00aa');
    expect((ringPath.getAttribute('d') ?? '').length).toBeGreaterThan(0);

    // Morph also preserves custom strokeColor & strokeWidth
    styledView.morph(g, visual, visual, 0.5, baseState);
    expect(shapePath.getAttribute('stroke')).toBe('#112233');
    expect(shapePath.getAttribute('stroke-width')).toBe('3.2');

    // 2) End-to-end via createSimplexSvg with shapeOptions + hover + focus dimming + runtime update
    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 760, height: 500, right: 760, bottom: 500 }),
    });
    document.body.appendChild(container);

    const items: DefaultTaggedItem[] = [
      { id: 'a1', tags: ['alpha', 'beta'] },
      { id: 'a2', tags: ['alpha', 'beta'] },
      { id: 'b1', tags: ['beta', 'gamma'] },
      { id: 'b2', tags: ['gamma', 'delta'] },
      { id: 'd1', tags: ['delta', 'epsilon'] },
      { id: 'e1', tags: ['epsilon', 'zeta'] },
      { id: 'z1', tags: ['zeta', 'alpha'] },
    ];

    const controller = createSimplexSvg(container, {
      items,
      preset: 'geometric',
      shapeOptions: {
        hoverScale: 1.42,
        hoverRingColor: '#ff00aa',
        dimmedOpacity: 0.16,
        strokeColor: '#112233',
        strokeWidth: 2.5,
      },
      layoutOptions: { seed: 42 },
    });
    for (let i = 0; i < 40; i++) controller.stepForTest(20);

    expect(controller.getMetrics().overlapCount).toBe(0);
    const svg = controller.getSvgElement();
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 760, height: 500, right: 760, bottom: 500 }),
    });

    const parseTransform = (el: Element): { x: number; y: number; scale: number } => {
      const t = el.getAttribute('transform') ?? '';
      const m = /translate\(([-\d.]+),\s*([-\d.]+)\)\s*scale\(([-\d.]+)\)/.exec(t);
      expect(m).not.toBeNull();
      return {
        x: parseFloat(m![1]!),
        y: parseFloat(m![2]!),
        scale: parseFloat(m![3]!),
      };
    };

    const firstItemGroup = svg.querySelector('g.sv-node-item')!;
    const firstItemShape = firstItemGroup.querySelector('path.sv-geom-shape')!;
    expect(firstItemShape.getAttribute('stroke')).toBe('#112233');
    expect(firstItemShape.getAttribute('stroke-width')).toBe('2.5');

    const restPos = parseTransform(firstItemGroup);

    // Hover the item: scale is multiplied by hoverScale (1.42x) and hoverRingColor is applied
    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: restPos.x,
        clientY: restPos.y,
        bubbles: true,
      }),
    );
    controller.stepForTest(16);

    const hoveredPos = parseTransform(firstItemGroup);
    expect(hoveredPos.scale / restPos.scale).toBeCloseTo(1.42, 2);
    expect(firstItemGroup.querySelector('path.sv-geom-ring')?.getAttribute('stroke')).toBe(
      '#ff00aa',
    );

    // Move pointer away to clear hover
    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 4,
        clientY: 4,
        bubbles: true,
      }),
    );
    controller.stepForTest(16);
    expect(parseTransform(firstItemGroup).scale).toBeCloseTo(restPos.scale, 3);

    // Highlight one item so all other items become dimmed with exact dimmedOpacity (no double-dimming!)
    controller.setHighlightedIds(['a1']);
    controller.stepForTest(16);

    let sawDimmed = false;
    let sawHighlighted = false;
    for (const gEl of svg.querySelectorAll('g.sv-node-item')) {
      const id = gEl.getAttribute('data-node-id')!;
      const op = parseFloat(gEl.getAttribute('opacity') ?? '1');
      if (id === 'a1') {
        sawHighlighted = true;
        expect(op).toBeCloseTo(1, 2);
      } else {
        sawDimmed = true;
        expect(op).toBeCloseTo(0.16, 2);
      }
    }
    expect(sawDimmed).toBe(true);
    expect(sawHighlighted).toBe(true);

    // Runtime update via setShapeOptions updates strokeColor, strokeWidth, and dimmedOpacity immediately
    controller.setShapeOptions({
      strokeColor: '#44aa88',
      strokeWidth: 1.8,
      dimmedOpacity: 0.25,
    });
    for (let i = 0; i < 10; i++) controller.stepForTest(16);

    const updatedItemShape = svg.querySelector('g.sv-node-item path.sv-geom-shape')!;
    expect(updatedItemShape.getAttribute('stroke')).toBe('#44aa88');
    expect(updatedItemShape.getAttribute('stroke-width')).toBe('1.8');
    for (const gEl of svg.querySelectorAll('g.sv-node-item')) {
      const id = gEl.getAttribute('data-node-id')!;
      if (id !== 'a1') {
        expect(parseFloat(gEl.getAttribute('opacity') ?? '1')).toBeCloseTo(0.25, 2);
      }
    }

    controller.destroy();
    container.remove();
  });

  it('supports first-class setItemFilter with dim/hide modes, zero layout re-solve, hitTest exclusion, hover cleanup, and timeline compatibility (Issue #15)', () => {
    interface TypedDoc {
      readonly id: string;
      readonly kind: 'post' | 'note' | 'paper';
      readonly title: string;
      readonly tags: readonly string[];
      readonly year: number;
    }

    const items: readonly TypedDoc[] = [
      { id: 'p1', kind: 'post', title: 'Alpha Post', tags: ['alpha', 'beta'], year: 2021 },
      { id: 'p2', kind: 'post', title: 'Beta Post', tags: ['beta', 'gamma'], year: 2021 },
      { id: 'n1', kind: 'note', title: 'Alpha Note', tags: ['alpha'], year: 2022 },
      { id: 'n2', kind: 'note', title: 'Gamma Note', tags: ['gamma', 'delta'], year: 2022 },
      { id: 'r1', kind: 'paper', title: 'Delta Paper', tags: ['delta', 'alpha'], year: 2023 },
      { id: 'r2', kind: 'paper', title: 'Gamma Paper', tags: ['gamma'], year: 2023 },
    ];

    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 760, height: 500, right: 760, bottom: 500 }),
    });
    document.body.appendChild(container);

    let metricsCalls = 0;
    const hoveredIds: Array<string | null> = [];
    const clickedIds: string[] = [];

    const controller = createSimplexSvg<TypedDoc>(container, {
      items,
      preset: 'geometric',
      shapeOptions: { dimmedOpacity: 0.22 },
      layoutOptions: { seed: 42 },
      interactions: {
        onContentHover: (ev) => {
          hoveredIds.push(ev ? ev.item.id : null);
        },
        onContentClick: (ev) => {
          clickedIds.push(ev.item.id);
        },
      },
      onMetricsChange: () => {
        metricsCalls += 1;
      },
    });
    for (let i = 0; i < 30; i++) controller.stepForTest(20);

    const svg = controller.getSvgElement();
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 760, height: 500, right: 760, bottom: 500 }),
    });

    const snapshotTransforms = (): Map<string, string> => {
      const map = new Map<string, string>();
      for (const el of svg.querySelectorAll('g.sv-node-item, g.sv-node-cluster')) {
        const id = el.getAttribute('data-node-id');
        const tf = el.getAttribute('transform');
        if (id && tf) map.set(id, tf);
      }
      return map;
    };

    const parseTranslate = (el: Element): { x: number; y: number } => {
      const m = el
        .getAttribute('transform')
        ?.match(/translate\(\s*([0-9.-]+)[,\s]+([0-9.-]+)/);
      return { x: parseFloat(m![1]!), y: parseFloat(m![2]!) };
    };

    const baselineTransforms = snapshotTransforms();
    const baselineMetricsCalls = metricsCalls;
    const baselineClusters = controller.getClusters().map((c) => c.clusterUid);

    expect(controller.getItemFilter()).toEqual({ predicate: null, mode: 'dim' });

    // 1) Default mode: 'dim' — freezes all positions & clusters, dims non-matching items to shapeOptions.dimmedOpacity
    controller.setItemFilter((item) => item.kind === 'post');
    expect(controller.getItemFilter().mode).toBe('dim');
    expect(metricsCalls).toBe(baselineMetricsCalls);
    expect(controller.getClusters().map((c) => c.clusterUid)).toEqual(baselineClusters);
    expect(snapshotTransforms()).toEqual(baselineTransforms);

    for (const el of svg.querySelectorAll('g.sv-node-item')) {
      const id = el.getAttribute('data-node-id')!;
      const op = parseFloat(el.getAttribute('opacity') ?? '1');
      if (id === 'p1' || id === 'p2') {
        expect(op).toBeCloseTo(1, 2);
        expect(el.getAttribute('data-filtered-out')).toBeNull();
        expect(el.getAttribute('pointer-events')).toBeNull();
      } else {
        expect(op).toBeCloseTo(0.22, 2);
        expect(el.getAttribute('data-filtered-out')).toBe('true');
        expect(el.getAttribute('pointer-events')).toBeNull();
      }
    }

    // Hover a dimmed non-matching item ('n1') — hover still works in 'dim' mode
    const n1El = svg.querySelector('g.sv-node-item[data-node-id="n1"]')!;
    const n1Pos = parseTranslate(n1El);
    svg.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: n1Pos.x,
        clientY: n1Pos.y,
        bubbles: true,
      }),
    );
    controller.stepForTest(16);
    expect(hoveredIds.at(-1)).toBe('n1');

    // 2) Switch to mode: 'hide' — clears active hover on newly hidden item, sets opacity 0 & pointer-events none, skips hitTest, ZERO layout re-solve
    controller.setItemFilter((item) => item.kind === 'post', { mode: 'hide' });
    expect(controller.getItemFilter().mode).toBe('hide');
    expect(metricsCalls).toBe(baselineMetricsCalls);
    expect(hoveredIds.at(-1)).toBeNull();
    expect(snapshotTransforms()).toEqual(baselineTransforms);

    for (const el of svg.querySelectorAll('g.sv-node-item')) {
      const id = el.getAttribute('data-node-id')!;
      const op = parseFloat(el.getAttribute('opacity') ?? '1');
      if (id === 'p1' || id === 'p2') {
        expect(op).toBeCloseTo(1, 2);
        expect(el.getAttribute('data-filtered-out')).toBeNull();
        expect(el.getAttribute('pointer-events')).toBeNull();
      } else {
        expect(op).toBeCloseTo(0, 3);
        expect(el.getAttribute('data-filtered-out')).toBe('true');
        expect(el.getAttribute('pointer-events')).toBe('none');
      }
    }

    // Clicking coordinates of hidden item 'n1' must NOT fire onContentClick for 'n1'
    svg.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 2,
        pointerType: 'mouse',
        button: 0,
        clientX: n1Pos.x,
        clientY: n1Pos.y,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 2,
        pointerType: 'mouse',
        button: 0,
        clientX: n1Pos.x,
        clientY: n1Pos.y,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: n1Pos.x, clientY: n1Pos.y, bubbles: true }),
    );
    expect(clickedIds).not.toContain('n1');

    // Clicking a visible matching item ('p1') still works normally
    const p1Pos = parseTranslate(svg.querySelector('g.sv-node-item[data-node-id="p1"]')!);
    svg.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 3,
        pointerType: 'mouse',
        button: 0,
        clientX: p1Pos.x,
        clientY: p1Pos.y,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 3,
        pointerType: 'mouse',
        button: 0,
        clientX: p1Pos.x,
        clientY: p1Pos.y,
        bubbles: true,
      }),
    );
    svg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: p1Pos.x, clientY: p1Pos.y, bubbles: true }),
    );
    expect(clickedIds).toContain('p1');

    // 3) Clearing filter with null restores all items immediately with zero layout re-solve
    controller.setItemFilter(null);
    expect(metricsCalls).toBe(baselineMetricsCalls);
    expect(snapshotTransforms()).toEqual(baselineTransforms);
    for (const el of svg.querySelectorAll('g.sv-node-item')) {
      expect(parseFloat(el.getAttribute('opacity') ?? '0')).toBeCloseTo(1, 2);
      expect(el.getAttribute('data-filtered-out')).toBeNull();
      expect(el.getAttribute('pointer-events')).toBeNull();
    }

    // 4) Initial itemFilter + timeline stepping: newly entering items are evaluated against active filter immediately
    const tlContainer = document.createElement('div');
    Object.defineProperty(tlContainer, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 760, height: 500, right: 760, bottom: 500 }),
    });
    document.body.appendChild(tlContainer);

    const tlCtrl = createSimplexSvg<TypedDoc>(tlContainer, {
      items,
      layoutOptions: { seed: 42 },
      itemFilter: (item) => item.kind !== 'note',
      itemFilterMode: 'hide',
      timeline: {
        getTimestamp: (item) => item.year,
        initialStep: 0,
      },
    });
    for (let i = 0; i < 30; i++) tlCtrl.stepForTest(20);
    // Step 1 adds year 2022 ('n1', 'n2' — both kind: 'note') -> must stay hidden immediately
    tlCtrl.timeline!.seek(1);
    for (let i = 0; i < 30; i++) tlCtrl.stepForTest(20);
    const tlSvg = tlCtrl.getSvgElement();
    const n1Tl = tlSvg.querySelector('g.sv-node-item[data-node-id="n1"]')!;
    expect(parseFloat(n1Tl.getAttribute('opacity') ?? '1')).toBeCloseTo(0, 3);
    expect(n1Tl.getAttribute('pointer-events')).toBe('none');

    // Step 2 adds year 2023 ('r1', 'r2' — kind: 'paper') -> visible!
    tlCtrl.timeline!.seek(2);
    for (let i = 0; i < 30; i++) tlCtrl.stepForTest(20);
    const r1Tl = tlSvg.querySelector('g.sv-node-item[data-node-id="r1"]')!;
    expect(parseFloat(r1Tl.getAttribute('opacity') ?? '0')).toBeGreaterThan(0.95);
    expect(r1Tl.getAttribute('pointer-events')).toBeNull();

    tlCtrl.destroy();
    tlContainer.remove();
    controller.destroy();
    container.remove();
  });

  it('batches simultaneous theme, preset, styling, filter, and strategy updates into a single solve & SVG render pass via controller.setOptions() and re-entrant controller.batch() (Issue #16)', () => {
    const items: readonly DefaultTaggedItem[] = [
      { id: 'b1', tags: ['alpha', 'beta'] },
      { id: 'b2', tags: ['beta', 'gamma'] },
      { id: 'b3', tags: ['gamma', 'delta'] },
      { id: 'b4', tags: ['alpha', 'delta'] },
      { id: 'b5', tags: ['alpha', 'gamma'] },
      { id: 'b6', tags: ['beta', 'delta'] },
    ];

    const container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 760, height: 500, right: 760, bottom: 500 }),
    });
    document.body.appendChild(container);

    let metricsCalls = 0;
    const renderSpy = vi.spyOn(SvgRendererAdapter.prototype, 'renderFrame');

    try {
      const controller = createSimplexSvg(container, {
        items,
        preset: 'geometric',
        theme: 'dark',
        layoutOptions: { seed: 42 },
        onMetricsChange: () => {
          metricsCalls += 1;
        },
      });
      for (let i = 0; i < 20; i++) controller.stepForTest(20);

      let colorCalls = 0;
      const baseColorStrat = createThemeAdaptiveOklabColorStrategy();
      const trackedColorStrat = {
        ...baseColorStrat,
        assignClusterColors: (
          ...args: Parameters<typeof baseColorStrat.assignClusterColors>
        ) => {
          colorCalls += 1;
          return baseColorStrat.assignClusterColors(...args);
        },
      };

      let layoutCalls = 0;
      const baseLayoutStrat = createLocalAdaptiveLayoutStrategy();
      const trackedLayoutStrat = {
        ...baseLayoutStrat,
        solve: (...args: Parameters<typeof baseLayoutStrat.solve>) => {
          layoutCalls += 1;
          return baseLayoutStrat.solve(...args);
        },
      };

      const metricsBefore = metricsCalls;
      renderSpy.mockClear();

      // 1) Atomic setOptions: theme + preset + badgeOptions + shapeOptions + colorStrategy + layoutStrategy + zoomStrategy + itemFilter
      controller.setOptions({
        theme: 'light',
        preset: 'badges',
        badgeOptions: { showCode: false, maxTitleChars: 20 },
        shapeOptions: {
          strokeColor: '#0f172a',
          strokeWidth: 2.2,
          dimmedOpacity: 0.2,
        },
        colorStrategy: trackedColorStrat,
        layoutStrategy: trackedLayoutStrat,
        zoomStrategy: createBarycentricZoomStrategy(),
        itemFilter: (item) => item.id !== 'b6',
        itemFilterMode: 'dim',
      });

      // Exactly 1 layout/metrics pass, 1 color pass, 1 SVG renderFrame pass!
      expect(metricsCalls - metricsBefore).toBe(1);
      expect(colorCalls).toBe(1);
      expect(layoutCalls).toBe(1);
      expect(renderSpy).toHaveBeenCalledTimes(1);

      const svg = controller.getSvgElement();
      expect(controller.getZoomStrategy().mode).toBe('drill-down');
      expect(controller.getLayoutStrategy()).toBe(trackedLayoutStrat);
      expect(controller.getColorStrategy()).toBe(trackedColorStrat);

      // Step crossfade to settle visual transition, then verify all visual updates took effect
      for (let i = 0; i < 25; i++) controller.stepForTest(20);
      const firstItemShape = svg.querySelector('g.sv-node-item path.sv-geom-shape')!;
      expect(firstItemShape.getAttribute('stroke')).toBe('#0f172a');
      expect(firstItemShape.getAttribute('stroke-width')).toBe('2.2');
      expect(svg.querySelectorAll('g.sv-node-cluster .sv-badge-code').length).toBe(0);
      const b6El = svg.querySelector('g.sv-node-item[data-node-id="b6"]')!;
      expect(parseFloat(b6El.getAttribute('opacity') ?? '1')).toBeCloseTo(0.2, 2);

      // 2) Re-entrant controller.batch() with nested batch & multiple sequential setters -> 1 solve, 1 render
      const metricsBeforeBatch = metricsCalls;
      renderSpy.mockClear();
      const paletteStrat = createPaletteColorStrategy(['#ef4444', '#3b82f6', '#10b981', '#f59e0b']);

      const result = controller.batch(() => {
        controller.setTheme('dark');
        controller.batch(() => {
          controller.setShapeOptions({
            strokeColor: '#e2e8f0',
            strokeWidth: 1.6,
            dimmedOpacity: 0.3,
          });
          controller.setColorStrategy(paletteStrat);
          controller.setItemFilter(null);
        });
        return 'ok';
      });

      expect(result).toBe('ok');
      expect(metricsCalls - metricsBeforeBatch).toBe(1);
      expect(renderSpy).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 25; i++) controller.stepForTest(20);
      expect(
        svg.querySelector('g.sv-node-item path.sv-geom-shape')!.getAttribute('stroke'),
      ).toBe('#e2e8f0');
      expect(parseFloat(b6El.getAttribute('opacity') ?? '0')).toBeCloseTo(1, 2);

      // 3) Exception safety: a throwing batch callback restores batchDepth cleanly so subsequent updates work
      expect(() => {
        controller.batch(() => {
          controller.setTheme('light');
          throw new Error('simulated batch failure');
        });
      }).toThrow('simulated batch failure');

      const metricsAfterThrow = metricsCalls;
      controller.setSizeMultiplier(1.15);
      expect(metricsCalls - metricsAfterThrow).toBe(1);

      controller.destroy();
    } finally {
      renderSpy.mockRestore();
      container.remove();
    }
  });
});





