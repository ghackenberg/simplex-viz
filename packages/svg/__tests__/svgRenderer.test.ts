// @vitest-environment happy-dom
import type { DefaultTaggedItem, VisualResolver } from '@simplex-viz/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BadgeClusterSvgView,
  ClusterTintedEdgeSvgView,
  GeometricShapeSvgView,
  GradientTriangleSvgView,
  SimplexSvgController,
  createBarycentricZoomStrategy,
  createEmbeddingClusteringStrategy,
  createFixedLatticeMeshStrategy,
  createSimplexSvg,
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
      zoomStrategy: createBarycentricZoomStrategy(),
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
        subdivision: '1:4',
        clusterZoomMode: 'none',
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
});



