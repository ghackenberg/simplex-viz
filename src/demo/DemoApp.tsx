import type {
  ClusterDescriptor,
  ClusterHoverEvent,
  ContentHoverEvent,
  HitTarget,
  LayoutMetrics,
  MeshOptions,
  MeshTriangleRenderState,
  NormalizedPointerEvent,
  TriangleHoverEvent,
  WheelBehavior,
} from '@simplex-viz/core';
import {
  SimplexTopicGraph,
  createAdaptiveHexMeshStrategy,
  createCollisionDrivenLayoutStrategy,
  createEmbeddingClusteringStrategy,
  createFixedLatticeMeshStrategy,
  createIncrementalAnchorClusteringStrategy,
  createJaccardAnnealingClusteringStrategy,
  createLocalAdaptiveLayoutStrategy,
  createOklabContrastColorStrategy,
  createPaletteColorStrategy,
  createPbdUniformLayoutStrategy,
  createSimilarityClusteringStrategy,
  createSoftSimplexEmbeddingClusteringStrategy,
  createSoftSimplexTagClusteringStrategy,
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
import { EntitySpecBadge } from './components/EntityPreview';
import { SimplexLogoMark } from './components/SimplexLogoMark';
import {
  resolveDemoTagMeta,
  type TagTaxonomyInfo,
} from './data/knowledgeCatalog';
import {
  DATASET_DESCRIPTIONS,
  buildDemoCatalog,
  computeMediaPairwiseSimilarity,
  createDynamicDemoEntity,
  deriveDemoEntityClusterMeta,
  type DemoClusterSummary,
  type DemoDatasetId,
  type DemoEntity,
} from './data/multimodalCatalog';
import {
  DEFAULT_DEMO_RENDER_CONFIG,
  createDemoEdgeView,
  createDemoTriangleView,
  createDemoVisualResolver,
  demoAnchorClusterView,
  demoBadgeClusterView,
  demoDomainContentView,
  demoGeometricContentView,
  demoMultiSectorContentView,
  renderDemoClusterCard,
  renderDemoContentCard,
  type ClusterRendererKind,
  type ContentRendererKind,
  type ContentShapeMode,
  type DemoClusterVisual,
  type DemoContentVisual,
  type DemoRenderConfig,
  type MeshEdgeStyle,
  type TriangleFaceStyle,
} from './presets';

type ThemePreference = 'auto' | 'light' | 'dark';
type ContentHoverPolicy = 'tooltip' | 'highlight-unit' | 'none';
type ClusterHoverPolicy = 'tooltip' | 'focus-members' | 'none';
type TriangleHoverPolicy = 'tooltip' | 'focus-preview' | 'none';
type LeftClickPolicy = 'inspect' | 'focus-toggle' | 'remove';
type RightClickPolicy = 'context-menu' | 'browser-default';
type MeshStrategyId = 'adaptive' | 'lattice-3x3' | 'lattice-4x3';
type TagClusteringStrategyId =
  | 'soft-simplex-tags'
  | 'jaccard-annealing'
  | 'incremental-anchor';
type NonTagClusteringMode = 'soft-simplex-embedding' | 'embedding' | 'similarity';
type EmbeddingMetricKind = 'cosine' | 'euclidean';
type EmbeddingAnchorRule = 'simplex-projection' | 'explaining-away' | 'top-1';
type ColorStrategyId =
  | 'oklab-contrast'
  | 'theme-adaptive'
  | 'curated-palette'
  | 'nordic-palette';
type LayoutStrategyId =
  | 'collision-adaptive'
  | 'pbd-uniform'
  | 'pbd-warm-start'
  | 'local-adaptive';

interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly target: HitTarget<
    DemoEntity,
    DemoContentVisual,
    DemoClusterVisual,
    TagTaxonomyInfo,
    DemoClusterSummary
  >;
}

type InspectedTarget =
  | {
      readonly kind: 'content';
      readonly item: DemoEntity;
      readonly clusterTitles: readonly string[];
      readonly residualDistance?: number;
      readonly featureSummary?: string;
      readonly mixedColorHex: string;
    }
  | {
      readonly kind: 'cluster';
      readonly cluster: ClusterDescriptor<
        DemoEntity,
        TagTaxonomyInfo,
        DemoClusterSummary
      >;
    }
  | {
      readonly kind: 'triangle';
      readonly triangle: MeshTriangleRenderState<
        DemoEntity,
        TagTaxonomyInfo,
        DemoClusterSummary
      >;
    };

const CONTENT_CONTROL_COPY: Record<
  DemoDatasetId,
  {
    readonly domainOptionLabel?: string;
    readonly cardOptionLabel: string;
    readonly byTypeShapeLabel: string;
    readonly scaleMetricLabel: string;
    readonly cardMetaLabel: string;
  }
> = {
  knowledge: {
    cardOptionLabel: 'Article Mini-Card (JSX)',
    byTypeShapeLabel: 'By Content Type (Article / Video / Project)',
    scaleMetricLabel: 'Scale by Reading Time',
    cardMetaLabel: 'Show Type & Reading Time',
  },
  media: {
    domainOptionLabel: 'Media Frame Tile (SVG Thumbnail)',
    cardOptionLabel: 'Media Gallery Card (JSX)',
    byTypeShapeLabel: 'By Media Kind (Image / Video)',
    scaleMetricLabel: 'Scale Videos Slightly Larger',
    cardMetaLabel: 'Show Resolution & Duration',
  },
  voice: {
    domainOptionLabel: 'Acoustic Waveform Capsule (SVG)',
    cardOptionLabel: 'Voice Sample Card (JSX)',
    byTypeShapeLabel: 'By Vocal Register (High ≥ 180 Hz / Low)',
    scaleMetricLabel: 'Scale by Sample Duration',
    cardMetaLabel: 'Show Pitch & Duration',
  },
  'body-shape': {
    domainOptionLabel: 'Body Silhouette Glyph (SVG)',
    cardOptionLabel: 'Anthropometric Card (JSX)',
    byTypeShapeLabel: 'By Posture Profile (Athletic / Dynamic / Compact / Upright)',
    scaleMetricLabel: 'Scale by Stature (cm)',
    cardMetaLabel: 'Show Posture & Stature',
  },
};

function formatEntitySubtitle(entity: DemoEntity): string {
  if (entity.kind === 'knowledge') {
    return `${entity.entry.contentType} · ${entity.entry.readingMinutes} min · ${entity.entry.publishedYear}`;
  }
  if (entity.kind === 'media') {
    return entity.media.mediaKind === 'video'
      ? `video · ${entity.media.durationSec ?? 0}s · ${entity.media.aspectRatio}`
      : `image · ${entity.media.resolutionLabel} · ${entity.media.aspectRatio}`;
  }
  if (entity.kind === 'voice') {
    return `${entity.voice.speakerProfile} · ${entity.voice.pitchHz} Hz · ${entity.voice.durationSec}s`;
  }
  return `${entity.body.archetype} · ${entity.body.heightCm} cm`;
}

