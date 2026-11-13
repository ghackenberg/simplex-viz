import type { ClusterDerivationContext } from '@simplex-viz/core';

/**
 * Custom domain content item intentionally using `slug` & `hashtags` instead of `id` & `tags`
 * to prove compile-time enforcement of `ItemIdentityConfig<KnowledgeEntry>`.
 */
export interface KnowledgeEntry {
  readonly slug: string;
  readonly headline: string;
  readonly hashtags: readonly string[];
  readonly contentType: 'article' | 'video' | 'project';
  readonly readingMinutes: number;
  readonly publishedYear: number;
}

/**
 * Custom domain metadata for normalized tags (`TTagMeta`).
 */
export interface TagTaxonomyInfo {
  readonly displayTitle: string;
  readonly domainCategory: string;
  readonly priorityWeight: number;
}

/**
 * Custom derived metadata computed once per cluster update (`TClusterMeta`).
 */
export interface TopicClusterSummary {
  readonly title: string;
  readonly memberCount: number;
  readonly exclusiveCount: number;
  readonly avgReadingMinutes: number;
  readonly dominantType: KnowledgeEntry['contentType'];
}

export const TAG_TAXONOMY: Record<string, TagTaxonomyInfo> = {
  triangulation: { displayTitle: 'Triangulation', domainCategory: 'Geometry', priorityWeight: 1.4 },
  geometry: { displayTitle: 'Computational Geometry', domainCategory: 'Geometry', priorityWeight: 1.3 },
  'convex-hull': { displayTitle: 'Convex Hulls', domainCategory: 'Geometry', priorityWeight: 1.2 },
  sat: { displayTitle: 'SAT Collision', domainCategory: 'Geometry', priorityWeight: 1.1 },
  oklab: { displayTitle: 'OKLab Color Space', domainCategory: 'Perception', priorityWeight: 1.35 },
  'color-science': { displayTitle: 'Color Science', domainCategory: 'Perception', priorityWeight: 1.1 },
  svg: { displayTitle: 'SVG Scene Graph', domainCategory: 'Rendering', priorityWeight: 1.3 },
  shaders: { displayTitle: 'GLSL Shaders', domainCategory: 'Rendering', priorityWeight: 1.25 },
  webgl: { displayTitle: 'WebGL Pipeline', domainCategory: 'Rendering', priorityWeight: 1.2 },
  animation: { displayTitle: 'Spring Animation', domainCategory: 'Motion', priorityWeight: 1.2 },
  springs: { displayTitle: 'Critical Damping', domainCategory: 'Motion', priorityWeight: 1.1 },
  typescript: { displayTitle: 'TypeScript', domainCategory: 'Languages', priorityWeight: 1.3 },
  react: { displayTitle: 'React 19', domainCategory: 'UI', priorityWeight: 1.25 },
  rust: { displayTitle: 'Rust', domainCategory: 'Systems', priorityWeight: 1.3 },
  wasm: { displayTitle: 'WebAssembly', domainCategory: 'Systems', priorityWeight: 1.2 },
  compilers: { displayTitle: 'Compiler Design', domainCategory: 'Languages', priorityWeight: 1.3 },
  ast: { displayTitle: 'AST Analysis', domainCategory: 'Languages', priorityWeight: 1.1 },
  crdt: { displayTitle: 'CRDT Sync', domainCategory: 'Distributed Systems', priorityWeight: 1.35 },
  consensus: { displayTitle: 'Consensus Protocols', domainCategory: 'Distributed Systems', priorityWeight: 1.25 },
  distributed: { displayTitle: 'Distributed Systems', domainCategory: 'Distributed Systems', priorityWeight: 1.2 },
  embeddings: { displayTitle: 'Vector Embeddings', domainCategory: 'ML', priorityWeight: 1.3 },
  clustering: { displayTitle: 'Topic Clustering', domainCategory: 'ML', priorityWeight: 1.35 },
  testing: { displayTitle: 'Invariant Testing', domainCategory: 'Quality', priorityWeight: 1.15 },
  accessibility: { displayTitle: 'Accessibility', domainCategory: 'UI', priorityWeight: 1.15 },
  typography: { displayTitle: 'Typography', domainCategory: 'UI', priorityWeight: 1.1 },
};

export function resolveDemoTagMeta(tag: string): TagTaxonomyInfo | undefined {
  return TAG_TAXONOMY[tag];
}

