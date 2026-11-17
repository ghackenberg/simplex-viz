import {
  SimplexTopicGraph,
  createCollisionDrivenLayoutStrategy,
  createSimilarityClusteringStrategy,
  createSoftSimplexEmbeddingClusteringStrategy,
  createSoftSimplexTagClusteringStrategy,
  createThemeAdaptiveOklabColorStrategy,
  useSimplexGraphController,
} from '@simplex-viz/react';
import { useMemo, useState } from 'react';
import type { CommonsThumbManifest } from '../../demo/commonsThumbs';
import { resolveDemoTagMeta, type TagTaxonomyInfo } from '../../demo/data/knowledgeCatalog';
import {
  buildDemoCatalog,
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
  type DemoClusterVisual,
  type DemoContentVisual,
} from '../../demo/presets';
import { createHeroZoomStrategy } from '../../demo/zoomPresets';
import {
  DatasetInfoButton,
  DatasetProvenanceModal,
  resolveDatasetProvenanceMeta,
} from './DatasetProvenanceModal';
import {
  DemoNodeInspectorOverlay,
  useDemoNodeInspector,
} from './DemoNodeInspectorOverlay';
import { CssFullscreenButton, useCssFullscreen } from './useCssFullscreen';
import { useDocumentDarkTheme } from './useDocumentDarkTheme';

const HERO_DATASETS: ReadonlyArray<{
  readonly id: DemoDatasetId;
  readonly label: string;
  readonly modalityHint: string;
}> = [
  { id: 'knowledge', label: 'arXiv Papers', modalityHint: 'Tags' },
  { id: 'media', label: 'Vega Cinema', modalityHint: 'Dual Vectors' },
  { id: 'voice', label: 'UCI Vowels', modalityHint: '10D LPC' },
  { id: 'zoo-species', label: 'UCI Zoo', modalityHint: 'Similarity' },
];

export interface HeroAtlasIslandProps {
  readonly thumbManifest?: CommonsThumbManifest;
}

