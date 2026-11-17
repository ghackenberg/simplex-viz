export const MESH_STRATEGY_IDS = [
  'adaptive-hex-mesh',
  'fixed-grid-mesh',
] as const;
export type CanonicalMeshStrategyId = (typeof MESH_STRATEGY_IDS)[number];

export const CLUSTERING_STRATEGY_IDS = [
  'soft-simplex-tags',
  'jaccard-qap-tags',
  'incremental-anchor-tags',
  'soft-simplex-embeddings',
  'nnls-simplex-embeddings',
  'pam-medoid-similarity',
] as const;
export type CanonicalClusteringStrategyId =
  (typeof CLUSTERING_STRATEGY_IDS)[number];

export const COLOR_STRATEGY_IDS = [
  'oklab-edge-contrast',
  'theme-adaptive-oklab',
  'custom-brand-palette',
] as const;
export type CanonicalColorStrategyId = (typeof COLOR_STRATEGY_IDS)[number];

export const LAYOUT_STRATEGY_IDS = [
  'collision-local-layout',
  'pbd-uniform-layout',
  'warm-start-pbd-layout',
  'density-adaptive-layout',
] as const;
export type CanonicalLayoutStrategyId = (typeof LAYOUT_STRATEGY_IDS)[number];

export const ZOOM_STRATEGY_IDS = [
  'subspace-recluster-zoom',
  'barycentric-subdivision-zoom',
  'semantic-tag-split-zoom',
  'free-camera-zoom',
] as const;
export type CanonicalZoomStrategyId = (typeof ZOOM_STRATEGY_IDS)[number];

export const ALL_STRATEGY_IDS = [
  ...MESH_STRATEGY_IDS,
  ...CLUSTERING_STRATEGY_IDS,
  ...COLOR_STRATEGY_IDS,
  ...LAYOUT_STRATEGY_IDS,
  ...ZOOM_STRATEGY_IDS,
] as const;

export type CanonicalStrategyId = (typeof ALL_STRATEGY_IDS)[number];

export interface CanonicalStrategySpec {
  readonly id: CanonicalStrategyId;
  readonly name: string;
  readonly shortName: string;
  readonly stage: 1 | 2 | 3 | 4 | 5;
  readonly stageLabel: string;
  /** Stage overview slug under `/docs/[stageDocSlug]` */
  readonly docSlug: string;
  /** Dedicated strategy sub-page path `/docs/strategies/[id]` */
  readonly strategyDocPath: string;
  readonly factoryName: string;
  readonly isDefault?: boolean;
  readonly requiresTags?: boolean;
  readonly summary: string;
}