export function deriveDemoClusterMeta(
  ctx: ClusterDerivationContext<KnowledgeEntry, TagTaxonomyInfo>,
): TopicClusterSummary {
  const sortedTags = [...ctx.coreTags].sort((a, b) => {
    const wa = (a.meta?.priorityWeight ?? 1) * a.frequency;
    const wb = (b.meta?.priorityWeight ?? 1) * b.frequency;
    return wb - wa;
  });

  const primaryTag = sortedTags[0];
  const secondaryTag = sortedTags[1];
  const title = primaryTag
    ? secondaryTag
      ? `${primaryTag.meta?.displayTitle ?? primaryTag.tag} & ${secondaryTag.meta?.displayTitle ?? secondaryTag.tag}`
      : (primaryTag.meta?.displayTitle ?? primaryTag.tag)
    : ctx.defaultLabel;

  const memberCount = ctx.members.length;
  const exclusiveCount = ctx.members.filter((m) => m.isExclusiveVertexMember).length;
  const totalMinutes = ctx.members.reduce((sum, m) => sum + m.item.readingMinutes, 0);
  const avgReadingMinutes = memberCount > 0 ? totalMinutes / memberCount : 0;

  const typeCounts: Record<KnowledgeEntry['contentType'], number> = {
    article: 0,
    video: 0,
    project: 0,
  };
  for (const m of ctx.members) {
    typeCounts[m.item.contentType] += 1;
  }

  let dominantType: KnowledgeEntry['contentType'] = 'article';
  if (typeCounts.video > typeCounts[dominantType]) dominantType = 'video';
  if (typeCounts.project > typeCounts[dominantType]) dominantType = 'project';

  return {
    title,
    memberCount,
    exclusiveCount,
    avgReadingMinutes,
    dominantType,
  };
}

interface SeedTopic {
  readonly tags: readonly string[];
  readonly templates: readonly string[];
}

const SEED_TOPICS: readonly SeedTopic[] = [
  {
    tags: ['triangulation', 'geometry'],
    templates: [
      'Toothed 60° Simplex Grids for Adaptive Viewports',
      'Delaunay vs. Regular Mesh Triangulation in InfoVis',
      'Barycentric Coordinates on Equilateral Triangles',
      'Planar Embedding of Multi-Tag Content Graphs',
      'Edge-Length Optimization Under Shifting Aspect Ratios',
    ],
  },
  {
    tags: ['convex-hull', 'sat', 'geometry'],
    templates: [
      'Andrew’s Monotone Chain in O(n log n)',
      'Separating Axis Theorem for Convex Polygons',
      'Jitter-Free Minimum Translation Vectors',
      'Uniform Spatial Hash Grids for 2D Collisions',
      'Binary Search Over Scale Factors with PBD Relaxation',
    ],
  },
  {
    tags: ['oklab', 'color-science'],
    templates: [
      'Perceptual Color Mixing in OKLab Space',
      'Chroma Preservation for Complementary Topic Weights',
      'Simulated Annealing for Maximum Edge Contrast',
      'Gamut Clamping from OKLCH to sRGB',
      'Accessible Contrast Ratios on Obsidian Surfaces',
    ],
  },
  {
    tags: ['svg', 'animation', 'springs'],
    templates: [
      'Keyed DOM Reconciliation for 60-fps SVG Graphs',
      'Critically Damped Spring Integrators with C1 Continuity',
      'Dual-Layer Crossfading for Arbitrary SVG Views',
      'Parametric 64-Point SVG Path Morphing',
      'Offscreen getBBox() Measurement for Dynamic Badges',
    ],
  },
  {
    tags: ['typescript', 'compilers', 'ast'],
    templates: [
      'Conditional Hybrid Accessors with Conditional Types',
      'End-to-End Type Safety Without Wrapper Casts',
      'Type-Level Assertions with expectTypeOf in Vitest',
      'Incremental AST Transformations in TypeScript',
      'Strict Package Boundaries via ESLint Flat Config',
    ],
  },
  {
    tags: ['react', 'svg', 'accessibility'],
    templates: [
      'Declarative JSX Mini-Cards in an SVG Scene Graph',
      'Centralized Pointer Hit-Testing at the Root SVG Level',
      'Keyboard Navigation and Focus Rings for Graph Nodes',
      'React 19 Portals vs. Direct Attribute Updates',
      'Reduced Motion and Accessible Graph Tooltips',
    ],
  },
  {
    tags: ['rust', 'wasm', 'geometry'],
    templates: [
      'Zero-Copy Geometry Buffers Between Rust and Wasm',
      'SIMD-Accelerated Vector Norms in the Browser',
      'Deterministic PRNGs for Reproducible Layouts',
      'Memory-Safe Spatial Index Structures in Rust',
      'WebAssembly Threads for Dense Point Clouds',
    ],
  },
  {
    tags: ['shaders', 'webgl', 'oklab'],
    templates: [
      'Signed Distance Fields for Crisp Vector Glyphs',
      'Direct OKLab Interpolation Inside Fragment Shaders',
      'Instanced Rendering of Thousands of Convex Hulls',
      'Screen-Space Anti-Aliasing with fwidth() in WebGL2',
      'Seamless Transitions Between SVG and Canvas/WebGL',
    ],
  },
  {
    tags: ['crdt', 'consensus', 'distributed'],
    templates: [
      'Conflict-Free Replication of Tagged Collections',
      'Byzantine Fault Tolerance in Edge Networks',
      'Causal State Vectors for Real-Time Collaboration',
      'Raft Log Compaction Under High Write Load',
      'Deterministic Merging of Distributed Metadata',
    ],
  },
  {
    tags: ['embeddings', 'clustering', 'triangulation'],
    templates: [
      'Two-Stage Topic Clustering with Minimal Overlap',
      'Regularized Jaccard Similarity for Tag Co-Occurrence',
      'QAP Mesh Embedding via Simulated Annealing',
      'Weighted Hitting Set for Planar Triangle Coverage',
      'Hungarian Bipartite Matching for Stable Cluster UIDs',
    ],
  },
  {
    tags: ['testing', 'typescript', 'sat'],
    templates: [
      'Geometric Invariant Tests for Zero Overlap',
      'Deterministic getBBox() Mocking in happy-dom',
      'Property-Based Testing for Convex Hulls',
      'Publint Verification for Tree-Shakeable ESM Packages',
      'Continuous Benchmarking of Solver Convergence',
    ],
  },
  {
    tags: ['typography', 'svg', 'color-science'],
    templates: [
      'Tabular Monospace Numerals in Live Telemetry',
      'Optical Weight Compensation on Dark Surfaces',
      'Dynamic Text Wrapping in SVG Badge Components',
      'Hierarchical Information Density Without Pill Clutter',
      'High-Contrast Palettes for Scientific Interfaces',
    ],
  },
  // Cross-cluster bridge items (2 or 3 tags spanning topics!)
  {
    tags: ['triangulation', 'clustering', 'oklab'],
    templates: [
      'Barycentric Color Blending Along Mesh Edges',
      'Explaining-Away on Minimal Planar Simplex Units',
      'Cluster Color Stability Across Live Mutations',
    ],
  },
  {
    tags: ['react', 'animation', 'typescript'],
    templates: [
      'Interruptible React State Transitions Without Jumps',
      'Generic Hooks for Imperative Graph Controllers',
      'Crossfade Orchestration During Live Plugin Swaps',
    ],
  },
  {
    tags: ['webgl', 'geometry', 'rust'],
    templates: [
      'Porting the SAT Solver to WebGL & WebAssembly',
      'Parallel Convex Hull Computation for 5,000+ Nodes',
      'GPU-Accelerated Broad-Phase Collision Detection',
    ],
  },
];

