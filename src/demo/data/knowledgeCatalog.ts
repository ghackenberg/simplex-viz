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
  triangulation: { displayTitle: 'Triangulation', domainCategory: 'Geometrie', priorityWeight: 1.4 },
  geometry: { displayTitle: 'Computational Geometry', domainCategory: 'Geometrie', priorityWeight: 1.3 },
  'convex-hull': { displayTitle: 'Konvexe Hüllen', domainCategory: 'Geometrie', priorityWeight: 1.2 },
  sat: { displayTitle: 'SAT Kollision', domainCategory: 'Geometrie', priorityWeight: 1.1 },
  oklab: { displayTitle: 'OKLab Farbraum', domainCategory: 'Perzeption', priorityWeight: 1.35 },
  'color-science': { displayTitle: 'Farbmetrik', domainCategory: 'Perzeption', priorityWeight: 1.1 },
  svg: { displayTitle: 'SVG Szenengraph', domainCategory: 'Rendering', priorityWeight: 1.3 },
  shaders: { displayTitle: 'GLSL Shaders', domainCategory: 'Rendering', priorityWeight: 1.25 },
  webgl: { displayTitle: 'WebGL Pipeline', domainCategory: 'Rendering', priorityWeight: 1.2 },
  animation: { displayTitle: 'Feder-Animation', domainCategory: 'Motion', priorityWeight: 1.2 },
  springs: { displayTitle: 'Kritische Dämpfung', domainCategory: 'Motion', priorityWeight: 1.1 },
  typescript: { displayTitle: 'TypeScript', domainCategory: 'Sprachen', priorityWeight: 1.3 },
  react: { displayTitle: 'React 19', domainCategory: 'UI', priorityWeight: 1.25 },
  rust: { displayTitle: 'Rust', domainCategory: 'Systeme', priorityWeight: 1.3 },
  wasm: { displayTitle: 'WebAssembly', domainCategory: 'Systeme', priorityWeight: 1.2 },
  compilers: { displayTitle: 'Compilerbau', domainCategory: 'Sprachen', priorityWeight: 1.3 },
  ast: { displayTitle: 'AST Analyse', domainCategory: 'Sprachen', priorityWeight: 1.1 },
  crdt: { displayTitle: 'CRDT Sync', domainCategory: 'Verteilte Systeme', priorityWeight: 1.35 },
  consensus: { displayTitle: 'Konsens-Protokolle', domainCategory: 'Verteilte Systeme', priorityWeight: 1.25 },
  distributed: { displayTitle: 'Verteilte Systeme', domainCategory: 'Verteilte Systeme', priorityWeight: 1.2 },
  embeddings: { displayTitle: 'Vektor-Embeddings', domainCategory: 'ML', priorityWeight: 1.3 },
  clustering: { displayTitle: 'Topic Clustering', domainCategory: 'ML', priorityWeight: 1.35 },
  testing: { displayTitle: 'Invariants Testing', domainCategory: 'Qualität', priorityWeight: 1.15 },
  accessibility: { displayTitle: 'Barrierefreiheit', domainCategory: 'UI', priorityWeight: 1.15 },
  typography: { displayTitle: 'Typografie', domainCategory: 'UI', priorityWeight: 1.1 },
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
      'Gezahnte 60°-Simplex-Gitter für adaptive Viewports',
      'Delaunay- vs. Gitter-Triangulierung in InfoVis',
      'Baryzentrische Koordinaten auf gleichseitigen Dreiecken',
      'Planare Einbettung von Multi-Tag-Graphen',
      'Kantenlängen-Optimierung bei wechselnden Seitenverhältnissen',
    ],
  },
  {
    tags: ['convex-hull', 'sat', 'geometry'],
    templates: [
      'Andrew’s Monotone Chain in O(n log n)',
      'Separating Axis Theorem für konvexe Polygone',
      'Minimum Translation Vector ohne Flackern',
      'Uniform Spatial Hash Grids für 2D-Kollisionen',
      'Binärsuche über Skalierungsfaktoren mit PBD-Relaxation',
    ],
  },
  {
    tags: ['oklab', 'color-science'],
    templates: [
      'Perzeptuelle Farbmischung im OKLab-Farbraum',
      'Chroma-Erhaltung bei komplementären Themengewichten',
      'Simulated Annealing für maximale Kanten-Kontraste',
      'Gamut-Clamping von OKLCH nach sRGB',
      'Barrierefreie Kontrastwerte auf Obsidian-Flächen',
    ],
  },
  {
    tags: ['svg', 'animation', 'springs'],
    templates: [
      'Keyed DOM Reconciliation für 60-fps SVG-Graphen',
      'Kritisch gedämpfte Feder-Integratoren mit C1-Stetigkeit',
      'Dual-Layer Crossfade für beliebige SVG-Komponenten',
      'Parametrisches 64-Punkt-Pfad-Morphing',
      'Offscreen getBBox()-Vermessung für dynamische Text-Badges',
    ],
  },
  {
    tags: ['typescript', 'compilers', 'ast'],
    templates: [
      'Bedingte Hybrid-Accessors mit Conditional Types',
      'Ende-zu-Ende-Typsicherheit ohne Wrapper-Casts',
      'Type-Level Tests mit expectTypeOf in Vitest',
      'Inkrementelle AST-Transformationen in TypeScript',
      'Strikte Paketgrenzen über ESLint Flat Config',
    ],
  },
  {
    tags: ['react', 'svg', 'accessibility'],
    templates: [
      'Deklarative JSX-Mini-Cards im SVG-Szenengraph',
      'Zentrales Pointer-Hit-Testing auf Root-SVG-Ebene',
      'Tastatur-Navigation und Fokusringe für Graph-Knoten',
      'React 19 Portals vs. direkte Attribut-Updates',
      'Reduzierte Bewegung und barrierefreie Tooltips',
    ],
  },
  {
    tags: ['rust', 'wasm', 'geometry'],
    templates: [
      'Zero-Copy Geometry Buffer zwischen Rust und Wasm',
      'SIMD-beschleunigte Vektor-Normen im Browser',
      'Deterministische PRNGs für reproduzierbare Layouts',
      'Speichersichere Spatial-Index-Strukturen in Rust',
      'WebAssembly Threads für dichte Punktwolken',
    ],
  },
  {
    tags: ['shaders', 'webgl', 'oklab'],
    templates: [
      'Signed Distance Fields für scharfe Vektor-Glyphen',
      'OKLab-Interpolation direkt im Fragment-Shader',
      'Instanced Rendering tausender konvexer Hüllen',
      'Anti-Aliasing mit fwidth() in WebGL2',
      'Nahtlose Übergänge zwischen SVG und Canvas/WebGL',
    ],
  },
  {
    tags: ['crdt', 'consensus', 'distributed'],
    templates: [
      'Konfliktfreie Replikation von Tag-Sammlungen',
      'Byzantinische Fehlertoleranz in Edge-Netzen',
      'Kausale Zustandsvektoren für Echtzeit-Kollaboration',
      'Raft-Log-Kompaktierung unter hoher Last',
      'Deterministisches Merging verteilter Metadaten',
    ],
  },
  {
    tags: ['embeddings', 'clustering', 'triangulation'],
    templates: [
      'Zweistufiges Themen-Clustering mit minimaler Überlappung',
      'Regularisierter Jaccard-Index für Tag-Co-Occurrence',
      'QAP-Gittereinbettung per Simulated Annealing',
      'Weighted Hitting-Set zur planaren Dreiecksabdeckung',
      'Ungarisches Bipartite Matching für stabile Cluster-UIDs',
    ],
  },
  {
    tags: ['testing', 'typescript', 'sat'],
    templates: [
      'Geometrische Invarianten-Tests für Null-Überlappung',
      'Deterministisches getBBox()-Mocking in happy-dom',
      'Property-Based Testing für konvexe Hüllen',
      'Publint-Prüfung für Tree-Shakeable ESM-Pakete',
      'Continuous Benchmarking der Solver-Konvergenz',
    ],
  },
  {
    tags: ['typography', 'svg', 'color-science'],
    templates: [
      'Tabellarische Monospace-Ziffern in Live-Telemetrie',
      'Optische Kompensation von Schrift auf dunklen Flächen',
      'Dynamische Text-Umbrüche in SVG-Badge-Komponenten',
      'Hierarchische Informationsdichte ohne Pill-Clutter',
      'Kontraststarke Farbpaletten für wissenschaftliche UIs',
    ],
  },
  // Cross-cluster bridge items (2 or 3 tags spanning topics!)
  {
    tags: ['triangulation', 'clustering', 'oklab'],
    templates: [
      'Baryzentrische Farbmischung entlang von Gitterkanten',
      'Explaining-Away auf kleinsten planaren Einheiten',
      'Stabilität der Cluster-Farben bei Live-Mutationen',
    ],
  },
  {
    tags: ['react', 'animation', 'typescript'],
    templates: [
      'Unterbrechbare React-Zustandswechsel ohne Sprünge',
      'Generische Hooks für imperative Graph-Controller',
      'Crossfade-Orchestrierung bei Live-Plugin-Wechsel',
    ],
  },
  {
    tags: ['webgl', 'geometry', 'rust'],
    templates: [
      'Portierung des SAT-Solvers auf WebGL & Wasm',
      'Parallele Hüllenberechnung für 5.000+ Knoten',
      'GPU-basierte Broad-Phase-Kollisionserkennung',
    ],
  },
];

const TYPES: readonly KnowledgeEntry['contentType'][] = ['article', 'video', 'project'];

/**
 * Generates an initial corpus of 126 realistic, interconnected `KnowledgeEntry` items.
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
          headline: pass === 0 ? baseTitle : `${baseTitle} (Praxisstudie ${seq})`,
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
    headline: `${labelA} × ${labelB} Analyse #${seq}`,
    hashtags,
    contentType,
    readingMinutes: 5 + (seq % 19),
    publishedYear: 2026,
  };
}