export const STRATEGY_REGISTRY: Record<CanonicalStrategyId, CanonicalStrategySpec> = {
  // Stage 1: Mesh Topology
  'adaptive-hex-mesh': {
    id: 'adaptive-hex-mesh',
    name: 'Adaptive Hex Lattice',
    shortName: 'Adaptive Hex',
    stage: 1,
    stageLabel: 'Mesh Triangulation',
    docSlug: 'stage-1-mesh',
    strategyDocPath: '/docs/strategies/adaptive-hex-mesh',
    factoryName: 'createAdaptiveHexMeshStrategy',
    isDefault: true,
    summary:
      'Chooses orientation and staggered 60° row parity automatically to maximize triangle side length.',
  },
  'fixed-grid-mesh': {
    id: 'fixed-grid-mesh',
    name: 'Fixed Grid Lattice',
    shortName: 'Fixed Grid',
    stage: 1,
    stageLabel: 'Mesh Triangulation',
    docSlug: 'stage-1-mesh',
    strategyDocPath: '/docs/strategies/fixed-grid-mesh',
    factoryName: 'createFixedLatticeMeshStrategy',
    summary:
      'Pins an exact (cols × rows) equilateral vertex grid across viewport resizes.',
  },

  // Stage 2: Clustering & Projection
  'soft-simplex-tags': {
    id: 'soft-simplex-tags',
    name: 'Soft-Simplex Tag Clustering',
    shortName: 'Soft-Simplex Tags',
    stage: 2,
    stageLabel: 'Clustering & Projection',
    docSlug: 'stage-2-clustering',
    strategyDocPath: '/docs/strategies/soft-simplex-tags',
    factoryName: 'createSoftSimplexTagClusteringStrategy',
    requiresTags: true,
    summary:
      'Spreads multi-tag items smoothly across triangle interiors while keeping 1-tag items in a free 360° halo.',
  },
  'jaccard-qap-tags': {
    id: 'jaccard-qap-tags',
    name: 'Jaccard Annealing Clustering',
    shortName: 'Jaccard Annealing',
    stage: 2,
    stageLabel: 'Clustering & Projection',
    docSlug: 'stage-2-clustering',
    strategyDocPath: '/docs/strategies/jaccard-qap-tags',
    factoryName: 'createJaccardAnnealingClusteringStrategy',
    isDefault: true,
    requiresTags: true,
    summary:
      'Regularized Jaccard tag partitioning with QAP Simulated Annealing and planar hitting-set edges.',
  },
  'incremental-anchor-tags': {
    id: 'incremental-anchor-tags',
    name: 'Incremental Tag Anchoring',
    shortName: 'Incremental Anchors',
    stage: 2,
    stageLabel: 'Clustering & Projection',
    docSlug: 'stage-2-clustering',
    strategyDocPath: '/docs/strategies/incremental-anchor-tags',
    factoryName: 'createIncrementalAnchorClusteringStrategy',
    requiresTags: true,
    summary:
      'Preserves existing cluster vertices and UIDs during live updates while attaching new tags incrementally.',
  },
  'soft-simplex-embeddings': {
    id: 'soft-simplex-embeddings',
    name: 'Soft-Simplex Embedding Projection',
    shortName: 'Soft-Simplex Vectors',
    stage: 2,
    stageLabel: 'Clustering & Projection',
    docSlug: 'stage-2-clustering',
    strategyDocPath: '/docs/strategies/soft-simplex-embeddings',
    factoryName: 'createSoftSimplexEmbeddingClusteringStrategy',
    requiresTags: false,
    summary:
      'Load-balanced QAP and continuous interior simplex projection for single- or multi-modal embeddings.',
  },
  'nnls-simplex-embeddings': {
    id: 'nnls-simplex-embeddings',
    name: 'Planar NNLS Embedding Projection',
    shortName: 'Planar NNLS Vectors',
    stage: 2,
    stageLabel: 'Clustering & Projection',
    docSlug: 'stage-2-clustering',
    strategyDocPath: '/docs/strategies/nnls-simplex-embeddings',
    factoryName: 'createEmbeddingClusteringStrategy',
    requiresTags: false,
    summary:
      'Spherical/L2 k-Means++ with closed-form non-negative least-squares projection onto planar triangles.',
  },
  'pam-medoid-similarity': {
    id: 'pam-medoid-similarity',
    name: 'Pairwise k-Medoids Projection',
    shortName: 'Pairwise k-Medoids',
    stage: 2,
    stageLabel: 'Clustering & Projection',
    docSlug: 'stage-2-clustering',
    strategyDocPath: '/docs/strategies/pam-medoid-similarity',
    factoryName: 'createSimilarityClusteringStrategy',
    requiresTags: false,
    summary:
      'Partitions arbitrary S(a, b) ∈ [0, 1] similarity kernels via PAM k-Medoids and QAP mesh embedding.',
  },

  // Stage 3: Perceptual Color
  'oklab-edge-contrast': {
    id: 'oklab-edge-contrast',
    name: 'OKLab Edge Contrast',
    shortName: 'OKLab Contrast',
    stage: 3,
    stageLabel: 'OKLab Color Science',
    docSlug: 'stage-3-color',
    strategyDocPath: '/docs/strategies/oklab-edge-contrast',
    factoryName: 'createOklabContrastColorStrategy',
    isDefault: true,
    summary:
      'Maximizes perceptual ΔE_OK across mesh edges and preserves chroma on barycentric bridge items.',
  },
  'theme-adaptive-oklab': {
    id: 'theme-adaptive-oklab',
    name: 'Theme-Adaptive OKLab',
    shortName: 'Theme-Adaptive OKLab',
    stage: 3,
    stageLabel: 'OKLab Color Science',
    docSlug: 'stage-3-color',
    strategyDocPath: '/docs/strategies/theme-adaptive-oklab',
    factoryName: 'createThemeAdaptiveOklabColorStrategy',
    summary:
      'Adjusts perceptual lightness and chroma automatically between light and dark themes.',
  },
  'custom-brand-palette': {
    id: 'custom-brand-palette',
    name: 'Custom Brand Palette',
    shortName: 'Brand Palette',
    stage: 3,
    stageLabel: 'OKLab Color Science',
    docSlug: 'stage-3-color',
    strategyDocPath: '/docs/strategies/custom-brand-palette',
    factoryName: 'createPaletteColorStrategy',
    summary:
      'Maps custom design-system hex colors onto the mesh with edge-contrast optimization.',
  },

  // Stage 4: Collision Layout
  'collision-local-layout': {
    id: 'collision-local-layout',
    name: 'Collision-Local Pocket Layout',
    shortName: 'Collision-Local Layout',
    stage: 4,
    stageLabel: 'Composable Layout',
    docSlug: 'stage-4-layout',
    strategyDocPath: '/docs/strategies/collision-local-layout',
    factoryName: 'createCollisionDrivenLayoutStrategy',
    summary:
      'Keeps sparse regions at full 1.0x scale and shrinks only locally colliding pockets to 0.0 px overlap.',
  },
  'pbd-uniform-layout': {
    id: 'pbd-uniform-layout',
    name: 'Uniform PBD Layout',
    shortName: 'Uniform PBD',
    stage: 4,
    stageLabel: 'Composable Layout',
    docSlug: 'stage-4-layout',
    strategyDocPath: '/docs/strategies/pbd-uniform-layout',
    factoryName: 'createPbdUniformLayoutStrategy',
    isDefault: true,
    summary:
      'Space-filling mesh-inward fan seeding with global uniform scale search and exact convex SAT separation.',
  },
  'warm-start-pbd-layout': {
    id: 'warm-start-pbd-layout',
    name: 'Warm-Start PBD Layout',
    shortName: 'Warm-Start PBD',
    stage: 4,
    stageLabel: 'Composable Layout',
    docSlug: 'stage-4-layout',
    strategyDocPath: '/docs/strategies/warm-start-pbd-layout',
    factoryName: 'createWarmStartPbdLayoutStrategy',
    summary:
      'Reuses settled coordinates across live mutations with space-filling PBD relaxation and uniform scale ratios.',
  },
  'density-adaptive-layout': {
    id: 'density-adaptive-layout',
    name: 'Density-Adaptive Layout',
    shortName: 'Density-Adaptive',
    stage: 4,
    stageLabel: 'Composable Layout',
    docSlug: 'stage-4-layout',
    strategyDocPath: '/docs/strategies/density-adaptive-layout',
    factoryName: 'createLocalAdaptiveLayoutStrategy',
    summary:
      'Disperses nodes into open triangle interiors, evaluates smooth radial crowd density, and polishes locally without global shrink.',
  },

  // Stage 5: Zoom & Drill-Down
  'subspace-recluster-zoom': {
    id: 'subspace-recluster-zoom',
    name: 'Subspace Re-Clustering Drill-Down',
    shortName: 'Subspace Re-Cluster',
    stage: 5,
    stageLabel: 'Conformal 1:4 Zoom',
    docSlug: 'stage-5-zoom',
    strategyDocPath: '/docs/strategies/subspace-recluster-zoom',
    factoryName: 'createSubspaceZoomStrategy',
    requiresTags: false,
    summary:
      'Projects out constant parent traits and re-clusters zoomed subsets locally over high-variance features, vectors, or similarities.',
  },
  'barycentric-subdivision-zoom': {
    id: 'barycentric-subdivision-zoom',
    name: 'Barycentric 1:4 Drill-Down',
    shortName: 'Barycentric 1:4',
    stage: 5,
    stageLabel: 'Conformal 1:4 Zoom',
    docSlug: 'stage-5-zoom',
    strategyDocPath: '/docs/strategies/barycentric-subdivision-zoom',
    factoryName: 'createBarycentricZoomStrategy',
    summary:
      'Purely geometric orientation-preserving 1:4 subdivision with Adaptive Contrast Stretch and explicit A ↔ B midpoint bridges.',
  },
  'semantic-tag-split-zoom': {
    id: 'semantic-tag-split-zoom',
    name: 'Semantic 3→6 Tag Drill-Down',
    shortName: 'Semantic 3→6 Tags',
    stage: 5,
    stageLabel: 'Conformal 1:4 Zoom',
    docSlug: 'stage-5-zoom',
    strategyDocPath: '/docs/strategies/semantic-tag-split-zoom',
    factoryName: 'createSemanticZoomStrategy',
    requiresTags: true,
    summary:
      'Promotes vertex-exclusive secondary tags across 6 collision-free sub-vertices with parent-corner context and A ↔ B bridge fallbacks.',
  },
  'free-camera-zoom': {
    id: 'free-camera-zoom',
    name: 'Continuous Free Camera',
    shortName: 'Free Camera',
    stage: 5,
    stageLabel: 'Conformal 1:4 Zoom',
    docSlug: 'stage-5-zoom',
    strategyDocPath: '/docs/strategies/free-camera-zoom',
    factoryName: 'createFreeCameraZoomStrategy',
    isDefault: true,
    summary:
      'Continuous cursor-centered wheel zoom, drag-to-pan, and two-finger touch pinch.',
  },
};

export function getStrategySpec(id: CanonicalStrategyId): CanonicalStrategySpec {
  return STRATEGY_REGISTRY[id];
}

export function getStrategiesByStage(
  stage: 1 | 2 | 3 | 4 | 5,
): readonly CanonicalStrategySpec[] {
  return ALL_STRATEGY_IDS.map((id) => STRATEGY_REGISTRY[id]).filter(
    (spec) => spec.stage === stage,
  );
}
