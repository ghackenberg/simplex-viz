import {
  SimplexTopicGraph,
  createBarycentricZoomStrategy,
  createCollisionDrivenLayoutStrategy,
  createFreeCameraZoomStrategy,
  createJaccardAnnealingClusteringStrategy,
  createPbdUniformLayoutStrategy,
  createSemanticZoomStrategy,
  createSoftSimplexTagClusteringStrategy,
  createThemeAdaptiveOklabColorStrategy,
  useSimplexGraphController,
} from '@simplex-viz/react';
import { useMemo, useState } from 'react';
import { resolveDemoTagMeta, type TagTaxonomyInfo } from '../../demo/data/knowledgeCatalog';
import {
  buildDemoCatalog,
  deriveDemoEntityClusterMeta,
  type DemoClusterSummary,
  type DemoEntity,
} from '../../demo/data/multimodalCatalog';
import {
  DEFAULT_DEMO_RENDER_CONFIG,
  createDemoEdgeView,
  createDemoTriangleView,
  createDemoVisualResolver,
  demoBadgeClusterView,
  demoGeometricContentView,
  type DemoClusterVisual,
  type DemoContentVisual,
} from '../../demo/presets';
import { createDemoSubspaceZoomStrategy } from '../../demo/zoomPresets';
import { STRATEGY_REGISTRY } from '../../site/strategies';
import { useDocumentDarkTheme } from './useDocumentDarkTheme';

interface StrategyLiveSandboxProps {
  readonly mode: 'clustering' | 'layout' | 'zoom';
}

