// @vitest-environment happy-dom
import type { DefaultTaggedItem, VisualResolver } from '@simplex-viz/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BadgeClusterSvgView,
  GeometricShapeSvgView,
  GradientTriangleSvgView,
  SimplexSvgController,
  createEmbeddingClusteringStrategy,
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
});