export function DemoApp() {
  const [datasetId, setDatasetId] = useState<DemoDatasetId>('knowledge');
  const [items, setItems] = useState<readonly DemoEntity[]>(() =>
    buildDemoCatalog('knowledge'),
  );
  const [renderConfig, setRenderConfig] = useState<DemoRenderConfig>(
    DEFAULT_DEMO_RENDER_CONFIG,
  );
  const [sizeMultiplier, setSizeMultiplier] = useState<number>(1.0);
  const [showHulls, setShowHulls] = useState<boolean>(false);
  const [rapidFireActive, setRapidFireActive] = useState<boolean>(false);

  const updateRenderConfig = useCallback((patch: Partial<DemoRenderConfig>) => {
    setRenderConfig((prev) => ({ ...prev, ...patch }));
  }, []);

  // Pluggable Core Strategy selections
  const [meshStrategyId, setMeshStrategyId] = useState<MeshStrategyId>('adaptive');
  const [tagClusteringStrategyId, setTagClusteringStrategyId] =
    useState<TagClusteringStrategyId>('soft-simplex-tags');
  const [sharedTagRule, setSharedTagRule] =
    useState<SharedTagRuleKind>('planar-hitting-set');
  const [anchorRule, setAnchorRule] =
    useState<SimplexAnchorRuleKind>('explaining-away');

  // Non-tag embedding / similarity strategy parameters
  const [nonTagMode, setNonTagMode] =
    useState<NonTagClusteringMode>('soft-simplex-embedding');
  const [triangleSpreadPct, setTriangleSpreadPct] = useState<number>(45);
  const [embeddingMetric, setEmbeddingMetric] =
    useState<EmbeddingMetricKind>('cosine');
  const [embeddingAnchorRule, setEmbeddingAnchorRule] =
    useState<EmbeddingAnchorRule>('simplex-projection');
  const [semanticWeightPct, setSemanticWeightPct] = useState<number>(65);

  const [colorStrategyId, setColorStrategyId] =
    useState<ColorStrategyId>('oklab-contrast');
  const [layoutStrategyId, setLayoutStrategyId] =
    useState<LayoutStrategyId>('collision-adaptive');

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
  const [triangleHoverPolicy, setTriangleHoverPolicy] =
    useState<TriangleHoverPolicy>('tooltip');
  const [leftClickPolicy, setLeftClickPolicy] = useState<LeftClickPolicy>('inspect');
  const [rightClickPolicy, setRightClickPolicy] =
    useState<RightClickPolicy>('context-menu');
  const [wheelPolicy, setWheelPolicy] = useState<
    'zoom-to-cursor' | 'pan-vertical' | 'none'
  >('zoom-to-cursor');

  // Live telemetry & interaction overlays
  const [metrics, setMetrics] = useState<LayoutMetrics>({
    clusterCount: 0,
    itemCount: 0,
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
    DemoEntity,
    DemoContentVisual,
    TagTaxonomyInfo,
    DemoClusterSummary
  > | null>(null);
  const [hoveredCluster, setHoveredCluster] = useState<ClusterHoverEvent<
    DemoEntity,
    DemoClusterVisual,
    TagTaxonomyInfo,
    DemoClusterSummary
  > | null>(null);
  const [hoveredTriangle, setHoveredTriangle] = useState<TriangleHoverEvent<
    DemoEntity,
    TagTaxonomyInfo,
    DemoClusterSummary
  > | null>(null);
  const [inspected, setInspected] = useState<InspectedTarget | null>(null);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => new Set());
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(() => new Set());
  const [focusedClusterUid, setFocusedClusterUid] = useState<string | null>(null);
  const [focusedTriangleIndex, setFocusedTriangleIndex] = useState<number | null>(null);
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
    DemoEntity,
    DemoContentVisual,
    DemoClusterVisual,
    TagTaxonomyInfo,
    DemoClusterSummary
  >();

  const switchDataset = useCallback((nextDataset: DemoDatasetId) => {
    setRapidFireActive(false);
    setPinnedIds(new Set());
    setHighlightedIds(new Set());
    setFocusedClusterUid(null);
    setFocusedTriangleIndex(null);
    setHoveredContent(null);
    setHoveredCluster(null);
    setHoveredTriangle(null);
    setInspected(null);
    setContextMenu(null);
    setDatasetId(nextDataset);
    setItems(buildDemoCatalog(nextDataset));
    setRenderConfig((prev) => {
      if (nextDataset === 'knowledge') {
        return prev.contentRenderer === 'domain'
          ? { ...prev, contentRenderer: 'geometric' }
          : prev;
      }
      return prev.contentRenderer === 'geometric'
        ? { ...prev, contentRenderer: 'domain' }
        : prev;
    });
  }, []);

  const visualResolver = useMemo(
    () => createDemoVisualResolver(renderConfig, resolvedTheme),
    [renderConfig, resolvedTheme],
  );

  const triangleView = useMemo(
    () =>
      createDemoTriangleView({
        triangleFaceStyle: renderConfig.triangleFaceStyle,
        triangleFaceOpacity: renderConfig.triangleFaceOpacity,
      }),
    [renderConfig.triangleFaceStyle, renderConfig.triangleFaceOpacity],
  );

  const edgeView = useMemo(
    () =>
      createDemoEdgeView({
        meshEdgeStyle: renderConfig.meshEdgeStyle,
        meshEdgeWidth: renderConfig.meshEdgeWidth,
      }),
    [renderConfig.meshEdgeStyle, renderConfig.meshEdgeWidth],
  );

  const meshStrategy = useMemo(() => {
    if (meshStrategyId === 'lattice-3x3') {
      return createFixedLatticeMeshStrategy<DemoEntity>({ cols: 3, rows: 3 });
    }
    if (meshStrategyId === 'lattice-4x3') {
      return createFixedLatticeMeshStrategy<DemoEntity>({ cols: 4, rows: 3 });
    }
    return createAdaptiveHexMeshStrategy<DemoEntity>();
  }, [meshStrategyId]);

  const clusteringStrategy = useMemo(() => {
    const spread = triangleSpreadPct / 100;

    if (datasetId === 'knowledge') {
      const getKnowledgeTags = (e: DemoEntity): readonly string[] =>
        e.kind === 'knowledge' ? e.entry.hashtags : [];
      if (tagClusteringStrategyId === 'soft-simplex-tags') {
        return createSoftSimplexTagClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
          getTags: getKnowledgeTags,
          sharedTagRule,
          anchorRule,
          triangleSpread: spread,
        });
      }
      if (tagClusteringStrategyId === 'incremental-anchor') {
        return createIncrementalAnchorClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
          getTags: getKnowledgeTags,
          sharedTagRule,
          anchorRule,
        });
      }
      return createJaccardAnnealingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        getTags: getKnowledgeTags,
        sharedTagRule,
        anchorRule,
      });
    }

    const semW = semanticWeightPct / 100;
    const styleW = Math.max(0.05, 1 - semW);

    if (nonTagMode === 'similarity') {
      return createSimilarityClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        clusterCount: datasetId === 'media' ? 7 : 6,
        anchorRule: embeddingAnchorRule === 'top-1' ? 'top-1' : 'simplex-projection',
        getSimilarity: (a, b) => {
          if (datasetId === 'media') {
            return computeMediaPairwiseSimilarity(a, b, semW, styleW);
          }
          const va =
            a.kind === 'voice'
              ? a.voice.voiceEmbedding
              : a.kind === 'body-shape'
                ? a.body.shapeEmbedding
                : [];
          const vb =
            b.kind === 'voice'
              ? b.voice.voiceEmbedding
              : b.kind === 'body-shape'
                ? b.body.shapeEmbedding
                : [];
          let dot = 0;
          let na = 0;
          let nb = 0;
          for (let i = 0; i < va.length; i++) {
            const x = va[i] ?? 0;
            const y = vb[i] ?? 0;
            dot += x * y;
            na += x * x;
            nb += y * y;
          }
          if (na <= 1e-9 || nb <= 1e-9) return 0;
          return Math.max(0, Math.min(1, dot / (Math.sqrt(na) * Math.sqrt(nb))));
        },
      });
    }

    if (nonTagMode === 'soft-simplex-embedding') {
      if (datasetId === 'media') {
        return createSoftSimplexEmbeddingClusteringStrategy<
          DemoEntity,
          TagTaxonomyInfo
        >({
          getEmbedding: [
            {
              name: 'semantic-scene',
              weight: semW,
              getVector: (e) => (e.kind === 'media' ? e.media.semanticEmbedding : []),
            },
            {
              name: 'visual-style',
              weight: styleW,
              getVector: (e) => (e.kind === 'media' ? e.media.styleEmbedding : []),
            },
          ],
          clusterCount: 7,
          metric: embeddingMetric,
          triangleSpread: spread,
        });
      }

      if (datasetId === 'voice') {
        return createSoftSimplexEmbeddingClusteringStrategy<
          DemoEntity,
          TagTaxonomyInfo
        >({
          getEmbedding: (e) => (e.kind === 'voice' ? e.voice.voiceEmbedding : []),
          clusterCount: 6,
          metric: embeddingMetric,
          triangleSpread: spread,
        });
      }

      return createSoftSimplexEmbeddingClusteringStrategy<
        DemoEntity,
        TagTaxonomyInfo
      >({
        getEmbedding: (e) => (e.kind === 'body-shape' ? e.body.shapeEmbedding : []),
        clusterCount: 6,
        metric: embeddingMetric,
        triangleSpread: spread,
      });
    }

    if (datasetId === 'media') {
      return createEmbeddingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        getEmbedding: [
          {
            name: 'semantic-scene',
            weight: semW,
            getVector: (e) => (e.kind === 'media' ? e.media.semanticEmbedding : []),
          },
          {
            name: 'visual-style',
            weight: styleW,
            getVector: (e) => (e.kind === 'media' ? e.media.styleEmbedding : []),
          },
        ],
        clusterCount: 7,
        metric: embeddingMetric,
        anchorRule: embeddingAnchorRule,
      });
    }

    if (datasetId === 'voice') {
      return createEmbeddingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        getEmbedding: (e) => (e.kind === 'voice' ? e.voice.voiceEmbedding : []),
        clusterCount: 6,
        metric: embeddingMetric,
        anchorRule: embeddingAnchorRule,
      });
    }

    return createEmbeddingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
      getEmbedding: (e) => (e.kind === 'body-shape' ? e.body.shapeEmbedding : []),
      clusterCount: 6,
      metric: embeddingMetric,
      anchorRule: embeddingAnchorRule,
    });
  }, [
    datasetId,
    tagClusteringStrategyId,
    sharedTagRule,
    anchorRule,
    nonTagMode,
    triangleSpreadPct,
    embeddingMetric,
    embeddingAnchorRule,
    semanticWeightPct,
  ]);

  const colorStrategy = useMemo(() => {
    if (colorStrategyId === 'theme-adaptive') {
      return createThemeAdaptiveOklabColorStrategy<DemoEntity, TagTaxonomyInfo>();
    }
    if (colorStrategyId === 'curated-palette') {
      return createPaletteColorStrategy<DemoEntity, TagTaxonomyInfo>(
        ['#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#f97316'],
        { mode: 'edge-contrast' },
      );
    }
    if (colorStrategyId === 'nordic-palette') {
      return createPaletteColorStrategy<DemoEntity, TagTaxonomyInfo>(
        ['#0284c7', '#0d9488', '#475569', '#0369a1', '#0f766e', '#64748b'],
        { mode: 'edge-contrast' },
      );
    }
    return createOklabContrastColorStrategy<DemoEntity, TagTaxonomyInfo>();
  }, [colorStrategyId]);

  const layoutStrategy = useMemo(() => {
    if (layoutStrategyId === 'collision-adaptive') {
      return createCollisionDrivenLayoutStrategy({
        minLocalScale: 0.34,
        shrinkFactor: 0.85,
        warmStart: true,
      });
    }
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

  const resetCoreStrategies = useCallback(() => {
    setMeshStrategyId('adaptive');
    setTagClusteringStrategyId('soft-simplex-tags');
    setSharedTagRule('planar-hitting-set');
    setAnchorRule('explaining-away');
    setNonTagMode('soft-simplex-embedding');
    setTriangleSpreadPct(45);
    setEmbeddingMetric('cosine');
    setEmbeddingAnchorRule('simplex-projection');
    setSemanticWeightPct(65);
    setColorStrategyId('oklab-contrast');
    setLayoutStrategyId('collision-adaptive');
  }, []);

  const effectivePinnedIds = useMemo(() => {
    if (inspected?.kind !== 'content' || pinnedIds.has(inspected.item.id)) {
      return pinnedIds;
    }
    const merged = new Set(pinnedIds);
    merged.add(inspected.item.id);
    return merged;
  }, [pinnedIds, inspected]);

  // Mutation handlers (work identically across all 4 tagged & untagged datasets!)
  const handleAddItems = useCallback(
    (count: number) => {
      const additions: DemoEntity[] = [];
      for (let i = 0; i < count; i++) {
        dynamicSeqRef.current += 1;
        additions.push(createDynamicDemoEntity(datasetId, dynamicSeqRef.current));
      }
      setItems((prev) => [...prev, ...additions]);
    },
    [datasetId],
  );

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
    setFocusedTriangleIndex(null);
    setInspected(null);
    setItems(buildDemoCatalog(datasetId));
  }, [datasetId]);

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

  useEffect(() => {
    if (triangleHoverPolicy === 'none') {
      setHoveredTriangle(null);
    }
  }, [triangleHoverPolicy]);

  // Interaction callbacks wired to configured policies
  const onContentHover = useCallback(
    (
      ev: ContentHoverEvent<
        DemoEntity,
        DemoContentVisual,
        TagTaxonomyInfo,
        DemoClusterSummary
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
        DemoEntity,
        DemoClusterVisual,
        TagTaxonomyInfo,
        DemoClusterSummary
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

  const onTriangleHover = useCallback(
    (
      ev: TriangleHoverEvent<
        DemoEntity,
        TagTaxonomyInfo,
        DemoClusterSummary
      > | null,
    ) => {
      if (triangleHoverPolicy === 'none') {
        setHoveredTriangle(null);
        return;
      }
      if (triangleHoverPolicy === 'focus-preview') {
        setFocusedTriangleIndex(ev ? ev.triangle.index : null);
        setHoveredTriangle(ev);
        return;
      }
      setHoveredTriangle(ev);
    },
    [triangleHoverPolicy],
  );

  const togglePinId = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const removeItemById = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setPinnedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setInspected((cur) =>
      cur?.kind === 'content' && cur.item.id === id ? null : cur,
    );
  }, []);

  const onLeftClick = useCallback(
    (
      target: HitTarget<
        DemoEntity,
        DemoContentVisual,
        DemoClusterVisual,
        TagTaxonomyInfo,
        DemoClusterSummary
      >,
    ) => {
      setContextMenu(null);
      if (target.kind === 'background') {
        if (leftClickPolicy === 'focus-toggle') {
          setFocusedClusterUid(null);
          setFocusedTriangleIndex(null);
          setHighlightedIds(new Set());
        } else if (leftClickPolicy === 'inspect') {
          setInspected(null);
          setFocusedClusterUid(null);
          setFocusedTriangleIndex(null);
        }
        return;
      }

      if (leftClickPolicy === 'remove') {
        if (target.kind === 'content') {
          removeItemById(target.item.id);
        }
        return;
      }

      if (leftClickPolicy === 'focus-toggle') {
        if (target.kind === 'cluster') {
          setHighlightedIds(new Set());
          setFocusedTriangleIndex(null);
          setFocusedClusterUid((cur) =>
            cur === target.cluster.clusterUid ? null : target.cluster.clusterUid,
          );
        } else if (target.kind === 'triangle') {
          setHighlightedIds(new Set());
          setFocusedClusterUid(null);
          setFocusedTriangleIndex((cur) =>
            cur === target.triangle.index ? null : target.triangle.index,
          );
        } else {
          setFocusedClusterUid(null);
          setFocusedTriangleIndex(null);
          const ids = new Set<string>([target.item.id]);
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
        setFocusedClusterUid(null);
        setFocusedTriangleIndex(null);
        setInspected((cur) =>
          cur?.kind === 'content' && cur.item.id === target.item.id
            ? null
            : {
                kind: 'content',
                item: target.item,
                clusterTitles: target.layoutContext.unitClusters.map(
                  (uc) => `${uc.cluster.code} (${Math.round(uc.weight * 100)}%)`,
                ),
                residualDistance: target.layoutContext.residualDistance,
                featureSummary: target.layoutContext.featureSummary,
                mixedColorHex: target.layoutContext.mixedColorHex,
              },
        );
      } else if (target.kind === 'cluster') {
        setFocusedTriangleIndex(null);
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
      } else {
        setFocusedClusterUid(null);
        setFocusedTriangleIndex((cur) =>
          cur === target.triangle.index ? null : target.triangle.index,
        );
        setInspected((cur) =>
          cur?.kind === 'triangle' && cur.triangle.index === target.triangle.index
            ? null
            : {
                kind: 'triangle',
                triangle: target.triangle,
              },
        );
      }
    },
    [leftClickPolicy, removeItemById],
  );

  const onRightClick = useCallback(
    (
      target: HitTarget<
        DemoEntity,
        DemoContentVisual,
        DemoClusterVisual,
        TagTaxonomyInfo,
        DemoClusterSummary
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
  const activeDatasetInfo = DATASET_DESCRIPTIONS[datasetId];

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

            {/* Section 0: Dataset & Feature Representation (Tagged vs. Tag-Free Modalities) */}
            <section className="p-4 border-b border-slate-200/80 dark:border-slate-800/80">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-300">
                  Dataset &amp; Representation
                </h2>
                <span className="font-mono text-[10px] text-cyan-700 dark:text-cyan-300">
                  {datasetId === 'knowledge' ? 'Tagged' : 'Tag-Free'}
                </span>
              </div>
              <select
                aria-label="Dataset and representation"
                value={datasetId}
                onChange={(e) => switchDataset(e.target.value as DemoDatasetId)}
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
              >
                <option value="knowledge">{DATASET_DESCRIPTIONS.knowledge.label}</option>
                <option value="media">{DATASET_DESCRIPTIONS.media.label}</option>
                <option value="voice">{DATASET_DESCRIPTIONS.voice.label}</option>
                <option value="body-shape">
                  {DATASET_DESCRIPTIONS['body-shape'].label}
                </option>
              </select>
              <div className="mt-1.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                {activeDatasetInfo.clusteringModeLabel} · {items.length} items
              </div>
            </section>

            {/* Section 1: Fine-Grained Visual Rendering Settings */}
            <section className="p-4 border-b border-slate-200/80 dark:border-slate-800/80">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-300">
                  Visual Rendering
                </h2>
                <button
                  type="button"
                  onClick={() =>
                    setRenderConfig({
                      ...DEFAULT_DEMO_RENDER_CONFIG,
                      contentRenderer: datasetId === 'knowledge' ? 'geometric' : 'domain',
                    })
                  }
                  className="cursor-pointer text-[11px] text-slate-500 hover:text-cyan-700 dark:text-slate-400 dark:hover:text-cyan-300 transition-colors"
                >
                  Defaults
                </button>
              </div>

              <div className="space-y-3 text-xs">
                {/* Content Nodes Sub-Group (adapted per active dataset) */}
                <div className="rounded-md border border-slate-200/80 bg-slate-50/60 p-2.5 space-y-2.5 dark:border-slate-800 dark:bg-[#0E131D]/70">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                      Content Nodes
                    </span>
                    <select
                      value={renderConfig.contentRenderer}
                      onChange={(e) =>
                        updateRenderConfig({
                          contentRenderer: e.target.value as ContentRendererKind,
                        })
                      }
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0B0F17] dark:text-slate-200"
                    >
                      {CONTENT_CONTROL_COPY[datasetId].domainOptionLabel && (
                        <option value="domain">
                          {CONTENT_CONTROL_COPY[datasetId].domainOptionLabel}
                        </option>
                      )}
                      <option value="geometric">Geometric Shape (SVG Morphing)</option>
                      <option value="multisector">Multi-Sector Donut (SVG)</option>
                      <option value="react-card">
                        {CONTENT_CONTROL_COPY[datasetId].cardOptionLabel}
                      </option>
                    </select>
                  </label>

                  {renderConfig.contentRenderer === 'domain' && datasetId !== 'knowledge' && (
                    <>
                      <label className="block">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>{datasetId === 'media' ? 'Frame Scale' : 'Glyph Scale'}</span>
                          <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                            {renderConfig.domainGlyphScale.toFixed(2)}×
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.75}
                          max={1.45}
                          step={0.05}
                          value={renderConfig.domainGlyphScale}
                          onChange={(e) =>
                            updateRenderConfig({
                              domainGlyphScale: parseFloat(e.target.value),
                            })
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>

                      {datasetId === 'voice' && (
                        <label className="block">
                          <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                            <span>Waveform Bars</span>
                            <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                              {renderConfig.voiceWaveformBars} bars
                            </span>
                          </div>
                          <input
                            type="range"
                            min={6}
                            max={14}
                            step={1}
                            value={renderConfig.voiceWaveformBars}
                            onChange={(e) =>
                              updateRenderConfig({
                                voiceWaveformBars: parseInt(e.target.value, 10),
                              })
                            }
                            className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                          />
                        </label>
                      )}

                      <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                        <span>{CONTENT_CONTROL_COPY[datasetId].scaleMetricLabel}</span>
                        <input
                          type="checkbox"
                          checked={renderConfig.scaleByReadingTime}
                          onChange={(e) =>
                            updateRenderConfig({
                              scaleByReadingTime: e.target.checked,
                            })
                          }
                          className="h-3.5 w-3.5 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>

                      {datasetId === 'media' && (
                        <>
                          <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                            <span>Show Video Play Indicator</span>
                            <input
                              type="checkbox"
                              checked={renderConfig.mediaShowVideoBadge}
                              onChange={(e) =>
                                updateRenderConfig({
                                  mediaShowVideoBadge: e.target.checked,
                                })
                              }
                              className="h-3.5 w-3.5 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                            />
                          </label>
                          <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                            <span>Show Aspect Ratio (16:9 / 4:3 / 1:1)</span>
                            <input
                              type="checkbox"
                              checked={renderConfig.mediaShowAspectTag}
                              onChange={(e) =>
                                updateRenderConfig({
                                  mediaShowAspectTag: e.target.checked,
                                })
                              }
                              className="h-3.5 w-3.5 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                            />
                          </label>
                        </>
                      )}

                      {datasetId === 'voice' && (
                        <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                          <span>Show Pitch Readout (Hz)</span>
                          <input
                            type="checkbox"
                            checked={renderConfig.voiceShowPitchLabel}
                            onChange={(e) =>
                              updateRenderConfig({
                                voiceShowPitchLabel: e.target.checked,
                              })
                            }
                            className="h-3.5 w-3.5 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                          />
                        </label>
                      )}

                      {datasetId === 'body-shape' && (
                        <>
                          <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                            <span>Show Calibration Frame</span>
                            <input
                              type="checkbox"
                              checked={renderConfig.bodyShowCalibrationRing}
                              onChange={(e) =>
                                updateRenderConfig({
                                  bodyShowCalibrationRing: e.target.checked,
                                })
                              }
                              className="h-3.5 w-3.5 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                            />
                          </label>
                          <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                            <span>Show Stature (cm)</span>
                            <input
                              type="checkbox"
                              checked={renderConfig.bodyShowHeightLabel}
                              onChange={(e) =>
                                updateRenderConfig({
                                  bodyShowHeightLabel: e.target.checked,
                                })
                              }
                              className="h-3.5 w-3.5 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                            />
                          </label>
                        </>
                      )}
                    </>
                  )}

                  {renderConfig.contentRenderer === 'geometric' && (
                    <>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                          Shape Mapping
                        </span>
                        <select
                          value={renderConfig.contentShapeMode}
                          onChange={(e) =>
                            updateRenderConfig({
                              contentShapeMode: e.target.value as ContentShapeMode,
                            })
                          }
                          className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0B0F17] dark:text-slate-200"
                        >
                          <option value="by-type">
                            {CONTENT_CONTROL_COPY[datasetId].byTypeShapeLabel}
                          </option>
                          <option value="circle">Circle (All Items)</option>
                          <option value="diamond">Diamond (All Items)</option>
                          <option value="hexagon">Hexagon (All Items)</option>
                          <option value="star">5-Point Star (All Items)</option>
                        </select>
                      </label>

                      <label className="block">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>Base Radius</span>
                          <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                            {renderConfig.contentBaseRadius} px
                          </span>
                        </div>
                        <input
                          type="range"
                          min={7}
                          max={16}
                          step={1}
                          value={renderConfig.contentBaseRadius}
                          onChange={(e) =>
                            updateRenderConfig({
                              contentBaseRadius: parseFloat(e.target.value),
                            })
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>

                      <label className="block">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>Stroke Width</span>
                          <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                            {renderConfig.contentStrokeWidth.toFixed(1)} px
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={3.0}
                          step={0.1}
                          value={renderConfig.contentStrokeWidth}
                          onChange={(e) =>
                            updateRenderConfig({
                              contentStrokeWidth: parseFloat(e.target.value),
                            })
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                        <span>{CONTENT_CONTROL_COPY[datasetId].scaleMetricLabel}</span>
                        <input
                          type="checkbox"
                          checked={renderConfig.scaleByReadingTime}
                          onChange={(e) =>
                            updateRenderConfig({
                              scaleByReadingTime: e.target.checked,
                            })
                          }
                          className="h-3.5 w-3.5 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>
                    </>
                  )}

                  {renderConfig.contentRenderer === 'multisector' && (
                    <>
                      <label className="block">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>Base Radius</span>
                          <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                            {renderConfig.contentBaseRadius + 2} px
                          </span>
                        </div>
                        <input
                          type="range"
                          min={7}
                          max={16}
                          step={1}
                          value={renderConfig.contentBaseRadius}
                          onChange={(e) =>
                            updateRenderConfig({
                              contentBaseRadius: parseFloat(e.target.value),
                            })
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>

                      <label className="block">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>Inner Core Ratio</span>
                          <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                            {Math.round(renderConfig.donutInnerRatio * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.25}
                          max={0.7}
                          step={0.05}
                          value={renderConfig.donutInnerRatio}
                          onChange={(e) =>
                            updateRenderConfig({
                              donutInnerRatio: parseFloat(e.target.value),
                            })
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                        <span>{CONTENT_CONTROL_COPY[datasetId].scaleMetricLabel}</span>
                        <input
                          type="checkbox"
                          checked={renderConfig.scaleByReadingTime}
                          onChange={(e) =>
                            updateRenderConfig({
                              scaleByReadingTime: e.target.checked,
                            })
                          }
                          className="h-3.5 w-3.5 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                        <span>Outer Accent Ring</span>
                        <input
                          type="checkbox"
                          checked={renderConfig.donutAccentRing}
                          onChange={(e) =>
                            updateRenderConfig({
                              donutAccentRing: e.target.checked,
                            })
                          }
                          className="h-3.5 w-3.5 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>
                    </>
                  )}

                  {renderConfig.contentRenderer === 'react-card' && (
                    <>
                      <label className="block">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>Headline Length</span>
                          <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                            {renderConfig.contentCardMaxChars} chars
                          </span>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={26}
                          step={1}
                          value={renderConfig.contentCardMaxChars}
                          onChange={(e) =>
                            updateRenderConfig({
                              contentCardMaxChars: parseInt(e.target.value, 10),
                            })
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                        <span>{CONTENT_CONTROL_COPY[datasetId].cardMetaLabel}</span>
                        <input
                          type="checkbox"
                          checked={renderConfig.showContentCardMeta}
                          onChange={(e) =>
                            updateRenderConfig({
                              showContentCardMeta: e.target.checked,
                            })
                          }
                          className="h-3.5 w-3.5 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>
                    </>
                  )}
                </div>

                {/* Cluster Nodes Sub-Group */}
                <div className="rounded-md border border-slate-200/80 bg-slate-50/60 p-2.5 space-y-2.5 dark:border-slate-800 dark:bg-[#0E131D]/70">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                      Cluster Nodes
                    </span>
                    <select
                      value={renderConfig.clusterRenderer}
                      onChange={(e) =>
                        updateRenderConfig({
                          clusterRenderer: e.target.value as ClusterRendererKind,
                        })
                      }
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0B0F17] dark:text-slate-200"
                    >
                      <option value="anchor">Double-Ring Anchor (SVG)</option>
                      <option value="badge">Stats Pill Badge (SVG getBBox)</option>
                      <option value="react-card">React JSX Summary Card</option>
                    </select>
                  </label>

                  {renderConfig.clusterRenderer === 'anchor' ? (
                    <label className="block">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>Anchor Radius</span>
                        <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                          {renderConfig.anchorRadius} px
                        </span>
                      </div>
                      <input
                        type="range"
                        min={16}
                        max={32}
                        step={1}
                        value={renderConfig.anchorRadius}
                        onChange={(e) =>
                          updateRenderConfig({
                            anchorRadius: parseInt(e.target.value, 10),
                          })
                        }
                        className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                      />
                    </label>
                  ) : (
                    <>
                      <label className="block">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>Title Length</span>
                          <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                            {renderConfig.clusterTitleMaxChars} chars
                          </span>
                        </div>
                        <input
                          type="range"
                          min={12}
                          max={28}
                          step={1}
                          value={renderConfig.clusterTitleMaxChars}
                          onChange={(e) =>
                            updateRenderConfig({
                              clusterTitleMaxChars: parseInt(e.target.value, 10),
                            })
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between text-[11px] text-slate-700 dark:text-slate-300">
                        <span>Show Cluster Metrics</span>
                        <input
                          type="checkbox"
                          checked={renderConfig.showClusterMetaLine}
                          onChange={(e) =>
                            updateRenderConfig({
                              showClusterMetaLine: e.target.checked,
                            })
                          }
                          className="h-3.5 w-3.5 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>
                    </>
                  )}
                </div>

                {/* Mesh Triangulation (Faces & Edges) Sub-Group */}
                <div className="rounded-md border border-slate-200/80 bg-slate-50/60 p-2.5 space-y-2.5 dark:border-slate-800 dark:bg-[#0E131D]/70">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                      Triangle Faces
                    </span>
                    <select
                      value={renderConfig.triangleFaceStyle}
                      onChange={(e) =>
                        updateRenderConfig({
                          triangleFaceStyle: e.target.value as TriangleFaceStyle,
                        })
                      }
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0B0F17] dark:text-slate-200"
                    >
                      <option value="oklab-tint">OKLab Tint (Default)</option>
                      <option value="barycentric-gradient">
                        Continuous Barycentric Gradient
                      </option>
                      <option value="barycentric-sector">
                        Barycentric 3-Way Sectors
                      </option>
                      <option value="blueprint-inset">Blueprint Inset Frame</option>
                      <option value="density-heatmap">Density Heatmap + Count</option>
                    </select>
                  </label>

                  <label className="block">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>Face Base Opacity</span>
                      <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                        {Math.round(renderConfig.triangleFaceOpacity * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.03}
                      max={0.35}
                      step={0.01}
                      value={renderConfig.triangleFaceOpacity}
                      onChange={(e) =>
                        updateRenderConfig({
                          triangleFaceOpacity: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-slate-600 dark:text-slate-300">
                      Mesh Edges
                    </span>
                    <select
                      value={renderConfig.meshEdgeStyle}
                      onChange={(e) =>
                        updateRenderConfig({
                          meshEdgeStyle: e.target.value as MeshEdgeStyle,
                        })
                      }
                      className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0B0F17] dark:text-slate-200"
                    >
                      <option value="dashed">Dashed Architectural (Default)</option>
                      <option value="cluster-tinted">
                        Cluster-Tinted Tri-Segment
                      </option>
                      <option value="precision-rail">Precision Double Rail</option>
                      <option value="minimal-highlight">
                        Minimal (Highlight Only)
                      </option>
                    </select>
                  </label>

                  <label className="block">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>Edge Stroke Width</span>
                      <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                        {renderConfig.meshEdgeWidth.toFixed(1)} px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={3.0}
                      step={0.1}
                      value={renderConfig.meshEdgeWidth}
                      onChange={(e) =>
                        updateRenderConfig({
                          meshEdgeWidth: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            </section>

            {/* Section 1b: Core Algorithm Strategies (completely independent from rendering) */}
            <section className="p-4 border-b border-slate-200/80 dark:border-slate-800/80">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-wide text-slate-700 dark:text-slate-300">
                  Core Strategies
                </h2>
                <button
                  type="button"
                  onClick={resetCoreStrategies}
                  className="cursor-pointer text-[11px] text-slate-500 hover:text-cyan-700 dark:text-slate-400 dark:hover:text-cyan-300 transition-colors"
                >
                  Defaults
                </button>
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

                {datasetId === 'knowledge' ? (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                        2 · Tag Clustering Strategy
                      </span>
                      <select
                        value={tagClusteringStrategyId}
                        onChange={(e) =>
                          setTagClusteringStrategyId(
                            e.target.value as TagClusteringStrategyId,
                          )
                        }
                        className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                      >
                        <option value="soft-simplex-tags">
                          Soft-Simplex Balanced + Spread
                        </option>
                        <option value="jaccard-annealing">
                          Jaccard + QAP Annealing (Classic)
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

                    {tagClusteringStrategyId === 'soft-simplex-tags' && (
                      <label className="block rounded-md border border-slate-200/80 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-[#0E131D]/70">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Triangle Interior Spread</span>
                          <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                            {triangleSpreadPct}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={65}
                          step={5}
                          value={triangleSpreadPct}
                          onChange={(e) =>
                            setTriangleSpreadPct(parseInt(e.target.value, 10))
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>
                    )}
                  </>
                ) : (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                        2 · Feature Clustering Strategy
                      </span>
                      <select
                        value={nonTagMode}
                        onChange={(e) =>
                          setNonTagMode(e.target.value as NonTagClusteringMode)
                        }
                        className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                      >
                        <option value="soft-simplex-embedding">
                          Soft-Simplex Embedding + Load Balance
                        </option>
                        <option value="embedding">
                          Embedding k-Means + QAP (Classic)
                        </option>
                        <option value="similarity">
                          Pairwise Similarity k-Medoids + QAP
                        </option>
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-1.5">
                      {(nonTagMode === 'soft-simplex-embedding' ||
                        nonTagMode === 'embedding') && (
                        <label
                          className={`block ${
                            nonTagMode === 'soft-simplex-embedding' ? 'col-span-2' : ''
                          }`}
                        >
                          <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                            Vector Metric
                          </span>
                          <select
                            value={embeddingMetric}
                            onChange={(e) =>
                              setEmbeddingMetric(
                                e.target.value as EmbeddingMetricKind,
                              )
                            }
                            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                          >
                            <option value="cosine">Cosine (Spherical)</option>
                            <option value="euclidean">Euclidean L2</option>
                          </select>
                        </label>
                      )}

                      {nonTagMode !== 'soft-simplex-embedding' && (
                        <label
                          className={`block ${nonTagMode === 'similarity' ? 'col-span-2' : ''}`}
                        >
                          <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                            Simplex Projection
                          </span>
                          <select
                            value={embeddingAnchorRule}
                            onChange={(e) =>
                              setEmbeddingAnchorRule(
                                e.target.value as EmbeddingAnchorRule,
                              )
                            }
                            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                          >
                            <option value="simplex-projection">
                              Closed-Form NNLS Simplex
                            </option>
                            {nonTagMode === 'embedding' && (
                              <option value="explaining-away">
                                Soft Explaining-Away
                              </option>
                            )}
                            <option value="top-1">Nearest Vertex Only</option>
                          </select>
                        </label>
                      )}
                    </div>

                    {nonTagMode === 'soft-simplex-embedding' && (
                      <label className="block rounded-md border border-slate-200/80 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-[#0E131D]/70">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Triangle Interior Spread</span>
                          <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                            {triangleSpreadPct}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={80}
                          step={5}
                          value={triangleSpreadPct}
                          onChange={(e) =>
                            setTriangleSpreadPct(parseInt(e.target.value, 10))
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>
                    )}

                    {datasetId === 'media' && (
                      <label className="block rounded-md border border-slate-200/80 bg-slate-50/70 p-2 dark:border-slate-800 dark:bg-[#0E131D]/70">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Modality Weight: Scene / Style</span>
                          <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
                            {semanticWeightPct}% / {100 - semanticWeightPct}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={5}
                          max={95}
                          step={5}
                          value={semanticWeightPct}
                          onChange={(e) =>
                            setSemanticWeightPct(parseInt(e.target.value, 10))
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                        />
                      </label>
                    )}
                  </>
                )}

                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                    3 · Color Strategy
                  </span>
                  <select
                    value={colorStrategyId}
                    onChange={(e) =>
                      setColorStrategyId(e.target.value as ColorStrategyId)
                    }
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                  >
                    <option value="oklab-contrast">
                      OKLab Edge Contrast (Default)
                    </option>
                    <option value="theme-adaptive">
                      Theme-Adaptive OKLab (Dark/Light)
                    </option>
                    <option value="curated-palette">
                      Curated High-Contrast Palette
                    </option>
                    <option value="nordic-palette">
                      Nordic Slate &amp; Teal Palette
                    </option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                    4 · Layout Strategy
                  </span>
                  <select
                    value={layoutStrategyId}
                    onChange={(e) =>
                      setLayoutStrategyId(e.target.value as LayoutStrategyId)
                    }
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                  >
                    <option value="collision-adaptive">
                      Collision-Driven Adaptive Scale
                    </option>
                    <option value="pbd-uniform">
                      PBD Uniform Scale (Classic)
                    </option>
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
                  <span className="font-mono tabular-nums text-cyan-700 dark:text-cyan-300">
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
                  <div className="font-mono tabular-nums text-base font-semibold text-slate-900 dark:text-slate-100">
                    {metrics.clusterCount}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#0B0F17] p-2.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Items
                  </div>
                  <div className="font-mono tabular-nums text-base font-semibold text-slate-900 dark:text-slate-100">
                    {metrics.itemCount}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#0B0F17] p-2.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    α Cluster
                  </div>
                  <div className="font-mono tabular-nums text-base font-semibold text-amber-600 dark:text-amber-300">
                    {metrics.clusterScale.toFixed(3)}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#0B0F17] p-2.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    α Content
                  </div>
                  <div className="font-mono tabular-nums text-base font-semibold text-cyan-700 dark:text-cyan-300">
                    {metrics.contentScale.toFixed(3)}
                  </div>
                </div>
                <div className="bg-white dark:bg-[#0B0F17] p-2.5">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Overlaps
                  </div>
                  <div
                    className={`font-mono tabular-nums text-base font-semibold ${
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
                  <div className="font-mono tabular-nums text-base font-semibold text-slate-900 dark:text-slate-100">
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
                    Hover Triangle Face
                  </span>
                  <select
                    value={triangleHoverPolicy}
                    onChange={(e) =>
                      setTriangleHoverPolicy(e.target.value as TriangleHoverPolicy)
                    }
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700/80 dark:bg-[#0E131D] dark:text-slate-200"
                  >
                    <option value="tooltip">Show Triangle Tooltip</option>
                    <option value="focus-preview">Isolate Face on Hover</option>
                    <option value="none">Disabled</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                    Left Click
                  </span>
                  <select
                    value={leftClickPolicy}
                    onChange={(e) =>
                      setLeftClickPolicy(e.target.value as LeftClickPolicy)
                    }
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
                    onChange={(e) =>
                      setRightClickPolicy(e.target.value as RightClickPolicy)
                    }
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
          {/* Top-Left Canvas Controls Fly-Out Button */}
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
            DemoEntity,
            DemoContentVisual,
            DemoClusterVisual,
            TagTaxonomyInfo,
            DemoClusterSummary
          >
            controllerRef={controllerRef}
            items={items}
            getId={(entity) => entity.id}
            resolveTagMeta={resolveDemoTagMeta}
            deriveClusterMeta={deriveDemoEntityClusterMeta}
            visualResolver={visualResolver}
            theme={resolvedTheme}
            contentView={
              renderConfig.contentRenderer === 'domain'
                ? demoDomainContentView
                : renderConfig.contentRenderer === 'geometric'
                  ? demoGeometricContentView
                  : renderConfig.contentRenderer === 'multisector'
                    ? demoMultiSectorContentView
                    : undefined
            }
            clusterView={
              renderConfig.clusterRenderer === 'anchor'
                ? demoAnchorClusterView
                : renderConfig.clusterRenderer === 'badge'
                  ? demoBadgeClusterView
                  : undefined
            }
            triangleView={triangleView}
            edgeView={edgeView}
            renderContentNode={
              renderConfig.contentRenderer === 'react-card'
                ? renderDemoContentCard
                : undefined
            }
            renderClusterNode={
              renderConfig.clusterRenderer === 'react-card'
                ? renderDemoClusterCard
                : undefined
            }
            sizeMultiplier={sizeMultiplier}
            showHulls={showHulls}
            pinnedIds={effectivePinnedIds}
            highlightedIds={highlightedIds}
            focusedClusterUid={focusedClusterUid}
            focusedTriangleIndex={focusedTriangleIndex}
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
            onTriangleHover={onTriangleHover}
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
                {hoveredContent.item.title}
              </div>
              <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                {formatEntitySubtitle(hoveredContent.item)}
              </div>
              <div className="mt-1 text-[11px] text-cyan-700 dark:text-cyan-300">
                {hoveredContent.layoutContext.tags.length > 0
                  ? hoveredContent.layoutContext.tags
                      .map((t) => t.meta?.displayTitle ?? t.tag)
                      .join(' · ')
                  : hoveredContent.layoutContext.unitClusters
                      .map((uc) => `${uc.cluster.code} ${Math.round(uc.weight * 100)}%`)
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
                <span className="truncate">{hoveredCluster.cluster.meta.title}</span>
              </div>
              <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                {hoveredCluster.cluster.meta.subtitle}
              </div>
              {hoveredCluster.cluster.coreTags.length > 0 ? (
                <div className="mt-1 text-[11px] text-slate-700 dark:text-slate-300">
                  Core:{' '}
                  {hoveredCluster.cluster.coreTags
                    .map((t) => t.meta?.displayTitle ?? t.tag)
                    .join(', ')}
                </div>
              ) : hoveredCluster.cluster.featureSummary ? (
                <div className="mt-1 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                  {hoveredCluster.cluster.featureSummary}
                </div>
              ) : null}
            </div>
          )}

          {/* Floating Triangle Hover Tooltip */}
          {hoveredTriangle &&
            !hoveredContent &&
            !hoveredCluster &&
            !contextMenu && (
              <div
                className="pointer-events-none absolute z-30 max-w-[min(21rem,calc(100%-1.5rem))] rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg dark:border-slate-700/90 dark:bg-[#0B0F17]/95"
                style={{
                  left: Math.max(
                    12,
                    Math.min(
                      Math.max(12, stageSize.width - 280),
                      hoveredTriangle.screenPosition.x + 14,
                    ),
                  ),
                  top: Math.max(
                    12,
                    Math.min(
                      Math.max(12, stageSize.height - 120),
                      hoveredTriangle.screenPosition.y - 12,
                    ),
                  ),
                }}
              >
                <div className="flex items-center justify-between gap-2 font-semibold text-slate-900 dark:text-slate-100">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-xs"
                      style={{ backgroundColor: hoveredTriangle.triangle.fillHex }}
                    />
                    <span>Triangle #{hoveredTriangle.triangle.index + 1}</span>
                  </span>
                  <span className="font-mono tabular-nums text-[11px] font-normal text-cyan-700 dark:text-cyan-300">
                    {hoveredTriangle.triangle.coveredItemCount} items
                  </span>
                </div>
                <div className="mt-1 space-y-0.5 text-[11px] text-slate-700 dark:text-slate-300">
                  {hoveredTriangle.triangle.clusters.map((corner, idx) => (
                    <div
                      key={hoveredTriangle.triangle.vertexIndices[idx]}
                      className="flex items-center gap-1.5 truncate"
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: corner?.colorHex ?? '#64748b',
                        }}
                      />
                      <span className="font-mono text-slate-500 dark:text-slate-400">
                        {corner?.code ??
                          `V${hoveredTriangle.triangle.vertexIndices[idx]}`}
                      </span>
                      <span className="truncate">
                        {corner?.meta.title ?? 'Unassigned Vertex'}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-1 font-mono tabular-nums text-[10px] text-slate-500 dark:text-slate-400">
                  {hoveredTriangle.triangle.interiorItemCount} 3-way interior · Click to
                  inspect
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
                    {contextMenu.target.item.title}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const id =
                        contextMenu.target.kind === 'content'
                          ? contextMenu.target.item.id
                          : '';
                      if (id) togglePinId(id);
                      setContextMenu(null);
                    }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Pin className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
                    {pinnedIds.has(contextMenu.target.item.id)
                      ? 'Unpin node'
                      : 'Pin node'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const id =
                        contextMenu.target.kind === 'content'
                          ? contextMenu.target.item.id
                          : '';
                      if (id) {
                        removeItemById(id);
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
                        setFocusedTriangleIndex(null);
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

              {contextMenu.target.kind === 'triangle' &&
                ((tri) => (
                  <>
                    <div className="border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-300 truncate">
                      Triangle #{tri.index + 1} ·{' '}
                      {tri.clusters
                        .map((c, idx) =>
                          c ? c.code : `V${tri.vertexIndices[idx]}`,
                        )
                        .join(' · ')}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setFocusedClusterUid(null);
                        setFocusedTriangleIndex((cur) =>
                          cur === tri.index ? null : tri.index,
                        );
                        setContextMenu(null);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Crosshair className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                      {focusedTriangleIndex === tri.index
                        ? 'Clear triangle focus'
                        : 'Isolate triangle face'}
                    </button>
                  </>
                ))(contextMenu.target.triangle)}

              {contextMenu.target.kind === 'background' && (
                <button
                  type="button"
                  onClick={() => {
                    handle.resetCamera();
                    setFocusedClusterUid(null);
                    setFocusedTriangleIndex(null);
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

          {/* Responsive Selected / Inspected Node or Triangle Detail Panel */}
          {inspected && (
            <div className="absolute bottom-3 left-3 right-24 z-20 max-h-[44dvh] overflow-y-auto rounded-md border border-slate-200 bg-white/95 p-3.5 text-xs shadow-lg backdrop-blur-xs dark:border-slate-800 dark:bg-[#0B0F17]/95 dark:shadow-none sm:bottom-auto sm:left-auto sm:top-14 sm:right-4 sm:w-80 sm:max-h-[calc(100%-7rem)]">
              <div className="flex items-start justify-between gap-2">
                <div>
                  {inspected.kind === 'content' ? (
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                      {inspected.item.title}
                    </div>
                  ) : inspected.kind === 'cluster' ? (
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                      <span className="font-mono text-cyan-700 dark:text-cyan-300 mr-1.5">
                        {inspected.cluster.code}
                      </span>
                      {inspected.cluster.meta.title}
                    </div>
                  ) : (
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-xs shrink-0"
                        style={{ backgroundColor: inspected.triangle.fillHex }}
                      />
                      <span>Triangle #{inspected.triangle.index + 1}</span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Close inspector"
                  onClick={() => {
                    setInspected(null);
                    setFocusedClusterUid(null);
                    setFocusedTriangleIndex(null);
                  }}
                  className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {inspected.kind === 'content' ? (
                <div>
                  <EntitySpecBadge
                    entity={inspected.item}
                    accentHex={inspected.mixedColorHex}
                  />
                  <div className="mt-2.5 text-[11px] text-slate-700 dark:text-slate-300">
                    <span className="text-slate-500 dark:text-slate-400">Simplex Unit: </span>
                    <span className="font-mono tabular-nums">
                      {inspected.clusterTitles.join(', ')}
                    </span>
                  </div>
                  {(inspected.featureSummary ||
                    inspected.residualDistance !== undefined) && (
                    <div className="mt-1 font-mono tabular-nums text-[10px] text-slate-500 dark:text-slate-400">
                      {inspected.featureSummary ?? ''}
                      {inspected.residualDistance !== undefined
                        ? ` · residual ${inspected.residualDistance.toFixed(3)}`
                        : ''}
                    </div>
                  )}
                </div>
              ) : inspected.kind === 'cluster' ? (
                <div className="mt-2.5 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{inspected.cluster.meta.memberCount} members</span>
                    <span aria-hidden="true">·</span>
                    <span>{inspected.cluster.meta.exclusiveCount} exclusive</span>
                    {inspected.cluster.cohesion !== undefined && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>
                          {Math.round(inspected.cluster.cohesion * 100)}% cohesion
                        </span>
                      </>
                    )}
                  </div>
                  {inspected.cluster.coreTags.length > 0 ? (
                    <div className="text-[11px] text-slate-700 dark:text-slate-300">
                      <span className="text-slate-500 dark:text-slate-400">
                        Core Tags:{' '}
                      </span>
                      {inspected.cluster.coreTags
                        .map((t) => t.meta?.displayTitle ?? t.tag)
                        .join(', ')}
                    </div>
                  ) : inspected.cluster.featureSummary ? (
                    <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                      {inspected.cluster.featureSummary}
                    </div>
                  ) : null}
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
                          {m.item.title}
                        </span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                          {Math.round(m.normalizedWeight * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-2.5 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{inspected.triangle.coveredItemCount} covered items</span>
                    <span aria-hidden="true">·</span>
                    <span>{inspected.triangle.interiorItemCount} interior 3-way</span>
                  </div>
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-2 space-y-1.5">
                    {inspected.triangle.clusters.map((corner, idx) => (
                      <div
                        key={inspected.triangle.vertexIndices[idx]}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                            style={{
                              backgroundColor: corner?.colorHex ?? '#64748b',
                            }}
                          />
                          <span className="font-mono text-cyan-700 dark:text-cyan-300 shrink-0">
                            {corner?.code ??
                              `V${inspected.triangle.vertexIndices[idx]}`}
                          </span>
                          <span className="truncate text-slate-700 dark:text-slate-200">
                            {corner?.meta.title ?? 'Unassigned Vertex'}
                          </span>
                        </div>
                        {corner && (
                          <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                            {corner.meta.memberCount}
                          </span>
                        )}
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