export function StrategyLiveSandbox({ mode }: StrategyLiveSandboxProps) {
  const theme = useDocumentDarkTheme();
  const { controllerRef, handle } = useSimplexGraphController<
    DemoEntity,
    DemoContentVisual,
    DemoClusterVisual,
    TagTaxonomyInfo,
    DemoClusterSummary
  >();

  const [clusteringVariant, setClusteringVariant] = useState<'soft' | 'jaccard'>('soft');
  const [spreadPct, setSpreadPct] = useState<number>(48);
  const [layoutVariant, setLayoutVariant] = useState<'collision-local' | 'uniform'>(
    'collision-local',
  );
  const [zoomVariant, setZoomVariant] = useState<
    'subspace' | 'semantic' | 'barycentric' | 'free'
  >('subspace');

  const items = useMemo(() => buildDemoCatalog('knowledge').slice(0, 38), []);
  const visualResolver = useMemo(
    () =>
      createDemoVisualResolver(
        { ...DEFAULT_DEMO_RENDER_CONFIG, contentRenderer: 'geometric' },
        theme,
      ),
    [theme],
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
    const getTags = (e: DemoEntity) => (e.kind === 'knowledge' ? e.entry.hashtags : []);
    if (mode === 'clustering' && clusteringVariant === 'jaccard') {
      return createJaccardAnnealingClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
        getTags,
      });
    }
    return createSoftSimplexTagClusteringStrategy<DemoEntity, TagTaxonomyInfo>({
      getTags,
      triangleSpread: mode === 'clustering' ? spreadPct / 100 : 0.45,
    });
  }, [mode, clusteringVariant, spreadPct]);

  const layoutStrategy = useMemo(() => {
    if (mode === 'layout' && layoutVariant === 'uniform') {
      return createPbdUniformLayoutStrategy();
    }
    return createCollisionDrivenLayoutStrategy();
  }, [mode, layoutVariant]);

  const zoomStrategy = useMemo(() => {
    if (mode === 'zoom') {
      if (zoomVariant === 'subspace') {
        return createDemoSubspaceZoomStrategy('knowledge', 'incident-star');
      }
      if (zoomVariant === 'semantic') {
        return createSemanticZoomStrategy<
          DemoEntity,
          TagTaxonomyInfo,
          DemoClusterSummary
        >();
      }
      if (zoomVariant === 'free') {
        return createFreeCameraZoomStrategy<
          DemoEntity,
          TagTaxonomyInfo,
          DemoClusterSummary
        >();
      }
      return createBarycentricZoomStrategy<
        DemoEntity,
        TagTaxonomyInfo,
        DemoClusterSummary
      >();
    }
    return createFreeCameraZoomStrategy<
      DemoEntity,
      TagTaxonomyInfo,
      DemoClusterSummary
    >();
  }, [mode, zoomVariant]);

  const colorStrategy = useMemo(
    () => createThemeAdaptiveOklabColorStrategy<DemoEntity, TagTaxonomyInfo>(),
    [],
  );

  return (
    <div className="not-prose my-8 rounded-xl border border-slate-200/90 bg-white overflow-hidden dark:border-slate-800/80 dark:bg-[#0B0F17]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-3.5 py-3 dark:border-slate-800/80">
        {mode === 'clustering' && (
          <>
            <div className="flex max-w-full overflow-x-auto items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#0E131D]">
              <button
                type="button"
                onClick={() => setClusteringVariant('soft')}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  clusteringVariant === 'soft'
                    ? 'bg-white text-slate-950 shadow-xs dark:bg-slate-800 dark:text-cyan-300'
                    : 'text-slate-600 hover:text-slate-950 dark:text-slate-400'
                }`}
              >
                {STRATEGY_REGISTRY['soft-simplex-tags'].name}
              </button>
              <button
                type="button"
                onClick={() => setClusteringVariant('jaccard')}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  clusteringVariant === 'jaccard'
                    ? 'bg-white text-slate-950 shadow-xs dark:bg-slate-800 dark:text-cyan-300'
                    : 'text-slate-600 hover:text-slate-950 dark:text-slate-400'
                }`}
              >
                {STRATEGY_REGISTRY['jaccard-qap-tags'].name}
              </button>
            </div>
            {clusteringVariant === 'soft' && (
              <label className="flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                <span>triangleSpread: {(spreadPct / 100).toFixed(2)}</span>
                <input
                  type="range"
                  min={0}
                  max={80}
                  step={5}
                  value={spreadPct}
                  onChange={(e) => setSpreadPct(parseInt(e.target.value, 10))}
                  className="w-24 sm:w-28 accent-cyan-600 dark:accent-cyan-400 cursor-pointer"
                />
              </label>
            )}
          </>
        )}

        {mode === 'layout' && (
          <div className="flex max-w-full overflow-x-auto items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#0E131D]">
            <button
              type="button"
              onClick={() => setLayoutVariant('collision-local')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                layoutVariant === 'collision-local'
                  ? 'bg-white text-slate-950 shadow-xs dark:bg-slate-800 dark:text-cyan-300'
                  : 'text-slate-600 hover:text-slate-950 dark:text-slate-400'
              }`}
            >
              {STRATEGY_REGISTRY['collision-local-layout'].name}
            </button>
            <button
              type="button"
              onClick={() => setLayoutVariant('uniform')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                layoutVariant === 'uniform'
                  ? 'bg-white text-slate-950 shadow-xs dark:bg-slate-800 dark:text-cyan-300'
                  : 'text-slate-600 hover:text-slate-950 dark:text-slate-400'
              }`}
            >
              {STRATEGY_REGISTRY['pbd-uniform-layout'].name}
            </button>
          </div>
        )}

        {mode === 'zoom' && (
          <div className="flex flex-wrap items-center gap-2 w-full justify-between">
            <div className="flex max-w-full overflow-x-auto items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#0E131D]">
              <button
                type="button"
                onClick={() => {
                  handle.drillToRoot();
                  setZoomVariant('subspace');
                }}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  zoomVariant === 'subspace'
                    ? 'bg-white text-slate-950 shadow-xs dark:bg-slate-800 dark:text-cyan-300'
                    : 'text-slate-600 hover:text-slate-950 dark:text-slate-400'
                }`}
              >
                {STRATEGY_REGISTRY['subspace-recluster-zoom'].shortName}
              </button>
              <button
                type="button"
                onClick={() => {
                  handle.drillToRoot();
                  setZoomVariant('semantic');
                }}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  zoomVariant === 'semantic'
                    ? 'bg-white text-slate-950 shadow-xs dark:bg-slate-800 dark:text-cyan-300'
                    : 'text-slate-600 hover:text-slate-950 dark:text-slate-400'
                }`}
              >
                {STRATEGY_REGISTRY['semantic-tag-split-zoom'].shortName}
              </button>
              <button
                type="button"
                onClick={() => {
                  handle.drillToRoot();
                  setZoomVariant('barycentric');
                }}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  zoomVariant === 'barycentric'
                    ? 'bg-white text-slate-950 shadow-xs dark:bg-slate-800 dark:text-cyan-300'
                    : 'text-slate-600 hover:text-slate-950 dark:text-slate-400'
                }`}
              >
                {STRATEGY_REGISTRY['barycentric-subdivision-zoom'].shortName}
              </button>
              <button
                type="button"
                onClick={() => {
                  handle.drillToRoot();
                  setZoomVariant('free');
                }}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  zoomVariant === 'free'
                    ? 'bg-white text-slate-950 shadow-xs dark:bg-slate-800 dark:text-cyan-300'
                    : 'text-slate-600 hover:text-slate-950 dark:text-slate-400'
                }`}
              >
                {STRATEGY_REGISTRY['free-camera-zoom'].shortName}
              </button>
            </div>
            <button
              type="button"
              onClick={() => handle.drillToRoot()}
              className="cursor-pointer rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
            >
              Overview
            </button>
          </div>
        )}
      </div>

      <div className="relative h-[340px] sm:h-[380px] w-full bg-slate-50/70 dark:bg-[#07090E]">
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
          contentView={demoGeometricContentView}
          clusterView={demoBadgeClusterView}
          triangleView={triangleView}
          edgeView={edgeView}
          clusteringStrategy={clusteringStrategy}
          colorStrategy={colorStrategy}
          layoutStrategy={layoutStrategy}
          zoomStrategy={zoomStrategy}
          theme={theme}
          showZoomBreadcrumbs
          tooltip={(target) => {
            if (target.kind === 'content') return target.item.title;
            if (target.kind === 'cluster') return `${target.cluster.meta.title} (${target.cluster.meta.memberCount} items)`;
            return `Triangle #${target.triangle.index + 1} · ${target.triangle.coveredItemCount} items`;
          }}
        />
      </div>
    </div>
  );
}
