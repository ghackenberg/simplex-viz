// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SimplexTopicGraph } from '../src/SimplexTopicGraph';

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
});
