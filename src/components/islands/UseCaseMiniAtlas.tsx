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
} from '@simplex-viz/react';
import { useMemo } from 'react';
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
import { createDemoZoomStrategy } from '../../demo/zoomPresets';
import type {
  CanonicalClusteringStrategyId,
  CanonicalColorStrategyId,
  CanonicalLayoutStrategyId,
  CanonicalMeshStrategyId,
  CanonicalZoomStrategyId,
} from '../../site/strategies';
import {
  DemoNodeInspectorOverlay,
  useDemoNodeInspector,
} from './DemoNodeInspectorOverlay';
import { CssFullscreenButton, useCssFullscreen } from './useCssFullscreen';
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
}: UseCaseMiniAtlasProps) {
  const theme = useDocumentDarkTheme();
  const isTagged = datasetId === 'knowledge' || datasetId === 'github-repos';
  const effectiveNodeView: ContentRendererKind = nodeView;

  const { isFullscreen, toggleFullscreen } = useCssFullscreen();

  const items = useMemo(() => buildDemoCatalog(datasetId), [datasetId]);
  const inspector = useDemoNodeInspector(items);

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

  const activeContentView =
    effectiveNodeView === 'react-card'
      ? undefined
      : effectiveNodeView === 'multisector'
        ? demoMultiSectorContentView
        : effectiveNodeView === 'domain'
          ? demoDomainContentView
          : demoGeometricContentView;

  return (
    <div
      className={`not-prose flex flex-col overflow-hidden bg-white dark:bg-[#0B0F17] ${
        isFullscreen
          ? 'sv-atlas-fullscreen'
          : 'my-6 rounded-xl border border-slate-200/90 dark:border-slate-800/80'
      }`}
    >
      {/* Live Simplex Canvas with Floating Fullscreen Overlay Button */}
      <div
        className={`relative w-full bg-slate-50/70 dark:bg-[#07090E] ${
          isFullscreen ? 'min-h-0 flex-1' : 'h-[450px] sm:h-[520px]'
        }`}
      >
        <div className="pointer-events-none absolute top-3 right-3 z-20">
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
  );
}
