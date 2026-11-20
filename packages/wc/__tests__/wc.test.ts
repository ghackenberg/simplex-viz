// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SIMPLEX_TAG_NAME,
  SimplexTopicGraphElement,
  createBarycentricZoomStrategy,
  defineSimplexTopicGraphElement,
  type DefaultTaggedItem,
  type SimplexClickEventDetail,
  type SimplexHoverEventDetail,
  type SimplexSelectionChangeDetail,
  type SimplexTimelineState,
  type SimplexZoomState,
} from '../src/index';

const SAMPLE_ITEMS: readonly DefaultTaggedItem[] = [
  { id: 'wc-1', label: 'Topology', tags: ['geometry', 'math'] },
  { id: 'wc-2', label: 'Shaders', tags: ['graphics', 'math'] },
  { id: 'wc-3', label: 'OKLab', tags: ['color', 'graphics'] },
  { id: 'wc-4', label: 'Simplices', tags: ['geometry', 'color'] },
  { id: 'wc-5', label: 'Layout', tags: ['geometry', 'graphics'] },
];

function sizeElement(el: HTMLElement, width = 720, height = 480): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
  });
}

describe('@simplex-viz/wc (<simplex-topic-graph>) (Issue #26)', () => {
  it('registers idempotently, handles SSR safely, and supports @simplex-viz/wc/define', async () => {
    // Importing @simplex-viz/wc/define auto-registers <simplex-topic-graph>
    await import('../src/define');
    expect(customElements.get(DEFAULT_SIMPLEX_TAG_NAME)).toBe(SimplexTopicGraphElement);

    // Second call is idempotent and never throws
    expect(defineSimplexTopicGraphElement(DEFAULT_SIMPLEX_TAG_NAME)).toBe(false);

    // Custom tag name registers cleanly once as an alias subclass, then returns false
    const customTag = 'x-custom-simplex-graph';
    expect(defineSimplexTopicGraphElement(customTag)).toBe(true);
    const aliasCtor = customElements.get(customTag);
    expect(aliasCtor).toBeDefined();
    expect(Object.getPrototypeOf(aliasCtor)).toBe(SimplexTopicGraphElement);
    expect(document.createElement(customTag)).toBeInstanceOf(SimplexTopicGraphElement);
    expect(defineSimplexTopicGraphElement(customTag)).toBe(false);

    // SSR guard: returns false safely when customElements is absent
    const originalRegistry = globalThis.customElements;
    Object.defineProperty(globalThis, 'customElements', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    try {
      expect(defineSimplexTopicGraphElement('x-ssr-safe-graph')).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'customElements', {
        configurable: true,
        writable: true,
        value: originalRegistry,
      });
    }
  });

  it('mounts in Light DOM, reacts to HTML attributes & JS properties, and supports inline JSON script data', () => {
    defineSimplexTopicGraphElement();

    // 1) Declarative inline <script type="application/json"> + HTML attributes
    const host = document.createElement('div');
    host.innerHTML = `
      <simplex-topic-graph
        preset="badges"
        theme="light"
        aria-label="Embedded knowledge map"
        reduced-motion="true"
        selected-ids="wc-1, wc-3"
        highlighted-ids="wc-2"
        marquee-selection="false"
      >
        <script type="application/json">${JSON.stringify(SAMPLE_ITEMS)}</script>
      </simplex-topic-graph>
    `;
    document.body.appendChild(host);
    const el = host.querySelector('simplex-topic-graph') as SimplexTopicGraphElement;

    try {
      expect(el).toBeInstanceOf(SimplexTopicGraphElement);
      expect(el.shadowRoot).toBeNull(); // Light DOM for getBBox() & webfont fidelity
      expect(el.controller).not.toBeNull();
      expect(el.items.length).toBe(SAMPLE_ITEMS.length);
      expect(el.preset).toBe('badges');
      expect(el.theme).toBe('light');
      expect(el.isReducedMotionActive()).toBe(true);
      expect(el.marqueeSelection).toBe(false);
      expect([...el.getSelectedIds()].sort()).toEqual(['wc-1', 'wc-3']);
      expect([...el.getHighlightedIds()]).toEqual(['wc-2']);

      const svg = el.getSvgElement()!;
      expect(svg).not.toBeNull();
      expect(svg.getAttribute('aria-label')).toBe('Embedded knowledge map');
      expect(svg.getAttribute('data-reduced-motion')).toBe('true');
      expect(
        svg.querySelector('g.sv-node-item[data-node-id="wc-1"]')?.getAttribute('data-selected'),
      ).toBe('true');

      // 2) Live attribute mutations update controller & SVG immediately
      el.setAttribute('aria-label', 'Updated atlas label');
      el.setAttribute('reduced-motion', 'false');
      el.setAttribute('selected-ids', '["wc-4"]');
      el.setAttribute('keyboard-navigation', 'false');
      expect(svg.getAttribute('aria-label')).toBe('Updated atlas label');
      expect(el.isReducedMotionActive()).toBe(false);
      expect(svg.getAttribute('data-reduced-motion')).toBeNull();
      expect([...el.getSelectedIds()]).toEqual(['wc-4']);
      expect(svg.getAttribute('tabindex')).toBeNull();

      // 3) Live JS property mutations sync smoothly
      el.theme = 'dark';
      el.preset = 'geometric';
      el.highlightedIds = ['wc-5'];
      expect(el.theme).toBe('dark');
      expect(el.preset).toBe('geometric');
      expect([...el.highlightedIds]).toEqual(['wc-5']);
    } finally {
      host.remove();
    }
  });

  it('preserves pre-upgrade JS properties set before customElements.define()', () => {
    const tag = 'x-preupgrade-simplex';
    const preEl = document.createElement(tag) as unknown as SimplexTopicGraphElement;
    // Set properties on plain unknown element BEFORE defining the custom element
    preEl.items = SAMPLE_ITEMS;
    preEl.theme = 'light';
    preEl.selectedIds = ['wc-2'];
    document.body.appendChild(preEl);

    try {
      expect(defineSimplexTopicGraphElement(tag)).toBe(true);
      customElements.upgrade(preEl);
      // happy-dom may not re-run connectedCallback automatically on upgrade if already connected;
      // reconnect guarantees full custom element lifecycle in all DOM engines
      if (!preEl.controller) {
        preEl.remove();
        document.body.appendChild(preEl);
      }

      expect(preEl).toBeInstanceOf(SimplexTopicGraphElement);
      expect(preEl.items.length).toBe(SAMPLE_ITEMS.length);
      expect(preEl.theme).toBe('light');
      expect([...preEl.getSelectedIds()]).toEqual(['wc-2']);
    } finally {
      preEl.remove();
    }
  });

  it('dispatches bubbling CustomEvents (simplex-click, simplex-hover, simplex-selection-change, simplex-zoom, simplex-timeline-change) with cancelable click/hover interception', () => {
    defineSimplexTopicGraphElement();

    interface DatedEntry {
      readonly id: string;
      readonly label: string;
      readonly tags: readonly string[];
      readonly year: number;
    }

    const items: readonly DatedEntry[] = Array.from({ length: 36 }, (_, i) => ({
      id: `ev-${i}`,
      label: `Node ${i}`,
      tags: [
        i % 3 === 0 ? 'alpha' : i % 3 === 1 ? 'beta' : 'gamma',
        i % 2 === 0 ? 'beta' : 'gamma',
        `sub-${i % 4}`,
      ],
      year: 2021 + (i % 3),
    }));

    const wrapper = document.createElement('div');
    const el = document.createElement(
      'simplex-topic-graph',
    ) as unknown as SimplexTopicGraphElement<DatedEntry>;
    el.items = items;
    el.tooltip = true;
    el.layoutOptions = { seed: 31, sizeMultiplier: 1.8 };
    el.zoomStrategy = createBarycentricZoomStrategy({
      subdivision: '1:4',
      stopWhenFullScale: false,
    });
    el.timeline = {
      getTimestamp: (item) => item.year,
      autoFinalSeed: true,
    };
    wrapper.appendChild(el);
    document.body.appendChild(wrapper);

    const stageEl = el.querySelector('.sv-wc-stage') as HTMLDivElement;
    sizeElement(stageEl, 720, 480);

    const clicks: SimplexClickEventDetail<DatedEntry>[] = [];
    const hovers: SimplexHoverEventDetail<DatedEntry>[] = [];
    const selections: SimplexSelectionChangeDetail[] = [];
    const zooms: SimplexZoomState[] = [];
    const timelines: SimplexTimelineState<DatedEntry>[] = [];
    let preventClicks = true;

    // Listen on parent wrapper to confirm events bubble & are composed
    wrapper.addEventListener('simplex-click', (e) => {
      const ce = e as CustomEvent<SimplexClickEventDetail<DatedEntry>>;
      clicks.push(ce.detail);
      if (preventClicks) ce.preventDefault();
    });
    wrapper.addEventListener('simplex-hover', (e) => {
      const ce = e as CustomEvent<SimplexHoverEventDetail<DatedEntry>>;
      hovers.push(ce.detail);
    });
    wrapper.addEventListener('simplex-selection-change', (e) => {
      selections.push((e as CustomEvent<SimplexSelectionChangeDetail>).detail);
    });
    wrapper.addEventListener('simplex-zoom', (e) => {
      zooms.push((e as CustomEvent<SimplexZoomState>).detail);
    });
    wrapper.addEventListener('simplex-timeline-change', (e) => {
      timelines.push((e as CustomEvent<SimplexTimelineState<DatedEntry>>).detail);
    });

    try {
      for (let i = 0; i < 35; i++) el.stepForTest(20);
      const svg = el.getSvgElement()!;
      sizeElement(svg as unknown as HTMLElement, 720, 480);

      // 1) Selection event & shift-click-selects attribute
      expect(el.shiftClickSelects).toBe(true);
      el.setAttribute('shift-click-selects', 'false');
      expect(el.shiftClickSelects).toBe(false);
      el.setAttribute('shift-click-selects', 'true');
      expect(el.shiftClickSelects).toBe(true);
      expect(el.toggleSelectedId('ev-0')).toBe(true);
      expect(selections.at(-1)?.ids).toEqual(['ev-0']);

      // 2) Cancelable click on drillable triangle -> preventDefault() blocks drill-down
      const drillIdx = el.getZoomState()!.drillableTriangleIndices[0]!;
      const triPoly = svg.querySelector(
        `g.sv-mesh-triangle[data-triangle-index="${drillIdx}"] polygon`,
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

      svg.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'mouse',
          clientX: cx,
          clientY: cy,
          bubbles: true,
        }),
      );
      expect(hovers.some((h) => h.kind === 'triangle')).toBe(true);

      svg.dispatchEvent(
        new MouseEvent('click', { button: 0, clientX: cx, clientY: cy, bubbles: true }),
      );
      expect(clicks.at(-1)?.kind).toBe('triangle');
      expect(el.getZoomState()!.depth).toBe(0); // prevented!

      // Allow default -> clicking drills down and emits simplex-zoom
      preventClicks = false;
      svg.dispatchEvent(
        new MouseEvent('click', { button: 0, clientX: cx, clientY: cy, bubbles: true }),
      );
      for (let i = 0; i < 35; i++) el.stepForTest(20);
      expect(el.getZoomState()!.depth).toBe(1);
      expect(zooms.some((z) => z.depth === 1)).toBe(true);

      // 3) Timeline seek emits simplex-timeline-change
      el.timelineController!.seek(0);
      expect(timelines.some((t) => t.step === 0)).toBe(true);
    } finally {
      wrapper.remove();
    }
  });

  it('supports getViewState/restoreViewState, exportSvg, batching, and clean teardown/reconnection', () => {
    defineSimplexTopicGraphElement();

    const el = document.createElement('simplex-topic-graph') as SimplexTopicGraphElement;
    el.items = SAMPLE_ITEMS;
    el.layoutOptions = { seed: 11 };
    document.body.appendChild(el);

    try {
      for (let i = 0; i < 20; i++) el.stepForTest(20);

      // Mutate via batch + view state round-trip
      const metricsSpy = vi.fn();
      el.addEventListener('simplex-metrics', metricsSpy);
      el.batch(() => {
        el.theme = 'light';
        el.setSelectedIds(['wc-1', 'wc-4']);
        el.setHighlightedIds(['wc-2']);
        el.focusItem('wc-3');
      });
      el.camera!.setState({ zoom: 1.75, panX: 35, panY: -22 });

      const saved = JSON.parse(JSON.stringify(el.getViewState()));
      expect(saved.version).toBe(1);
      expect(saved.selectedIds).toEqual(['wc-1', 'wc-4']);
      expect(saved.focusedItemId).toBe('wc-3');

      el.resetCamera();
      el.clearSelection();
      el.setHighlightedIds(null);
      el.focusItem(null);

      expect(el.restoreViewState(saved)).toBe(true);
      expect(el.getViewState()).toEqual(saved);

      // Standalone SVG export works directly from the element
      const svgStr = el.exportSvg({ title: 'WC Export' });
      expect(svgStr).not.toBeNull();
      expect(svgStr).toContain('<title>WC Export</title>');

      // Disconnecting cleans up stage & controller completely
      el.remove();
      expect(el.controller).toBeNull();
      expect(el.querySelector('.sv-wc-stage')).toBeNull();
      expect(el.getViewState()).toBeNull();
      expect(el.exportSvg()).toBeNull();
      expect(el.restoreViewState(saved)).toBe(false);

      // Reconnecting cleanly mounts a fresh controller with preserved state
      document.body.appendChild(el);
      expect(el.controller).not.toBeNull();
      expect(el.items.length).toBe(SAMPLE_ITEMS.length);
      expect(el.theme).toBe('light');
    } finally {
      el.remove();
    }
  });

  it('supports custom DOM/HTML tooltip renderer on <simplex-topic-graph> with cancelable hover and teardown cleanup (Issue #28)', () => {
    defineSimplexTopicGraphElement();

    const wrapper = document.createElement('div');
    sizeElement(wrapper, 720, 480);
    const el = document.createElement('simplex-topic-graph') as SimplexTopicGraphElement;
    sizeElement(el, 720, 480);

    let renderCalls = 0;
    let cleanupCalls = 0;
    let hideCalls = 0;

    el.items = SAMPLE_ITEMS;
    el.layoutOptions = { seed: 13 };
    el.tooltip = {
      className: 'wc-rich-tip',
      render(target, containerEl) {
        renderCalls += 1;
        const badge = document.createElement('div');
        badge.className = 'wc-tip-body';
        badge.textContent =
          target.kind === 'content'
            ? target.item.id
            : target.kind === 'cluster'
              ? target.cluster.code
              : `tri-${target.triangle.index}`;
        containerEl.appendChild(badge);
        return () => {
          cleanupCalls += 1;
        };
      },
      onHide() {
        hideCalls += 1;
      },
    };

    let blockHover = false;
    el.addEventListener('simplex-hover', (ev) => {
      if (blockHover) ev.preventDefault();
    });

    wrapper.appendChild(el);
    document.body.appendChild(wrapper);

    try {
      for (let i = 0; i < 30; i++) el.stepForTest(20);
      const svg = el.getSvgElement()!;
      sizeElement(svg as unknown as HTMLElement, 720, 480);

      const firstItem = svg.querySelector('g.sv-node-item')!;
      const m = firstItem
        .getAttribute('transform')!
        .match(/translate\(\s*([0-9.-]+)[,\s]+([0-9.-]+)/)!;
      const x = parseFloat(m[1]!);
      const y = parseFloat(m[2]!);

      svg.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      );

      const tipEl = el.querySelector<HTMLDivElement>('.sv-tooltip.wc-rich-tip')!;
      expect(tipEl).not.toBeNull();
      expect(tipEl.style.display).toBe('block');
      expect(tipEl.querySelector('.wc-tip-body')?.textContent).toBe(
        firstItem.getAttribute('data-node-id'),
      );
      expect(renderCalls).toBe(1);

      // Cancelable simplex-hover prevents tooltip display
      blockHover = true;
      svg.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'mouse',
          clientX: x + 1,
          clientY: y + 1,
          bubbles: true,
        }),
      );
      expect(tipEl.style.display).toBe('none');
      expect(cleanupCalls).toBe(1);
      expect(hideCalls).toBe(1);

      // Re-enable hover, show tooltip, and confirm disconnect triggers cleanup
      blockHover = false;
      svg.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'mouse',
          clientX: x,
          clientY: y,
          bubbles: true,
        }),
      );
      expect(tipEl.style.display).toBe('block');
      expect(renderCalls).toBe(2);

      el.remove();
      expect(cleanupCalls).toBe(2);
      expect(hideCalls).toBe(2);
    } finally {
      wrapper.remove();
    }
  });
});
