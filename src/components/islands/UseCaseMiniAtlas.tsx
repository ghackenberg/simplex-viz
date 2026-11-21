import type { SimplexCanvasController } from '@simplex-viz/canvas';
import type { SimplexTimelineState, SimplexZoomState } from '@simplex-viz/core';
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
  type TimelinePlayerOptions,
} from '@simplex-viz/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommonsThumbManifest } from '../../demo/commonsThumbs';
import { resolveDemoTagMeta, type TagTaxonomyInfo } from '../../demo/data/knowledgeCatalog';
import {
  buildDemoCatalog,
  computeMediaPairwiseSimilarity,
  computeZooTraitSimilarity,
  deriveDemoEntityClusterMeta,
  type DemoClusterSummary,
  type DemoDatasetId,
  type DemoEntity,
} from '../../demo/data/multimodalCatalog';
import {
  DEFAULT_DEMO_RENDER_CONFIG,
  createDemoEdgeView,
  createDemoTriangleView,
  createDemoVisualResolver,
  demoBadgeClusterView,
  demoDomainContentView,
  demoGeometricContentView,
  demoMultiSectorContentView,
  renderDemoClusterCard,
  renderDemoContentCard,
  type ContentRendererKind,
  type DemoClusterVisual,
  type DemoContentVisual,
} from '../../demo/presets';
import {
  demoCanvasClusterRenderer,
  demoCanvasContentRenderer,
  subscribeCanvasImageLoads,
} from '../../demo/canvasPresets';
import { createDemoZoomStrategy } from '../../demo/zoomPresets';
import type {
  CanonicalClusteringStrategyId,
  CanonicalColorStrategyId,
  CanonicalLayoutStrategyId,
  CanonicalMeshStrategyId,
  CanonicalZoomStrategyId,
} from '../../site/strategies';
import { AtlasBottomBar, AtlasTimelineBar } from './AtlasWorkbenchChrome';
import {
  DatasetProvenanceModal,
  resolveDatasetProvenanceMeta,
} from './DatasetProvenanceModal';
import {
  DemoNodeInspectorOverlay,
  useDemoNodeInspector,
} from './DemoNodeInspectorOverlay';
import {
  SimplexCanvasStage,
  type ShowcaseRendererKind,
} from './SimplexCanvasStage';
import { useCssFullscreen } from './useCssFullscreen';
import { useDocumentDarkTheme } from './useDocumentDarkTheme';

export interface UseCaseMiniAtlasProps {
  readonly datasetId: DemoDatasetId;
  readonly meshStrategy: CanonicalMeshStrategyId;
  readonly clusteringStrategy: CanonicalClusteringStrategyId;
  readonly colorStrategy: CanonicalColorStrategyId;
  readonly layoutStrategy: CanonicalLayoutStrategyId;
  readonly zoomStrategy: CanonicalZoomStrategyId;
  readonly nodeView: ContentRendererKind;
  readonly thumbManifest?: CommonsThumbManifest;
  readonly timelineEnabled?: boolean;
  readonly embedded?: boolean;
}

const BRAND_PALETTE_HEX = [
  '#0891b2',
  '#d97706',
  '#c026d3',
  '#059669',
  '#2563eb',
  '#e11d48',
] as const;

const MEDIA_RECEPTION_WEIGHT = 0.65;
const MEDIA_PRODUCTION_WEIGHT = 0.35;

function cosineSim(u: readonly number[], v: readonly number[]): number {
  let dot = 0;
  let nu = 0;
  let nv = 0;
  for (let i = 0; i < u.length; i++) {
    const ui = u[i] ?? 0;
    const vi = v[i] ?? 0;
    dot += ui * vi;
    nu += ui * ui;
    nv += vi * vi;
  }
  if (nu <= 1e-9 || nv <= 1e-9) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(nu) * Math.sqrt(nv))));
}

