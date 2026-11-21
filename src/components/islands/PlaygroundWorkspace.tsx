import type {
  CanvasDefaultClusterVisual,
  CanvasDefaultContentVisual,
  SimplexCanvasController,
} from '@simplex-viz/canvas';
import {
  DEFAULT_FULL_SCALE_THRESHOLD,
  SimplexTopicGraph,
  createAdaptiveHexMeshStrategy,
  createBarycentricZoomStrategy,
  createCollisionDrivenLayoutStrategy,
  createFinalSeededLayoutStrategy,
  createFixedLatticeMeshStrategy,
  createFreeCameraZoomStrategy,
  createIncrementalAnchorClusteringStrategy,
  createJaccardAnnealingClusteringStrategy,
  createLocalAdaptiveLayoutStrategy,
  createOklabContrastColorStrategy,
  createPaletteColorStrategy,
  createPbdUniformLayoutStrategy,
  createSemanticZoomStrategy,
  createSoftSimplexTagClusteringStrategy,
  createSubspaceZoomStrategy,
  createThemeAdaptiveOklabColorStrategy,
  createWarmStartPbdLayoutStrategy,
  useSimplexGraphController,
  type BarycentricClusterZoomMode,
  type DefaultClusterPresetVisual,
  type DefaultContentPresetVisual,
  type EmptyClusterBehavior,
  type FinalSeededLayoutScaleMode,
  type LayoutSolverOptions,
  type MeshOptions,
  type SharedTagRuleKind,
  type SimplexAnchorRuleKind,
  type SimplexTimelineState,
  type SimplexVisualPreset,
  type SimplexZoomState,
  type TimelinePlayerOptions,
} from '@simplex-viz/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react';
import {
  STRATEGY_REGISTRY,
  type CanonicalClusteringStrategyId,
  type CanonicalColorStrategyId,
  type CanonicalLayoutStrategyId,
  type CanonicalMeshStrategyId,
  type CanonicalZoomStrategyId,
} from '../../site/strategies';
import {
  SimplexCanvasStage,
  type ShowcaseRendererKind,
} from './SimplexCanvasStage';
import { useDocumentDarkTheme } from './useDocumentDarkTheme';

export interface PlaygroundTaggedItem {
  readonly id: string;
  readonly label: string;
  readonly tags: readonly string[];
  readonly date?: string | number;
  readonly note?: string;
}

export interface PlaygroundDatasetEnvelope {
  readonly version: 1;
  readonly items: readonly PlaygroundTaggedItem[];
}

type AccordionSectionId =
  | 'mesh'
  | 'clustering'
  | 'color'
  | 'layout'
  | 'zoom'
  | 'visual'
  | 'timeline';

type PlaygroundLayoutId = CanonicalLayoutStrategyId | 'final-seeded-layout';

const DEFAULT_BRAND_PALETTE: readonly string[] = [
  '#0891b2',
  '#d97706',
  '#c026d3',
  '#059669',
  '#2563eb',
  '#e11d48',
];

const PALETTE_PRESETS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly colors: readonly string[];
}> = [
  {
    id: 'brand',
    label: 'Default',
    colors: DEFAULT_BRAND_PALETTE,
  },
  {
    id: 'nordic',
    label: 'Nordic',
    colors: ['#0284c7', '#0d9488', '#4f46e5', '#65a30d', '#ea580c', '#db2777'],
  },
  {
    id: 'editorial',
    label: 'Editorial',
    colors: ['#b45309', '#0f766e', '#1d4ed8', '#be123c', '#4338ca', '#15803d'],
  },
];

const SCHEMA_EXAMPLE = `{
  "version": 1,
  "items": [
    {
      "id": "paper-1",
      "label": "Conformal Mesh Parameterization",
      "tags": ["geometry", "mesh", "graphics"],
      "date": 2021,
      "note": "Optional subtitle or URL"
    },
    {
      "id": "paper-2",
      "label": "Perceptual Color Interpolation",
      "tags": ["color", "graphics"],
      "date": 2023
    }
  ]
}`;

function parseOptionalDateValue(raw: unknown): string | number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (/^\d{4}$/.test(trimmed)) {
      return Number(trimmed);
    }
    return trimmed;
  }
  return undefined;
}

function normalizeTagList(rawInput: string | readonly unknown[]): string[] {
  const tokens: string[] = [];
  if (typeof rawInput === 'string') {
    for (const part of rawInput.split(/[,;\n]+|\s+/g)) {
      const cleaned = part.trim().replace(/^#+/, '').toLowerCase();
      if (cleaned.length > 0 && !tokens.includes(cleaned)) {
        tokens.push(cleaned);
      }
    }
    return tokens;
  }

  for (const entry of rawInput) {
    if (typeof entry === 'string') {
      const cleaned = entry.trim().replace(/^#+/, '').toLowerCase();
      if (cleaned.length > 0 && !tokens.includes(cleaned)) {
        tokens.push(cleaned);
      }
    }
  }
  return tokens;
}

export function parsePlaygroundJson(
  rawText: string,
): { ok: true; dataset: PlaygroundDatasetEnvelope } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON syntax: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let rawItems: unknown[];

  if (Array.isArray(parsed)) {
    rawItems = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.items)) {
      return {
        ok: false,
        error:
          'Expected either a JSON array of items [...] or an object { "items": [...] }.',
      };
    }
    rawItems = obj.items;
  } else {
    return {
      ok: false,
      error: 'Top-level JSON value must be an object with "items" or an array of items.',
    };
  }

  const seenIds = new Set<string>();
  const normalizedItems: PlaygroundTaggedItem[] = [];

  for (let i = 0; i < rawItems.length; i++) {
    const row = rawItems[i];
    if (!row || typeof row !== 'object') {
      return {
        ok: false,
        error: `Item at index ${i} must be an object with "label" and "tags".`,
      };
    }
    const rec = row as Record<string, unknown>;
    const rawLabel =
      typeof rec.label === 'string'
        ? rec.label
        : typeof rec.title === 'string'
          ? rec.title
          : typeof rec.headline === 'string'
            ? rec.headline
            : typeof rec.fullName === 'string'
              ? rec.fullName
              : '';
    const label = rawLabel.trim();
    if (!label) {
      return {
        ok: false,
        error: `Item at index ${i} is missing a non-empty "label" (or "title") string.`,
      };
    }

    const rawTagsField = Array.isArray(rec.tags)
      ? rec.tags
      : Array.isArray(rec.hashtags)
        ? rec.hashtags
        : Array.isArray(rec.topics)
          ? rec.topics
          : typeof rec.tags === 'string'
            ? rec.tags
            : null;

    if (rawTagsField === null) {
      return {
        ok: false,
        error: `Item "${label}" (index ${i}) is missing a "tags" string[] field.`,
      };
    }

    const tags = normalizeTagList(rawTagsField);
    if (tags.length === 0) {
      return {
        ok: false,
        error: `Item "${label}" (index ${i}) must have at least one non-empty tag.`,
      };
    }

    const baseId =
      typeof rec.id === 'string' && rec.id.trim().length > 0
        ? rec.id.trim()
        : typeof rec.slug === 'string' && rec.slug.trim().length > 0
          ? rec.slug.trim()
          : `item-${i + 1}`;
    let uniqueId = baseId;
    let suffix = 2;
    while (seenIds.has(uniqueId)) {
      uniqueId = `${baseId}-${suffix++}`;
    }
    seenIds.add(uniqueId);

    const date = parseOptionalDateValue(
      rec.date ??
        rec.year ??
        rec.publishedYear ??
        rec.releaseYear ??
        rec.timestamp ??
        rec.createdAt,
    );

    const note =
      typeof rec.note === 'string' && rec.note.trim().length > 0
        ? rec.note.trim()
        : typeof rec.description === 'string' && rec.description.trim().length > 0
          ? rec.description.trim()
          : undefined;

    normalizedItems.push({
      id: uniqueId,
      label,
      tags,
      ...(date !== undefined ? { date } : {}),
      ...(note ? { note } : {}),
    });
  }

  return {
    ok: true,
    dataset: {
      version: 1,
      items: normalizedItems,
    },
  };
}

function AccordionChevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-150 dark:text-slate-500 ${
        open ? 'rotate-180' : ''
      }`}
    >
      <path
        d="M4 6.25L8 10.25L12 6.25"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlaygroundWorkspace() {
  const theme = useDocumentDarkTheme();
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'left' | 'right'>('none');

  const [items, setItems] = useState<readonly PlaygroundTaggedItem[]>([]);

  // Builder form state
  const [draftLabel, setDraftLabel] = useState<string>('');
  const [draftTags, setDraftTags] = useState<string>('');
  const [draftDate, setDraftDate] = useState<string>('');
  const [draftNote, setDraftNote] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Right sidebar accordion state
  const [openSection, setOpenSection] = useState<AccordionSectionId | null>('mesh');

  // Stage 01 · Mesh strategy & parameters
  const [meshId, setMeshId] = useState<CanonicalMeshStrategyId>('adaptive-hex-mesh');
  const [meshInnerPadding, setMeshInnerPadding] = useState<number>(48);
  const [adaptiveMaxClusters, setAdaptiveMaxClusters] = useState<number>(14);
  const [adaptiveMinSide, setAdaptiveMinSide] = useState<number>(130);
  const [fixedCols, setFixedCols] = useState<number>(3);
  const [fixedRows, setFixedRows] = useState<number>(2);
  const [fixedOrientation, setFixedOrientation] = useState<
    'auto' | 'horizontal' | 'vertical'
  >('auto');
  const [fixedWideFirst, setFixedWideFirst] = useState<boolean>(true);

  // Stage 02 · Clustering strategy & parameters
  const [clusteringId, setClusteringId] =
    useState<CanonicalClusteringStrategyId>('soft-simplex-tags');
  const [sharedTagRule, setSharedTagRule] =
    useState<SharedTagRuleKind>('planar-hitting-set');
  const [anchorRule, setAnchorRule] =
    useState<SimplexAnchorRuleKind>('explaining-away');
  const [softTriangleSpread, setSoftTriangleSpread] = useState<number>(0.45);
  const [softBalanceLoad, setSoftBalanceLoad] = useState<boolean>(true);

  // Stage 03 · Color strategy & parameters
  const [colorId, setColorId] =
    useState<CanonicalColorStrategyId>('theme-adaptive-oklab');
  const [paletteColors, setPaletteColors] =
    useState<readonly string[]>(DEFAULT_BRAND_PALETTE);
  const [paletteMode, setPaletteMode] = useState<'edge-contrast' | 'sequential'>(
    'edge-contrast',
  );
  const [palettePreserveMatched, setPalettePreserveMatched] = useState<boolean>(false);

  // Stage 04 · Layout strategy & parameters
  const [layoutId, setLayoutId] =
    useState<PlaygroundLayoutId>('collision-local-layout');
  const [finalSeededBaseLayoutId, setFinalSeededBaseLayoutId] =
    useState<CanonicalLayoutStrategyId>('collision-local-layout');
  const [finalSeededScaleMode, setFinalSeededScaleMode] =
    useState<FinalSeededLayoutScaleMode>('pinned');
  const [finalSeededUnseenPolicy, setFinalSeededUnseenPolicy] = useState<
    'fallback' | 'reseed'
  >('fallback');
  const [collisionMinLocalScale, setCollisionMinLocalScale] = useState<number>(0.32);
  const [collisionShrinkFactor, setCollisionShrinkFactor] = useState<number>(0.85);
  const [collisionWarmStart, setCollisionWarmStart] = useState<boolean>(true);
  const [densityCrowdRadiusPx, setDensityCrowdRadiusPx] = useState<number>(76);
  const [densityMinLocalScale, setDensityMinLocalScale] = useState<number>(0.35);
  const [densityWarmStart, setDensityWarmStart] = useState<boolean>(true);
  const [clusterGapPx, setClusterGapPx] = useState<number>(14);
  const [itemGapPx, setItemGapPx] = useState<number>(5);
  const [minContentScale, setMinContentScale] = useState<number>(0.2);
  const [relaxationIterations, setRelaxationIterations] = useState<number>(42);

  // Stage 05 · Zoom strategy & parameters
  const [zoomId, setZoomId] =
    useState<CanonicalZoomStrategyId>('semantic-tag-split-zoom');
  const [clusterZoomMode, setClusterZoomMode] =
    useState<BarycentricClusterZoomMode>('incident-star');
  const [zoomStopWhenFullScale, setZoomStopWhenFullScale] = useState<boolean>(true);
  const [zoomFullScaleThreshold, setZoomFullScaleThreshold] = useState<number>(
    DEFAULT_FULL_SCALE_THRESHOLD,
  );
  const [semanticBarycentricFallback, setSemanticBarycentricFallback] =
    useState<boolean>(true);
  const [barycentricContrastStretch, setBarycentricContrastStretch] =
    useState<boolean>(true);
  const [barycentricSectorFallback, setBarycentricSectorFallback] =
    useState<boolean>(true);

  // Stage 06 · Visual preset & geometry parameters
  const [rendererMode, setRendererMode] = useState<ShowcaseRendererKind>('svg');
  const [presetMode, setPresetMode] = useState<SimplexVisualPreset>('geometric');
  const [sizeMultiplier, setSizeMultiplier] = useState<number>(1);
  const [showHulls, setShowHulls] = useState<boolean>(false);
  const [emptyClusterBehavior, setEmptyClusterBehavior] =
    useState<EmptyClusterBehavior>('normal');

  // Stage 07 · Chronological timeline playback
  const [timelineEnabled, setTimelineEnabled] = useState<boolean>(false);
  const [timelineStepIntervalMs, setTimelineStepIntervalMs] = useState<number>(650);
  const [timelineSpeed, setTimelineSpeed] = useState<number>(1);
  const [timelineLoop, setTimelineLoop] = useState<boolean>(false);
  const [timelineAutoFinalSeed, setTimelineAutoFinalSeed] = useState<boolean>(true);
  const [timelineAutoFinalSeedLayout, setTimelineAutoFinalSeedLayout] = useState<
    false | FinalSeededLayoutScaleMode
  >(false);
  const [timelineIncludeEmptyStart, setTimelineIncludeEmptyStart] =
    useState<boolean>(false);
  const [timelineShowControls, setTimelineShowControls] = useState<boolean>(true);
  const [timelinePosition, setTimelinePosition] = useState<'bottom' | 'top'>('bottom');
  const [timelineState, setTimelineState] =
    useState<SimplexTimelineState<PlaygroundTaggedItem> | null>(null);

  // Import/Export & Drag-and-drop state
  const [jsonDrawerOpen, setJsonDrawerOpen] = useState<boolean>(false);
  const [jsonText, setJsonText] = useState<string>('');
  const [jsonEditorError, setJsonEditorError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    readonly tone: 'ok' | 'err';
    readonly message: string;
  } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const dragDepthRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [zoomState, setZoomState] = useState<SimplexZoomState | null>(null);

  const { controllerRef, handle: svgHandle } = useSimplexGraphController<
    PlaygroundTaggedItem,
    DefaultContentPresetVisual,
    DefaultClusterPresetVisual
  >();
  const canvasControllerRef = useRef<SimplexCanvasController<
    PlaygroundTaggedItem,
    CanvasDefaultContentVisual,
    CanvasDefaultClusterVisual
  > | null>(null);

  const handle = useMemo(
    () => ({
      drillToRoot: () => {
        if (rendererMode === 'canvas') {
          return canvasControllerRef.current?.drillToRoot() ?? false;
        }
        return svgHandle.drillToRoot();
      },
      getTimeline: () => {
        if (rendererMode === 'canvas') {
          return canvasControllerRef.current?.getTimeline() ?? null;
        }
        return svgHandle.getTimeline();
      },
    }),
    [rendererMode, svgHandle],
  );

  const serializedDataset = useMemo(() => {
    const payload: PlaygroundDatasetEnvelope = {
      version: 1,
      items,
    };
    return JSON.stringify(payload, null, 2);
  }, [items]);

  const applyImportedText = useCallback(
    (rawText: string, sourceLabel: string): boolean => {
      const res = parsePlaygroundJson(rawText);
      if (!res.ok) {
        setStatusBanner({ tone: 'err', message: `${sourceLabel}: ${res.error}` });
        setJsonEditorError(res.error);
        return false;
      }
      handle.drillToRoot();
      setItems(res.dataset.items);
      setEditingId(null);
      setSelectedItemId(null);
      setJsonEditorError(null);
      setStatusBanner({
        tone: 'ok',
        message: `Loaded ${res.dataset.items.length} tagged items via ${sourceLabel}.`,
      });
      return true;
    },
    [handle],
  );

  // Escape key closes full-size Paste/Edit JSON workspace
  useEffect(() => {
    if (!jsonDrawerOpen) return;
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        setJsonDrawerOpen(false);
        setJsonEditorError(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [jsonDrawerOpen]);

  // Global clipboard paste support when focus is outside input/textarea/select
  useEffect(() => {
    function onWindowPaste(ev: ClipboardEvent) {
      const target = ev.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const text = ev.clipboardData?.getData('text/plain')?.trim();
      if (!text || (!text.startsWith('{') && !text.startsWith('['))) {
        return;
      }
      ev.preventDefault();
      applyImportedText(text, 'Clipboard Paste');
    }
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [applyImportedText]);

  const allTagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const t of item.tags) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase().replace(/^#+/, '');
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.tags.some((t) => t.includes(q)) ||
        (item.date !== undefined && String(item.date).toLowerCase().includes(q)) ||
        (item.note && item.note.toLowerCase().includes(q)),
    );
  }, [items, searchQuery]);

  const highlightedSet = useMemo(
    () => (selectedItemId ? new Set([selectedItemId]) : undefined),
    [selectedItemId],
  );

  // Engine Options & Parameterized Strategy Instances
  const meshOptions = useMemo<MeshOptions>(
    () => ({
      innerPadding: meshInnerPadding,
      maxClusters: adaptiveMaxClusters,
      minSideLength: adaptiveMinSide,
    }),
    [meshInnerPadding, adaptiveMaxClusters, adaptiveMinSide],
  );

  const meshStrategy = useMemo(() => {
    if (meshId === 'fixed-grid-mesh') {
      return createFixedLatticeMeshStrategy<PlaygroundTaggedItem>({
        cols: fixedCols,
        rows: fixedRows,
        orientation: fixedOrientation,
        wideFirst: fixedWideFirst,
        innerPadding: meshInnerPadding,
      });
    }
    return createAdaptiveHexMeshStrategy<PlaygroundTaggedItem>({
      innerPadding: meshInnerPadding,
      maxClusters: adaptiveMaxClusters,
      minSideLength: adaptiveMinSide,
    });
  }, [
    meshId,
    fixedCols,
    fixedRows,
    fixedOrientation,
    fixedWideFirst,
    meshInnerPadding,
    adaptiveMaxClusters,
    adaptiveMinSide,
  ]);

  const clusteringStrategy = useMemo(() => {
    if (clusteringId === 'jaccard-qap-tags') {
      return createJaccardAnnealingClusteringStrategy<PlaygroundTaggedItem>({
        sharedTagRule,
        anchorRule,
      });
    }
    if (clusteringId === 'incremental-anchor-tags') {
      return createIncrementalAnchorClusteringStrategy<PlaygroundTaggedItem>({
        sharedTagRule,
        anchorRule,
      });
    }
    return createSoftSimplexTagClusteringStrategy<PlaygroundTaggedItem>({
      sharedTagRule,
      anchorRule,
      triangleSpread: softTriangleSpread,
      balanceLoad: softBalanceLoad,
    });
  }, [
    clusteringId,
    sharedTagRule,
    anchorRule,
    softTriangleSpread,
    softBalanceLoad,
  ]);

  const colorStrategy = useMemo(() => {
    if (colorId === 'oklab-edge-contrast') {
      return createOklabContrastColorStrategy<PlaygroundTaggedItem>();
    }
    if (colorId === 'custom-brand-palette') {
      return createPaletteColorStrategy<PlaygroundTaggedItem>(paletteColors, {
        mode: paletteMode,
        preserveMatchedColors: palettePreserveMatched,
      });
    }
    return createThemeAdaptiveOklabColorStrategy<PlaygroundTaggedItem>();
  }, [colorId, paletteColors, paletteMode, palettePreserveMatched]);

  const layoutOptions = useMemo<LayoutSolverOptions>(
    () => ({
      clusterGapPx,
      itemGapPx,
      minContentScale,
      relaxationIterations,
      sizeMultiplier,
    }),
    [
      clusterGapPx,
      itemGapPx,
      minContentScale,
      relaxationIterations,
      sizeMultiplier,
    ],
  );

  const layoutStrategy = useMemo(() => {
    const buildBaseLayout = (id: CanonicalLayoutStrategyId) => {
      if (id === 'pbd-uniform-layout') {
        return createPbdUniformLayoutStrategy();
      }
      if (id === 'warm-start-pbd-layout') {
        return createWarmStartPbdLayoutStrategy();
      }
      if (id === 'density-adaptive-layout') {
        return createLocalAdaptiveLayoutStrategy({
          crowdRadiusPx: densityCrowdRadiusPx,
          minLocalScale: densityMinLocalScale,
          warmStart: densityWarmStart,
        });
      }
      return createCollisionDrivenLayoutStrategy({
        minLocalScale: collisionMinLocalScale,
        shrinkFactor: collisionShrinkFactor,
        warmStart: collisionWarmStart,
      });
    };

    if (layoutId === 'final-seeded-layout') {
      return createFinalSeededLayoutStrategy(
        buildBaseLayout(finalSeededBaseLayoutId),
        {
          scaleMode: finalSeededScaleMode,
          unseenItemPolicy: finalSeededUnseenPolicy,
        },
      );
    }

    return buildBaseLayout(layoutId);
  }, [
    layoutId,
    finalSeededBaseLayoutId,
    finalSeededScaleMode,
    finalSeededUnseenPolicy,
    densityCrowdRadiusPx,
    densityMinLocalScale,
    densityWarmStart,
    collisionMinLocalScale,
    collisionShrinkFactor,
    collisionWarmStart,
  ]);

  const zoomStrategy = useMemo(() => {
    if (zoomId === 'free-camera-zoom') {
      return createFreeCameraZoomStrategy<PlaygroundTaggedItem>();
    }
    if (zoomId === 'subspace-recluster-zoom') {
      return createSubspaceZoomStrategy<PlaygroundTaggedItem>({
        clusterZoomMode,
        stopWhenFullScale: zoomStopWhenFullScale,
        fullScaleThreshold: zoomFullScaleThreshold,
      });
    }
    if (zoomId === 'barycentric-subdivision-zoom') {
      return createBarycentricZoomStrategy<PlaygroundTaggedItem>({
        clusterZoomMode,
        adaptiveContrastStretch: barycentricContrastStretch,
        enableSectorFallback: barycentricSectorFallback,
        stopWhenFullScale: zoomStopWhenFullScale,
        fullScaleThreshold: zoomFullScaleThreshold,
      });
    }
    return createSemanticZoomStrategy<PlaygroundTaggedItem>({
      clusterZoomMode,
      barycentricFallback: semanticBarycentricFallback,
      stopWhenFullScale: zoomStopWhenFullScale,
      fullScaleThreshold: zoomFullScaleThreshold,
    });
  }, [
    zoomId,
    clusterZoomMode,
    barycentricContrastStretch,
    barycentricSectorFallback,
    semanticBarycentricFallback,
    zoomStopWhenFullScale,
    zoomFullScaleThreshold,
  ]);

  const timelineConfig = useMemo<
    TimelinePlayerOptions<PlaygroundTaggedItem> | undefined
  >(() => {
    if (!timelineEnabled) return undefined;
    return {
      getTimestamp: (item) => item.date,
      stepIntervalMs: timelineStepIntervalMs,
      speed: timelineSpeed,
      loop: timelineLoop,
      autoFinalSeed: timelineAutoFinalSeed,
      autoFinalSeedLayout: timelineAutoFinalSeedLayout,
      emptyClusterBehavior,
      includeEmptyStart: timelineIncludeEmptyStart,
      showControls: timelineShowControls,
      position: timelinePosition,
    };
  }, [
    timelineEnabled,
    timelineStepIntervalMs,
    timelineSpeed,
    timelineLoop,
    timelineAutoFinalSeed,
    timelineAutoFinalSeedLayout,
    emptyClusterBehavior,
    timelineIncludeEmptyStart,
    timelineShowControls,
    timelinePosition,
  ]);

  useEffect(() => {
    if (!timelineEnabled || items.length === 0) {
      setTimelineState(null);
    }
  }, [timelineEnabled, items.length]);

  const hasNonDefaultPipeline = useMemo(() => {
    const paletteChanged =
      paletteColors.length !== DEFAULT_BRAND_PALETTE.length ||
      paletteColors.some((c, idx) => c !== DEFAULT_BRAND_PALETTE[idx]);
    return (
      meshId !== 'adaptive-hex-mesh' ||
      meshInnerPadding !== 48 ||
      adaptiveMaxClusters !== 14 ||
      adaptiveMinSide !== 130 ||
      fixedCols !== 3 ||
      fixedRows !== 2 ||
      fixedOrientation !== 'auto' ||
      !fixedWideFirst ||
      clusteringId !== 'soft-simplex-tags' ||
      sharedTagRule !== 'planar-hitting-set' ||
      anchorRule !== 'explaining-away' ||
      Math.abs(softTriangleSpread - 0.45) > 1e-4 ||
      !softBalanceLoad ||
      colorId !== 'theme-adaptive-oklab' ||
      paletteChanged ||
      paletteMode !== 'edge-contrast' ||
      palettePreserveMatched ||
      layoutId !== 'collision-local-layout' ||
      finalSeededBaseLayoutId !== 'collision-local-layout' ||
      finalSeededScaleMode !== 'pinned' ||
      finalSeededUnseenPolicy !== 'fallback' ||
      Math.abs(collisionMinLocalScale - 0.32) > 1e-4 ||
      Math.abs(collisionShrinkFactor - 0.85) > 1e-4 ||
      !collisionWarmStart ||
      densityCrowdRadiusPx !== 76 ||
      Math.abs(densityMinLocalScale - 0.3) > 1e-4 ||
      densityWarmStart ||
      clusterGapPx !== 14 ||
      itemGapPx !== 5 ||
      Math.abs(minContentScale - 0.2) > 1e-4 ||
      relaxationIterations !== 42 ||
      zoomId !== 'semantic-tag-split-zoom' ||
      clusterZoomMode !== 'incident-star' ||
      !zoomStopWhenFullScale ||
      Math.abs(zoomFullScaleThreshold - DEFAULT_FULL_SCALE_THRESHOLD) > 1e-4 ||
      !semanticBarycentricFallback ||
      !barycentricContrastStretch ||
      !barycentricSectorFallback ||
      presetMode !== 'geometric' ||
      Math.abs(sizeMultiplier - 1) > 1e-4 ||
      showHulls ||
      emptyClusterBehavior !== 'normal' ||
      timelineEnabled ||
      timelineStepIntervalMs !== 650 ||
      timelineSpeed !== 1 ||
      timelineLoop ||
      !timelineAutoFinalSeed ||
      timelineAutoFinalSeedLayout !== false ||
      timelineIncludeEmptyStart ||
      !timelineShowControls ||
      timelinePosition !== 'bottom'
    );
  }, [
    meshId,
    meshInnerPadding,
    adaptiveMaxClusters,
    adaptiveMinSide,
    fixedCols,
    fixedRows,
    fixedOrientation,
    fixedWideFirst,
    clusteringId,
    sharedTagRule,
    anchorRule,
    softTriangleSpread,
    softBalanceLoad,
    colorId,
    paletteColors,
    paletteMode,
    palettePreserveMatched,
    layoutId,
    finalSeededBaseLayoutId,
    finalSeededScaleMode,
    finalSeededUnseenPolicy,
    collisionMinLocalScale,
    collisionShrinkFactor,
    collisionWarmStart,
    densityCrowdRadiusPx,
    densityMinLocalScale,
    densityWarmStart,
    clusterGapPx,
    itemGapPx,
    minContentScale,
    relaxationIterations,
    zoomId,
    clusterZoomMode,
    zoomStopWhenFullScale,
    zoomFullScaleThreshold,
    semanticBarycentricFallback,
    barycentricContrastStretch,
    barycentricSectorFallback,
    presetMode,
    sizeMultiplier,
    showHulls,
    emptyClusterBehavior,
    timelineEnabled,
    timelineStepIntervalMs,
    timelineSpeed,
    timelineLoop,
    timelineAutoFinalSeed,
    timelineAutoFinalSeedLayout,
    timelineIncludeEmptyStart,
    timelineShowControls,
    timelinePosition,
  ]);

  function resetAllPipelineDefaults() {
    handle.drillToRoot();
    setMeshId('adaptive-hex-mesh');
    setMeshInnerPadding(48);
    setAdaptiveMaxClusters(14);
    setAdaptiveMinSide(130);
    setFixedCols(3);
    setFixedRows(2);
    setFixedOrientation('auto');
    setFixedWideFirst(true);

    setClusteringId('soft-simplex-tags');
    setSharedTagRule('planar-hitting-set');
    setAnchorRule('explaining-away');
    setSoftTriangleSpread(0.45);
    setSoftBalanceLoad(true);

    setColorId('theme-adaptive-oklab');
    setPaletteColors(DEFAULT_BRAND_PALETTE);
    setPaletteMode('edge-contrast');
    setPalettePreserveMatched(false);

    setLayoutId('collision-local-layout');
    setFinalSeededBaseLayoutId('collision-local-layout');
    setFinalSeededScaleMode('pinned');
    setFinalSeededUnseenPolicy('fallback');
    setCollisionMinLocalScale(0.32);
    setCollisionShrinkFactor(0.85);
    setCollisionWarmStart(true);
    setDensityCrowdRadiusPx(76);
    setDensityMinLocalScale(0.3);
    setDensityWarmStart(false);
    setClusterGapPx(14);
    setItemGapPx(5);
    setMinContentScale(0.2);
    setRelaxationIterations(42);

    setZoomId('semantic-tag-split-zoom');
    setClusterZoomMode('incident-star');
    setZoomStopWhenFullScale(true);
    setZoomFullScaleThreshold(DEFAULT_FULL_SCALE_THRESHOLD);
    setSemanticBarycentricFallback(true);
    setBarycentricContrastStretch(true);
    setBarycentricSectorFallback(true);

    setPresetMode('geometric');
    setSizeMultiplier(1);
    setShowHulls(false);
    setEmptyClusterBehavior('normal');

    setTimelineEnabled(false);
    setTimelineStepIntervalMs(650);
    setTimelineSpeed(1);
    setTimelineLoop(false);
    setTimelineAutoFinalSeed(true);
    setTimelineAutoFinalSeedLayout(false);
    setTimelineIncludeEmptyStart(false);
    setTimelineShowControls(true);
    setTimelinePosition('bottom');
    setTimelineState(null);
  }

  function openJsonEditor() {
    if (!jsonDrawerOpen) {
      setJsonText(items.length > 0 ? serializedDataset : SCHEMA_EXAMPLE);
      setJsonEditorError(null);
      setJsonDrawerOpen(true);
    }
    setMobileDrawer('none');
  }

  function handleFormatJsonText() {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setJsonEditorError(null);
    } catch (err) {
      setJsonEditorError(
        `Cannot format JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function handleAddOrUpdateItem(ev: FormEvent) {
    ev.preventDefault();
    const cleanLabel = draftLabel.trim();
    const cleanTags = normalizeTagList(draftTags);
    const cleanDate = parseOptionalDateValue(draftDate);
    const cleanNote = draftNote.trim();

    if (!cleanLabel) {
      setStatusBanner({ tone: 'err', message: 'Please enter an item label.' });
      return;
    }
    if (cleanTags.length === 0) {
      setStatusBanner({
        tone: 'err',
        message: 'Please assign at least one tag (comma- or space-separated).',
      });
      return;
    }

    if (editingId) {
      setItems((prev) =>
        prev.map((it) =>
          it.id === editingId
            ? {
                id: it.id,
                label: cleanLabel,
                tags: cleanTags,
                ...(cleanDate !== undefined ? { date: cleanDate } : {}),
                ...(cleanNote ? { note: cleanNote } : {}),
              }
            : it,
        ),
      );
      setEditingId(null);
      setStatusBanner({ tone: 'ok', message: `Updated "${cleanLabel}".` });
    } else {
      const nextId = `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
      setItems((prev) => [
        {
          id: nextId,
          label: cleanLabel,
          tags: cleanTags,
          ...(cleanDate !== undefined ? { date: cleanDate } : {}),
          ...(cleanNote ? { note: cleanNote } : {}),
        },
        ...prev,
      ]);
      setSelectedItemId(nextId);
      setStatusBanner({ tone: 'ok', message: `Added "${cleanLabel}".` });
    }

    setDraftLabel('');
    setDraftTags('');
    setDraftDate('');
    setDraftNote('');
  }

  function startEditItem(item: PlaygroundTaggedItem) {
    setEditingId(item.id);
    setDraftLabel(item.label);
    setDraftTags(item.tags.join(', '));
    setDraftDate(item.date !== undefined ? String(item.date) : '');
    setDraftNote(item.note ?? '');
  }

  function appendSuggestedTag(tag: string) {
    const existing = normalizeTagList(draftTags);
    if (existing.includes(tag)) return;
    setDraftTags(existing.length > 0 ? `${existing.join(', ')}, ${tag}` : tag);
  }

  function handleFileInputChange(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        if (applyImportedText(reader.result, `File "${file.name}"`)) {
          setJsonDrawerOpen(false);
        }
      }
    };
    reader.onerror = () => {
      setStatusBanner({ tone: 'err', message: `Could not read file "${file.name}".` });
    };
    reader.readAsText(file);
    ev.target.value = '';
  }

  function handleCanvasDragEnter(ev: DragEvent<HTMLDivElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  }

  function handleCanvasDragOver(ev: DragEvent<HTMLDivElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = 'copy';
  }

  function handleCanvasDragLeave(ev: DragEvent<HTMLDivElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFile(false);
    }
  }

  function handleCanvasDrop(ev: DragEvent<HTMLDivElement>) {
    ev.preventDefault();
    ev.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);

    const file = ev.dataTransfer.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          if (applyImportedText(reader.result, `Dropped file "${file.name}"`)) {
            setJsonDrawerOpen(false);
          }
        }
      };
      reader.onerror = () => {
        setStatusBanner({
          tone: 'err',
          message: `Failed to read dropped file "${file.name}".`,
        });
      };
      reader.readAsText(file);
      return;
    }

    const droppedText = ev.dataTransfer.getData('text/plain')?.trim();
    if (droppedText) {
      if (applyImportedText(droppedText, 'Dropped JSON text')) {
        setJsonDrawerOpen(false);
      }
    }
  }

  function handleDownloadJson() {
    const blob = new Blob([serializedDataset], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = 'simplex-dataset.json';
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusBanner({
      tone: 'ok',
      message: `Downloaded ${filename} (${items.length} items).`,
    });
  }

  function handleCopyJson() {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(serializedDataset).then(() => {
      setStatusBanner({
        tone: 'ok',
        message: `Copied ${items.length} items as formatted JSON to clipboard.`,
      });
    });
  }

  function handleClearDataset() {
    handle.drillToRoot();
    setEditingId(null);
    setSelectedItemId(null);
    setItems([]);
    setStatusBanner({
      tone: 'ok',
      message: 'Cleared dataset.',
    });
  }

  function toggleSection(section: AccordionSectionId) {
    setOpenSection((prev) => (prev === section ? null : section));
  }

  const meshHeaderSummary =
    meshId === 'fixed-grid-mesh' ? `Fixed ${fixedCols}×${fixedRows}` : 'Adaptive Hex';

  const clusteringHeaderSummary =
    clusteringId === 'jaccard-qap-tags'
      ? 'Jaccard QAP'
      : clusteringId === 'incremental-anchor-tags'
        ? 'Incremental'
        : 'Soft-Simplex';

  const colorHeaderSummary =
    colorId === 'oklab-edge-contrast'
      ? 'Edge Contrast'
      : colorId === 'custom-brand-palette'
        ? 'Custom Palette'
        : 'Theme OKLab';

  const layoutHeaderSummary =
    layoutId === 'final-seeded-layout'
      ? finalSeededScaleMode === 'adaptive'
        ? 'Final-Seeded (Adapt)'
        : 'Final-Seeded (Pin)'
      : layoutId === 'pbd-uniform-layout'
        ? 'Uniform PBD'
        : layoutId === 'warm-start-pbd-layout'
          ? 'Warm-Start PBD'
          : layoutId === 'density-adaptive-layout'
            ? 'Density-Adaptive'
            : 'Collision-Local';

  const zoomHeaderSummary =
    zoomId === 'free-camera-zoom'
      ? 'Free Camera'
      : zoomId === 'subspace-recluster-zoom'
        ? 'Subspace'
        : zoomId === 'barycentric-subdivision-zoom'
          ? 'Barycentric 1:4'
          : 'Semantic 3→6';

  const presetLabel =
    presetMode === 'glyphs'
      ? 'Donut Glyphs'
      : presetMode === 'badges'
        ? 'Label Badges'
        : 'Geometric';
  const visualHeaderSummary =
    rendererMode === 'canvas' ? `Canvas · ${presetLabel}` : presetLabel;

  const timelineHeaderSummary = timelineEnabled
    ? timelineState
      ? `${timelineState.activeLabel} (${timelineState.step + 1}/${timelineState.totalSteps + 1})`
      : 'Enabled'
    : 'Off';

  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-white dark:bg-[#0B0F17]">
      {/* Mobile Backdrop when Left or Right Drawer is Open */}
      {mobileDrawer !== 'none' && (
        <div
          aria-hidden="true"
          onClick={() => setMobileDrawer('none')}
          className="absolute inset-0 z-20 bg-slate-950/45 backdrop-blur-[1px] lg:hidden"
        />
      )}

      {/* Left Sidebar: JSON Dataset Actions + Item Builder + Corpus List */}
      <aside
        aria-label="Dataset and JSON controls"
        className={`${
          mobileDrawer === 'left' ? 'flex' : 'hidden lg:flex'
        } max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-30 max-lg:w-[min(92vw,350px)] max-lg:shadow-2xl lg:w-[320px] xl:w-[345px] shrink-0 flex-col border-r border-slate-200/90 bg-white overflow-y-auto dark:border-slate-800/90 dark:bg-[#0B0F17]`}
      >
        {/* Integrated JSON Dataset Actions */}
        <div className="border-b border-slate-200/80 bg-slate-50/80 px-3.5 py-3 dark:border-slate-800/80 dark:bg-[#0E131D]/80">
          <div className="mb-2 flex h-5 items-center justify-between gap-2">
            <span className="text-xs font-semibold leading-none text-slate-900 dark:text-slate-100">
              Dataset JSON
            </span>
            <div className="flex items-center gap-1.5">
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearDataset}
                  className="inline-flex h-5 cursor-pointer items-center rounded px-1.5 text-[11px] font-medium leading-none text-slate-500 hover:bg-slate-200/70 hover:text-rose-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-rose-300 transition-colors whitespace-nowrap"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setMobileDrawer('none')}
                className="inline-flex h-5 cursor-pointer items-center rounded px-1.5 text-[11px] font-medium leading-none text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white whitespace-nowrap"
              >
                Done
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileInputChange}
            className="hidden"
          />

          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer rounded-md border border-cyan-600/50 bg-cyan-50/70 px-2.5 py-1.5 font-semibold text-cyan-800 hover:bg-cyan-100 dark:border-cyan-500/40 dark:bg-cyan-950/40 dark:text-cyan-300 dark:hover:bg-cyan-950/70 transition-colors whitespace-nowrap"
            >
              Select .json…
            </button>
            <button
              type="button"
              onClick={openJsonEditor}
              aria-pressed={jsonDrawerOpen}
              className={`cursor-pointer rounded-md border px-2.5 py-1.5 font-semibold transition-colors whitespace-nowrap ${
                jsonDrawerOpen
                  ? 'border-cyan-600/70 bg-cyan-50 text-cyan-900 dark:border-cyan-400/60 dark:bg-cyan-950/60 dark:text-cyan-200'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              Paste / Edit JSON
            </button>
            <button
              type="button"
              onClick={handleCopyJson}
              className="cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-300 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              Copy JSON
            </button>
            <button
              type="button"
              onClick={handleDownloadJson}
              className="cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-300 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              Export .json
            </button>
          </div>

          {statusBanner && (
            <div
              role="status"
              className={`mt-2.5 flex items-start justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug ${
                statusBanner.tone === 'ok'
                  ? 'border-emerald-500/40 bg-emerald-50/90 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-rose-500/40 bg-rose-50/90 text-rose-900 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-200'
              }`}
            >
              <span>{statusBanner.message}</span>
              <button
                type="button"
                onClick={() => setStatusBanner(null)}
                className="cursor-pointer font-mono text-xs opacity-70 hover:opacity-100 shrink-0"
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}
        </div>

        {/* Add / Edit Item Form */}
        <form
          onSubmit={handleAddOrUpdateItem}
          className="space-y-2.5 border-b border-slate-200/80 bg-slate-50/35 px-3.5 py-3.5 dark:border-slate-800/80 dark:bg-[#0E131D]/35"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              {editingId ? 'Edit Tagged Item' : 'Add Tagged Item'}
            </span>
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setDraftLabel('');
                  setDraftTags('');
                  setDraftDate('');
                  setDraftNote('');
                }}
                className="cursor-pointer text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white whitespace-nowrap"
              >
                Cancel edit
              </button>
            )}
          </div>

          <div>
            <input
              type="text"
              placeholder="Item label (e.g. Neural Radiance Fields)"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              className="h-8.5 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
            />
          </div>

          <div>
            <input
              type="text"
              placeholder="Tags: geometry, rendering, ml"
              value={draftTags}
              onChange={(e) => setDraftTags(e.target.value)}
              className="h-8.5 w-full rounded-md border border-slate-200 bg-white px-2.5 font-mono text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-[1fr_92px] gap-1.5">
            <input
              type="text"
              placeholder="Optional note or subtitle"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
            />
            <input
              type="text"
              placeholder="Year / date"
              aria-label="Optional year or ISO date for timeline"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
              className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 font-mono text-xs text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
            />
          </div>

          {allTagCounts.length > 0 && (
            <div className="pt-0.5">
              <p className="mb-1 text-[10.5px] text-slate-500 dark:text-slate-400">
                Quick-add existing tag:
              </p>
              <div className="flex max-h-14 flex-wrap gap-1 overflow-y-auto">
                {allTagCounts.slice(0, 14).map(([tag, count]) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => appendSuggestedTag(tag)}
                    className="cursor-pointer rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-slate-700 hover:border-cyan-500 hover:text-cyan-700 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-300 dark:hover:border-cyan-400 dark:hover:text-cyan-300 transition-colors whitespace-nowrap"
                  >
                    #{tag} ({count})
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            className="w-full cursor-pointer rounded-md bg-slate-900 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400 transition-colors whitespace-nowrap"
          >
            {editingId ? 'Save Changes' : '+ Add Item to Atlas'}
          </button>
        </form>

        {/* Corpus List & Filter */}
        <div className="flex min-h-[180px] flex-1 flex-col px-3.5 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-200">
              Items ({filteredItems.length}/{items.length}) · {allTagCounts.length} tags
            </span>
            {selectedItemId && (
              <button
                type="button"
                onClick={() => setSelectedItemId(null)}
                className="cursor-pointer text-[11px] text-cyan-700 hover:underline dark:text-cyan-300 whitespace-nowrap"
              >
                Clear highlight
              </button>
            )}
          </div>

          <input
            type="search"
            placeholder="Filter items or #tags…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="mt-2 h-8 w-full rounded-md border border-slate-200 bg-slate-50/70 px-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-cyan-600 focus:bg-white focus:outline-none dark:border-slate-800 dark:bg-[#07090E] dark:text-slate-100"
          />

          <div className="mt-2.5 min-h-0 flex-1 overflow-y-auto divide-y divide-slate-200/70 rounded-lg border border-slate-200/80 dark:divide-slate-800/80 dark:border-slate-800">
            {filteredItems.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
                {items.length === 0
                  ? 'Dataset is empty. Add your first tagged item above or drop a .json file onto the canvas.'
                  : 'No items match your filter.'}
              </p>
            ) : (
              filteredItems.map((item) => {
                const isSelected = selectedItemId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`flex items-start justify-between gap-2 p-2.5 text-xs transition-colors ${
                      isSelected
                        ? 'bg-cyan-50/80 dark:bg-cyan-950/30'
                        : 'hover:bg-slate-50 dark:hover:bg-[#0E131D]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedItemId((prev) => (prev === item.id ? null : item.id))
                      }
                      className="min-w-0 flex-1 cursor-pointer text-left"
                    >
                      <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {item.label}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10.5px] text-cyan-700 dark:text-cyan-400">
                        {item.date !== undefined ? `${item.date} · ` : ''}
                        {item.tags.map((t) => `#${t}`).join(' · ')}
                      </p>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEditItem(item)}
                        className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setItems((prev) => prev.filter((x) => x.id !== item.id));
                          if (selectedItemId === item.id) setSelectedItemId(null);
                          if (editingId === item.id) setEditingId(null);
                        }}
                        aria-label={`Remove ${item.label}`}
                        className="cursor-pointer rounded px-1.5 py-0.5 font-mono text-xs text-slate-400 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950/50 dark:hover:text-rose-300"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>

      {/* Center Pane: Full-Height Interactive Drop-Zone Simplex Canvas + 100% Paste/Edit JSON View */}
      <div
        onDragEnter={handleCanvasDragEnter}
        onDragOver={handleCanvasDragOver}
        onDragLeave={handleCanvasDragLeave}
        onDrop={handleCanvasDrop}
        className="relative h-full min-h-0 min-w-0 flex-1 bg-slate-50/70 dark:bg-[#07090E]"
      >
        {/* Mobile-only Sidebar Drawer Triggers (< lg) when JSON editor is closed */}
        {!jsonDrawerOpen && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileDrawer('left')}
              className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur-xs dark:border-slate-700/90 dark:bg-[#0B0F17]/95 dark:text-slate-100 whitespace-nowrap tabular-nums"
            >
              <span>Dataset ({items.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileDrawer('right')}
              className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur-xs dark:border-slate-700/90 dark:bg-[#0B0F17]/95 dark:text-slate-100 whitespace-nowrap"
            >
              <span>Strategies</span>
            </button>
          </div>
        )}

        {/* Full-Width & Full-Height Center Paste / Edit JSON Interface */}
        {jsonDrawerOpen && (
          <div
            role="region"
            aria-label="Paste and Edit Dataset JSON"
            className="absolute inset-0 z-40 flex h-full w-full flex-col overflow-hidden bg-white dark:bg-[#0B0F17]"
          >
            {/* Integrated Top Bar with Actions & Close Button */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-200/90 bg-slate-50/90 px-4 py-2.5 dark:border-slate-800/90 dark:bg-[#0E131D]/90">
              <div className="flex items-center gap-2.5 min-w-0">
                <label
                  htmlFor="sv-playground-json-textarea"
                  className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap"
                >
                  Paste / Edit Dataset JSON
                </label>
                <span className="hidden sm:inline text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  Envelope {'{ "version": 1, "items": [...] }'} or plain array
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setJsonText(SCHEMA_EXAMPLE);
                    setJsonEditorError(null);
                  }}
                  className="cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-300 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  Insert Template
                </button>
                <button
                  type="button"
                  onClick={handleFormatJsonText}
                  className="cursor-pointer rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-300 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  Format JSON
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (applyImportedText(jsonText, 'JSON Editor')) {
                      setJsonDrawerOpen(false);
                    }
                  }}
                  className="cursor-pointer rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400 transition-colors whitespace-nowrap"
                >
                  Apply to Canvas
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setJsonDrawerOpen(false);
                    setJsonEditorError(null);
                  }}
                  aria-label="Close JSON editor"
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white transition-colors whitespace-nowrap"
                >
                  <span aria-hidden="true" className="font-mono text-sm leading-none">
                    ×
                  </span>
                  <span>Close</span>
                </button>
              </div>
            </div>

            {jsonEditorError && (
              <div
                role="alert"
                className="flex items-center justify-between gap-2 border-b border-rose-500/35 bg-rose-50/95 px-4 py-2 text-xs text-rose-900 dark:border-rose-500/35 dark:bg-rose-950/50 dark:text-rose-200"
              >
                <span>{jsonEditorError}</span>
                <button
                  type="button"
                  onClick={() => setJsonEditorError(null)}
                  className="cursor-pointer font-mono text-xs opacity-75 hover:opacity-100 shrink-0"
                  aria-label="Dismiss JSON error"
                >
                  ×
                </button>
              </div>
            )}

            {/* 100% Remaining Height Split: Full-Height Editor + Compact Schema Reference */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden xl:flex-row">
              <div className="flex min-h-0 flex-1 flex-col">
                <textarea
                  id="sv-playground-json-textarea"
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    if (jsonEditorError) setJsonEditorError(null);
                  }}
                  spellCheck={false}
                  placeholder={SCHEMA_EXAMPLE}
                  className="h-full min-h-0 w-full flex-1 resize-none border-0 bg-slate-50/45 p-4 font-mono text-xs leading-relaxed text-slate-900 focus:bg-white focus:outline-none dark:bg-[#07090E] dark:text-slate-100 dark:focus:bg-[#07090E]"
                />
              </div>

              <div className="max-h-48 shrink-0 overflow-y-auto border-t border-slate-200/80 bg-slate-50/65 p-4 text-xs xl:max-h-none xl:w-[300px] xl:border-t-0 xl:border-l dark:border-slate-800/80 dark:bg-[#0E131D]/65">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  JSON Schema (`version: 1`)
                </p>
                <p className="mt-1.5 leading-relaxed text-slate-600 dark:text-slate-400">
                  Provide an object with <code className="font-mono">items</code> or a top-level array. Each item requires a{' '}
                  <code className="font-mono">label</code> (or <code className="font-mono">title</code>) and non-empty{' '}
                  <code className="font-mono">tags</code> (<code className="font-mono">string[]</code> or comma-separated string), plus optional{' '}
                  <code className="font-mono">date</code>/<code className="font-mono">year</code> for Timeline playback.
                </p>
                <p className="mt-2 leading-relaxed text-slate-600 dark:text-slate-400">
                  Tip: Press{' '}
                  <kbd className="rounded border border-slate-300 px-1 py-0.5 font-mono text-[10px] dark:border-slate-700">
                    Esc
                  </kbd>{' '}
                  to close this editor, or drop a <code className="font-mono">.json</code> file anywhere here.
                </p>
                <pre className="mt-3 whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white p-2.5 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-[#0B0F17] dark:text-cyan-300">
                  <code>{SCHEMA_EXAMPLE}</code>
                </pre>
              </div>
            </div>
          </div>
        )}

        {items.length > 0 ? (
          rendererMode === 'svg' ? (
            <SimplexTopicGraph<PlaygroundTaggedItem>
              controllerRef={controllerRef}
              items={items}
              getId={(it) => it.id}
              getTags={(it) => it.tags}
              getLabel={(it) => it.label}
              preset={presetMode}
              theme={theme}
              sizeMultiplier={sizeMultiplier}
              showHulls={showHulls}
              emptyClusterBehavior={emptyClusterBehavior}
              highlightedIds={highlightedSet}
              meshOptions={meshOptions}
              layoutOptions={layoutOptions}
              meshStrategy={meshStrategy}
              clusteringStrategy={clusteringStrategy}
              colorStrategy={colorStrategy}
              layoutStrategy={layoutStrategy}
              zoomStrategy={zoomStrategy}
              showZoomBreadcrumbs
              timeline={timelineConfig}
              onTimelineStateChange={setTimelineState}
              tooltip={(target) => {
                if (target.kind === 'content') {
                  const tagStr = target.item.tags.map((t) => `#${t}`).join(' ');
                  const datePrefix =
                    target.item.date !== undefined ? `[${target.item.date}] ` : '';
                  return target.item.note
                    ? `${datePrefix}${target.item.label} (${tagStr}) — ${target.item.note}`
                    : `${datePrefix}${target.item.label} (${tagStr})`;
                }
                if (target.kind === 'cluster') {
                  return `${target.cluster.code}: ${target.cluster.defaultLabel} (${target.cluster.members.length} items)`;
                }
                return `Triangle #${target.triangle.index + 1} (${target.triangle.coveredItemCount} items)`;
              }}
              onZoomStateChange={setZoomState}
            />
          ) : (
            <SimplexCanvasStage<PlaygroundTaggedItem>
              controllerRef={canvasControllerRef}
              resetKey={timelineEnabled ? 'tl' : 'static'}
              items={items}
              getId={(it) => it.id}
              getTags={(it) => it.tags}
              getLabel={(it) => it.label}
              preset={presetMode}
              theme={theme}
              showHulls={showHulls}
              emptyClusterBehavior={emptyClusterBehavior}
              highlightedIds={highlightedSet}
              meshOptions={meshOptions}
              layoutOptions={layoutOptions}
              meshStrategy={meshStrategy}
              clusteringStrategy={clusteringStrategy}
              colorStrategy={colorStrategy}
              layoutStrategy={layoutStrategy}
              zoomStrategy={zoomStrategy}
              showZoomBreadcrumbs
              timeline={
                timelineConfig
                  ? {
                      getTimestamp: timelineConfig.getTimestamp,
                      stepIntervalMs: timelineConfig.stepIntervalMs,
                      autoFinalSeed: timelineConfig.autoFinalSeed,
                      autoFinalSeedLayout:
                        timelineConfig.autoFinalSeedLayout === true
                          ? 'pinned'
                          : timelineConfig.autoFinalSeedLayout,
                      emptyClusterBehavior: timelineConfig.emptyClusterBehavior,
                    }
                  : null
              }
              onTimelineStateChange={setTimelineState}
              tooltip={{
                formatContent: (ev) => {
                  const tagStr = ev.item.tags.map((t) => `#${t}`).join(' ');
                  const datePrefix =
                    ev.item.date !== undefined ? `[${ev.item.date}] ` : '';
                  return ev.item.note
                    ? `${datePrefix}${ev.item.label} (${tagStr}) — ${ev.item.note}`
                    : `${datePrefix}${ev.item.label} (${tagStr})`;
                },
                formatCluster: (ev) =>
                  `${ev.cluster.code}: ${ev.cluster.defaultLabel} (${ev.cluster.members.length} items)`,
                formatTriangle: (ev) =>
                  `Triangle #${ev.triangle.index + 1} (${ev.triangle.coveredItemCount} items)`,
              }}
              onZoomStateChange={setZoomState}
            />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Empty Simplex Canvas
            </p>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Add tagged items using the builder on the left, drop a{' '}
              <code className="font-mono">.json</code> file from your desktop directly here, or press{' '}
              <code className="font-mono">Ctrl+V / ⌘V</code> to paste JSON from your clipboard.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-cyan-500 dark:text-slate-950 whitespace-nowrap"
              >
                Select .json File…
              </button>
              <button
                type="button"
                onClick={openJsonEditor}
                className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap transition-colors"
              >
                Paste / Edit JSON
              </button>
            </div>
          </div>
        )}

        {/* Desktop File Drag-and-Drop Overlay */}
        {isDraggingFile && (
          <div className="pointer-events-none absolute inset-3 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-cyan-500 bg-white/92 backdrop-blur-xs dark:border-cyan-400 dark:bg-[#0B0F17]/92">
            <p className="text-base font-bold text-slate-950 dark:text-white">
              Drop .json dataset onto Simplex canvas
            </p>
            <p className="mt-1 font-mono text-xs text-cyan-700 dark:text-cyan-300">
              {'{ "items": [{ "id"?, "label", "tags": string[] }] }'}
            </p>
          </div>
        )}
      </div>

      {/* Right Sidebar: Accordion-Based Pipeline Strategies & Parameterization */}
      <aside
        aria-label="Pipeline strategy and parameter settings"
        className={`${
          mobileDrawer === 'right' ? 'flex' : 'hidden lg:flex'
        } max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:w-[min(92vw,320px)] max-lg:shadow-2xl lg:w-[295px] xl:w-[320px] shrink-0 flex-col border-l border-slate-200/90 bg-white overflow-y-auto dark:border-slate-800/90 dark:bg-[#0B0F17]`}
      >
        {/* Sidebar Header */}
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/80 px-3.5 dark:border-slate-800/80 dark:bg-[#0E131D]/80">
          <span className="text-xs font-semibold leading-none text-slate-900 dark:text-slate-100 whitespace-nowrap">
            Pipeline Strategies
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!hasNonDefaultPipeline}
              onClick={resetAllPipelineDefaults}
              className={`inline-flex h-6 items-center rounded px-1.5 text-[11px] font-medium leading-none transition-colors whitespace-nowrap ${
                hasNonDefaultPipeline
                  ? 'cursor-pointer text-cyan-700 hover:bg-cyan-100/70 dark:text-cyan-300 dark:hover:bg-cyan-950/60'
                  : 'invisible pointer-events-none'
              }`}
            >
              Reset defaults
            </button>
            <button
              type="button"
              onClick={() => setMobileDrawer('none')}
              className="inline-flex h-6 cursor-pointer items-center rounded px-1.5 text-[11px] font-medium leading-none text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white whitespace-nowrap"
            >
              Done
            </button>
          </div>
        </div>

        {zoomState && zoomState.canDrillUp && (
          <div className="border-b border-slate-200/80 bg-cyan-50/45 px-3.5 py-2 dark:border-slate-800/80 dark:bg-cyan-950/25">
            <button
              type="button"
              onClick={() => handle.drillToRoot()}
              className="w-full cursor-pointer rounded-md border border-cyan-500/50 bg-white px-2.5 py-1.5 text-xs font-semibold text-cyan-800 hover:bg-cyan-50 dark:border-cyan-500/40 dark:bg-[#0B0F17] dark:text-cyan-300 dark:hover:bg-cyan-950/50 transition-colors whitespace-nowrap"
            >
              Reset Zoom (Overview)
            </button>
          </div>
        )}

        <div className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
          {/* 01 · Mesh Generation */}
          <div>
            <button
              type="button"
              aria-expanded={openSection === 'mesh'}
              onClick={() => toggleSection('mesh')}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-slate-50/80 dark:hover:bg-[#0E131D]/70 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                01. Mesh
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[11px] tabular-nums text-cyan-700 dark:text-cyan-300">
                  {meshHeaderSummary}
                </span>
                <AccordionChevron open={openSection === 'mesh'} />
              </span>
            </button>

            {openSection === 'mesh' && (
              <div className="space-y-3 border-t border-slate-100 bg-slate-50/35 px-3.5 py-3 text-xs dark:border-slate-800/60 dark:bg-[#0E131D]/35">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Strategy
                  </span>
                  <select
                    value={meshId}
                    onChange={(e) => {
                      handle.drillToRoot();
                      setMeshId(e.target.value as CanonicalMeshStrategyId);
                    }}
                    className="h-8.5 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
                  >
                    <option value="adaptive-hex-mesh">Adaptive Hex</option>
                    <option value="fixed-grid-mesh">
                      Fixed Grid ({fixedCols}×{fixedRows})
                    </option>
                  </select>
                </label>

                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {STRATEGY_REGISTRY[meshId].summary}
                </p>

                <div className="space-y-2.5 border-t border-slate-200/70 pt-2.5 dark:border-slate-800/70">
                  {meshId === 'adaptive-hex-mesh' ? (
                    <>
                      <label className="flex flex-col gap-1">
                        <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Max clusters (K)</span>
                          <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {adaptiveMaxClusters}
                          </span>
                        </span>
                        <input
                          type="range"
                          min={3}
                          max={16}
                          step={1}
                          value={adaptiveMaxClusters}
                          onChange={(e) => {
                            handle.drillToRoot();
                            setAdaptiveMaxClusters(Number(e.target.value));
                          }}
                          className="w-full accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Min triangle side</span>
                          <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {adaptiveMinSide} px
                          </span>
                        </span>
                        <input
                          type="range"
                          min={80}
                          max={220}
                          step={10}
                          value={adaptiveMinSide}
                          onChange={(e) => setAdaptiveMinSide(Number(e.target.value))}
                          className="w-full accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                            <span>Columns</span>
                            <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                              {fixedCols}
                            </span>
                          </span>
                          <input
                            type="range"
                            min={2}
                            max={6}
                            step={1}
                            value={fixedCols}
                            onChange={(e) => {
                              handle.drillToRoot();
                              setFixedCols(Number(e.target.value));
                            }}
                            className="w-full accent-cyan-600 dark:accent-cyan-400"
                          />
                        </label>

                        <label className="flex flex-col gap-1">
                          <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                            <span>Rows</span>
                            <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                              {fixedRows}
                            </span>
                          </span>
                          <input
                            type="range"
                            min={2}
                            max={6}
                            step={1}
                            value={fixedRows}
                            onChange={(e) => {
                              handle.drillToRoot();
                              setFixedRows(Number(e.target.value));
                            }}
                            className="w-full accent-cyan-600 dark:accent-cyan-400"
                          />
                        </label>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-300">
                          Lattice orientation
                        </span>
                        <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-[#07090E]">
                          {(['auto', 'horizontal', 'vertical'] as const).map((orient) => (
                            <button
                              key={orient}
                              type="button"
                              onClick={() => setFixedOrientation(orient)}
                              className={`cursor-pointer rounded py-1 text-[11px] font-medium capitalize transition-colors whitespace-nowrap ${
                                fixedOrientation === orient
                                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                              }`}
                            >
                              {orient}
                            </button>
                          ))}
                        </div>
                      </div>

                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                        <span>Wide first lattice row</span>
                        <input
                          type="checkbox"
                          checked={fixedWideFirst}
                          onChange={(e) => setFixedWideFirst(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>
                    </>
                  )}

                  <label className="flex flex-col gap-1">
                    <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                      <span>Inner mesh padding</span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {meshInnerPadding} px
                      </span>
                    </span>
                    <input
                      type="range"
                      min={24}
                      max={96}
                      step={4}
                      value={meshInnerPadding}
                      onChange={(e) => setMeshInnerPadding(Number(e.target.value))}
                      className="w-full accent-cyan-600 dark:accent-cyan-400"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* 02 · Clustering */}
          <div>
            <button
              type="button"
              aria-expanded={openSection === 'clustering'}
              onClick={() => toggleSection('clustering')}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-slate-50/80 dark:hover:bg-[#0E131D]/70 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                02. Clustering
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[11px] text-cyan-700 dark:text-cyan-300">
                  {clusteringHeaderSummary}
                </span>
                <AccordionChevron open={openSection === 'clustering'} />
              </span>
            </button>

            {openSection === 'clustering' && (
              <div className="space-y-3 border-t border-slate-100 bg-slate-50/35 px-3.5 py-3 text-xs dark:border-slate-800/60 dark:bg-[#0E131D]/35">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Strategy
                  </span>
                  <select
                    value={clusteringId}
                    onChange={(e) => {
                      handle.drillToRoot();
                      setClusteringId(e.target.value as CanonicalClusteringStrategyId);
                    }}
                    className="h-8.5 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
                  >
                    <option value="soft-simplex-tags">Soft-Simplex Tags</option>
                    <option value="jaccard-qap-tags">Jaccard QAP</option>
                    <option value="incremental-anchor-tags">Incremental Anchor</option>
                  </select>
                </label>

                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {STRATEGY_REGISTRY[clusteringId].summary}
                </p>

                <div className="space-y-2.5 border-t border-slate-200/70 pt-2.5 dark:border-slate-800/70">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-600 dark:text-slate-300">
                      Item anchor rule
                    </span>
                    <select
                      value={anchorRule}
                      onChange={(e) =>
                        setAnchorRule(e.target.value as SimplexAnchorRuleKind)
                      }
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
                    >
                      <option value="explaining-away">
                        Explaining-Away (Minimal Simplex)
                      </option>
                      <option value="raw-overlap">Raw Tag Overlap</option>
                      <option value="barycentric-all">Barycentric All Clusters</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-600 dark:text-slate-300">
                      Shared tag expansion
                    </span>
                    <select
                      value={sharedTagRule}
                      onChange={(e) =>
                        setSharedTagRule(e.target.value as SharedTagRuleKind)
                      }
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
                    >
                      <option value="planar-hitting-set">
                        Planar Hitting-Set (100% Coverage)
                      </option>
                      <option value="none">None (Disjoint Core Only)</option>
                    </select>
                  </label>

                  {clusteringId === 'soft-simplex-tags' && (
                    <>
                      <label className="flex flex-col gap-1">
                        <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Triangle spread</span>
                          <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {softTriangleSpread.toFixed(2)}
                          </span>
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={0.65}
                          step={0.05}
                          value={softTriangleSpread}
                          onChange={(e) => setSoftTriangleSpread(Number(e.target.value))}
                          className="w-full accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                        <span>Load-balance interior vertices</span>
                        <input
                          type="checkbox"
                          checked={softBalanceLoad}
                          onChange={(e) => setSoftBalanceLoad(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 03 · Color Assignment */}
          <div>
            <button
              type="button"
              aria-expanded={openSection === 'color'}
              onClick={() => toggleSection('color')}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-slate-50/80 dark:hover:bg-[#0E131D]/70 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                03. Color
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[11px] text-cyan-700 dark:text-cyan-300">
                  {colorHeaderSummary}
                </span>
                <AccordionChevron open={openSection === 'color'} />
              </span>
            </button>

            {openSection === 'color' && (
              <div className="space-y-3 border-t border-slate-100 bg-slate-50/35 px-3.5 py-3 text-xs dark:border-slate-800/60 dark:bg-[#0E131D]/35">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Strategy
                  </span>
                  <select
                    value={colorId}
                    onChange={(e) => setColorId(e.target.value as CanonicalColorStrategyId)}
                    className="h-8.5 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
                  >
                    <option value="theme-adaptive-oklab">Theme OKLab</option>
                    <option value="oklab-edge-contrast">Edge Contrast</option>
                    <option value="custom-brand-palette">Custom Palette</option>
                  </select>
                </label>

                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {STRATEGY_REGISTRY[colorId].summary}
                </p>

                {colorId === 'custom-brand-palette' ? (
                  <div className="space-y-2.5 border-t border-slate-200/70 pt-2.5 dark:border-slate-800/70">
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-300">
                        Assignment mode
                      </span>
                      <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-[#07090E]">
                        {(
                          [
                            { id: 'edge-contrast', label: 'Edge Contrast' },
                            { id: 'sequential', label: 'Sequential' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setPaletteMode(opt.id)}
                            className={`cursor-pointer rounded py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                              paletteMode === opt.id
                                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-600 dark:text-slate-300">
                          Palette swatches
                        </span>
                        <div className="flex items-center gap-1">
                          {PALETTE_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => setPaletteColors(preset.colors)}
                              className="cursor-pointer rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:border-cyan-500 hover:text-cyan-700 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-300 dark:hover:border-cyan-400 whitespace-nowrap"
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-6 gap-1.5">
                        {paletteColors.map((hex, idx) => (
                          <label
                            key={idx}
                            title={`Cluster swatch ${idx + 1}: ${hex}`}
                            className="flex flex-col items-center gap-0.5"
                          >
                            <input
                              type="color"
                              value={hex}
                              onChange={(e) => {
                                const next = [...paletteColors];
                                next[idx] = e.target.value;
                                setPaletteColors(next);
                              }}
                              aria-label={`Palette color ${idx + 1}`}
                              className="h-7 w-full cursor-pointer rounded border border-slate-200 bg-transparent p-0.5 dark:border-slate-700"
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                    {paletteMode === 'edge-contrast' && (
                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                        <span>Preserve matched colors</span>
                        <input
                          type="checkbox"
                          checked={palettePreserveMatched}
                          onChange={(e) => setPalettePreserveMatched(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>
                    )}
                  </div>
                ) : (
                  <div className="border-t border-slate-200/70 pt-2 text-[11px] text-slate-500 dark:border-slate-800/70 dark:text-slate-400">
                    {colorId === 'theme-adaptive-oklab'
                      ? `Adapts OKLab lightness & chroma automatically to the active ${theme} theme.`
                      : 'Synthesizes high-chroma OKLab colors maximizing ΔE across adjacent mesh edges.'}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 04 · Node Layout */}
          <div>
            <button
              type="button"
              aria-expanded={openSection === 'layout'}
              onClick={() => toggleSection('layout')}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-slate-50/80 dark:hover:bg-[#0E131D]/70 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                04. Layout
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[11px] text-cyan-700 dark:text-cyan-300">
                  {layoutHeaderSummary}
                </span>
                <AccordionChevron open={openSection === 'layout'} />
              </span>
            </button>

            {openSection === 'layout' && (
              <div className="space-y-3 border-t border-slate-100 bg-slate-50/35 px-3.5 py-3 text-xs dark:border-slate-800/60 dark:bg-[#0E131D]/35">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Strategy
                  </span>
                  <select
                    value={layoutId}
                    onChange={(e) => setLayoutId(e.target.value as PlaygroundLayoutId)}
                    className="h-8.5 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
                  >
                    <option value="collision-local-layout">Collision-Local</option>
                    <option value="pbd-uniform-layout">Uniform PBD</option>
                    <option value="warm-start-pbd-layout">Warm-Start PBD</option>
                    <option value="density-adaptive-layout">Density-Adaptive</option>
                    <option value="final-seeded-layout">Final-Seeded (Frozen)</option>
                  </select>
                </label>

                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {layoutId === 'final-seeded-layout'
                    ? 'Seeds every item at its canonical full-corpus coordinates (0 px drift across timeline steps). Choose pinned final scale or adaptive sparse-frame scaling.'
                    : STRATEGY_REGISTRY[layoutId].summary}
                </p>

                <div className="space-y-2.5 border-t border-slate-200/70 pt-2.5 dark:border-slate-800/70">
                  {layoutId === 'final-seeded-layout' && (
                    <>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-300">
                          Scale mode
                        </span>
                        <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-[#07090E]">
                          {(
                            [
                              { id: 'pinned', label: 'Pinned' },
                              { id: 'adaptive', label: 'Adaptive' },
                            ] as const
                          ).map((mode) => (
                            <button
                              key={mode.id}
                              type="button"
                              onClick={() => setFinalSeededScaleMode(mode.id)}
                              className={`cursor-pointer rounded py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                                finalSeededScaleMode === mode.id
                                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                              }`}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-300">
                          Canonical base solver
                        </span>
                        <select
                          value={finalSeededBaseLayoutId}
                          onChange={(e) =>
                            setFinalSeededBaseLayoutId(
                              e.target.value as CanonicalLayoutStrategyId,
                            )
                          }
                          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
                        >
                          <option value="collision-local-layout">Collision-Local</option>
                          <option value="density-adaptive-layout">Density-Adaptive</option>
                          <option value="warm-start-pbd-layout">Warm-Start PBD</option>
                          <option value="pbd-uniform-layout">Uniform PBD</option>
                        </select>
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-300">
                          Unseen item policy
                        </span>
                        <select
                          value={finalSeededUnseenPolicy}
                          onChange={(e) =>
                            setFinalSeededUnseenPolicy(
                              e.target.value as 'fallback' | 'reseed',
                            )
                          }
                          className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
                        >
                          <option value="fallback">Fallback to base solver</option>
                          <option value="reseed">Re-seed with new items</option>
                        </select>
                      </label>
                    </>
                  )}
                  {layoutId === 'collision-local-layout' && (
                    <>
                      <label className="flex flex-col gap-1">
                        <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Min local scale</span>
                          <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {collisionMinLocalScale.toFixed(2)}×
                          </span>
                        </span>
                        <input
                          type="range"
                          min={0.15}
                          max={0.8}
                          step={0.05}
                          value={collisionMinLocalScale}
                          onChange={(e) =>
                            setCollisionMinLocalScale(Number(e.target.value))
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Collision shrink step</span>
                          <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {collisionShrinkFactor.toFixed(2)}
                          </span>
                        </span>
                        <input
                          type="range"
                          min={0.7}
                          max={0.95}
                          step={0.01}
                          value={collisionShrinkFactor}
                          onChange={(e) =>
                            setCollisionShrinkFactor(Number(e.target.value))
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                        <span>Warm-start item positions</span>
                        <input
                          type="checkbox"
                          checked={collisionWarmStart}
                          onChange={(e) => setCollisionWarmStart(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>
                    </>
                  )}

                  {layoutId === 'density-adaptive-layout' && (
                    <>
                      <label className="flex flex-col gap-1">
                        <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Crowd radius</span>
                          <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {densityCrowdRadiusPx} px
                          </span>
                        </span>
                        <input
                          type="range"
                          min={40}
                          max={180}
                          step={8}
                          value={densityCrowdRadiusPx}
                          onChange={(e) =>
                            setDensityCrowdRadiusPx(Number(e.target.value))
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Min local scale</span>
                          <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {densityMinLocalScale.toFixed(2)}×
                          </span>
                        </span>
                        <input
                          type="range"
                          min={0.15}
                          max={0.8}
                          step={0.05}
                          value={densityMinLocalScale}
                          onChange={(e) =>
                            setDensityMinLocalScale(Number(e.target.value))
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                        <span>Warm-start item positions</span>
                        <input
                          type="checkbox"
                          checked={densityWarmStart}
                          onChange={(e) => setDensityWarmStart(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>
                    </>
                  )}

                  {(layoutId === 'pbd-uniform-layout' ||
                    layoutId === 'warm-start-pbd-layout') && (
                    <label className="flex flex-col gap-1">
                      <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                        <span>Min uniform scale</span>
                        <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {minContentScale.toFixed(2)}×
                        </span>
                      </span>
                      <input
                        type="range"
                        min={0.1}
                        max={0.6}
                        step={0.05}
                        value={minContentScale}
                        onChange={(e) => setMinContentScale(Number(e.target.value))}
                        className="w-full accent-cyan-600 dark:accent-cyan-400"
                      />
                    </label>
                  )}

                  <label className="flex flex-col gap-1">
                    <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                      <span>Item hull gap</span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {itemGapPx} px
                      </span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={16}
                      step={1}
                      value={itemGapPx}
                      onChange={(e) => setItemGapPx(Number(e.target.value))}
                      className="w-full accent-cyan-600 dark:accent-cyan-400"
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                      <span>Cluster hull gap</span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {clusterGapPx} px
                      </span>
                    </span>
                    <input
                      type="range"
                      min={4}
                      max={32}
                      step={2}
                      value={clusterGapPx}
                      onChange={(e) => setClusterGapPx(Number(e.target.value))}
                      className="w-full accent-cyan-600 dark:accent-cyan-400"
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                      <span>PBD relaxation steps</span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {relaxationIterations}
                      </span>
                    </span>
                    <input
                      type="range"
                      min={16}
                      max={80}
                      step={4}
                      value={relaxationIterations}
                      onChange={(e) =>
                        setRelaxationIterations(Number(e.target.value))
                      }
                      className="w-full accent-cyan-600 dark:accent-cyan-400"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* 05 · Zoom & Subdivision */}
          <div>
            <button
              type="button"
              aria-expanded={openSection === 'zoom'}
              onClick={() => toggleSection('zoom')}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-slate-50/80 dark:hover:bg-[#0E131D]/70 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                05. Zoom
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[11px] text-cyan-700 dark:text-cyan-300">
                  {zoomHeaderSummary}
                </span>
                <AccordionChevron open={openSection === 'zoom'} />
              </span>
            </button>

            {openSection === 'zoom' && (
              <div className="space-y-3 border-t border-slate-100 bg-slate-50/35 px-3.5 py-3 text-xs dark:border-slate-800/60 dark:bg-[#0E131D]/35">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Strategy
                  </span>
                  <select
                    value={zoomId}
                    onChange={(e) => {
                      handle.drillToRoot();
                      setZoomId(e.target.value as CanonicalZoomStrategyId);
                    }}
                    className="h-8.5 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
                  >
                    <option value="semantic-tag-split-zoom">Semantic 3→6</option>
                    <option value="subspace-recluster-zoom">Subspace Re-Cluster</option>
                    <option value="barycentric-subdivision-zoom">Barycentric 1:4</option>
                    <option value="free-camera-zoom">Free Camera</option>
                  </select>
                </label>

                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {STRATEGY_REGISTRY[zoomId].summary}
                </p>

                {zoomId === 'free-camera-zoom' ? (
                  <div className="border-t border-slate-200/70 pt-2 text-[11px] text-slate-500 dark:border-slate-800/70 dark:text-slate-400">
                    Continuous wheel zoom-to-cursor, pinch zoom, and pointer drag-to-pan without discrete subdivision frames.
                  </div>
                ) : (
                  <div className="space-y-2.5 border-t border-slate-200/70 pt-2.5 dark:border-slate-800/70">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-slate-600 dark:text-slate-300">
                        Cluster drill-down mode
                      </span>
                      <select
                        value={clusterZoomMode}
                        onChange={(e) => {
                          handle.drillToRoot();
                          setClusterZoomMode(
                            e.target.value as BarycentricClusterZoomMode,
                          );
                        }}
                        className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
                      >
                        <option value="incident-star">1-Ring Incident Star</option>
                        <option value="spotlight">3-Sector Spotlight</option>
                        <option value="none">Disabled (Triangles Only)</option>
                      </select>
                    </label>

                    {zoomId === 'semantic-tag-split-zoom' && (
                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                        <span>1:4 Barycentric fallback</span>
                        <input
                          type="checkbox"
                          checked={semanticBarycentricFallback}
                          onChange={(e) =>
                            setSemanticBarycentricFallback(e.target.checked)
                          }
                          className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>
                    )}

                    {zoomId === 'barycentric-subdivision-zoom' && (
                      <>
                        <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                          <span>Adaptive contrast stretch</span>
                          <input
                            type="checkbox"
                            checked={barycentricContrastStretch}
                            onChange={(e) =>
                              setBarycentricContrastStretch(e.target.checked)
                            }
                            className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                          />
                        </label>

                        <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                          <span>Leaf 3-sector fallback</span>
                          <input
                            type="checkbox"
                            checked={barycentricSectorFallback}
                            onChange={(e) =>
                              setBarycentricSectorFallback(e.target.checked)
                            }
                            className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                          />
                        </label>
                      </>
                    )}

                    <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                      <span>Stop drill at full scale</span>
                      <input
                        type="checkbox"
                        checked={zoomStopWhenFullScale}
                        onChange={(e) => setZoomStopWhenFullScale(e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                      />
                    </label>

                    {zoomStopWhenFullScale && (
                      <label className="flex flex-col gap-1">
                        <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Full-scale threshold</span>
                          <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {Math.round(zoomFullScaleThreshold * 100)}%
                          </span>
                        </span>
                        <input
                          type="range"
                          min={0.5}
                          max={1}
                          step={0.01}
                          value={zoomFullScaleThreshold}
                          onChange={(e) =>
                            setZoomFullScaleThreshold(Number(e.target.value))
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 06 · Visual Preset & Geometry */}
          <div>
            <button
              type="button"
              aria-expanded={openSection === 'visual'}
              onClick={() => toggleSection('visual')}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-slate-50/80 dark:hover:bg-[#0E131D]/70 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                06. Visuals
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[11px] text-cyan-700 dark:text-cyan-300">
                  {visualHeaderSummary}
                </span>
                <AccordionChevron open={openSection === 'visual'} />
              </span>
            </button>

            {openSection === 'visual' && (
              <div className="space-y-3 border-t border-slate-100 bg-slate-50/35 px-3.5 py-3 text-xs dark:border-slate-800/60 dark:bg-[#0E131D]/35">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Renderer backend
                  </span>
                  <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-[#07090E]">
                    {(
                      [
                        { id: 'svg', label: 'SVG (@simplex-viz/svg)' },
                        { id: 'canvas', label: 'Canvas 2D (@simplex-viz/canvas)' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setRendererMode(opt.id)}
                        className={`cursor-pointer rounded px-2 py-1 text-[11px] transition-colors truncate ${
                          rendererMode === opt.id
                            ? 'bg-white font-semibold text-slate-950 shadow-xs dark:bg-[#0B0F17] dark:text-cyan-300'
                            : 'font-medium text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100'
                        }`}
                      >
                        {opt.id === 'svg' ? 'SVG' : 'Canvas 2D'}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    Node visual preset
                  </span>
                  <select
                    value={presetMode}
                    onChange={(e) =>
                      setPresetMode(e.target.value as SimplexVisualPreset)
                    }
                    className="h-8.5 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-cyan-600 focus:outline-none dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-100"
                  >
                    <option value="geometric">Geometric</option>
                    <option value="glyphs">Donut Glyphs</option>
                    <option value="badges">Label Badges</option>
                  </select>
                </label>

                <div className="space-y-2.5 border-t border-slate-200/70 pt-2.5 dark:border-slate-800/70">
                  <label className="flex flex-col gap-1">
                    <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                      <span>Node size multiplier</span>
                      <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {sizeMultiplier.toFixed(2)}×
                      </span>
                    </span>
                    <input
                      type="range"
                      min={0.6}
                      max={1.6}
                      step={0.05}
                      value={sizeMultiplier}
                      onChange={(e) => setSizeMultiplier(Number(e.target.value))}
                      className="w-full accent-cyan-600 dark:accent-cyan-400"
                    />
                  </label>

                  <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                    <span>Show convex collision hulls</span>
                    <input
                      type="checkbox"
                      checked={showHulls}
                      onChange={(e) => setShowHulls(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                    />
                  </label>

                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-600 dark:text-slate-300">
                      Empty clusters
                    </span>
                    <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-[#07090E]">
                      {(
                        [
                          { id: 'normal', label: 'Normal' },
                          { id: 'dim', label: 'Dim' },
                          { id: 'hide', label: 'Hide' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setEmptyClusterBehavior(opt.id)}
                          className={`cursor-pointer rounded py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                            emptyClusterBehavior === opt.id
                              ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 07 · Chronological Timeline Playback */}
          <div>
            <button
              type="button"
              aria-expanded={openSection === 'timeline'}
              onClick={() => toggleSection('timeline')}
              className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-slate-50/80 dark:hover:bg-[#0E131D]/70 transition-colors"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                07. Timeline
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[11px] text-cyan-700 dark:text-cyan-300">
                  {timelineHeaderSummary}
                </span>
                <AccordionChevron open={openSection === 'timeline'} />
              </span>
            </button>

            {openSection === 'timeline' && (
              <div className="space-y-3 border-t border-slate-100 bg-slate-50/35 px-3.5 py-3 text-xs dark:border-slate-800/60 dark:bg-[#0E131D]/35">
                <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] font-medium text-slate-800 dark:text-slate-200">
                  <span>Enable chronological timeline</span>
                  <input
                    type="checkbox"
                    checked={timelineEnabled}
                    onChange={(e) => setTimelineEnabled(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                  />
                </label>

                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  Groups items by their optional <code className="font-mono">date</code> /{' '}
                  <code className="font-mono">year</code> field (or steps 1 item per frame when undated).
                </p>

                {timelineEnabled && (
                  <>
                    {timelineState && (
                      <div className="space-y-2 rounded-lg border border-slate-200/80 bg-white p-2.5 dark:border-slate-800 dark:bg-[#07090E]">
                        <div className="flex items-center justify-between gap-2 font-mono text-[11px] tabular-nums">
                          <span className="truncate font-semibold text-slate-900 dark:text-slate-100">
                            {timelineState.activeLabel}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400 shrink-0">
                            {timelineState.activeItemCount}/{timelineState.totalItemCount} items
                          </span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const tl = handle.getTimeline();
                              tl?.pause();
                              tl?.stepBy(-1);
                            }}
                            disabled={timelineState.atStart}
                            className="cursor-pointer rounded border border-slate-200 bg-slate-50 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            Prev
                          </button>
                          <button
                            type="button"
                            onClick={() => handle.getTimeline()?.toggle()}
                            className="col-span-2 cursor-pointer rounded bg-slate-900 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-cyan-500 dark:text-slate-950 dark:hover:bg-cyan-400"
                          >
                            {timelineState.playing ? 'Pause' : 'Play'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const tl = handle.getTimeline();
                              tl?.pause();
                              tl?.stepBy(1);
                            }}
                            disabled={timelineState.atEnd}
                            className="cursor-pointer rounded border border-slate-200 bg-slate-50 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2.5 border-t border-slate-200/70 pt-2.5 dark:border-slate-800/70">
                      <label className="flex flex-col gap-1">
                        <span className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                          <span>Step interval</span>
                          <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                            {timelineStepIntervalMs} ms
                          </span>
                        </span>
                        <input
                          type="range"
                          min={200}
                          max={2000}
                          step={50}
                          value={timelineStepIntervalMs}
                          onChange={(e) =>
                            setTimelineStepIntervalMs(Number(e.target.value))
                          }
                          className="w-full accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>

                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-300">
                          Playback speed
                        </span>
                        <div className="grid grid-cols-4 gap-1">
                          {[0.5, 1, 2, 4].map((spd) => (
                            <button
                              key={spd}
                              type="button"
                              onClick={() => setTimelineSpeed(spd)}
                              className={`cursor-pointer rounded border py-1 font-mono text-[11px] tabular-nums transition-colors ${
                                timelineSpeed === spd
                                  ? 'border-cyan-600 bg-cyan-50 font-semibold text-cyan-800 dark:border-cyan-400 dark:bg-cyan-950/60 dark:text-cyan-200'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#07090E] dark:text-slate-300 dark:hover:bg-slate-800'
                              }`}
                            >
                              {spd}×
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-300">
                          Playback layout stability
                        </span>
                        <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-[#07090E]">
                          {(
                            [
                              { id: 'dynamic', value: false as const, label: 'Dynamic' },
                              { id: 'pinned', value: 'pinned' as const, label: 'Pinned' },
                              { id: 'adaptive', value: 'adaptive' as const, label: 'Adaptive' },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setTimelineAutoFinalSeedLayout(opt.value)}
                              className={`cursor-pointer rounded py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                                timelineAutoFinalSeedLayout === opt.value
                                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <span className="text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                          {layoutId === 'final-seeded-layout'
                            ? 'Using explicit Final-Seeded strategy from 04. Layout.'
                            : timelineAutoFinalSeedLayout === 'pinned'
                              ? 'Pins final positions & scale (0 px drift, no resize).'
                              : timelineAutoFinalSeedLayout === 'adaptive'
                                ? 'Pins final positions, scales larger while sparse.'
                                : 'Re-solves positions & scales with the active 04. Layout strategy.'}
                        </span>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-600 dark:text-slate-300">
                          Empty / future clusters
                        </span>
                        <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-[#07090E]">
                          {(
                            [
                              { id: 'normal', label: 'Normal' },
                              { id: 'dim', label: 'Dim' },
                              { id: 'hide', label: 'Hide' },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setEmptyClusterBehavior(opt.id)}
                              className={`cursor-pointer rounded py-1 text-[11px] font-medium transition-colors whitespace-nowrap ${
                                emptyClusterBehavior === opt.id
                                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                        <span>Pin clusters (auto final-seed)</span>
                        <input
                          type="checkbox"
                          checked={timelineAutoFinalSeed}
                          onChange={(e) => setTimelineAutoFinalSeed(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                        <span>Show canvas player HUD</span>
                        <input
                          type="checkbox"
                          checked={timelineShowControls}
                          onChange={(e) => setTimelineShowControls(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>

                      {timelineShowControls && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[11px] text-slate-600 dark:text-slate-300">
                            Canvas HUD position
                          </span>
                          <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-[#07090E]">
                            {(['bottom', 'top'] as const).map((pos) => (
                              <button
                                key={pos}
                                type="button"
                                onClick={() => setTimelinePosition(pos)}
                                className={`cursor-pointer rounded py-1 text-[11px] font-medium capitalize transition-colors whitespace-nowrap ${
                                  timelinePosition === pos
                                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                                }`}
                              >
                                {pos}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                        <span>Loop playback</span>
                        <input
                          type="checkbox"
                          checked={timelineLoop}
                          onChange={(e) => setTimelineLoop(e.target.checked)}
                          className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>

                      <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                        <span>Include empty start frame</span>
                        <input
                          type="checkbox"
                          checked={timelineIncludeEmptyStart}
                          onChange={(e) =>
                            setTimelineIncludeEmptyStart(e.target.checked)
                          }
                          className="h-3.5 w-3.5 rounded accent-cyan-600 dark:accent-cyan-400"
                        />
                      </label>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
