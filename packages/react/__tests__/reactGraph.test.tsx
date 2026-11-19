// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BarycentricSectorTriangleSvgView,
  ClusterTintedEdgeSvgView,
  SimplexTopicGraph,
  createBarycentricZoomStrategy,
  createEmbeddingClusteringStrategy,
  createSimplexTimeline,
  useSimplexGraphController,
  useSimplexTimeline,
  type SimplexTimelineState,
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

  it('disables regular mouse scroll wheel camera zoom in SimplexTopicGraph when a drill-down zoomStrategy is active', () => {
    const items = Array.from({ length: 18 }, (_, i) => ({
      id: `w-${i}`,
      tags: [`cat-${i % 3}`, `cat-${(i + 1) % 3}`, `sub-${i % 4}`],
    }));

    const { container, unmount } = render(
      <div style={{ width: 800, height: 600 }}>
        <SimplexTopicGraph
          items={items}
          zoomStrategy={createBarycentricZoomStrategy()}
          onWheel="zoom-to-cursor"
        />
      </div>,
    );

    const svg = container.querySelector('svg')!;
    const worldGroup = svg.querySelector('g.sv-world')!;
    expect(worldGroup.getAttribute('transform')).toBe('translate(0.00, 0.00) scale(1.0000)');

    svg.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -160,
        clientX: 400,
        clientY: 300,
        ctrlKey: false,
        bubbles: true,
      }),
    );

    // Camera must remain strictly at identity scale/pan in drill-down mode
    expect(worldGroup.getAttribute('transform')).toBe('translate(0.00, 0.00) scale(1.0000)');

    unmount();
  });

  it('composes onLeftClick and target-specific handlers with built-in drill-down and respects onWheel="none" without preventDefault (Issue #3)', () => {
    const items = Array.from({ length: 36 }, (_, i) => ({
      id: `rc-${i}`,
      tags: ['alpha', 'beta', 'gamma', `sub-${i % 3}`],
    }));

    const events: string[] = [];
    let consumeClick = false;
    let latestDepth = 0;

    const { container, unmount } = render(
      <div style={{ width: 720, height: 500 }}>
        <SimplexTopicGraph
          items={items}
          zoomStrategy={createBarycentricZoomStrategy({ stopWhenFullScale: false })}
          layoutOptions={{ seed: 19 }}
          onWheel="none"
          onTriangleClick={() => {
            events.push('triangle-specific');
            return consumeClick;
          }}
          onLeftClick={(target) => {
            events.push(`left:${target.kind}`);
          }}
          onZoomStateChange={(z) => {
            latestDepth = z.depth;
          }}
        />
      </div>,
    );

    const svg = container.querySelector('svg')!;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 720, height: 500, right: 720, bottom: 500 }),
    });

    const drillTri = svg.querySelector('g.sv-mesh-triangle[data-drillable="true"] polygon');
    expect(drillTri).not.toBeNull();
    const pts = drillTri!
      .getAttribute('points')!
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x: x!, y: y! };
      });
    const cx = (pts[0]!.x + pts[1]!.x + pts[2]!.x) / 3;
    const cy = (pts[0]!.y + pts[1]!.y + pts[2]!.y) / 3;

    // Consuming in onTriangleClick suppresses both onLeftClick and built-in drill-down
    consumeClick = true;
    svg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: cx, clientY: cy, bubbles: true }),
    );
    expect(events).toEqual(['triangle-specific']);
    expect(latestDepth).toBe(0);

    // Returning false composes onTriangleClick -> onLeftClick -> built-in drill-down
    events.length = 0;
    consumeClick = false;
    svg.dispatchEvent(
      new MouseEvent('click', { button: 0, clientX: cx, clientY: cy, bubbles: true }),
    );
    expect(events).toEqual(['triangle-specific', 'left:triangle']);
    expect(latestDepth).toBe(1);

    unmount();

    // Separate free-camera mount with onWheel="none" must NOT call preventDefault()
    const { container: freeContainer, unmount: unmountFree } = render(
      <div style={{ width: 640, height: 480 }}>
        <SimplexTopicGraph items={items.slice(0, 12)} onWheel="none" />
      </div>,
    );
    const freeSvg = freeContainer.querySelector('svg')!;
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: -120,
      clientX: 300,
      clientY: 200,
      cancelable: true,
      bubbles: true,
    });
    freeSvg.dispatchEvent(wheelEvent);
    expect(wheelEvent.defaultPrevented).toBe(false);

    unmountFree();
  });

  it('supports formatTagLabel, badgeOptions, and getShape props on SimplexTopicGraph (Issues #4, #7, #11)', () => {
    interface TaggedCard {
      readonly id: string;
      readonly kind: 'essay' | 'demo';
      readonly title: string;
      readonly tags: readonly string[];
    }

    const items: readonly TaggedCard[] = [
      { id: 'c1', kind: 'essay', title: 'One', tags: ['autonomous-driving', 'sensor-fusion'] },
      { id: 'c2', kind: 'demo', title: 'Two', tags: ['sensor-fusion', 'computer-vision'] },
      { id: 'c3', kind: 'essay', title: 'Three', tags: ['autonomous-driving', 'computer-vision'] },
      { id: 'c4', kind: 'demo', title: 'Four', tags: ['formal-verification', 'sensor-fusion'] },
      { id: 'c5', kind: 'essay', title: 'Five', tags: ['formal-verification', 'autonomous-driving'] },
    ];

    const labelMap: Record<string, string> = {
      'autonomous-driving': 'Autonomous Driving',
      'sensor-fusion': 'Sensor Fusion',
      'computer-vision': 'Computer Vision',
      'formal-verification': 'Formal Verification',
    };

    const controllerRef = {
      current: null as import('@simplex-viz/svg').SimplexSvgController<
        TaggedCard,
        unknown,
        unknown
      > | null,
    };

    const { container, rerender, unmount } = render(
      <div style={{ width: 820, height: 560 }}>
        <SimplexTopicGraph
          controllerRef={controllerRef}
          items={items}
          getLabel={(x) => x.title}
          preset="badges"
          formatTagLabel={(tag) => labelMap[tag] ?? tag}
          badgeOptions={{
            showCode: false,
            maxTitleChars: 14,
            formatTitle: (t) => `• ${t}`,
          }}
          getShape={(item) => (item.kind === 'essay' ? 'pentagon' : { sides: 3 })}
          tooltip
        />
      </div>,
    );

    const svg = container.querySelector('svg')!;
    const clusterNodes = svg.querySelectorAll('g.sv-node-cluster');
    expect(clusterNodes.length).toBeGreaterThanOrEqual(3);
    for (const cg of clusterNodes) {
      const texts = cg.querySelectorAll('text');
      expect(texts.length).toBe(2); // code omitted via showCode: false
      expect(texts[0]!.textContent?.startsWith('• ')).toBe(true);
      expect(texts[0]!.textContent).not.toMatch(/[a-z]-[a-z]/);
      expect(texts[0]!.textContent!.length).toBeLessThanOrEqual(14);
    }

    const essayPath = svg
      .querySelector('g.sv-node-item[data-node-id="c1"] path.sv-geom-shape')
      ?.getAttribute('d');
    const demoPath = svg
      .querySelector('g.sv-node-item[data-node-id="c2"] path.sv-geom-shape')
      ?.getAttribute('d');
    expect(essayPath).toBeTruthy();
    expect(demoPath).toBeTruthy();
    expect(essayPath).not.toBe(demoPath);

    // Live prop toggle: re-enabling showCode crossfades cluster badges to include the code prefix
    rerender(
      <div style={{ width: 820, height: 560 }}>
        <SimplexTopicGraph
          controllerRef={controllerRef}
          items={items}
          getLabel={(x) => x.title}
          preset="badges"
          formatTagLabel={(tag) => labelMap[tag] ?? tag}
          badgeOptions={{ showCode: true }}
          getShape={(item) => (item.kind === 'essay' ? 'pentagon' : { sides: 3 })}
          tooltip
        />
      </div>,
    );
    for (let i = 0; i < 40; i++) controllerRef.current?.stepForTest(20);
    const updatedClusterNodes = container.querySelectorAll('g.sv-node-cluster');
    for (const cg of updatedClusterNodes) {
      expect(cg.querySelectorAll('text').length).toBe(3);
    }

    unmount();
  });

  it('supports timeline prop, onTimelineStateChange, and declarative useSimplexTimeline hook controls (Issue #8)', () => {
    interface DatedEntry {
      readonly id: string;
      readonly title: string;
      readonly tags: readonly string[];
      readonly year: number;
    }

    const entries: readonly DatedEntry[] = [
      { id: 'e1', title: 'First', tags: ['alpha', 'beta'], year: 2021 },
      { id: 'e2', title: 'Second', tags: ['beta', 'gamma'], year: 2022 },
      { id: 'e3', title: 'Third', tags: ['alpha', 'gamma'], year: 2023 },
      { id: 'e4', title: 'Fourth', tags: ['alpha', 'delta'], year: 2023 },
    ];

    const callbackStates: SimplexTimelineState<DatedEntry>[] = [];

    function TimelineHost() {
      const { controllerRef } = useSimplexGraphController<DatedEntry>();
      const tl = useSimplexTimeline(controllerRef);

      return (
        <div style={{ width: 820, height: 540 }}>
          <SimplexTopicGraph
            controllerRef={controllerRef}
            items={entries}
            getLabel={(e) => e.title}
            timeline={{
              getTimestamp: (e) => e.year,
              stepIntervalMs: 300,
              showControls: true,
            }}
            onTimelineStateChange={(st) => {
              callbackStates.push(st);
            }}
          />
          <div data-testid="tl-step">{tl.state?.step ?? -1}</div>
          <div data-testid="tl-label">{tl.state?.activeLabel ?? ''}</div>
          <div data-testid="tl-playing">{String(tl.state?.playing ?? false)}</div>
          <button type="button" data-testid="tl-seek-0" onClick={() => tl.seek(0)}>
            Start
          </button>
          <button type="button" data-testid="tl-next" onClick={() => tl.stepBy(1)}>
            Next
          </button>
          <button type="button" data-testid="tl-play" onClick={() => tl.play()}>
            Play
          </button>
          <button type="button" data-testid="tl-reset" onClick={() => tl.resetToEnd()}>
            End
          </button>
        </div>
      );
    }

    const { container, getByTestId, unmount } = render(<TimelineHost />);

    // Built-in player bar is mounted and hook reflects initial full-corpus frame (step 2 = '2023')
    expect(container.querySelector('.sv-timeline-bar')).not.toBeNull();
    expect(getByTestId('tl-step').textContent).toBe('2');
    expect(getByTestId('tl-label').textContent).toBe('2023');
    expect(callbackStates.at(-1)?.step).toBe(2);

    // Declarative hook seek(0) and stepBy(1) update React state and underlying graph
    act(() => {
      getByTestId('tl-seek-0').click();
    });
    expect(getByTestId('tl-step').textContent).toBe('0');
    expect(getByTestId('tl-label').textContent).toBe('2021');

    act(() => {
      getByTestId('tl-next').click();
    });
    expect(getByTestId('tl-step').textContent).toBe('1');
    expect(getByTestId('tl-label').textContent).toBe('2022');

    act(() => {
      getByTestId('tl-play').click();
    });
    expect(getByTestId('tl-playing').textContent).toBe('true');

    act(() => {
      getByTestId('tl-reset').click();
    });
    expect(getByTestId('tl-playing').textContent).toBe('false');
    expect(getByTestId('tl-step').textContent).toBe('2');

    unmount();

    // Standalone SimplexTimelineController source also works directly with useSimplexTimeline
    const standalone = createSimplexTimeline(entries, {
      getTimestamp: (e) => e.year,
      initialStep: 0,
    });
    function StandaloneReader() {
      const tl = useSimplexTimeline(standalone);
      return (
        <span data-testid="standalone-label">
          {tl.state?.activeLabel}:{tl.state?.activeItemCount}
        </span>
      );
    }
    const standaloneView = render(<StandaloneReader />);
    expect(standaloneView.getByTestId('standalone-label').textContent).toBe('2021:1');
    act(() => {
      standalone.stepBy(1);
    });
    expect(standaloneView.getByTestId('standalone-label').textContent).toBe('2022:2');
    standaloneView.unmount();
    standalone.destroy();
  });

  it('syncs emptyClusterBehavior and timeline.autoFinalSeedLayout props dynamically on SimplexTopicGraph', () => {
    const items = [
      { id: 'r1', title: 'Alpha 1', tags: ['alpha', 'beta'], year: 2021 },
      { id: 'r2', title: 'Alpha 2', tags: ['alpha'], year: 2021 },
      { id: 'r3', title: 'Gamma 1', tags: ['gamma', 'delta'], year: 2024 },
      { id: 'r4', title: 'Delta 1', tags: ['delta'], year: 2024 },
    ];

    function DynamicHost({
      emptyClusterBehavior,
      autoFinalSeedLayout,
    }: {
      readonly emptyClusterBehavior: 'normal' | 'dim' | 'hide';
      readonly autoFinalSeedLayout: false | 'pinned' | 'adaptive';
    }) {
      const { controllerRef } = useSimplexGraphController<(typeof items)[number]>();
      return (
        <div style={{ width: 780, height: 520 }}>
          <SimplexTopicGraph
            controllerRef={controllerRef}
            items={items}
            emptyClusterBehavior={emptyClusterBehavior}
            timeline={{
              getTimestamp: (it) => it.year,
              autoFinalSeed: true,
              autoFinalSeedLayout,
              emptyClusterBehavior,
              initialStep: 0,
            }}
          />
          <span data-testid="layout-name">
            {controllerRef.current?.getLayoutStrategy().name ?? ''}
          </span>
        </div>
      );
    }

    const { container, rerender, unmount } = render(
      <DynamicHost emptyClusterBehavior="dim" autoFinalSeedLayout="adaptive" />,
    );

    expect(container.querySelector('.sv-timeline-bar')).not.toBeNull();
    const clusterNodesDim = Array.from(container.querySelectorAll('g.sv-node-cluster'));
    expect(clusterNodesDim.length).toBeGreaterThan(0);

    // Re-render with hide & pinned (must sync cleanly without crashing or remounting)
    rerender(<DynamicHost emptyClusterBehavior="hide" autoFinalSeedLayout="pinned" />);
    expect(container.querySelector('.sv-timeline-bar')).not.toBeNull();

    // Re-render with dynamic layout & normal empty clusters
    rerender(<DynamicHost emptyClusterBehavior="normal" autoFinalSeedLayout={false} />);
    expect(container.querySelector('.sv-timeline-bar')).not.toBeNull();

    unmount();
  });

  it('forwards deferInitialLayout on SimplexTopicGraph and initializes cleanly on first non-zero ResizeObserver entry (Issue #12)', () => {
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

    const items = [
      { id: 'd1', tags: ['alpha', 'beta'] },
      { id: 'd2', tags: ['beta', 'gamma'] },
      { id: 'd3', tags: ['alpha', 'gamma'] },
      { id: 'd4', tags: ['alpha', 'delta'] },
    ];

    const controllerRef = {
      current: null as import('@simplex-viz/svg').SimplexSvgController<
        (typeof items)[number],
        unknown,
        unknown
      > | null,
    };

    try {
      const { unmount } = render(
        <SimplexTopicGraph
          controllerRef={controllerRef}
          items={items}
          deferInitialLayout
        />,
      );

      expect(controllerRef.current).not.toBeNull();
      expect(controllerRef.current!.getClusters().length).toBe(0);
      expect(controllerRef.current!.getMetrics().meshSideLength).toBe(0);

      // Fire ResizeObserver for the graph container
      for (const rec of observers) {
        rec.cb([
          {
            target: rec.target,
            contentRect: {
              x: 0,
              y: 0,
              width: 760,
              height: 500,
              top: 0,
              left: 0,
              right: 760,
              bottom: 500,
              toJSON: () => ({}),
            },
          } as ResizeObserverEntry,
        ]);
      }

      expect(controllerRef.current!.getClusters().length).toBeGreaterThanOrEqual(3);
      expect(controllerRef.current!.getMetrics().isSettled).toBe(true);
      expect(controllerRef.current!.getMetrics().overlapCount).toBe(0);

      unmount();
    } finally {
      globalThis.ResizeObserver = OriginalResizeObserver;
    }
  });
});