export function UseCaseMiniAtlas({
  datasetId,
  meshStrategy: meshId,
  clusteringStrategy: clusteringId,
  colorStrategy: colorId,
  layoutStrategy: layoutId,
  zoomStrategy: zoomId,
  nodeView,
  thumbManifest,
  timelineEnabled = false,
  embedded = false,
}: UseCaseMiniAtlasProps) {
  const theme = useDocumentDarkTheme();
  const isTagged = datasetId === 'knowledge' || datasetId === 'github-repos';
  const effectiveNodeView: ContentRendererKind = nodeView;

  const [renderer, setRenderer] = useState<ShowcaseRendererKind>('svg');
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);
  const [zoomState, setZoomState] = useState<SimplexZoomState | null>(null);
  const [timelineState, setTimelineState] =
    useState<SimplexTimelineState<DemoEntity> | null>(null);

  const { controllerRef } = useSimplexGraphController<
    DemoEntity,
    DemoContentVisual,
    DemoClusterVisual,
    TagTaxonomyInfo,
    DemoClusterSummary
  >();
  const canvasControllerRef = useRef<SimplexCanvasController<
    DemoEntity,
    DemoContentVisual,
    DemoClusterVisual,
    TagTaxonomyInfo,
    DemoClusterSummary
  > | null>(null);

  const items = useMemo(() => buildDemoCatalog(datasetId), [datasetId]);
  const provenanceMeta = useMemo(
    () => resolveDatasetProvenanceMeta(datasetId, items.length),
    [datasetId, items.length],
  );
  const inspector = useDemoNodeInspector(items);
  const { isFullscreen, toggleFullscreen } = useCssFullscreen({
    disableEscape: Boolean(inspector.selected || isDatasetModalOpen),
  });

  const handleRendererChange = useCallback((next: ShowcaseRendererKind) => {
    setRenderer((prev) => {
      if (prev !== next) {
        setZoomState(null);
        setTimelineState(null);
      }
      return next;
    });
  }, []);

  // Ensure initial timeline state is hydrated immediately after mount or renderer switch
  // (SimplexSvgController only emits onStateChange on subsequent playback/seek events).
  useEffect(() => {
    if (!timelineEnabled) {
      setTimelineState(null);
      return;
    }
    const syncInitial = () => {
      const tl =
        renderer === 'svg'
          ? controllerRef.current?.getTimeline()
          : canvasControllerRef.current?.getTimeline();
      if (tl) {
        setTimelineState(tl.getState());
      }
    };
    syncInitial();
    const rafId = window.requestAnimationFrame(syncInitial);
    return () => window.cancelAnimationFrame(rafId);
  }, [timelineEnabled, renderer, datasetId, controllerRef]);

  const handleDrillToDepth = useCallback(
    (depth: number) => {
      if (renderer === 'svg') {
        controllerRef.current?.drillToDepth(depth);
      } else {
        canvasControllerRef.current?.drillToDepth(depth);
      }
    },
    [renderer, controllerRef],
  );

  const handleDrillUp = useCallback(() => {
    if (renderer === 'svg') {
      controllerRef.current?.drillUp();
    } else {
      canvasControllerRef.current?.drillUp();
    }
  }, [renderer, controllerRef]);

  const handleTimelineToggle = useCallback(() => {
    if (renderer === 'svg') {
      controllerRef.current?.getTimeline()?.toggle();
    } else {
      canvasControllerRef.current?.getTimeline()?.toggle();
    }
  }, [renderer, controllerRef]);

  const handleTimelineSeek = useCallback(
    (step: number) => {
      const tl =
        renderer === 'svg'
          ? controllerRef.current?.getTimeline()
          : canvasControllerRef.current?.getTimeline();
      tl?.pause();
      tl?.seek(step);
    },
    [renderer, controllerRef],
  );

  const renderConfig = useMemo(
    () => ({
      ...DEFAULT_DEMO_RENDER_CONFIG,
      contentRenderer: effectiveNodeView,
      clusterRenderer:
        effectiveNodeView === 'react-card' ? ('react-card' as const) : ('badge' as const),
    }),
    [effectiveNodeView],
  );

  const visualResolver = useMemo(
    () => createDemoVisualResolver(renderConfig, theme, thumbManifest),
    [renderConfig, theme, thumbManifest],
  );
  const triangleView = useMemo(
    () =>
      createDemoTriangleView({
        triangleFaceStyle: 'oklab-tint',
        triangleFaceOpacity: 0.13,
      }),
    [],
  );
  const edgeView = useMemo(
    () =>
      createDemoEdgeView({
        meshEdgeStyle: 'dashed',
        meshEdgeWidth: 1.25,
      }),
    [],
  );

  const meshStrategyInstance = useMemo(() => {
    if (meshId === 'fixed-grid-mesh') {
      return createFixedLatticeMeshStrategy<DemoEntity>({
        cols: 3,
        rows: 2,
        orientation: 'auto',
        wideFirst: true,
      });
    }
    return createAdaptiveHexMeshStrategy<DemoEntity>();
  }, [meshId]);

  const clusteringStrategyInstance = useMemo(() => {
    const getTags = (e: DemoEntity) => (e.kind === 'knowledge' ? e.entry.hashtags : []);
    if (isTagged) {
      if (clusteringId === 'jaccard-qap-tags') {
        return createJaccardAnnealingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
          getTags,
        });
      }
      if (clusteringId === 'incremental-anchor-tags') {
        return createIncrementalAnchorClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
          getTags,
        });
      }
      return createSoftSimplexTagClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        getTags,
        triangleSpread: 0.45,
      });
    }

    if (clusteringId === 'pam-medoid-similarity') {
      return createSimilarityClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        clusterCount: datasetId === 'zoo-species' ? 7 : 6,
        getSimilarity: (a, b) => {
          if (datasetId === 'zoo-species') {
            return computeZooTraitSimilarity(a, b);
          }
          if (datasetId === 'media') {
            return computeMediaPairwiseSimilarity(
              a,
              b,
              MEDIA_RECEPTION_WEIGHT,
              MEDIA_PRODUCTION_WEIGHT,
            );
          }
          if (a.kind === 'voice' && b.kind === 'voice') {
            return cosineSim(a.voice.voiceEmbedding, b.voice.voiceEmbedding);
          }
          if (a.kind === 'body-shape' && b.kind === 'body-shape') {
            return cosineSim(a.body.shapeEmbedding, b.body.shapeEmbedding);
          }
          return 0;
        },
      });
    }

    if (datasetId === 'media') {
      const sources = [
        {
          name: 'reception',
          weight: MEDIA_RECEPTION_WEIGHT,
          getVector: (e: DemoEntity) =>
            e.kind === 'media' ? e.media.semanticEmbedding : [],
        },
        {
          name: 'production',
          weight: MEDIA_PRODUCTION_WEIGHT,
          getVector: (e: DemoEntity) =>
            e.kind === 'media' ? e.media.styleEmbedding : [],
        },
      ];
      if (clusteringId === 'nnls-simplex-embeddings') {
        return createEmbeddingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
          getEmbedding: sources,
          clusterCount: 7,
        });
      }
      return createSoftSimplexEmbeddingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        getEmbedding: sources,
        clusterCount: 7,
        triangleSpread: 0.45,
      });
    }

    const singleVec = (e: DemoEntity) => {
      if (e.kind === 'voice') return e.voice.voiceEmbedding;
      if (e.kind === 'body-shape') return e.body.shapeEmbedding;
      if (e.kind === 'zoo-species') return e.zoo.traits;
      return [];
    };

    if (clusteringId === 'nnls-simplex-embeddings') {
      return createEmbeddingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        getEmbedding: singleVec,
        clusterCount: 6,
      });
    }

    return createSoftSimplexEmbeddingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
      getEmbedding: singleVec,
      clusterCount: 6,
      triangleSpread: 0.45,
    });
  }, [datasetId, isTagged, clusteringId]);

  const colorStrategyInstance = useMemo(() => {
    if (colorId === 'oklab-edge-contrast') {
      return createOklabContrastColorStrategy<DemoEntity, TagTaxonomyInfo>();
    }
    if (colorId === 'custom-brand-palette') {
      return createPaletteColorStrategy<DemoEntity, TagTaxonomyInfo>(BRAND_PALETTE_HEX, {
        mode: 'edge-contrast',
      });
    }
    return createThemeAdaptiveOklabColorStrategy<DemoEntity, TagTaxonomyInfo>();
  }, [colorId]);

  const layoutStrategyInstance = useMemo(() => {
    if (layoutId === 'pbd-uniform-layout') return createPbdUniformLayoutStrategy();
    if (layoutId === 'density-adaptive-layout') return createLocalAdaptiveLayoutStrategy();
    if (layoutId === 'warm-start-pbd-layout') return createWarmStartPbdLayoutStrategy();
    return createCollisionDrivenLayoutStrategy();
  }, [layoutId]);

  const zoomStrategyInstance = useMemo(
    () => createDemoZoomStrategy(datasetId, zoomId, 'incident-star'),
    [datasetId, zoomId],
  );

  const timelineOptions = useMemo<TimelinePlayerOptions<DemoEntity> | undefined>(() => {
    if (!timelineEnabled) return undefined;
    return {
      getTimestamp: (entity) => {
        if (entity.kind === 'media') return entity.media.releaseYear;
        if (entity.kind === 'knowledge') return entity.entry.publishedYear;
        return undefined;
      },
      stepIntervalMs: 550,
      showControls: false,
      autoFinalSeed: true,
      autoFinalSeedLayout: 'adaptive',
      emptyClusterBehavior: 'dim',
      position: 'bottom',
    };
  }, [timelineEnabled]);

  const activeContentView =
    effectiveNodeView === 'react-card'
      ? undefined
      : effectiveNodeView === 'multisector'
        ? demoMultiSectorContentView
        : effectiveNodeView === 'domain'
          ? demoDomainContentView
          : demoGeometricContentView;

  return (
    <>
      <div
        className={`not-prose flex flex-col overflow-hidden bg-white dark:bg-[#0B0F17] ${
          isFullscreen
            ? 'sv-atlas-fullscreen'
            : embedded
              ? ''
              : 'my-6 rounded-2xl border border-slate-200/90 dark:border-slate-800/90'
        }`}
      >
        {/* Zero-Overlay Workbench Body: Stage + Adaptive Container-Query Inspector + Timeline + Bottom Bar */}
        <div
          className="sv-workbench-container"
          data-fullscreen={isFullscreen ? 'true' : 'false'}
        >
        <div
          className="sv-workbench-body sv-workbench-example"
          data-fullscreen={isFullscreen ? 'true' : 'false'}
          data-inspector-open={inspector.selected ? 'true' : 'false'}
        >
          <div className="sv-workbench-stage bg-white dark:bg-[#0B0F17]">
            {renderer === 'svg' ? (
              <SimplexTopicGraph<
                DemoEntity,
                DemoContentVisual,
                DemoClusterVisual,
                TagTaxonomyInfo,
                DemoClusterSummary
              >
                controllerRef={controllerRef}
                items={items}
                getId={(e) => e.id}
                getTags={(e) => (e.kind === 'knowledge' ? e.entry.hashtags : [])}
                resolveTagMeta={resolveDemoTagMeta}
                deriveClusterMeta={deriveDemoEntityClusterMeta}
                visualResolver={visualResolver}
                contentView={activeContentView}
                clusterView={effectiveNodeView === 'react-card' ? undefined : demoBadgeClusterView}
                renderContentNode={
                  effectiveNodeView === 'react-card' ? renderDemoContentCard : undefined
                }
                renderClusterNode={
                  effectiveNodeView === 'react-card' ? renderDemoClusterCard : undefined
                }
                triangleView={triangleView}
                edgeView={edgeView}
                meshStrategy={meshStrategyInstance}
                clusteringStrategy={clusteringStrategyInstance}
                colorStrategy={colorStrategyInstance}
                layoutStrategy={layoutStrategyInstance}
                zoomStrategy={zoomStrategyInstance}
                theme={theme}
                showZoomBreadcrumbs={false}
                onZoomStateChange={setZoomState}
                timeline={timelineOptions}
                onTimelineStateChange={setTimelineState}
                pinnedIds={inspector.pinnedIds}
                onContentClick={(ev) =>
                  inspector.handleContentClick(ev.item, ev.layoutContext)
                }
                onBackgroundClick={() => inspector.clearSelection()}
            tooltip={(target) => {
              if (target.kind === 'content') {
                return `${target.item.title} — ${target.item.subtitleMeta}`;
              }
              if (target.kind === 'cluster') {
                return `${target.cluster.meta.title} (${target.cluster.meta.memberCount} items)`;
              }
              if (zoomId === 'free-camera-zoom') {
                return `Triangle #${target.triangle.index + 1} (${target.triangle.coveredItemCount} items)`;
              }
              if (target.triangle.neighborId) {
                return `Click neighbor triangle to switch (${target.triangle.coveredItemCount} items)`;
              }
              if (target.triangle.isDrillable) {
                return `Click triangle #${target.triangle.index + 1} to drill down 1:4 (${target.triangle.coveredItemCount} items)`;
              }
              return `Click triangle #${target.triangle.index + 1} to focus (${target.triangle.coveredItemCount} items)`;
            }}
          />
        ) : (
            <SimplexCanvasStage<
              DemoEntity,
              DemoContentVisual,
              DemoClusterVisual,
              TagTaxonomyInfo,
              DemoClusterSummary
            >
              controllerRef={canvasControllerRef}
              resetKey={`${datasetId}-${timelineEnabled ? 'tl' : 'static'}`}
              items={items}
              getId={(e) => e.id}
              getTags={(e) => (e.kind === 'knowledge' ? e.entry.hashtags : [])}
              getLabel={(e) => e.title}
              resolveTagMeta={resolveDemoTagMeta}
              deriveClusterMeta={deriveDemoEntityClusterMeta}
              visualResolver={visualResolver}
              contentRenderer={demoCanvasContentRenderer}
              clusterRenderer={demoCanvasClusterRenderer}
              subscribeRepaint={subscribeCanvasImageLoads}
              theme={theme}
              meshStrategy={meshStrategyInstance}
              clusteringStrategy={clusteringStrategyInstance}
              colorStrategy={colorStrategyInstance}
              layoutStrategy={layoutStrategyInstance}
              zoomStrategy={zoomStrategyInstance}
              showZoomBreadcrumbs={false}
              showTimelineControls={false}
              onZoomStateChange={setZoomState}
              onTimelineStateChange={setTimelineState}
              timeline={
                timelineOptions
                  ? {
                      getTimestamp: timelineOptions.getTimestamp,
                      stepIntervalMs: timelineOptions.stepIntervalMs,
                      autoFinalSeed: timelineOptions.autoFinalSeed,
                      autoFinalSeedLayout:
                        timelineOptions.autoFinalSeedLayout === true
                          ? 'pinned'
                          : timelineOptions.autoFinalSeedLayout,
                      emptyClusterBehavior: timelineOptions.emptyClusterBehavior,
                    }
                  : null
              }
              selectedIds={inspector.pinnedIds}
              onContentClick={(ev) =>
                inspector.handleContentClick(ev.item, ev.layoutContext)
              }
              onBackgroundClick={() => inspector.clearSelection()}
              tooltip={{
                formatContent: (ev) => `${ev.item.title} — ${ev.item.subtitleMeta}`,
                formatCluster: (ev) =>
                  `${ev.cluster.meta.title} (${ev.cluster.meta.memberCount} items)`,
                formatTriangle: (ev) => {
                  if (zoomId === 'free-camera-zoom') {
                    return `Triangle #${ev.triangle.index + 1} (${ev.triangle.coveredItemCount} items)`;
                  }
                  if (ev.triangle.neighborId) {
                    return `Click neighbor triangle to switch (${ev.triangle.coveredItemCount} items)`;
                  }
                  if (ev.triangle.isDrillable) {
                    return `Click triangle #${ev.triangle.index + 1} to drill down 1:4 (${ev.triangle.coveredItemCount} items)`;
                  }
                  return `Click triangle #${ev.triangle.index + 1} to focus (${ev.triangle.coveredItemCount} items)`;
                },
              }}
            />
            )}
          </div>

          <DemoNodeInspectorOverlay
            selected={inspector.selected}
            theme={theme}
            thumbManifest={thumbManifest}
            docked
            isFreeCamera={zoomId === 'free-camera-zoom'}
            onClose={() => {
              inspector.clearSelection();
            }}
          />

          {timelineEnabled && timelineState && (
            <AtlasTimelineBar
              timelineState={timelineState}
              onTogglePlay={handleTimelineToggle}
              onSeek={handleTimelineSeek}
              renderer={renderer}
            />
          )}

          <AtlasBottomBar
            zoomState={zoomState}
            onDrillToDepth={handleDrillToDepth}
            onDrillUp={handleDrillUp}
            renderer={renderer}
            onRendererChange={handleRendererChange}
            isDatasetModalOpen={isDatasetModalOpen}
            onOpenDatasetModal={() => setIsDatasetModalOpen(true)}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            isFreeCamera={zoomId === 'free-camera-zoom'}
          />
        </div>
        </div>
      </div>

      <DatasetProvenanceModal
        isOpen={isDatasetModalOpen}
        meta={provenanceMeta}
        onClose={() => setIsDatasetModalOpen(false)}
      />
    </>
  );
}
