import type {
  ClusterDescriptor,
  ClusterHoverEvent,
  ContentHoverEvent,
  HitTarget,
  LayoutMetrics,
  MeshOptions,
  NormalizedPointerEvent,
  WheelBehavior,
} from '@simplex-viz/core';
import {
  SimplexTopicGraph,
  createAdaptiveHexMeshStrategy,
  createFixedLatticeMeshStrategy,
  createIncrementalAnchorClusteringStrategy,
  createJaccardAnnealingClusteringStrategy,
  createLocalAdaptiveLayoutStrategy,
  createOklabContrastColorStrategy,
  createPaletteColorStrategy,
  createPbdUniformLayoutStrategy,
  createThemeAdaptiveOklabColorStrategy,
  createWarmStartPbdLayoutStrategy,
  useSimplexGraphController,
  type SharedTagRuleKind,
  type SimplexAnchorRuleKind,
  type SimplexTheme,
} from '@simplex-viz/react';
import {
  Crosshair,
  Minus,
  Monitor,
  Moon,
  PanelLeftClose,
  Pin,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sun,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { version as libraryVersion } from '../../packages/core/package.json';
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

type ThemePreference = 'auto' | 'light' | 'dark';
type ContentHoverPolicy = 'tooltip' | 'highlight-unit' | 'none';
type ClusterHoverPolicy = 'tooltip' | 'focus-members' | 'none';
type LeftClickPolicy = 'inspect' | 'focus-toggle' | 'remove';
type RightClickPolicy = 'context-menu' | 'browser-default';
type MeshStrategyId = 'adaptive' | 'lattice-3x3' | 'lattice-4x3';
type ClusteringStrategyId = 'jaccard-annealing' | 'incremental-anchor';
type ColorStrategyId =
  | 'oklab-contrast'
  | 'theme-adaptive'
  | 'curated-palette'
  | 'nordic-palette';
type LayoutStrategyId = 'pbd-uniform' | 'pbd-warm-start' | 'local-adaptive';
type CombinationRecipeId = 'default' | 'editorial' | 'dense' | 'strict';

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

  // Pluggable Core Strategy selections
  const [meshStrategyId, setMeshStrategyId] = useState<MeshStrategyId>('adaptive');
  const [clusteringStrategyId, setClusteringStrategyId] =
    useState<ClusteringStrategyId>('jaccard-annealing');
  const [sharedTagRule, setSharedTagRule] =
    useState<SharedTagRuleKind>('planar-hitting-set');
  const [anchorRule, setAnchorRule] =
    useState<SimplexAnchorRuleKind>('explaining-away');
  const [colorStrategyId, setColorStrategyId] =
    useState<ColorStrategyId>('oklab-contrast');
  const [layoutStrategyId, setLayoutStrategyId] =
    useState<LayoutStrategyId>('pbd-uniform');

  // Privacy-safe in-memory theme state (never persisted to storage or cookies)
  const [themePreference, setThemePreference] = useState<ThemePreference>('auto');
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: SimplexTheme =
    themePreference === 'auto' ? (systemDark ? 'dark' : 'light') : themePreference;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', resolvedTheme === 'dark' ? '#07090E' : '#F8FAFC');
    }
  }, [resolvedTheme]);

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
  const [controlsOpen, setControlsOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  );
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));

  const dynamicSeqRef = useRef<number>(200);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const updateSize = (w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      setStageSize((prev) =>
        Math.abs(prev.width - w) < 24 && Math.abs(prev.height - h) < 24
          ? prev
          : { width: Math.round(w), height: Math.round(h) },
      );
    };
    const rect = el.getBoundingClientRect();
    updateSize(rect.width, rect.height);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateSize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const responsiveMeshOptions: MeshOptions = useMemo(() => {
    const minDim = Math.min(stageSize.width, stageSize.height);
    const maxDim = Math.max(stageSize.width, stageSize.height);
    if (minDim < 460) {
      return {
        innerPadding: 28,
        minSideLength: 88,
        maxSideLength: 195,
        maxClusters: 8,
      };
    }
    if (minDim < 920 && maxDim < 1800) {
      return {
        innerPadding: 44,
        minSideLength: 125,
        maxSideLength: 280,
        maxClusters: 10,
      };
    }
    return {
      innerPadding: 56,
      minSideLength: 160,
      maxSideLength: Math.min(440, Math.max(280, Math.round(maxDim * 0.22))),
      maxClusters: 12,
    };
  }, [stageSize.width, stageSize.height]);

  const { controllerRef, handle } = useSimplexGraphController<
    KnowledgeEntry,
    DemoContentVisual,
    DemoClusterVisual,
    TagTaxonomyInfo,
    TopicClusterSummary
  >();

  const visualResolver = useMemo(
    () => createDemoVisualResolver(preset, resolvedTheme),
    [preset, resolvedTheme],
  );

  const meshStrategy = useMemo(() => {
    if (meshStrategyId === 'lattice-3x3') {
      return createFixedLatticeMeshStrategy<KnowledgeEntry>({ cols: 3, rows: 3 });
    }
    if (meshStrategyId === 'lattice-4x3') {
      return createFixedLatticeMeshStrategy<KnowledgeEntry>({ cols: 4, rows: 3 });
    }
    return createAdaptiveHexMeshStrategy<KnowledgeEntry>();
  }, [meshStrategyId]);

  const clusteringStrategy = useMemo(() => {
    if (clusteringStrategyId === 'incremental-anchor') {
      return createIncrementalAnchorClusteringStrategy<
        KnowledgeEntry,
        TagTaxonomyInfo
      >({
        sharedTagRule,
        anchorRule,
      });
    }
    return createJaccardAnnealingClusteringStrategy<
      KnowledgeEntry,
      TagTaxonomyInfo
    >({
      sharedTagRule,
      anchorRule,
    });
  }, [clusteringStrategyId, sharedTagRule, anchorRule]);

  const colorStrategy = useMemo(() => {
    if (colorStrategyId === 'theme-adaptive') {
      return createThemeAdaptiveOklabColorStrategy<
        KnowledgeEntry,
        TagTaxonomyInfo
      >();
    }
    if (colorStrategyId === 'curated-palette') {
      return createPaletteColorStrategy<KnowledgeEntry, TagTaxonomyInfo>(
        ['#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#f97316'],
        { mode: 'edge-contrast' },
      );
    }
    if (colorStrategyId === 'nordic-palette') {
      return createPaletteColorStrategy<KnowledgeEntry, TagTaxonomyInfo>(
        ['#0284c7', '#0d9488', '#475569', '#0369a1', '#0f766e', '#64748b'],
        { mode: 'edge-contrast' },
      );
    }
    return createOklabContrastColorStrategy<KnowledgeEntry, TagTaxonomyInfo>();
  }, [colorStrategyId]);

  const layoutStrategy = useMemo(() => {
    if (layoutStrategyId === 'pbd-warm-start') {
      return createWarmStartPbdLayoutStrategy();
    }
    if (layoutStrategyId === 'local-adaptive') {
      return createLocalAdaptiveLayoutStrategy({
        crowdRadiusPx: 72,
        minLocalScale: 0.42,
        warmStart: true,
      });
    }
    return createPbdUniformLayoutStrategy();
  }, [layoutStrategyId]);

  const applyCombinationRecipe = useCallback((recipeId: CombinationRecipeId) => {
    if (recipeId === 'default') {
      setPreset('geometric');
      setMeshStrategyId('adaptive');
      setClusteringStrategyId('jaccard-annealing');
      setSharedTagRule('planar-hitting-set');
      setAnchorRule('explaining-away');
      setColorStrategyId('oklab-contrast');
      setLayoutStrategyId('pbd-uniform');
      return;
    }
    if (recipeId === 'editorial') {
      setPreset('react-cards');
      setMeshStrategyId('lattice-3x3');
      setClusteringStrategyId('incremental-anchor');
      setSharedTagRule('planar-hitting-set');
      setAnchorRule('explaining-away');
      setColorStrategyId('theme-adaptive');
      setLayoutStrategyId('pbd-warm-start');
      return;
    }
    if (recipeId === 'dense') {
      setPreset('multisector');
      setMeshStrategyId('lattice-4x3');
      setClusteringStrategyId('jaccard-annealing');
      setSharedTagRule('planar-hitting-set');
      setAnchorRule('barycentric-all');
      setColorStrategyId('curated-palette');
      setLayoutStrategyId('local-adaptive');
      return;
    }
    setPreset('geometric');
    setMeshStrategyId('adaptive');
    setClusteringStrategyId('jaccard-annealing');
    setSharedTagRule('none');
    setAnchorRule('raw-overlap');
    setColorStrategyId('nordic-palette');
    setLayoutStrategyId('pbd-uniform');
  }, []);

  const activeRecipe: CombinationRecipeId | null = useMemo(() => {
    if (
      preset === 'geometric' &&
      meshStrategyId === 'adaptive' &&
      clusteringStrategyId === 'jaccard-annealing' &&
      sharedTagRule === 'planar-hitting-set' &&
      anchorRule === 'explaining-away' &&
      colorStrategyId === 'oklab-contrast' &&
      layoutStrategyId === 'pbd-uniform'
    ) {
      return 'default';
    }
    if (
      preset === 'react-cards' &&
      meshStrategyId === 'lattice-3x3' &&
      clusteringStrategyId === 'incremental-anchor' &&
      sharedTagRule === 'planar-hitting-set' &&
      anchorRule === 'explaining-away' &&
      colorStrategyId === 'theme-adaptive' &&
      layoutStrategyId === 'pbd-warm-start'
    ) {
      return 'editorial';
    }
    if (
      preset === 'multisector' &&
      meshStrategyId === 'lattice-4x3' &&
      clusteringStrategyId === 'jaccard-annealing' &&
      sharedTagRule === 'planar-hitting-set' &&
      anchorRule === 'barycentric-all' &&
      colorStrategyId === 'curated-palette' &&
      layoutStrategyId === 'local-adaptive'
    ) {
      return 'dense';
    }
    if (
      preset === 'geometric' &&
      meshStrategyId === 'adaptive' &&
      clusteringStrategyId === 'jaccard-annealing' &&
      sharedTagRule === 'none' &&
      anchorRule === 'raw-overlap' &&
      colorStrategyId === 'nordic-palette' &&
      layoutStrategyId === 'pbd-uniform'
    ) {
      return 'strict';
    }
    return null;
  }, [
    preset,
    meshStrategyId,
    clusteringStrategyId,
    sharedTagRule,
    anchorRule,
    colorStrategyId,
    layoutStrategyId,
  ]);

  const effectivePinnedIds = useMemo(() => {
    if (inspected?.kind !== 'content' || pinnedIds.has(inspected.item.slug)) {
      return pinnedIds;
    }
    const merged = new Set(pinnedIds);
    merged.add(inspected.item.slug);
    return merged;
  }, [pinnedIds, inspected]);

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

  const removeItemBySlug = useCallback((slug: string) => {
    setItems((prev) => prev.filter((it) => it.slug !== slug));
    setPinnedIds((prev) => {
      if (!prev.has(slug)) return prev;
      const next = new Set(prev);
      next.delete(slug);
      return next;
    });
    setInspected((cur) =>
      cur?.kind === 'content' && cur.item.slug === slug ? null : cur,
    );
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
          setFocusedClusterUid(null);
        }
        return;
      }

      if (leftClickPolicy === 'remove') {
        if (target.kind === 'content') {
          removeItemBySlug(target.item.slug);
        }
        return;
      }

      if (leftClickPolicy === 'focus-toggle') {
        if (target.kind === 'cluster') {
          setHighlightedIds(new Set());
          setFocusedClusterUid((cur) =>
            cur === target.cluster.clusterUid ? null : target.cluster.clusterUid,
          );
        } else {
          setFocusedClusterUid(null);
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

      // Default: 'inspect' (single-select across content items & clusters)
      if (target.kind === 'content') {
        setFocusedClusterUid(null);
        setInspected((cur) =>
          cur?.kind === 'content' && cur.item.slug === target.item.slug
            ? null
            : {
                kind: 'content',
                item: target.item,
                clusterTitles: target.layoutContext.unitClusters.map(
                  (uc) => `${uc.cluster.code} (${Math.round(uc.weight * 100)}%)`,
                ),
                mixedColorHex: target.layoutContext.mixedColorHex,
              },
        );
      } else {
        setFocusedClusterUid((cur) =>
          cur === target.cluster.clusterUid ? null : target.cluster.clusterUid,
        );
        setInspected((cur) =>
          cur?.kind === 'cluster' &&
          cur.cluster.clusterUid === target.cluster.clusterUid
            ? null
            : {
                kind: 'cluster',
                cluster: target.cluster,
              },
        );
      }
    },
    [leftClickPolicy, removeItemBySlug],
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

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#07090E] dark:text-slate-100">
      {/* Minimal Header Bar: Brand + Version + Theme Switcher */}
      <header className="flex h-12 sm:h-13 shrink-0 items-center justify-between gap-2 sm:gap-4 border-b border-slate-200/90 bg-white px-3 sm:px-5 dark:border-slate-800/80 dark:bg-[#0B0F17]">
        <div className="flex items-center gap-2 sm:gap-2.5 text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0">
          <SimplexLogoMark className="h-6 w-6 sm:h-7 sm:w-7 shrink-0" />
          <span>
            Simplex<span className="text-[#06B6D4]">Viz</span>
          </span>
          <span className="rounded border border-slate-200/90 bg-slate-100/80 px-1.5 py-0.5 font-mono text-[10px] sm:text-[11px] font-medium text-slate-600 dark:border-slate-800 dark:bg-[#0E131D] dark:text-slate-400">
            v{libraryVersion}
          </span>
        </div>

        {/* Manual & Auto Theme Switcher (in-memory only, zero persistence) */}
        <div
          role="group"
          aria-label="Color theme"
          className="flex items-center rounded-md border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-[#0E131D] shrink-0"
        >
          {(
            [
              ['auto', 'Auto', Monitor],
              ['light', 'Light', Sun],
              ['dark', 'Dark', Moon],
            ] as const
          ).map(([opt, label, Icon]) => {
            const active = themePreference === opt;
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={active}
                title={
                  opt === 'auto'
                    ? `Auto (system: ${systemDark ? 'Dark' : 'Light'})`
                    : `${label} mode`
                }
                onClick={() => setThemePreference(opt)}
                className={`cursor-pointer flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-cyan-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Split Console */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Tap-outside Backdrop for Mobile/Tablet Fly-Out Drawer */}
        {controlsOpen && (
          <div
            aria-hidden="true"
            onClick={() => setControlsOpen(false)}
            className="absolute inset-0 z-20 bg-slate-950/35 backdrop-blur-[1px] lg:hidden"
          />
        )}

        {/* Left Fly-Out Control & Telemetry Column */}
        {controlsOpen && (
          <aside className="absolute inset-y-0 left-0 z-30 flex w-[min(340px,88vw)] sm:w-[330px] lg:w-[320px] xl:w-[348px] 2xl:w-[372px] shrink-0 flex-col overflow-y-auto border-r border-slate-200/90 bg-white shadow-xl dark:border-slate-800/80 dark:bg-[#0B0F17] lg:static lg:shadow-none">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 py-2.5 backdrop-blur-xs dark:border-slate-800/80 dark:bg-[#0B0F17]/95">
              <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-800 dark:text-slate-200">
                <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
                <span>Controls</span>
              </div>
              <button
                type="button"
                aria-label="Collapse controls"
                title="Collapse controls"
                onClick={() => setControlsOpen(false)}
                className="cursor-pointer rounded p-1.5 sm:p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            {/* Section 1: Visual Preset Switcher */}
            <section className="p-4 border-b border-slate-200/80 dark:border-slate-800/80">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-300">
                  Rendering Plugin
                </h2>
                <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
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
                        ? 'border-cyan-600/60 bg-cyan-50 text-slate-950 dark:border-cyan-500/60 dark:bg-cyan-500/10 dark:text-slate-50'
                        : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-800 dark:bg-[#0E131D] dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900'
                    }`}
                  >
                    <div className="text-xs font-semibold">{title}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {sub}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Section 1b: Core Strategy Matrix & Preset Combinations */}
          <section className="p-4 border-b border-slate-200/80 dark:border-slate-800/80">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-300">
                Core Strategies
              </h2>
              <button
                type="button"
                onClick={() => applyCombinationRecipe('default')}
                className="cursor-pointer text-[11px] text-slate-500 hover:text-cyan-700 dark:text-slate-400 dark:hover:text-cyan-300 transition-colors"
              >
                Defaults
              </button>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {(
                [
                  ['default', 'Adaptive Explorer', 'Geom · Hex · OKLab'],
                  ['editorial', 'Editorial Incremental', 'JSX · 3×3 · Warm'],
                  ['dense', 'Dense Local Scale', 'Glyph · 4×3 · Local'],
                  ['strict', 'Strict Partition', 'Geom · No Shared'],
                ] as const
              ).map(([recipeId, title, hint]) => {
                const isActive = activeRecipe === recipeId;
                return (
                  <button
                    key={recipeId}
                    type="button"
                    onClick={() => applyCombinationRecipe(recipeId)}
                    className={`cursor-pointer rounded-md border px-2 py-1.5 text-left transition-colors ${
                      isActive
                        ? 'border-cyan-600/60 bg-cyan-50 text-slate-950 dark:border-cyan-500/60 dark:bg-cyan-500/10 dark:text-slate-50'
                        : 'border-slate-200 bg-slate-50/70 text-slate-700 hover:border-slate-300 hover:bg-slate-100 dark:border-slate-800 dark:bg-[#0E131D] dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900'
                    }`}
                  >
                    <div className="text-[11px] font-semibold leading-tight truncate">
                      {title}
                    </div>
                    <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      {hint}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="space-y-2.5 text-xs">
              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  1 · Mesh Strategy
                </span>
                <select
                  value={meshStrategyId}
                  onChange={(e) => setMeshStrategyId(e.target.value as MeshStrategyId)}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                >
                  <option value="adaptive">Adaptive Hex Mesh (Auto K)</option>
                  <option value="lattice-3x3">Fixed 3×3 Lattice (K = 9)</option>
                  <option value="lattice-4x3">Fixed 4×3 Lattice (K = 12)</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  2 · Clustering Strategy
                </span>
                <select
                  value={clusteringStrategyId}
                  onChange={(e) =>
                    setClusteringStrategyId(e.target.value as ClusteringStrategyId)
                  }
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                >
                  <option value="jaccard-annealing">
                    Jaccard + QAP Annealing (Full)
                  </option>
                  <option value="incremental-anchor">
                    Incremental Anchor (Preserve Topics)
                  </option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-1.5">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                    Shared Tags
                  </span>
                  <select
                    value={sharedTagRule}
                    onChange={(e) =>
                      setSharedTagRule(e.target.value as SharedTagRuleKind)
                    }
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                  >
                    <option value="planar-hitting-set">Hitting-Set</option>
                    <option value="none">Core Only</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                    Anchor Rule
                  </span>
                  <select
                    value={anchorRule}
                    onChange={(e) =>
                      setAnchorRule(e.target.value as SimplexAnchorRuleKind)
                    }
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                  >
                    <option value="explaining-away">Explaining-Away</option>
                    <option value="raw-overlap">Raw Overlap</option>
                    <option value="barycentric-all">Barycentric All</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  3 · Color Strategy
                </span>
                <select
                  value={colorStrategyId}
                  onChange={(e) => setColorStrategyId(e.target.value as ColorStrategyId)}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                >
                  <option value="oklab-contrast">OKLab Edge Contrast (Default)</option>
                  <option value="theme-adaptive">
                    Theme-Adaptive OKLab (Dark/Light)
                  </option>
                  <option value="curated-palette">Curated High-Contrast Palette</option>
                  <option value="nordic-palette">Nordic Slate &amp; Teal Palette</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  4 · Layout Strategy
                </span>
                <select
                  value={layoutStrategyId}
                  onChange={(e) => setLayoutStrategyId(e.target.value as LayoutStrategyId)}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                >
                  <option value="pbd-uniform">PBD Uniform Scale (0 px overlap)</option>
                  <option value="pbd-warm-start">
                    Warm-Start PBD (Preserve Positions)
                  </option>
                  <option value="local-adaptive">
                    Local Density-Adaptive Scale
                  </option>
                </select>
              </label>
            </div>
          </section>

          {/* Section 2: Dynamic Mutations & Rapid-Fire Stress Test */}
          <section className="p-4 border-b border-slate-200/80 dark:border-slate-800/80">
            <div className="mb-2.5 flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-300">
                Dynamic Mutations
              </h2>
              <button
                type="button"
                onClick={handleResetCatalog}
                className="cursor-pointer text-[11px] text-slate-500 hover:text-cyan-700 dark:text-slate-400 dark:hover:text-cyan-300 transition-colors"
              >
                Reset
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              <button
                type="button"
                onClick={() => handleAddItems(1)}
                className="cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-cyan-600/50 hover:text-cyan-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200 dark:hover:border-cyan-500/50 dark:hover:text-cyan-200 transition-colors whitespace-nowrap"
              >
                + 1 Item
              </button>
              <button
                type="button"
                onClick={() => handleAddItems(10)}
                className="cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-cyan-600/50 hover:text-cyan-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200 dark:hover:border-cyan-500/50 dark:hover:text-cyan-200 transition-colors whitespace-nowrap"
              >
                + 10 Items
              </button>
              <button
                type="button"
                onClick={() => handleRemoveItems(1)}
                className="cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-amber-600/50 hover:text-amber-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200 dark:hover:border-amber-500/50 dark:hover:text-amber-200 transition-colors whitespace-nowrap"
              >
                - 1 Item
              </button>
              <button
                type="button"
                onClick={() => handleRemoveItems(10)}
                className="cursor-pointer rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-amber-600/50 hover:text-amber-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200 dark:hover:border-amber-500/50 dark:hover:text-amber-200 transition-colors whitespace-nowrap"
              >
                - 10 Items
              </button>
            </div>
            <button
              type="button"
              onClick={() => setRapidFireActive((v) => !v)}
              className={`cursor-pointer flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                rapidFireActive
                  ? 'border-amber-500/70 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'
                  : 'border-slate-200 bg-slate-100 text-slate-700 hover:border-cyan-600/50 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-cyan-500/50'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              {rapidFireActive
                ? 'Rapid-Fire Running (250 ms)… Stop'
                : 'Rapid-Fire Mutation Test'}
            </button>
          </section>

          {/* Section 3: Collision & Geometry Inspector */}
          <section className="p-4 border-b border-slate-200/80 dark:border-slate-800/80">
            <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-300">
              Collision &amp; Geometry Inspector
            </h2>

            <label className="block mb-3">
              <div className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 mb-1.5">
                <span>Size Multiplier</span>
                <span className="font-mono text-cyan-700 dark:text-cyan-300">
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
                className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 dark:border-slate-800 dark:bg-[#0E131D] dark:text-slate-200 mb-3">
              <span>Show Convex Bounding Hulls</span>
              <input
                type="checkbox"
                checked={showHulls}
                onChange={(e) => setShowHulls(e.target.checked)}
                className="h-4 w-4 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
              />
            </label>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200/80 dark:border-slate-800 dark:bg-slate-800/70">
              <div className="bg-white dark:bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Clusters K
                </div>
                <div className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100">
                  {metrics.clusterCount}
                </div>
              </div>
              <div className="bg-white dark:bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Items
                </div>
                <div className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100">
                  {metrics.itemCount}
                </div>
              </div>
              <div className="bg-white dark:bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  α Cluster
                </div>
                <div className="font-mono text-base font-semibold text-amber-600 dark:text-amber-300">
                  {metrics.clusterScale.toFixed(3)}
                </div>
              </div>
              <div className="bg-white dark:bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  α Content
                </div>
                <div className="font-mono text-base font-semibold text-cyan-700 dark:text-cyan-300">
                  {metrics.contentScale.toFixed(3)}
                </div>
              </div>
              <div className="bg-white dark:bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Overlaps
                </div>
                <div
                  className={`font-mono text-base font-semibold ${
                    metrics.overlapCount === 0
                      ? 'text-[#06B6D4]'
                      : 'text-fuchsia-600 dark:text-fuchsia-400'
                  }`}
                >
                  {metrics.overlapCount}
                </div>
              </div>
              <div className="bg-white dark:bg-[#0B0F17] p-2.5">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Frame Rate
                </div>
                <div className="font-mono text-base font-semibold text-slate-900 dark:text-slate-100">
                  {fps}{' '}
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">
                    fps
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: Interaction Configurator */}
          <section className="p-4">
            <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-300">
              Interaction Configurator
            </h2>
            <div className="space-y-2.5 text-xs">
              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Hover Content
                </span>
                <select
                  value={contentHoverPolicy}
                  onChange={(e) =>
                    setContentHoverPolicy(e.target.value as ContentHoverPolicy)
                  }
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                >
                  <option value="tooltip">Show Tooltip Card</option>
                  <option value="highlight-unit">Highlight Simplex Neighbors</option>
                  <option value="none">Disabled</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Hover Cluster
                </span>
                <select
                  value={clusterHoverPolicy}
                  onChange={(e) =>
                    setClusterHoverPolicy(e.target.value as ClusterHoverPolicy)
                  }
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                >
                  <option value="tooltip">Show Cluster Stats</option>
                  <option value="focus-members">Isolate Members</option>
                  <option value="none">Disabled</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Left Click
                </span>
                <select
                  value={leftClickPolicy}
                  onChange={(e) => setLeftClickPolicy(e.target.value as LeftClickPolicy)}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                >
                  <option value="inspect">Select &amp; Inspect Details</option>
                  <option value="focus-toggle">Focus Unit / Cluster</option>
                  <option value="remove">Remove Item Directly</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Right Click
                </span>
                <select
                  value={rightClickPolicy}
                  onChange={(e) => setRightClickPolicy(e.target.value as RightClickPolicy)}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                >
                  <option value="context-menu">Open Custom Context Menu</option>
                  <option value="browser-default">Browser Default Menu</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Mouse Scroll
                </span>
                <select
                  value={wheelPolicy}
                  onChange={(e) =>
                    setWheelPolicy(
                      e.target.value as 'zoom-to-cursor' | 'pan-vertical' | 'none',
                    )
                  }
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                >
                  <option value="zoom-to-cursor">Zoom to Cursor</option>
                  <option value="pan-vertical">Pan Vertical / Horizontal</option>
                  <option value="none">Disabled</option>
                </select>
              </label>
            </div>
          </section>
          </aside>
        )}

        {/* Main Triangulation Viewport Stage */}
        <main
          ref={stageRef}
          className="relative min-w-0 flex-1 bg-slate-50 dark:bg-[#07090E]"
        >
          {/* Top-Left Canvas Controls Fly-Out Button (visible only when sidebar is collapsed) */}
          {!controlsOpen && (
            <button
              type="button"
              aria-expanded={false}
              onClick={() => setControlsOpen(true)}
              className="cursor-pointer absolute top-3 left-3 sm:top-4 sm:left-4 z-20 flex min-h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur-xs hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 dark:border-slate-800 dark:bg-[#0B0F17]/95 dark:text-slate-200 dark:shadow-none dark:hover:border-slate-700 dark:hover:bg-slate-900 transition-colors whitespace-nowrap"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />
              <span>Controls</span>
            </button>
          )}
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
            theme={resolvedTheme}
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
            pinnedIds={effectivePinnedIds}
            highlightedIds={highlightedIds}
            focusedClusterUid={focusedClusterUid}
            meshOptions={responsiveMeshOptions}
            layoutOptions={{
              clusterGapPx: 14,
              itemGapPx: 5,
              seed: 20261113,
            }}
            meshStrategy={meshStrategy}
            clusteringStrategy={clusteringStrategy}
            colorStrategy={colorStrategy}
            layoutStrategy={layoutStrategy}
            onContentHover={onContentHover}
            onClusterHover={onClusterHover}
            onLeftClick={onLeftClick}
            onRightClick={onRightClick}
            onWheel={wheelBehavior}
            onMetricsChange={setMetrics}
            onFpsUpdate={setFps}
          />

          {/* Camera Zoom Overlay Controls */}
          <div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4 z-20 flex items-center gap-1 rounded-md border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur-xs dark:border-slate-800 dark:bg-[#0B0F17]/95 dark:shadow-none">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => handle.zoomBy(1.22)}
              className="cursor-pointer flex h-8 w-8 sm:h-7 sm:w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50 transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => handle.zoomBy(0.82)}
              className="cursor-pointer flex h-8 w-8 sm:h-7 sm:w-7 items-center justify-center rounded text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50 transition-colors"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>

          {/* Floating Content Hover Tooltip */}
          {hoveredContent && !contextMenu && (
            <div
              className="pointer-events-none absolute z-30 max-w-[min(20rem,calc(100%-1.5rem))] rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg dark:border-slate-700/90 dark:bg-[#0B0F17]/95"
              style={{
                left: Math.max(
                  12,
                  Math.min(
                    Math.max(12, stageSize.width - 270),
                    hoveredContent.screenPosition.x + 14,
                  ),
                ),
                top: Math.max(
                  12,
                  Math.min(
                    Math.max(12, stageSize.height - 110),
                    hoveredContent.screenPosition.y - 12,
                  ),
                ),
              }}
            >
              <div className="font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                {hoveredContent.item.headline}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                <span>{hoveredContent.item.contentType}</span>
                <span aria-hidden="true">·</span>
                <span>{hoveredContent.item.readingMinutes} min</span>
                <span aria-hidden="true">·</span>
                <span>{hoveredContent.item.publishedYear}</span>
              </div>
              <div className="mt-1 text-[11px] text-cyan-700 dark:text-cyan-300">
                {hoveredContent.layoutContext.tags
                  .map((t) => t.meta?.displayTitle ?? t.tag)
                  .join(' · ')}
              </div>
            </div>
          )}

          {/* Floating Cluster Hover Tooltip */}
          {hoveredCluster && !hoveredContent && !contextMenu && (
            <div
              className="pointer-events-none absolute z-30 max-w-[min(20rem,calc(100%-1.5rem))] rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg dark:border-slate-700/90 dark:bg-[#0B0F17]/95"
              style={{
                left: Math.max(
                  12,
                  Math.min(
                    Math.max(12, stageSize.width - 270),
                    hoveredCluster.screenPosition.x + 14,
                  ),
                ),
                top: Math.max(
                  12,
                  Math.min(
                    Math.max(12, stageSize.height - 110),
                    hoveredCluster.screenPosition.y - 12,
                  ),
                ),
              }}
            >
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <span className="font-mono text-cyan-700 dark:text-cyan-300">
                  {hoveredCluster.cluster.code}
                </span>
                <span>{hoveredCluster.cluster.meta.title}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                <span>{hoveredCluster.cluster.meta.memberCount} items</span>
                <span aria-hidden="true">·</span>
                <span>
                  avg {hoveredCluster.cluster.meta.avgReadingMinutes.toFixed(1)} min
                </span>
                <span aria-hidden="true">·</span>
                <span>{hoveredCluster.cluster.meta.dominantType}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-700 dark:text-slate-300">
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
              className="absolute z-40 w-52 rounded-md border border-slate-200 bg-white py-1 text-xs shadow-xl dark:border-slate-700 dark:bg-[#0B0F17]"
              style={{
                left: Math.max(8, Math.min(stageSize.width - 216, contextMenu.x)),
                top: Math.max(8, Math.min(stageSize.height - 150, contextMenu.y)),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {contextMenu.target.kind === 'content' && (
                <>
                  <div className="border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-300 truncate">
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
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Pin className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
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
                        removeItemBySlug(slug);
                      }
                      setContextMenu(null);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-fuchsia-600 hover:bg-slate-100 dark:text-fuchsia-400 dark:hover:bg-slate-800"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove item
                  </button>
                </>
              )}

              {contextMenu.target.kind === 'cluster' && (
                <>
                  <div className="border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-300 truncate">
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
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Crosshair className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
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
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                  Reset camera &amp; focus
                </button>
              )}
            </div>
          )}

          {/* Top-Right Reset Camera Button */}
          <button
            type="button"
            onClick={() => handle.resetCamera()}
            className="cursor-pointer absolute top-3 right-3 sm:top-4 sm:right-4 z-20 flex min-h-9 items-center gap-1.5 rounded-md border border-cyan-600/35 bg-white/95 px-3 py-1.5 text-xs font-semibold text-cyan-800 shadow-sm backdrop-blur-xs hover:bg-cyan-50 dark:border-cyan-500/40 dark:bg-[#0B0F17]/95 dark:text-cyan-200 dark:shadow-none dark:hover:bg-cyan-500/15 transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span>Reset Camera</span>
          </button>

          {/* Responsive Selected / Inspected Node Detail Panel */}
          {inspected && (
            <div className="absolute bottom-3 left-3 right-24 z-20 max-h-[44dvh] overflow-y-auto rounded-md border border-slate-200 bg-white/95 p-3.5 text-xs shadow-lg backdrop-blur-xs dark:border-slate-800 dark:bg-[#0B0F17]/95 dark:shadow-none sm:bottom-auto sm:left-auto sm:top-14 sm:right-4 sm:w-80 sm:max-h-[calc(100%-7rem)]">
              <div className="flex items-start justify-between gap-2">
                <div>
                  {inspected.kind === 'content' ? (
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                      {inspected.item.headline}
                    </div>
                  ) : (
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                      <span className="font-mono text-cyan-700 dark:text-cyan-300 mr-1.5">
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
                  className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {inspected.kind === 'content' ? (
                <div className="mt-2.5 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{inspected.item.slug}</span>
                    <span aria-hidden="true">·</span>
                    <span>{inspected.item.contentType}</span>
                    <span aria-hidden="true">·</span>
                    <span>{inspected.item.readingMinutes} min</span>
                  </div>
                  <div className="text-[11px] text-slate-700 dark:text-slate-300">
                    <span className="text-slate-500 dark:text-slate-400">Unit: </span>
                    {inspected.clusterTitles.join(', ')}
                  </div>
                  <div className="text-[11px] text-cyan-700 dark:text-cyan-300">
                    {inspected.item.hashtags
                      .map((h) => resolveDemoTagMeta(h)?.displayTitle ?? h)
                      .join(' · ')}
                  </div>
                </div>
              ) : (
                <div className="mt-2.5 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{inspected.cluster.meta.memberCount} members</span>
                    <span aria-hidden="true">·</span>
                    <span>{inspected.cluster.meta.exclusiveCount} exclusive</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      avg {inspected.cluster.meta.avgReadingMinutes.toFixed(1)} min
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-700 dark:text-slate-300">
                    <span className="text-slate-500 dark:text-slate-400">Core Tags: </span>
                    {inspected.cluster.coreTags
                      .map((t) => t.meta?.displayTitle ?? t.tag)
                      .join(', ')}
                  </div>
                  {inspected.cluster.sharedTags.length > 0 && (
                    <div className="text-[11px] text-amber-700 dark:text-amber-300">
                      <span className="text-slate-500 dark:text-slate-400">
                        Shared Tags:{' '}
                      </span>
                      {inspected.cluster.sharedTags
                        .map((t) => t.meta?.displayTitle ?? t.tag)
                        .join(', ')}
                    </div>
                  )}
                  <div className="max-h-32 overflow-y-auto border-t border-slate-200 dark:border-slate-800 pt-2 space-y-1">
                    {inspected.cluster.members.slice(0, 8).map((m) => (
                      <div
                        key={m.itemId}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="truncate text-slate-700 dark:text-slate-200">
                          {m.item.headline}
                        </span>
                        <span className="font-mono text-slate-500 dark:text-slate-400 shrink-0">
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
