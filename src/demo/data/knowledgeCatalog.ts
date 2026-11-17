import type { ClusterDerivationContext } from '@simplex-viz/core';
import arxivPapersJson from './open/arxiv-papers.json';

export interface KnowledgeEntry {
  readonly slug: string;
  readonly headline: string;
  readonly hashtags: readonly string[];
  readonly contentType: 'article' | 'video' | 'project';
  readonly readingMinutes: number;
  readonly publishedYear: number;
  readonly primaryAuthor?: string;
  readonly arxivId?: string;
  readonly repoName?: string;
  readonly repoStarsLabel?: string;
  readonly repoStars?: number;
  readonly repoLanguage?: string;
  readonly repoDescription?: string;
  readonly repoUrl?: string;
}

export interface TagTaxonomyInfo {
  readonly displayTitle: string;
  readonly domainCategory: string;
  readonly priorityWeight: number;
}

export interface TopicClusterSummary {
  readonly title: string;
  readonly memberCount: number;
  readonly exclusiveCount: number;
  readonly avgReadingMinutes: number;
  readonly dominantType: KnowledgeEntry['contentType'];
}

export const TAG_TAXONOMY: Record<string, TagTaxonomyInfo> = {
  // Real arXiv Computer Science & Mathematics Subject Classifications
  'cs.CG': { displayTitle: 'Comp. Geometry', domainCategory: 'Geometry', priorityWeight: 1.45 },
  'cs.GR': { displayTitle: 'Graphics', domainCategory: 'Graphics', priorityWeight: 1.4 },
  'cs.HC': { displayTitle: 'HCI', domainCategory: 'HCI & Vis', priorityWeight: 1.38 },
  'cs.LG': { displayTitle: 'Machine Learning', domainCategory: 'AI & ML', priorityWeight: 1.32 },
  'cs.CV': { displayTitle: 'Computer Vision', domainCategory: 'Vision', priorityWeight: 1.3 },
  'cs.DS': { displayTitle: 'Algorithms', domainCategory: 'Theory', priorityWeight: 1.35 },
  'cs.PL': { displayTitle: 'Prog. Languages', domainCategory: 'Systems', priorityWeight: 1.35 },
  'cs.DC': { displayTitle: 'Distributed Sys.', domainCategory: 'Systems', priorityWeight: 1.3 },
  'cs.AI': { displayTitle: 'AI', domainCategory: 'AI & ML', priorityWeight: 1.25 },
  'cs.IR': { displayTitle: 'Info. Retrieval', domainCategory: 'HCI & Vis', priorityWeight: 1.28 },
  'stat.ML': { displayTitle: 'Stat. Learning', domainCategory: 'AI & ML', priorityWeight: 1.28 },
  'math.MG': { displayTitle: 'Metric Geometry', domainCategory: 'Geometry', priorityWeight: 1.36 },
  'math.OC': { displayTitle: 'Optimization', domainCategory: 'Theory', priorityWeight: 1.26 },

  // Real GitHub Open-Source Visualization & Graphics Topics
  'data-visualization': { displayTitle: 'Data Vis', domainCategory: 'Vis', priorityWeight: 1.35 },
  visualization: { displayTitle: 'Visualization', domainCategory: 'Vis', priorityWeight: 1.25 },
  dataviz: { displayTitle: 'DataViz', domainCategory: 'Vis', priorityWeight: 1.25 },
  d3: { displayTitle: 'D3.js', domainCategory: 'Libraries', priorityWeight: 1.38 },
  charts: { displayTitle: 'Charts', domainCategory: 'Vis', priorityWeight: 1.3 },
  plotting: { displayTitle: 'Plotting', domainCategory: 'Vis', priorityWeight: 1.28 },
  graph: { displayTitle: 'Graphs', domainCategory: 'Topology', priorityWeight: 1.4 },
  'network-analysis': { displayTitle: 'Networks', domainCategory: 'Topology', priorityWeight: 1.35 },
  diagrams: { displayTitle: 'Diagrams', domainCategory: 'Topology', priorityWeight: 1.28 },
  webgl: { displayTitle: 'WebGL', domainCategory: 'Rendering', priorityWeight: 1.4 },
  threejs: { displayTitle: 'Three.js', domainCategory: 'Rendering', priorityWeight: 1.35 },
  canvas: { displayTitle: 'Canvas', domainCategory: 'Rendering', priorityWeight: 1.3 },
  svg: { displayTitle: 'SVG', domainCategory: 'Rendering', priorityWeight: 1.35 },
  geometry: { displayTitle: 'Geometry', domainCategory: 'Geometry', priorityWeight: 1.35 },
  typescript: { displayTitle: 'TypeScript', domainCategory: 'Languages', priorityWeight: 1.3 },
  javascript: { displayTitle: 'JavaScript', domainCategory: 'Languages', priorityWeight: 1.18 },
  react: { displayTitle: 'React', domainCategory: 'UI', priorityWeight: 1.28 },
  rust: { displayTitle: 'Rust', domainCategory: 'Systems', priorityWeight: 1.32 },
  wasm: { displayTitle: 'WebAssembly', domainCategory: 'Systems', priorityWeight: 1.28 },
  animation: { displayTitle: 'Animation', domainCategory: 'Motion', priorityWeight: 1.25 },
  color: { displayTitle: 'Color Spaces', domainCategory: 'Perception', priorityWeight: 1.28 },
  'machine-learning': { displayTitle: 'Machine Learning', domainCategory: 'ML', priorityWeight: 1.3 },
  clustering: { displayTitle: 'Clustering', domainCategory: 'ML', priorityWeight: 1.35 },

  // Sandbox & Playground Tags
  triangulation: { displayTitle: 'Triangulation', domainCategory: 'Geometry', priorityWeight: 1.4 },
  'convex-hull': { displayTitle: 'Convex Hulls', domainCategory: 'Geometry', priorityWeight: 1.2 },
  sat: { displayTitle: 'SAT Collision', domainCategory: 'Geometry', priorityWeight: 1.1 },
  oklab: { displayTitle: 'OKLab', domainCategory: 'Perception', priorityWeight: 1.35 },
  'color-science': { displayTitle: 'Color Science', domainCategory: 'Perception', priorityWeight: 1.1 },
  shaders: { displayTitle: 'Shaders', domainCategory: 'Rendering', priorityWeight: 1.25 },
  springs: { displayTitle: 'Spring Physics', domainCategory: 'Motion', priorityWeight: 1.1 },
  compilers: { displayTitle: 'Compilers', domainCategory: 'Languages', priorityWeight: 1.3 },
  ast: { displayTitle: 'AST', domainCategory: 'Languages', priorityWeight: 1.1 },
  crdt: { displayTitle: 'CRDT', domainCategory: 'Distributed Systems', priorityWeight: 1.35 },
  consensus: { displayTitle: 'Consensus', domainCategory: 'Distributed Systems', priorityWeight: 1.25 },
  distributed: { displayTitle: 'Distributed', domainCategory: 'Distributed Systems', priorityWeight: 1.2 },
  embeddings: { displayTitle: 'Embeddings', domainCategory: 'ML', priorityWeight: 1.3 },
  testing: { displayTitle: 'Testing', domainCategory: 'Quality', priorityWeight: 1.15 },
  accessibility: { displayTitle: 'Accessibility', domainCategory: 'UI', priorityWeight: 1.15 },
  typography: { displayTitle: 'Typography', domainCategory: 'UI', priorityWeight: 1.1 },
};

export function resolveDemoTagMeta(tag: string): TagTaxonomyInfo | undefined {
  return TAG_TAXONOMY[tag] ?? TAG_TAXONOMY[tag.toLowerCase()];
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
  const title = primaryTag
    ? (primaryTag.meta?.displayTitle ?? primaryTag.tag)
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

/**
 * Loads the real cross-disciplinary arXiv Computer Science & Geometry paper dataset.
 */
export function buildInitialKnowledgeCatalog(): readonly KnowledgeEntry[] {
  return arxivPapersJson.map((paper, idx) => ({
    slug: paper.id,
    headline: paper.title,
    hashtags: paper.categories,
    contentType: 'article' as const,
    readingMinutes: 10 + ((idx * 5 + paper.title.length) % 18),
    publishedYear: paper.publishedYear,
    primaryAuthor: paper.primaryAuthor,
    arxivId: paper.arxivId,
  }));
}
