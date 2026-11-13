import type {
  ClusterDescriptor,
  ClusterHoverEvent,
  ContentHoverEvent,
  HitTarget,
  LayoutMetrics,
  NormalizedPointerEvent,
  WheelBehavior,
} from '@simplex-viz/core';
import { SimplexTopicGraph, useSimplexGraphController } from '@simplex-viz/react';
import {
  Crosshair,
  Minus,
  Pin,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SimplexLogoMark } from './components/SimplexLogoMark';
import {
  buildInitialKnowledgeCatalog,
  createDynamicEntry,
  deriveDemoClusterMeta,
  resolveDemoTagMeta,
  type KnowledgeEntry,
  type TagTaxonomyInfo,
  type TopicClusterSummary,
} from './data/knowledgeCatalog';
import {
  createDemoVisualResolver,
  demoAnchorClusterView,
  demoBadgeClusterView,
  demoGeometricContentView,
  demoMultiSectorContentView,
  renderDemoClusterCard,
  renderDemoContentCard,
  type DemoClusterVisual,
  type DemoContentVisual,
  type PresetId,
} from './presets';

type ContentHoverPolicy = 'tooltip' | 'highlight-unit' | 'none';
type ClusterHoverPolicy = 'tooltip' | 'focus-members' | 'none';
type LeftClickPolicy = 'inspect' | 'focus-toggle' | 'remove';
type RightClickPolicy = 'context-menu' | 'browser-default';

interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly target: HitTarget<
    KnowledgeEntry,
    DemoContentVisual,
    DemoClusterVisual,
    TagTaxonomyInfo,
    TopicClusterSummary
  >;
}

type InspectedTarget =
  | {
      readonly kind: 'content';
      readonly item: KnowledgeEntry;
      readonly clusterTitles: readonly string[];
      readonly mixedColorHex: string;
    }
  | {
      readonly kind: 'cluster';
      readonly cluster: ClusterDescriptor<
        KnowledgeEntry,
        TagTaxonomyInfo,
        TopicClusterSummary
      >;
    };