const TYPES: readonly KnowledgeEntry['contentType'][] = ['article', 'video', 'project'];

/**
 * Generates an initial corpus of ~126 realistic, interconnected `KnowledgeEntry` items.
 */
export function buildInitialKnowledgeCatalog(): readonly KnowledgeEntry[] {
  const entries: KnowledgeEntry[] = [];
  let seq = 1;

  // 2 passes with slight cross-tag variations to produce ~126 distinct entries
  for (let pass = 0; pass < 2; pass++) {
    for (const topic of SEED_TOPICS) {
      for (let i = 0; i < topic.templates.length; i++) {
        const baseTitle = topic.templates[i]!;
        const extraTag =
          pass === 1
            ? Object.keys(TAG_TAXONOMY)[(seq * 5 + i) % Object.keys(TAG_TAXONOMY).length]!
            : null;
        const hashtags = extraTag && !topic.tags.includes(extraTag)
          ? [...topic.tags, extraTag]
          : [...topic.tags];

        const contentType = TYPES[(seq + pass + i) % TYPES.length]!;
        const readingMinutes = 4 + ((seq * 7 + i * 3) % 24);
        const publishedYear = 2024 + (seq % 3);

        entries.push({
          slug: `entry-${String(seq).padStart(3, '0')}`,
          headline: pass === 0 ? baseTitle : `${baseTitle} (Case Study ${seq})`,
          hashtags,
          contentType,
          readingMinutes,
          publishedYear,
        });
        seq++;
      }
    }
  }

  return entries;
}

const ALL_TAGS = Object.keys(TAG_TAXONOMY);

/**
 * Deterministically creates a fresh synthetic `KnowledgeEntry` for live mutation buttons & stress tests.
 */
export function createDynamicEntry(seq: number): KnowledgeEntry {
  const tagA = ALL_TAGS[seq % ALL_TAGS.length]!;
  const tagB = ALL_TAGS[(seq * 7 + 3) % ALL_TAGS.length]!;
  const tagC = seq % 3 === 0 ? ALL_TAGS[(seq * 11 + 5) % ALL_TAGS.length]! : null;
  const hashtags = Array.from(
    new Set(tagC ? [tagA, tagB, tagC] : [tagA, tagB]),
  );
  const contentType = TYPES[seq % TYPES.length]!;
  const labelA = TAG_TAXONOMY[tagA]?.displayTitle ?? tagA;
  const labelB = TAG_TAXONOMY[tagB]?.displayTitle ?? tagB;

  return {
    slug: `live-${seq}-${Date.now().toString(36).slice(-4)}`,
    headline: `${labelA} × ${labelB} Analysis #${seq}`,
    hashtags,
    contentType,
    readingMinutes: 5 + (seq % 19),
    publishedYear: 2026,
  };
}
