// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BarycentricSectorTriangleSvgView,
  ClusterTintedEdgeSvgView,
  SimplexTopicGraph,
  createEmbeddingClusteringStrategy,
} from '../src/index';

interface CustomDoc {
  readonly slug: string;
  readonly headline: string;
  readonly tags: readonly string[];
}

beforeEach(() => {
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: function (this: SVGElement) {
      const rect = this.querySelector('rect');
      if (rect) {
        return {
          x: parseFloat(rect.getAttribute('x') ?? '-45'),
          y: parseFloat(rect.getAttribute('y') ?? '-14'),
          width: parseFloat(rect.getAttribute('width') ?? '90'),
          height: parseFloat(rect.getAttribute('height') ?? '28'),
        };
      }
      return { x: -16, y: -16, width: 32, height: 32 };
    },
  });
});

describe('@simplex-viz/react integration', () => {
  it('renders custom domain items with declarative JSX renderContentNode and renderClusterNode', () => {
    const docs: readonly CustomDoc[] = Array.from({ length: 8 }, (_, i) => ({
      slug: `doc-${i}`,
      headline: `Topic ${i}`,
      tags: [`alpha-${i % 3}`, `beta-${(i + 1) % 3}`],
    }));

    let latestOverlaps = -1;

    const { container, unmount } = render(
      <div style={{ width: 900, height: 600 }}>
        <SimplexTopicGraph<CustomDoc, { readonly color: string }, { readonly title: string }>
          items={docs}
          getId={(d) => d.slug}
          getTags={(d) => d.tags}
          visualResolver={{
            resolveContentVisual: (_d, ctx) => ({ color: ctx.mixedColorHex }),
            resolveClusterVisual: (c) => ({ title: `${c.code} ${c.defaultLabel}` }),
            getVisualCacheKey: (v) => ('color' in v ? v.color : v.title),
          }}
          renderContentNode={(doc, ctx) => (
            <g>
              <rect x={-40} y={-12} width={80} height={24} rx={4} fill={ctx.mixedColorHex} />
              <text x={0} y={4} textAnchor="middle">
                {doc.headline}
              </text>
            </g>
          )}
          renderClusterNode={(cluster) => (
            <g>
              <rect x={-55} y={-18} width={110} height={36} rx={6} fill={cluster.colorHex} />
              <text x={0} y={4} textAnchor="middle">
                {cluster.code}
              </text>
            </g>
          )}
          onMetricsChange={(m) => {
            latestOverlaps = m.overlapCount;
          }}
        />
      </div>,
    );

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll('g.sv-node-item').length).toBe(8);
    expect(latestOverlaps).toBe(0);

    unmount();
  });

  it('supports zero-config preset rendering and keyless renderContentNode without visualResolver', () => {
    const simpleItems = Array.from({ length: 6 }, (_, i) => ({
      id: `simple-${i}`,
      tags: [`group-${i % 3}`, `group-${(i + 1) % 3}`],
    }));

    const zeroConfig = render(
      <div style={{ width: 800, height: 600 }}>
        <SimplexTopicGraph items={simpleItems} preset="glyphs" tooltip />
      </div>,
    );
    expect(zeroConfig.container.querySelectorAll('g.sv-node-item').length).toBe(6);
    zeroConfig.unmount();

    const docs: readonly CustomDoc[] = Array.from({ length: 6 }, (_, i) => ({
      slug: `doc-${i}`,
      headline: `Doc ${i}`,
      tags: [`alpha-${i % 3}`, `beta-${(i + 1) % 3}`],
    }));

    const keyless = render(
      <div style={{ width: 800, height: 600 }}>
        <SimplexTopicGraph
          items={docs}
          getId={(d) => d.slug}
          getTags={(d) => d.tags}
          preset="badges"
          renderContentNode={(doc, ctx) => (
            <g>
              <rect x={-36} y={-12} width={72} height={24} rx={4} fill={ctx.mixedColorHex} />
              <text x={0} y={4} textAnchor="middle">
                {doc.headline}
              </text>
            </g>
          )}
        />
      </div>,
    );
    expect(keyless.container.querySelectorAll('g.sv-node-item').length).toBe(6);
    expect(keyless.container.querySelectorAll('g.sv-node-cluster').length).toBeGreaterThanOrEqual(3);
    keyless.unmount();
  });

  it('accepts pluggable triangleView, edgeView, and controlled focusedTriangleIndex props', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      id: `t-${i}`,
      tags: [`x-${i % 3}`, `x-${(i + 1) % 3}`],
    }));

    const { container, unmount } = render(
      <div style={{ width: 800, height: 600 }}>
        <SimplexTopicGraph
          items={items}
          triangleView={new BarycentricSectorTriangleSvgView()}
          edgeView={new ClusterTintedEdgeSvgView()}
          focusedTriangleIndex={0}
          tooltip
        />
      </div>,
    );

    const triGroups = container.querySelectorAll('g.sv-mesh-triangle');
    const edgeGroups = container.querySelectorAll('g.sv-mesh-edge');
    expect(triGroups.length).toBeGreaterThanOrEqual(1);
    expect(edgeGroups.length).toBeGreaterThanOrEqual(3);
    // BarycentricSectorTriangleSvgView renders 3 quad polygons + medians + outline when focused
    expect(triGroups[0]!.querySelectorAll('polygon').length).toBeGreaterThanOrEqual(3);
    // ClusterTintedEdgeSvgView renders 3 colored segments per edge
    expect(edgeGroups[0]!.querySelectorAll('line').length).toBe(3);

    unmount();
  });

  it('renders untagged multi-modal embedding models without getTags', () => {
    interface MediaClip {
      readonly clipId: string;
      readonly visualVec: readonly number[];
      readonly audioVec: readonly number[];
    }

    const clips: readonly MediaClip[] = [
      { clipId: 'clip-1', visualVec: [0.95, 0.1, 0], audioVec: [0.9, 0.1] },
      { clipId: 'clip-2', visualVec: [0.9, 0.15, 0.05], audioVec: [0.85, 0.15] },
      { clipId: 'clip-3', visualVec: [0.1, 0.95, 0.05], audioVec: [0.15, 0.85] },
      { clipId: 'clip-4', visualVec: [0.12, 0.9, 0.1], audioVec: [0.1, 0.9] },
      { clipId: 'clip-5', visualVec: [0.05, 0.1, 0.95], audioVec: [0.5, 0.5] },
      { clipId: 'clip-6', visualVec: [0.1, 0.08, 0.92], audioVec: [0.55, 0.45] },
      { clipId: 'clip-7', visualVec: [0.5, 0.5, 0.15], audioVec: [0.5, 0.5] },
    ];

    let overlaps = -1;
    const { container, unmount } = render(
      <div style={{ width: 820, height: 580 }}>
        <SimplexTopicGraph
          items={clips}
          getId={(c) => c.clipId}
          clusteringStrategy={createEmbeddingClusteringStrategy<MediaClip>({
            getEmbedding: [
              { name: 'Visual', getVector: (c) => c.visualVec, weight: 0.7 },
              { name: 'Audio', getVector: (c) => c.audioVec, weight: 0.3 },
            ],
          })}
          preset="badges"
          tooltip
          onMetricsChange={(m) => {
            overlaps = m.overlapCount;
          }}
        />
      </div>,
    );

    expect(container.querySelectorAll('g.sv-node-item').length).toBe(7);
    expect(container.querySelectorAll('g.sv-node-cluster').length).toBeGreaterThanOrEqual(3);
    expect(overlaps).toBe(0);

    unmount();
  });
});
