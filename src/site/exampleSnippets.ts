import type { DemoDatasetId } from '../demo/data/multimodalCatalog';

export const EXAMPLE_CODE_SNIPPETS: Record<DemoDatasetId, string> = {
  knowledge: `import {
  SimplexTopicGraph,
  createAdaptiveHexMeshStrategy,
  createSoftSimplexTagClusteringStrategy,
  createThemeAdaptiveOklabColorStrategy,
  createCollisionDrivenLayoutStrategy,
  createSemanticZoomStrategy,
} from '@simplex-viz/react';

<SimplexTopicGraph
  items={arxivPapers}
  getId={(paper) => paper.slug}
  getTags={(paper) => paper.hashtags}
  resolveTagMeta={(tag) => arxivTaxonomy[tag]}
  meshStrategy={createAdaptiveHexMeshStrategy()}
  clusteringStrategy={createSoftSimplexTagClusteringStrategy({
    triangleSpread: 0.45,
    sharedTagRule: 'planar-hitting-set',
    anchorRule: 'explaining-away',
  })}
  colorStrategy={createThemeAdaptiveOklabColorStrategy()}
  layoutStrategy={createCollisionDrivenLayoutStrategy()}
  zoomStrategy={createSemanticZoomStrategy({
    clusterZoomMode: 'incident-star',
  })}
  showZoomBreadcrumbs
  tooltip
/>;`,

  'github-repos': `import {
  SimplexTopicGraph,
  createAdaptiveHexMeshStrategy,
  createJaccardAnnealingClusteringStrategy,
  createOklabContrastColorStrategy,
  createCollisionDrivenLayoutStrategy,
  createSemanticZoomStrategy,
  disambiguatePeerClusterTitle,
} from '@simplex-viz/react';

<SimplexTopicGraph
  items={repositories}
  getId={(repo) => repo.id}
  getTags={(repo) => repo.topics}
  resolveTagMeta={(tag) => repoTagTaxonomy[tag]}
  deriveClusterMeta={(ctx) => ({
    title:
      ctx.role === 'intermediate'
        ? (ctx.subclusterLabel ?? ctx.defaultLabel)
        : disambiguatePeerClusterTitle(
            ctx,
            (peer) => peer.coreTags[0]?.meta?.displayTitle ?? peer.defaultLabel,
            (peer) => peer.coreTags[1]?.meta?.displayTitle,
          ),
  })}
  meshStrategy={createAdaptiveHexMeshStrategy()}
  clusteringStrategy={createJaccardAnnealingClusteringStrategy({
    sharedTagRule: 'planar-hitting-set',
    anchorRule: 'explaining-away',
  })}
  colorStrategy={createOklabContrastColorStrategy()}
  layoutStrategy={createCollisionDrivenLayoutStrategy()}
  zoomStrategy={createSemanticZoomStrategy({
    clusterZoomMode: 'incident-star',
  })}
  showZoomBreadcrumbs
/>;`,

  media: `import {
  SimplexTopicGraph,
  createAdaptiveHexMeshStrategy,
  createSoftSimplexEmbeddingClusteringStrategy,
  createThemeAdaptiveOklabColorStrategy,
  createCollisionDrivenLayoutStrategy,
  createSubspaceZoomStrategy,
} from '@simplex-viz/react';

const cinemaFeatures = [
  { label: 'Gross', getValue: (f: FilmRecord) => Math.log10(f.worldwideGrossMusd), highLabel: 'Box-Office Hits', lowLabel: 'Modest Gross' },
  { label: 'Budget', getValue: (f: FilmRecord) => Math.log10(f.budgetMusd), highLabel: 'Big-Budget Epics', lowLabel: 'Low-Budget Cult' },
  { label: 'Runtime', getValue: (f: FilmRecord) => f.runtimeMin, highLabel: 'Epic Runtime', lowLabel: 'Compact Classics' },
  { label: 'Era', getValue: (f: FilmRecord) => f.releaseYear, highLabel: 'New Hollywood', lowLabel: 'Golden Age' },
  { label: 'Critics', getValue: (f: FilmRecord) => f.rottenTomatoes, highLabel: 'Critic Classics', lowLabel: 'Crowd-Pleasers' },
];

const cinemaClustering = createSoftSimplexEmbeddingClusteringStrategy<FilmRecord>({
  getEmbedding: [
    { name: 'reception', getVector: (f) => f.receptionVector, weight: 0.65 },
    { name: 'production', getVector: (f) => f.productionVector, weight: 0.35 },
  ],
  features: cinemaFeatures,
  clusterCount: 7,
  metric: 'cosine',
  triangleSpread: 0.45,
});

const cinemaZoom = createSubspaceZoomStrategy<FilmRecord>({
  features: cinemaFeatures,
});

<SimplexTopicGraph
  items={films}
  meshStrategy={createAdaptiveHexMeshStrategy()}
  clusteringStrategy={cinemaClustering}
  colorStrategy={createThemeAdaptiveOklabColorStrategy()}
  layoutStrategy={createCollisionDrivenLayoutStrategy()}
  zoomStrategy={cinemaZoom}
  timeline={{
    getTimestamp: (film) => film.releaseYear,
    stepIntervalMs: 550,
    autoFinalSeed: true,
    autoFinalSeedLayout: 'adaptive',
    emptyClusterBehavior: 'dim',
  }}
  showZoomBreadcrumbs
/>;`,

  voice: `import {
  SimplexTopicGraph,
  createFixedLatticeMeshStrategy,
  createEmbeddingClusteringStrategy,
  createThemeAdaptiveOklabColorStrategy,
  createPbdUniformLayoutStrategy,
  createSubspaceZoomStrategy,
} from '@simplex-viz/react';

const acousticFeatures = [
  { label: 'Vowel', getValue: (rec: VowelRecording) => \`Vowel \${rec.ipaSymbol}\` },
  { label: 'Speaker Sex', getValue: (rec: VowelRecording) => \`\${rec.speakerSex} Voice\` },
  { label: 'Pitch', getValue: (rec: VowelRecording) => rec.pitchHz, highLabel: 'High Pitch', lowLabel: 'Low Pitch' },
];

<SimplexTopicGraph
  items={vowelRecordings}
  contentView={lpcCapsuleSvgView}
  meshStrategy={createFixedLatticeMeshStrategy({ cols: 3, rows: 2 })}
  clusteringStrategy={createEmbeddingClusteringStrategy({
    getEmbedding: (rec) => rec.lpcVector,
    features: acousticFeatures,
    clusterCount: 6,
  })}
  colorStrategy={createThemeAdaptiveOklabColorStrategy()}
  layoutStrategy={createPbdUniformLayoutStrategy()}
  zoomStrategy={createSubspaceZoomStrategy({
    features: acousticFeatures,
    getVector: (rec) => rec.lpcVector,
  })}
  showZoomBreadcrumbs
/>;`,

  'zoo-species': `import {
  SimplexTopicGraph,
  createAdaptiveHexMeshStrategy,
  createSimilarityClusteringStrategy,
  createOklabContrastColorStrategy,
  createCollisionDrivenLayoutStrategy,
  createSubspaceZoomStrategy,
} from '@simplex-viz/react';

<SimplexTopicGraph
  items={zooSpecies}
  meshStrategy={createAdaptiveHexMeshStrategy()}
  clusteringStrategy={createSimilarityClusteringStrategy({
    clusterCount: 7,
    getSimilarity: (a, b) => computeGowerTraitSimilarity(a.traits, b.traits),
    features: uciZoo16TraitFeatures,
  })}
  colorStrategy={createOklabContrastColorStrategy()}
  layoutStrategy={createCollisionDrivenLayoutStrategy()}
  zoomStrategy={createSubspaceZoomStrategy({
    features: uciZoo16TraitFeatures,
    getSimilarity: (a, b) => computeGowerTraitSimilarity(a.traits, b.traits),
    clusterZoomMode: 'incident-star',
  })}
  showZoomBreadcrumbs
/>;`,

  'body-shape': `import {
  SimplexTopicGraph,
  createAdaptiveHexMeshStrategy,
  createSoftSimplexEmbeddingClusteringStrategy,
  createPaletteColorStrategy,
  createLocalAdaptiveLayoutStrategy,
  createSubspaceZoomStrategy,
} from '@simplex-viz/react';

const scientificPalette = [
  '#0891b2',
  '#d97706',
  '#c026d3',
  '#059669',
  '#2563eb',
  '#e11d48',
];

const penguinFeatures = [
  { label: 'Species', getValue: (p: PenguinSpecimen) => p.species, weight: 1.5 },
  { label: 'Sex', getValue: (p: PenguinSpecimen) => p.sex, weight: 1.2 },
  { label: 'Island', getValue: (p: PenguinSpecimen) => \`\${p.island} Isl.\` },
  { label: 'Body Mass', getValue: (p: PenguinSpecimen) => p.bodyMassG, highLabel: 'Heavy Mass', lowLabel: 'Light Mass' },
  { label: 'Bill Length', getValue: (p: PenguinSpecimen) => p.billLengthMm, highLabel: 'Long Bill', lowLabel: 'Short Bill' },
];

<SimplexTopicGraph
  items={penguinSpecimens}
  contentView={morphometricGlyphSvgView}
  meshStrategy={createAdaptiveHexMeshStrategy()}
  clusteringStrategy={createSoftSimplexEmbeddingClusteringStrategy({
    getEmbedding: (p) => p.morphVector,
    features: penguinFeatures,
    clusterCount: 5,
    triangleSpread: 0.45,
  })}
  colorStrategy={createPaletteColorStrategy(scientificPalette, {
    mode: 'edge-contrast',
  })}
  layoutStrategy={createLocalAdaptiveLayoutStrategy()}
  zoomStrategy={createSubspaceZoomStrategy({
    features: penguinFeatures,
    getVector: (p) => p.morphVector,
  })}
  showZoomBreadcrumbs
/>;`,

  'stellar-atlas': `// 1. simplex.worker.ts (dedicated Vite ES module Web Worker)
import { attachSimplexWorkerHandler } from '@simplex-viz/core/worker';

attachSimplexWorkerHandler();

// 2. Main thread: off-thread solve + high-capacity Canvas 2D rendering
import {
  createSimplexWorkerClient,
  isSimplexWorkerCancelledError,
} from '@simplex-viz/core/worker';
import {
  CanvasRendererAdapter,
  renderSimplexSnapshotToCanvas,
} from '@simplex-viz/canvas';

const workerClient = createSimplexWorkerClient(
  () => new Worker(new URL('./simplex.worker.ts', import.meta.url), { type: 'module' }),
  { cancelPreviousByDefault: true, fallbackToInThread: true },
);

// Solve 2,000+ stars off the main thread with zero-copy Float32Array handoff
const { snapshot } = await workerClient.solve(stellarCatalog, {
  getId: (star) => star.id,
  getEmbedding: (star) => new Float32Array(star.embedding),
  transferEmbeddings: true,
  width: canvas.clientWidth,
  height: canvas.clientHeight,
  itemRadius: 2.4,
  clusterRadius: 20,
  theme: 'dark',
  meshStrategy: { kind: 'adaptive-hex' },
  clusteringStrategy: {
    kind: 'soft-simplex-embedding',
    metric: 'cosine',
    clusterCount: 12,
    triangleSpread: 0.82,
    balanceLoad: true,
  },
  colorStrategy: { kind: 'theme-adaptive-oklab' },
  layoutStrategy: { kind: 'pbd-uniform' },
  layoutOptions: { itemGapPx: 0.85, relaxationIterations: 12 },
});

// Paint snapshot onto HiDPI Canvas 2D with automatic LOD & frustum culling
renderSimplexSnapshotToCanvas(canvas, snapshot, {
  theme: 'dark',
  lodThresholdPx: 3.5,
  devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
});`,
};