export function DemoApp() {
  const initialCatalog = useMemo(() => buildInitialKnowledgeCatalog(), []);
  const [items, setItems] = useState<readonly KnowledgeEntry[]>(initialCatalog);
  const [preset, setPreset] = useState<PresetId>('geometric');
  const [sizeMultiplier, setSizeMultiplier] = useState<number>(1.0);
  const [showHulls, setShowHulls] = useState<boolean>(false);
  const [rapidFireActive, setRapidFireActive] = useState<boolean>(false);
  const [activeNavSection, setActiveNavSection] = useState<
    'atlas' | 'rendering' | 'geometry' | 'interaction'
  >('atlas');

  // Interaction configurator policies
  const [contentHoverPolicy, setContentHoverPolicy] =
    useState<ContentHoverPolicy>('tooltip');
  const [clusterHoverPolicy, setClusterHoverPolicy] =
    useState<ClusterHoverPolicy>('tooltip');
  const [leftClickPolicy, setLeftClickPolicy] = useState<LeftClickPolicy>('inspect');
  const [rightClickPolicy, setRightClickPolicy] =
    useState<RightClickPolicy>('context-menu');
  const [wheelPolicy, setWheelPolicy] = useState<'zoom-to-cursor' | 'pan-vertical' | 'none'>(
    'zoom-to-cursor',
  );

  // Live telemetry & interaction overlays
  const [metrics, setMetrics] = useState<LayoutMetrics>({
    clusterCount: 0,
    itemCount: initialCatalog.length,
    tagCount: 0,
    clusterScale: 1,
    contentScale: 1,
    overlapCount: 0,
    maxPenetrationPx: 0,
    isSettled: true,
    meshSideLength: 0,
    areaEfficiency: 0,
  });
  const [fps, setFps] = useState<number>(60);
  const [hoveredContent, setHoveredContent] = useState<ContentHoverEvent<
    KnowledgeEntry,
    DemoContentVisual,
    TagTaxonomyInfo,
    TopicClusterSummary
  > | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<ClusterHoverEvent<
    KnowledgeEntry,
    DemoClusterVisual,
    TagTaxonomyInfo,
    TopicClusterSummary
  > | null>(null);
  const [inspected, setInspected] = useState<InspectedTarget | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set());
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(() => new Set());
  const [focusedClusterUid, setFocusedClusterUid] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState<boolean>(false);

  const dynamicSeqRef = useRef<number>(200);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const { controllerRef, handle } = useSimplexGraphController<
    KnowledgeEntry,
    DemoContentVisual,
    DemoClusterVisual,
    TagTaxonomyInfo,
    TopicClusterSummary
  >();

  const visualResolver = useMemo(() => createDemoVisualResolver(preset), [preset]);

  // Mutation handlers
  const handleAddItems = useCallback((count: number) => {
    const additions: KnowledgeEntry[] = [];
    for (let i = 0; i < count; i++) {
      dynamicSeqRef.current += 1;
      additions.push(createDynamicEntry(dynamicSeqRef.current));
    }
    setItems((prev) => [...prev, ...additions]);
  }, []);

  const handleRemoveItems = useCallback((count: number) => {
    setItems((prev) => {
      if (prev.length <= 3) return prev;
      const keepCount = Math.max(3, prev.length - count);
      return prev.slice(0, keepCount);
    });
  }, []);

  const handleResetCatalog = useCallback(() => {
    setRapidFireActive(false);
    setPinnedIds(new Set());
    setHighlightedIds(new Set());
    setFocusedClusterUid(null);
    setInspected(null);
    setItems(initialCatalog);
  }, [initialCatalog]);

  // Rapid-Fire Mutation Stress Test (mutates every 250ms mid-transition!)
  useEffect(() => {
    if (!rapidFireActive) return;
    let tick = 0;
    const timer = window.setInterval(() => {
      tick += 1;
      if (tick > 16) {
        setRapidFireActive(false);
        return;
      }
      if (tick % 3 === 0) {
        handleRemoveItems(4);
      } else {
        handleAddItems(3);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [rapidFireActive, handleAddItems, handleRemoveItems]);

  // Close context menu on Escape or outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  // Interaction callbacks wired to configured policies
  const onContentHover = useCallback(
    (
      ev: ContentHoverEvent<
        KnowledgeEntry,
        DemoContentVisual,
        TagTaxonomyInfo,
        TopicClusterSummary
      > | null,
    ) => {
      if (contentHoverPolicy === 'none') {
        setHoveredContent(null);
        return;
      }
      if (contentHoverPolicy === 'highlight-unit') {
        if (!ev) {
          setHighlightedIds(new Set());
          setHoveredContent(null);
          return;
        }
        const neighborIds = new Set<string>([ev.layoutContext.id]);
        for (const uc of ev.layoutContext.unitClusters) {
          for (const m of uc.cluster.members) {
            neighborIds.add(m.itemId);
          }
        }
        setHighlightedIds(neighborIds);
        setHoveredContent(ev);
        return;
      }
      setHoveredContent(ev);
    },
    [contentHoverPolicy],
  );

  const onClusterHover = useCallback(
    (
      ev: ClusterHoverEvent<
        KnowledgeEntry,
        DemoClusterVisual,
        TagTaxonomyInfo,
        TopicClusterSummary
      > | null,
    ) => {
      if (clusterHoverPolicy === 'none') {
        setHoveredCluster(null);
        return;
      }
      if (clusterHoverPolicy === 'focus-members') {
        setFocusedClusterUid(ev ? ev.cluster.clusterUid : null);
        setHoveredCluster(ev);
        return;
      }
      setHoveredCluster(ev);
    },
    [clusterHoverPolicy],
  );

  const togglePinId = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onLeftClick = useCallback(
    (
      target: HitTarget<
        KnowledgeEntry,
        DemoContentVisual,
        DemoClusterVisual,
        TagTaxonomyInfo,
        TopicClusterSummary
      >,
    ) => {
      setContextMenu(null);
      if (target.kind === 'background') {
        if (leftClickPolicy === 'focus-toggle') {
          setFocusedClusterUid(null);
          setHighlightedIds(new Set());
        } else if (leftClickPolicy === 'inspect') {
          setInspected(null);
        }
        return;
      }

      if (leftClickPolicy === 'remove') {
        if (target.kind === 'content') {
          const slugToRemove = target.item.slug;
          setItems((prev) => prev.filter((it) => it.slug !== slugToRemove));
        }
        return;
      }

      if (leftClickPolicy === 'focus-toggle') {
        if (target.kind === 'cluster') {
          setFocusedClusterUid((cur) =>
            cur === target.cluster.clusterUid ? null : target.cluster.clusterUid,
          );
        } else {
          const ids = new Set<string>([target.item.slug]);
          for (const uc of target.layoutContext.unitClusters) {
            for (const m of uc.cluster.members) {
              ids.add(m.itemId);
            }
          }
          setHighlightedIds(ids);
        }
        return;
      }

      // Default: 'inspect'
      if (target.kind === 'content') {
        togglePinId(target.item.slug);
        setInspected({
          kind: 'content',
          item: target.item,
          clusterTitles: target.layoutContext.unitClusters.map(
            (uc) => `${uc.cluster.code} (${Math.round(uc.weight * 100)}%)`,
          ),
          mixedColorHex: target.layoutContext.mixedColorHex,
        });
      } else {
        setFocusedClusterUid((cur) =>
          cur === target.cluster.clusterUid ? null : target.cluster.clusterUid,
        );
        setInspected({
          kind: 'cluster',
          cluster: target.cluster,
        });
      }
    },
    [leftClickPolicy, togglePinId],
  );

  const onRightClick = useCallback(
    (
      target: HitTarget<
        KnowledgeEntry,
        DemoContentVisual,
        DemoClusterVisual,
        TagTaxonomyInfo,
        TopicClusterSummary
      >,
      _raw: NormalizedPointerEvent,
    ): boolean | void => {
      if (rightClickPolicy === 'browser-default') return false;
      setContextMenu({
        x: target.screenPosition.x,
        y: target.screenPosition.y,
        target,
      });
      return true;
    },
    [rightClickPolicy],
  );

  const wheelBehavior: WheelBehavior = wheelPolicy;

  const scrollControlSection = (
    section: 'atlas' | 'rendering' | 'geometry' | 'interaction',
  ) => {
    setActiveNavSection(section);
    if (section !== 'atlas') {
      setMobilePanelOpen(true);
    }
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#07090E] text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex h-13 shrink-0 items-center justify-between gap-8 border-b border-slate-800/80 bg-[#0B0F17] px-5">
        <a
          href="#atlas"
          onClick={(e) => {
            e.preventDefault();
            scrollControlSection('atlas');
          }}
          className="flex items-center gap-2.5 text-base font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0"
        >
          <SimplexLogoMark className="h-7 w-7 shrink-0" />
          <span>
            Simplex<span className="text-cyan-400">Viz</span>
          </span>
        </a>

        <nav
          aria-label="Workspace"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400"
        >
          {(
            [
              ['atlas', 'Atlas'],
              ['rendering', 'Rendering'],
              ['geometry', 'Geometry'],
              ['interaction', 'Interaction'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => scrollControlSection(key)}
              className={`cursor-pointer transition-colors whitespace-nowrap shrink-0 pb-0.5 border-b ${
                activeNavSection === key
                  ? 'border-cyan-400 text-slate-100'
                  : 'border-transparent hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobilePanelOpen((v) => !v)}
            className="lg:hidden rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="inline h-3.5 w-3.5 mr-1.5" />
            Controls
          </button>
          <button
            type="button"
            onClick={() => handle.resetCamera()}
            className="cursor-pointer rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0"
          >
            Reset Camera
          </button>
        </div>
      </header>

      {/* Main Split Console */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left Control & Telemetry Column */}
        <aside
          className={`${
            mobilePanelOpen ? 'flex' : 'hidden'
          } lg:flex w-[340px] shrink-0 flex-col overflow-y-auto border-r border-slate-800/80 bg-[#0B0F17] z-20`}
        >
          {/* Section 1: Visual Preset Switcher */}
          <section
            className={`p-4 border-b border-slate-800/80 ${
              activeNavSection === 'rendering' ? 'bg-slate-900/40' : ''
            }`}
          >
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-300">
                Rendering Plugin
              </h2>
              <span className="font-mono text-[11px] text-slate-400">
                Live Crossfade
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {(
                [
                  [
                    'geometric',
                    'A · Geometric Encoding',
                    'SvgNodeView with 64-point morphing',
                  ],
                  [
                    'multisector',
                    'B · Topic Glyphs & Badges',
                    'Multi-sector donut + getBBox() pills',
                  ],
                  [
                    'react-cards',
                    'C · React JSX Mini-Cards',
                    'Declarative JSX + auto-scaling',
                  ],
                ] as const
              ).map(([id, title, sub]) => {
                const active = preset === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPreset(id)}
                    className={`cursor-pointer rounded-md border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-cyan-500/60 bg-cyan-500/10 text-slate-50'
                        : 'border-slate-800 bg-[#0E131D] text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="text-xs font-semibold">{title}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Section 2: Dynamic Mutations & Rapid-Fire Stress Test */}
          <section className="p-4 border-b border-slate-800/80">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-300">
                Dynamic Mutations
              </h2>
              <button
                type="button"
                onClick={handleResetCatalog}
                className="cursor-pointer text-[11px] text-slate-400 hover:text-cyan-300 transition-colors"
              >
                Reset
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              <button
                type="button"
                onClick={() => handleAddItems(1)}
                className="cursor-pointer rounded-md border border-slate-700/80 bg-[#0E131D] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/50 hover:text-cyan-200 transition-colors whitespace-nowrap"
              >
                + 1 Item
              </button>
              <button
                type="button"
                onClick={() => handleAddItems(10)}
                className="cursor-pointer rounded-md border border-slate-700/80 bg-[#0E131D] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/50 hover:text-cyan-200 transition-colors whitespace-nowrap"
              >
                + 10 Items
              </button>
              <button
                type="button"
                onClick={() => handleRemoveItems(1)}
                className="cursor-pointer rounded-md border border-slate-700/80 bg-[#0E131D] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-200 transition-colors whitespace-nowrap"
              >
                - 1 Item
              </button>
              <button
                type="button"
                onClick={() => handleRemoveItems(10)}
                className="cursor-pointer rounded-md border border-slate-700/80 bg-[#0E131D] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-200 transition-colors whitespace-nowrap"
              >
                - 10 Items
              </button>
            </div>
            <button
              type="button"
              onClick={() => setRapidFireActive((v) => !v)}
              className={`cursor-pointer flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                rapidFireActive
                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                  : 'border-slate-700 bg-slate-900/70 text-slate-200 hover:border-cyan-500/50'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              {rapidFireActive
                ? 'Rapid-Fire Running (250 ms)… Stop'
                : 'Rapid-Fire Mutation Test'}
            </button>
          </section>

          {/* Section 3: Collision & Geometry Inspector */}
          <section
            className={`p-4 border-b border-slate-800/80 ${
              activeNavSection === 'geometry' ? 'bg-slate-900/40' : ''
            }`}
          >
            <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-300">
              Collision &amp; Geometry Inspector
            </h2>

            <label className="block mb-3">
              <div className="flex items-center justify-between text-xs text-slate-300 mb-1.5">
                <span>Size Multiplier</span>
                <span className="font-mono text-cyan-300">
                  {sizeMultiplier.toFixed(2)}×
                </span>
              </div>
              <input
                type="range"
                min={0.6}
                max={2.2}
                step={0.05}
                value={sizeMultiplier}
                onChange={(e) => setSizeMultiplier(parseFloat(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-md border border-slate-800 bg-[#0E131D] px-3 py-2 text-xs text-slate-200 mb-3">
              <span>Show Convex Bounding Hulls</span>
              <input
                type="checkbox"
                checked={showHulls}
                onChange={(e) => setShowHulls(e.target.checked)}
                className="h-4 w-4 accent-cyan-400 cursor-pointer"
              />
            </label>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-slate-800 bg-slate-800/70">
              <div className="bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-400">Clusters K</div>
                <div className="font-mono text-base font-semibold text-slate-100">
                  {metrics.clusterCount}
                </div>
              </div>
              <div className="bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-400">Items</div>
                <div className="font-mono text-base font-semibold text-slate-100">
                  {metrics.itemCount}
                </div>
              </div>
              <div className="bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-400">α Cluster</div>
                <div className="font-mono text-base font-semibold text-amber-300">
                  {metrics.clusterScale.toFixed(3)}
                </div>
              </div>
              <div className="bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-400">α Content</div>
                <div className="font-mono text-base font-semibold text-cyan-300">
                  {metrics.contentScale.toFixed(3)}
                </div>
              </div>
              <div className="bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-400">Overlaps</div>
                <div
                  className={`font-mono text-base font-semibold ${
                    metrics.overlapCount === 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {metrics.overlapCount}
                </div>
              </div>
              <div className="bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-400">Frame Rate</div>
                <div className="font-mono text-base font-semibold text-slate-100">
                  {fps} <span className="text-[11px] text-slate-400 font-normal">fps</span>
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: Interaction Configurator */}
          <section
            className={`p-4 ${
              activeNavSection === 'interaction' ? 'bg-slate-900/40' : ''
            }`}
          >
            <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-300">
              Interaction Configurator
            </h2>
            <div className="space-y-2.5 text-xs">
              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-400">Hover Content</span>
                <select
                  value={contentHoverPolicy}
                  onChange={(e) =>
                    setContentHoverPolicy(e.target.value as ContentHoverPolicy)
                  }
                  className="w-full rounded-md border border-slate-700/80 bg-[#0E131D] px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="tooltip">Show Tooltip Card</option>
                  <option value="highlight-unit">Highlight Simplex Neighbors</option>
                  <option value="none">Disabled</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-400">Hover Cluster</span>
                <select
                  value={clusterHoverPolicy}
                  onChange={(e) =>
                    setClusterHoverPolicy(e.target.value as ClusterHoverPolicy)
                  }
                  className="w-full rounded-md border border-slate-700/80 bg-[#0E131D] px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="tooltip">Show Cluster Stats</option>
                  <option value="focus-members">Isolate Members</option>
                  <option value="none">Disabled</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-400">Left Click</span>
                <select
                  value={leftClickPolicy}
                  onChange={(e) => setLeftClickPolicy(e.target.value as LeftClickPolicy)}
                  className="w-full rounded-md border border-slate-700/80 bg-[#0E131D] px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="inspect">Pin &amp; Inspect Details</option>
                  <option value="focus-toggle">Focus Unit / Cluster</option>
                  <option value="remove">Remove Item Directly</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-400">Right Click</span>
                <select
                  value={rightClickPolicy}
                  onChange={(e) => setRightClickPolicy(e.target.value as RightClickPolicy)}
                  className="w-full rounded-md border border-slate-700/80 bg-[#0E131D] px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="context-menu">Open Custom Context Menu</option>
                  <option value="browser-default">Browser Default Menu</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-400">Mouse Scroll</span>
                <select
                  value={wheelPolicy}
                  onChange={(e) =>
                    setWheelPolicy(
                      e.target.value as 'zoom-to-cursor' | 'pan-vertical' | 'none',
                    )
                  }
                  className="w-full rounded-md border border-slate-700/80 bg-[#0E131D] px-2.5 py-1.5 text-xs text-slate-200"
                >
                  <option value="zoom-to-cursor">Zoom to Cursor</option>
                  <option value="pan-vertical">Pan Vertical / Horizontal</option>
                  <option value="none">Disabled</option>
                </select>
              </label>
            </div>
          </section>
        </aside>

        {/* Main Triangulation Viewport Stage */}
        <main ref={stageRef} className="relative min-w-0 flex-1 bg-[#07090E]">
          <SimplexTopicGraph<
            KnowledgeEntry,
            DemoContentVisual,
            DemoClusterVisual,
            TagTaxonomyInfo,
            TopicClusterSummary
          >
            controllerRef={controllerRef}
            items={items}
            getId={(entry) => entry.slug}
            getTags={(entry) => entry.hashtags}
            resolveTagMeta={resolveDemoTagMeta}
            deriveClusterMeta={deriveDemoClusterMeta}
            visualResolver={visualResolver}
            contentView={
              preset === 'geometric'
                ? demoGeometricContentView
                : preset === 'multisector'
                  ? demoMultiSectorContentView
                  : undefined
            }
            clusterView={
              preset === 'geometric'
                ? demoAnchorClusterView
                : preset === 'multisector'
                  ? demoBadgeClusterView
                  : undefined
            }
            renderContentNode={preset === 'react-cards' ? renderDemoContentCard : undefined}
            renderClusterNode={preset === 'react-cards' ? renderDemoClusterCard : undefined}
            sizeMultiplier={sizeMultiplier}
            showHulls={showHulls}
            pinnedIds={pinnedIds}
            highlightedIds={highlightedIds}
            focusedClusterUid={focusedClusterUid}
            meshOptions={{
              innerPadding: 54,
              minSideLength: 140,
              maxSideLength: 280,
              maxClusters: 10,
            }}
            layoutOptions={{
              clusterGapPx: 14,
              itemGapPx: 5,
              seed: 20261113,
            }}
            onContentHover={onContentHover}
            onClusterHover={onClusterHover}
            onLeftClick={onLeftClick}
            onRightClick={onRightClick}
            onWheel={wheelBehavior}
            onMetricsChange={setMetrics}
            onFpsUpdate={setFps}
          />

          {/* Camera Zoom Overlay Controls */}
          <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded-md border border-slate-800 bg-[#0B0F17]/95 p-1">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => handle.zoomBy(1.22)}
              className="cursor-pointer rounded p-1.5 text-slate-300 hover:bg-slate-800 hover:text-slate-50 transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => handle.zoomBy(0.82)}
              className="cursor-pointer rounded p-1.5 text-slate-300 hover:bg-slate-800 hover:text-slate-50 transition-colors"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Reset view"
              onClick={() => handle.resetCamera()}
              className="cursor-pointer rounded p-1.5 text-slate-300 hover:bg-slate-800 hover:text-slate-50 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Floating Content Hover Tooltip */}
          {hoveredContent && !contextMenu && (
            <div
              className="pointer-events-none absolute z-30 max-w-xs rounded-md border border-slate-700/90 bg-[#0B0F17]/95 px-3 py-2 text-xs shadow-lg"
              style={{
                left: Math.min(
                  (stageRef.current?.clientWidth ?? 900) - 270,
                  hoveredContent.screenPosition.x + 14,
                ),
                top: Math.max(12, hoveredContent.screenPosition.y - 12),
              }}
            >
              <div className="font-semibold text-slate-100 leading-snug">
                {hoveredContent.item.headline}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-400">
                <span>{hoveredContent.item.contentType}</span>
                <span aria-hidden="true">·</span>
                <span>{hoveredContent.item.readingMinutes} min</span>
                <span aria-hidden="true">·</span>
                <span>{hoveredContent.item.publishedYear}</span>
              </div>
              <div className="mt-1 text-[11px] text-cyan-300">
                {hoveredContent.layoutContext.tags
                  .map((t) => t.meta?.displayTitle ?? t.tag)
                  .join(' · ')}
              </div>
            </div>
          )}

          {/* Floating Cluster Hover Tooltip */}
          {hoveredCluster && !hoveredContent && !contextMenu && (
            <div
              className="pointer-events-none absolute z-30 max-w-xs rounded-md border border-slate-700/90 bg-[#0B0F17]/95 px-3 py-2 text-xs shadow-lg"
              style={{
                left: Math.min(
                  (stageRef.current?.clientWidth ?? 900) - 270,
                  hoveredCluster.screenPosition.x + 14,
                ),
                top: Math.max(12, hoveredCluster.screenPosition.y - 12),
              }}
            >
              <div className="flex items-center gap-2 font-semibold text-slate-100">
                <span className="font-mono text-cyan-300">
                  {hoveredCluster.cluster.code}
                </span>
                <span>{hoveredCluster.cluster.meta.title}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                <span>{hoveredCluster.cluster.meta.memberCount} items</span>
                <span aria-hidden="true">·</span>
                <span>
                  avg {hoveredCluster.cluster.meta.avgReadingMinutes.toFixed(1)} min
                </span>
                <span aria-hidden="true">·</span>
                <span>{hoveredCluster.cluster.meta.dominantType}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-300">
                Core:{' '}
                {hoveredCluster.cluster.coreTags
                  .map((t) => t.meta?.displayTitle ?? t.tag)
                  .join(', ')}
              </div>
            </div>
          )}

          {/* Custom Right-Click Context Menu */}
          {contextMenu && (
            <div
              className="absolute z-40 w-52 rounded-md border border-slate-700 bg-[#0B0F17] py-1 text-xs shadow-xl"
              style={{
                left: Math.min(
                  (stageRef.current?.clientWidth ?? 900) - 216,
                  contextMenu.x,
                ),
                top: Math.min(
                  (stageRef.current?.clientHeight ?? 600) - 150,
                  contextMenu.y,
                ),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {contextMenu.target.kind === 'content' && (
                <>
                  <div className="border-b border-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-300 truncate">
                    {contextMenu.target.item.headline}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const slug =
                        contextMenu.target.kind === 'content'
                          ? contextMenu.target.item.slug
                          : '';
                      if (slug) togglePinId(slug);
                      setContextMenu(null);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-slate-800"
                  >
                    <Pin className="h-3.5 w-3.5 text-amber-400" />
                    {pinnedIds.has(contextMenu.target.item.slug)
                      ? 'Unpin node'
                      : 'Pin node'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const slug =
                        contextMenu.target.kind === 'content'
                          ? contextMenu.target.item.slug
                          : '';
                      if (slug) {
                        setItems((prev) => prev.filter((it) => it.slug !== slug));
                      }
                      setContextMenu(null);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-rose-300 hover:bg-slate-800"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove item
                  </button>
                </>
              )}

              {contextMenu.target.kind === 'cluster' && (
                <>
                  <div className="border-b border-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-300 truncate">
                    {contextMenu.target.cluster.code} ·{' '}
                    {contextMenu.target.cluster.meta.title}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (contextMenu.target.kind === 'cluster') {
                        const uid = contextMenu.target.cluster.clusterUid;
                        setFocusedClusterUid((cur) => (cur === uid ? null : uid));
                      }
                      setContextMenu(null);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-slate-800"
                  >
                    <Crosshair className="h-3.5 w-3.5 text-cyan-400" />
                    Focus cluster members
                  </button>
                </>
              )}

              {contextMenu.target.kind === 'background' && (
                <button
                  type="button"
                  onClick={() => {
                    handle.resetCamera();
                    setFocusedClusterUid(null);
                    setHighlightedIds(new Set());
                    setContextMenu(null);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-slate-200 hover:bg-slate-800"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-cyan-400" />
                  Reset camera &amp; focus
                </button>
              )}
            </div>
          )}

          {/* Selected / Inspected Node Detail Panel */}
          {inspected && (
            <div className="absolute top-4 right-4 z-30 w-80 rounded-md border border-slate-800 bg-[#0B0F17]/95 p-3.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  {inspected.kind === 'content' ? (
                    <div className="text-sm font-semibold text-slate-100 leading-snug">
                      {inspected.item.headline}
                    </div>
                  ) : (
                    <div className="text-sm font-semibold text-slate-100 leading-snug">
                      <span className="font-mono text-cyan-300 mr-1.5">
                        {inspected.cluster.code}
                      </span>
                      {inspected.cluster.meta.title}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Close inspector"
                  onClick={() => {
                    setInspected(null);
                    setFocusedClusterUid(null);
                  }}
                  className="cursor-pointer rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {inspected.kind === 'content' ? (
                <div className="mt-2.5 space-y-2">
                  <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                    <span>{inspected.item.slug}</span>
                    <span aria-hidden="true">·</span>
                    <span>{inspected.item.contentType}</span>
                    <span aria-hidden="true">·</span>
                    <span>{inspected.item.readingMinutes} min</span>
                  </div>
                  <div className="text-[11px] text-slate-300">
                    <span className="text-slate-400">Unit: </span>
                    {inspected.clusterTitles.join(', ')}
                  </div>
                  <div className="text-[11px] text-cyan-300">
                    {inspected.item.hashtags
                      .map((h) => resolveDemoTagMeta(h)?.displayTitle ?? h)
                      .join(' · ')}
                  </div>
                </div>
              ) : (
                <div className="mt-2.5 space-y-2">
                  <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                    <span>{inspected.cluster.meta.memberCount} members</span>
                    <span aria-hidden="true">·</span>
                    <span>{inspected.cluster.meta.exclusiveCount} exclusive</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      avg {inspected.cluster.meta.avgReadingMinutes.toFixed(1)} min
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-300">
                    <span className="text-slate-400">Core Tags: </span>
                    {inspected.cluster.coreTags
                      .map((t) => t.meta?.displayTitle ?? t.tag)
                      .join(', ')}
                  </div>
                  {inspected.cluster.sharedTags.length > 0 && (
                    <div className="text-[11px] text-amber-300">
                      <span className="text-slate-400">Shared Tags: </span>
                      {inspected.cluster.sharedTags
                        .map((t) => t.meta?.displayTitle ?? t.tag)
                        .join(', ')}
                    </div>
                  )}
                  <div className="max-h-32 overflow-y-auto border-t border-slate-800 pt-2 space-y-1">
                    {inspected.cluster.members.slice(0, 8).map((m) => (
                      <div
                        key={m.itemId}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="truncate text-slate-200">
                          {m.item.headline}
                        </span>
                        <span className="font-mono text-slate-400 shrink-0">
                          {Math.round(m.normalizedWeight * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
