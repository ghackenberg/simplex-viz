// @vitest-environment happy-dom
import type { DefaultTaggedItem, VisualResolver } from '@simplex-viz/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BadgeClusterSvgView,
  GeometricShapeSvgView,
  SimplexSvgController,
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
});