export function HeroAtlasIsland({ thumbManifest }: HeroAtlasIslandProps = {}) {
  const theme = useDocumentDarkTheme();
  const { isFullscreen, toggleFullscreen } = useCssFullscreen();
  const [datasetId, setDatasetId] = useState<DemoDatasetId>('knowledge');
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);

  const { controllerRef, handle } = useSimplexGraphController<
    DemoEntity,
    DemoContentVisual,
    DemoClusterVisual,
    TagTaxonomyInfo,
    DemoClusterSummary
  >();

  const items = useMemo(() => buildDemoCatalog(datasetId), [datasetId]);
  const provenanceMeta = useMemo(
    () => resolveDatasetProvenanceMeta(datasetId, items.length),
    [datasetId, items.length],
  );
  const inspector = useDemoNodeInspector(items);

  const renderConfig = useMemo(
    () => ({
      ...DEFAULT_DEMO_RENDER_CONFIG,
      contentRenderer: 'domain' as const,
    }),
    [],
  );

  const visualResolver = useMemo(
    () => createDemoVisualResolver(renderConfig, theme, thumbManifest),
    [renderConfig, theme, thumbManifest],
  );
  const triangleView = useMemo(
    () =>
      createDemoTriangleView({
        triangleFaceStyle: 'oklab-tint',
        triangleFaceOpacity: 0.12,
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

  const clusteringStrategy = useMemo(() => {
    if (datasetId === 'knowledge') {
      return createSoftSimplexTagClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        getTags: (e) => (e.kind === 'knowledge' ? e.entry.hashtags : []),
        triangleSpread: 0.45,
      });
    }
    if (datasetId === 'zoo-species') {
      return createSimilarityClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        clusterCount: 6,
        getSimilarity: computeZooTraitSimilarity,
      });
    }
    if (datasetId === 'media') {
      return createSoftSimplexEmbeddingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        getEmbedding: [
          {
            name: 'reception',
            weight: 0.65,
            getVector: (e) => (e.kind === 'media' ? e.media.semanticEmbedding : []),
          },
          {
            name: 'production',
            weight: 0.35,
            getVector: (e) => (e.kind === 'media' ? e.media.styleEmbedding : []),
          },
        ],
        clusterCount: 6,
        triangleSpread: 0.45,
      });
    }
    return createSoftSimplexEmbeddingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
      getEmbedding: (e) => (e.kind === 'voice' ? e.voice.voiceEmbedding : []),
      clusterCount: 6,
      triangleSpread: 0.45,
    });
  }, [datasetId]);

  const colorStrategy = useMemo(
    () => createThemeAdaptiveOklabColorStrategy<DemoEntity, TagTaxonomyInfo>(),
    [],
  );

  const layoutStrategy = useMemo(() => createCollisionDrivenLayoutStrategy(), []);

  const zoomStrategy = useMemo(
    () => createHeroZoomStrategy(datasetId),
    [datasetId],
  );

  return (
    <>
      <div
        className={`flex flex-col overflow-hidden bg-white dark:bg-[#0B0F17] ${
          isFullscreen
            ? 'sv-atlas-fullscreen'
            : 'rounded-2xl border border-slate-200/90 dark:border-slate-800/90'
        }`}
      >
      {/* Pure Case-Switching Bar (2×2 Grid on Mobile, 4-Column Segmented Bar on Tablet/Desktop) */}
      <div className="shrink-0 border-b border-slate-200/80 bg-slate-100/85 p-1.5 dark:border-slate-800/80 dark:bg-[#0E131D]">
        <div
          role="tablist"
          aria-label="Example dataset"
          className="grid grid-cols-2 gap-1 sm:grid-cols-4"
        >
          {HERO_DATASETS.map((ds) => {
            const active = datasetId === ds.id;
            return (
              <button
                key={ds.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  inspector.clearSelection();
                  handle.drillToRoot();
                  setDatasetId(ds.id);
                }}
                className={`flex h-9 sm:h-8.5 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-white font-semibold text-slate-950 shadow-xs dark:bg-[#07090E] dark:text-cyan-300'
                    : 'font-medium text-slate-600 hover:bg-white/60 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-100'
                }`}
              >
                <span className="truncate">{ds.label}</span>
                <span
                  className={`hidden lg:inline font-normal ${
                    active
                      ? 'text-slate-400 dark:text-cyan-400/70'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  · {ds.modalityHint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Simplex Canvas with Floating Fullscreen Overlay Button */}
      <div
        className={`relative w-full bg-slate-50/70 dark:bg-[#07090E] ${
          isFullscreen ? 'min-h-0 flex-1' : 'h-[360px] sm:h-[460px] lg:h-[520px]'
        }`}
      >
        <div className="pointer-events-none absolute top-3 right-3 z-20 flex items-center gap-2">
          <div className="pointer-events-auto rounded-md shadow-xs">
            <DatasetInfoButton
              isOpen={isDatasetModalOpen}
              onOpen={() => setIsDatasetModalOpen(true)}
            />
          </div>
          <div className="pointer-events-auto rounded-md shadow-xs">
            <CssFullscreenButton
              isFullscreen={isFullscreen}
              onToggle={toggleFullscreen}
            />
          </div>
        </div>

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
          contentView={demoDomainContentView}
          clusterView={demoBadgeClusterView}
          triangleView={triangleView}
          edgeView={edgeView}
          clusteringStrategy={clusteringStrategy}
          colorStrategy={colorStrategy}
          layoutStrategy={layoutStrategy}
          zoomStrategy={zoomStrategy}
          theme={theme}
          showZoomBreadcrumbs
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
            if (target.triangle.neighborId) {
              return `Click neighbor triangle to switch (${target.triangle.coveredItemCount} items)`;
            }
            const zState = controllerRef.current?.getZoomState();
            if (zState?.activeFrameKind === 'triangle-focus' && zState.canDrillUp) {
              return `Click triangle to zoom out (${target.triangle.coveredItemCount} items)`;
            }
            if (target.triangle.isDrillable) {
              return `Click triangle to drill down 1:4 (${target.triangle.coveredItemCount} items)`;
            }
            return `Click triangle to focus (${target.triangle.coveredItemCount} items)`;
          }}
        />

        <DemoNodeInspectorOverlay
          selected={inspector.selected}
          theme={theme}
          thumbManifest={thumbManifest}
          onClose={() => {
            inspector.clearSelection();
          }}
        />
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
