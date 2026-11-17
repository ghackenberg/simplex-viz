import {
  disambiguatePeerClusterTitle,
  resolveDiscriminativeClusterLabel,
  type ClusterDerivationContext,
  type SubspaceZoomFeature,
} from '@simplex-viz/core';
import {
  buildInitialKnowledgeCatalog,
  deriveDemoClusterMeta,
  resolveDemoTagMeta,
  type KnowledgeEntry,
  type TagTaxonomyInfo,
} from './knowledgeCatalog';
import githubReposJson from './open/github-vis-repos.json';
import palmerPenguinsJson from './open/palmer-penguins.json';
import uciVowelsJson from './open/uci-vowels.json';
import uciZooJson from './open/uci-zoo.json';
import vegaMoviesJson from './open/vega-movies.json';

export const DEMO_DATASET_IDS = [
  'knowledge',
  'github-repos',
  'media',
  'voice',
  'zoo-species',
  'body-shape',
] as const;

export type DemoDatasetId = (typeof DEMO_DATASET_IDS)[number];

export interface OpenDatasetSourceInfo {
  readonly datasetId: DemoDatasetId;
  readonly sourceName: string;
  readonly sourceShort: string;
  readonly sourceUrl: string;
  readonly license: string;
  readonly attribution: string;
}

export const OPEN_DATASET_SOURCES: Record<DemoDatasetId, OpenDatasetSourceInfo> = {
  knowledge: {
    datasetId: 'knowledge',
    sourceName: 'arXiv.org Open-Access Archive',
    sourceShort: 'arXiv.org',
    sourceUrl: 'https://info.arxiv.org/help/api/index.html',
    license: 'CC0 1.0 (Metadata)',
    attribution: 'Cornell University arXiv e-Print Archive (CS & Geometry)',
  },
  'github-repos': {
    datasetId: 'github-repos',
    sourceName: 'GitHub Public Repository Index',
    sourceShort: 'GitHub API',
    sourceUrl: 'https://docs.github.com/en/rest/search/search',
    license: 'Public Metadata',
    attribution: 'Open-Source Visualization, WebGL & Graph Libraries on GitHub',
  },
  media: {
    datasetId: 'media',
    sourceName: 'Vega Datasets — Cinema Catalog (movies.json)',
    sourceShort: 'Vega Datasets',
    sourceUrl: 'https://github.com/vega/vega-datasets/blob/main/data/movies.json',
    license: 'BSD-3-Clause',
    attribution: 'UW Interactive Data Lab / Vega Project',
  },
  voice: {
    datasetId: 'voice',
    sourceName: 'UCI ML Repository — Deterding Spoken Vowel Context',
    sourceShort: 'UCI ML Repo',
    sourceUrl: 'https://archive.ics.uci.edu/dataset/108/connectionist+bench+vowel+recognition+deterding+data',
    license: 'CC BY 4.0',
    attribution: 'David Deterding, Mahesan Niranjan & Tony Robinson (Cambridge)',
  },
  'zoo-species': {
    datasetId: 'zoo-species',
    sourceName: 'UCI ML Repository — Zoo Animal Morphology',
    sourceShort: 'UCI ML Repo',
    sourceUrl: 'https://archive.ics.uci.edu/dataset/111/zoo',
    license: 'CC BY 4.0',
    attribution: 'Richard S. Forsyth (101 Vertebrate & Invertebrate Species)',
  },
  'body-shape': {
    datasetId: 'body-shape',
    sourceName: 'Palmer Station Antarctica LTER (penguins.json)',
    sourceShort: 'Palmer LTER',
    sourceUrl: 'https://allisonhorst.github.io/palmerpenguins/',
    license: 'CC0 1.0',
    attribution: 'Dr. Kristen Gorman & Palmer Station Antarctica LTER',
  },
};

export interface CommonsMediaCredit {
  readonly localPath: string;
  readonly commonsFileUrl: string;
  readonly wikipediaUrl: string;
  readonly fileTitle: string;
  readonly author: string;
  readonly licenseShort: string;
  readonly licenseUrl: string;
}

export interface VisualMediaItem {
  readonly id: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly mediaKind: 'image' | 'video';
  readonly durationSec?: number;
  readonly aspectRatio: '16:9' | '4:3' | '1:1';
  readonly resolutionLabel: string;
  readonly motif: 'horizon' | 'architecture' | 'macro' | 'portrait' | 'kinetic' | 'abstract';
  readonly palette: readonly [string, string];
  readonly genre: string;
  readonly releaseYear: number;
  readonly mpaa: string;
  readonly runtimeMin: number;
  readonly imdbRating: number;
  readonly rottenTomatoes: number;
  readonly budgetMusd: number;
  readonly worldwideGrossMusd: number;
  /** 4D Audience & Critical Reception Vector: [imdbNorm, rtNorm, votesLog, criticAudienceBalance] */
  readonly semanticEmbedding: readonly number[];
  /** 4D Production & Box-Office Scale Vector: [budgetLog, grossLog, runtimeNorm, roiNorm] */
  readonly styleEmbedding: readonly number[];
  readonly mediaCredit: CommonsMediaCredit;
}

export interface VoiceSampleItem {
  readonly id: string;
  readonly title: string;
  readonly speakerProfile: string;
  readonly speakerName: string;
  readonly speakerSex: string;
  readonly exampleWord: string;
  readonly language: string;
  readonly pitchHz: number;
  readonly durationSec: number;
  /** Real 10D LPC log-area formant vector from Deterding UCI Vowel dataset */
  readonly voiceEmbedding: readonly number[];
  /** 10 normalized LPC envelope bars in [0.18, 0.98] for SVG capsule rendering */
  readonly waveform: readonly number[];
}

export interface BodyShapeItem {
  readonly id: string;
  readonly title: string;
  readonly archetype: string;
  readonly posture: 'upright' | 'dynamic' | 'athletic' | 'compact' | 'tall';
  readonly heightCm: number;
  readonly species: string;
  readonly island: string;
  readonly sex: string;
  readonly bodyMassG: number;
  readonly flipperLengthMm: number;
  readonly billLengthMm: number;
  readonly billDepthMm: number;
  /** Real 6D standardized morphometric vector from Palmer Penguins */
  readonly shapeEmbedding: readonly number[];
  readonly proportions: {
    readonly shoulderW: number;
    readonly waistW: number;
    readonly hipW: number;
    readonly torsoH: number;
    readonly legH: number;
    readonly leanDeg: number;
  };
}

export interface ZooSpeciesItem {
  readonly id: string;
  readonly speciesName: string;
  readonly title: string;
  readonly taxonomicGroup: string;
  readonly legs: number;
  readonly aquatic: boolean;
  readonly airborne: boolean;
  readonly predator: boolean;
  /** 16 normalized biological traits from UCI Zoo */
  readonly traits: readonly number[];
  readonly mediaCredit?: CommonsMediaCredit;
}

export type DemoEntity =
  | {
      readonly kind: 'knowledge';
      readonly id: string;
      readonly title: string;
      readonly subtitleMeta: string;
      readonly entry: KnowledgeEntry;
    }
  | {
      readonly kind: 'media';
      readonly id: string;
      readonly title: string;
      readonly subtitleMeta: string;
      readonly media: VisualMediaItem;
    }
  | {
      readonly kind: 'voice';
      readonly id: string;
      readonly title: string;
      readonly subtitleMeta: string;
      readonly voice: VoiceSampleItem;
    }
  | {
      readonly kind: 'zoo-species';
      readonly id: string;
      readonly title: string;
      readonly subtitleMeta: string;
      readonly zoo: ZooSpeciesItem;
    }
  | {
      readonly kind: 'body-shape';
      readonly id: string;
      readonly title: string;
      readonly subtitleMeta: string;
      readonly body: BodyShapeItem;
    };

export interface DemoClusterSummary {
  readonly title: string;
  readonly subtitle: string;
  readonly memberCount: number;
  readonly exclusiveCount: number;
  readonly cohesion?: number;
  readonly metricBadge: string;
  readonly avgReadingMinutes?: number;
  readonly dominantType: string;
  readonly isIntermediate?: boolean;
  readonly shortBridgeTag?: string;
  readonly parentContextLabel?: string;
}

const GENRE_MOTIF: Record<string, { motif: VisualMediaItem['motif']; palette: readonly [string, string] }> = {
  Action: { motif: 'kinetic', palette: ['#f97316', '#1e293b'] },
  Adventure: { motif: 'horizon', palette: ['#10b981', '#0f172a'] },
  Drama: { motif: 'portrait', palette: ['#f472b6', '#311042'] },
  Comedy: { motif: 'portrait', palette: ['#fbbf24', '#1f2937'] },
  'Thriller/Suspense': { motif: 'architecture', palette: ['#38bdf8', '#0f172a'] },
  Horror: { motif: 'macro', palette: ['#f43f5e', '#18181b'] },
  'Romantic Comedy': { motif: 'portrait', palette: ['#ec4899', '#1e1b4b'] },
  Musical: { motif: 'abstract', palette: ['#c084fc', '#2e1065'] },
  Western: { motif: 'horizon', palette: ['#f59e0b', '#451a03'] },
  'Black Comedy': { motif: 'abstract', palette: ['#2dd4bf', '#042f2e'] },
};

const SHORT_GENRE_MAP: Record<string, string> = {
  'Thriller/Suspense': 'Thriller',
  'Romantic Comedy': 'Rom-Com',
  'Black Comedy': 'Dark Comedy',
};

const MEDIA_PRIMARY_FEATURES: readonly SubspaceZoomFeature<DemoEntity>[] = [
  {
    id: 'gross',
    label: 'Worldwide Gross',
    weight: 1.2,
    getValue: (e) =>
      e.kind === 'media'
        ? Math.log10(Math.max(0.5, e.media.worldwideGrossMusd))
        : null,
    highLabel: 'Box-Office Hits',
    lowLabel: 'Modest Gross',
  },
  {
    id: 'budget',
    label: 'Production Budget',
    weight: 1.2,
    getValue: (e) =>
      e.kind === 'media'
        ? Math.log10(Math.max(0.1, e.media.budgetMusd))
        : null,
    highLabel: 'Big-Budget Epics',
    lowLabel: 'Low-Budget Cult',
  },
  {
    id: 'critics',
    label: 'Critics Score',
    weight: 1.15,
    getValue: (e) => (e.kind === 'media' ? e.media.rottenTomatoes : null),
    highLabel: 'Critic Classics',
    lowLabel: 'Crowd-Pleasers',
  },
  {
    id: 'imdb',
    label: 'Audience Rating',
    weight: 1.1,
    getValue: (e) => (e.kind === 'media' ? e.media.imdbRating : null),
    highLabel: 'Acclaimed Canon',
    lowLabel: 'Genre Curiosities',
  },
  {
    id: 'roi',
    label: 'Box-Office ROI',
    weight: 1.1,
    getValue: (e) =>
      e.kind === 'media'
        ? Math.log10(
            Math.max(
              0.2,
              e.media.worldwideGrossMusd / Math.max(0.1, e.media.budgetMusd),
            ),
          )
        : null,
    highLabel: 'Sleeper Hits',
    lowLabel: 'Roadshow Prestige',
  },
  {
    id: 'runtime',
    label: 'Runtime',
    weight: 1.08,
    getValue: (e) => (e.kind === 'media' ? e.media.runtimeMin : null),
    highLabel: 'Epic Runtime',
    lowLabel: 'Compact Classics',
  },
  {
    id: 'era',
    label: 'Release Era',
    weight: 1.0,
    getValue: (e) => (e.kind === 'media' ? e.media.releaseYear : null),
    highLabel: 'New Hollywood',
    lowLabel: 'Golden Age',
  },
  {
    id: 'genre',
    label: 'Genre',
    weight: 0.95,
    getValue: (e) =>
      e.kind === 'media'
        ? (SHORT_GENRE_MAP[e.media.genre] ?? e.media.genre)
        : null,
  },
];

const PENGUIN_PRIMARY_FEATURES: readonly SubspaceZoomFeature<DemoEntity>[] = [
  {
    id: 'species',
    label: 'Species',
    weight: 1.45,
    getValue: (e) =>
      e.kind === 'body-shape'
        ? e.body.species === 'Adelie'
          ? 'Adélie'
          : e.body.species
        : null,
  },
  {
    id: 'sex',
    label: 'Sex',
    weight: 1.15,
    getValue: (e) =>
      e.kind === 'body-shape' && (e.body.sex === 'Male' || e.body.sex === 'Female')
        ? e.body.sex
        : null,
  },
  {
    id: 'mass',
    label: 'Body Mass',
    weight: 1.12,
    getValue: (e) => (e.kind === 'body-shape' ? e.body.bodyMassG : null),
    highLabel: 'Heavy',
    lowLabel: 'Compact',
  },
  {
    id: 'island',
    label: 'Island',
    weight: 1.08,
    getValue: (e) => (e.kind === 'body-shape' ? e.body.island : null),
  },
  {
    id: 'billLength',
    label: 'Culmen Length',
    weight: 1.0,
    getValue: (e) => (e.kind === 'body-shape' ? e.body.billLengthMm : null),
    highLabel: 'Long Bill',
    lowLabel: 'Short Bill',
  },
  {
    id: 'billDepth',
    label: 'Culmen Depth',
    weight: 1.0,
    getValue: (e) => (e.kind === 'body-shape' ? e.body.billDepthMm : null),
    highLabel: 'Deep Bill',
    lowLabel: 'Slender Bill',
  },
  {
    id: 'flipper',
    label: 'Flipper Span',
    weight: 1.0,
    getValue: (e) => (e.kind === 'body-shape' ? e.body.flipperLengthMm : null),
    highLabel: 'Long Flipper',
    lowLabel: 'Short Flipper',
  },
];

const CATALOG_CACHE = new Map<DemoDatasetId, readonly DemoEntity[]>();

export function buildDemoCatalog(dataset: DemoDatasetId): readonly DemoEntity[] {
  const cached = CATALOG_CACHE.get(dataset);
  if (cached) return cached;

  let result: readonly DemoEntity[];

  if (dataset === 'knowledge') {
    result = buildInitialKnowledgeCatalog().map((entry) => ({
      kind: 'knowledge' as const,
      id: entry.slug,
      title: entry.headline,
      subtitleMeta: `arXiv:${entry.arxivId ?? ''} · ${entry.primaryAuthor ?? 'Author'} (${entry.publishedYear})`,
      entry,
    }));
  } else if (dataset === 'github-repos') {
    result = githubReposJson.map((repo) => {
      const starsCompact =
        repo.stars >= 10000
          ? `${Math.round(repo.stars / 1000)}k`
          : repo.stars >= 1000
            ? `${(repo.stars / 1000).toFixed(1)}k`
            : `${repo.stars}`;
      const starsK = `${starsCompact} ★`;
      const cleanDesc = repo.description
        .replace(/:[a-z0-9_+-]+:/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      const entry: KnowledgeEntry = {
        slug: repo.id,
        headline: repo.fullName,
        hashtags: repo.topics,
        contentType: 'project',
        readingMinutes: Math.max(4, Math.min(28, Math.round(Math.log2(Math.max(2, repo.stars))))),
        publishedYear: 2026,
        primaryAuthor: `${starsK} · ${repo.language}`,
        repoName: repo.name,
        repoStarsLabel: starsCompact,
        repoStars: repo.stars,
        repoLanguage: repo.language,
        repoDescription: cleanDesc,
        repoUrl: repo.url,
      };
      return {
        kind: 'knowledge' as const,
        id: repo.id,
        title: repo.fullName,
        subtitleMeta: `${starsK} · ${repo.language} · ${repo.topics.join(', ')}`,
        entry,
      };
    });
  } else if (dataset === 'media') {
    result = vegaMoviesJson.map((m) => {
      const styleMeta = GENRE_MOTIF[m.genre] ?? {
        motif: 'architecture' as const,
        palette: ['#06b6d4', '#0f172a'] as const,
      };
      const aspectRatio: VisualMediaItem['aspectRatio'] =
        m.runtimeMin >= 135 ? '16:9' : m.runtimeMin >= 105 ? '4:3' : '1:1';
      const item: VisualMediaItem = {
        id: m.id,
        title: `${m.title} (${m.releaseYear})`,
        shortTitle: m.shortTitle,
        mediaKind: m.budgetMusd >= 12 ? 'video' : 'image',
        durationSec: m.runtimeMin,
        aspectRatio,
        resolutionLabel: `IMDb ${m.imdbRating.toFixed(1)} · RT ${m.rottenTomatoes}%`,
        motif: styleMeta.motif,
        palette: styleMeta.palette,
        genre: m.genre,
        releaseYear: m.releaseYear,
        mpaa: m.mpaa,
        runtimeMin: m.runtimeMin,
        imdbRating: m.imdbRating,
        rottenTomatoes: m.rottenTomatoes,
        budgetMusd: m.budgetMusd,
        worldwideGrossMusd: m.worldwideGrossMusd,
        semanticEmbedding: m.receptionVector,
        styleEmbedding: m.productionVector,
        mediaCredit: m.mediaCredit,
      };
      return {
        kind: 'media' as const,
        id: m.id,
        title: item.title,
        subtitleMeta: `${m.genre} · IMDb ${m.imdbRating} · RT ${m.rottenTomatoes}% · $${m.worldwideGrossMusd}M gross`,
        media: item,
      };
    });
  } else if (dataset === 'voice') {
    result = uciVowelsJson.map((v) => {
      const estF0 =
        v.speakerSex === 'Female'
          ? Math.round(195 + (v.lpcVector[0] ?? 0.5) * 65)
          : Math.round(105 + (v.lpcVector[0] ?? 0.5) * 55);
      const item: VoiceSampleItem = {
        id: v.id,
        title: v.title,
        speakerProfile: `${v.speakerName} (${v.speakerSex})`,
        speakerName: v.speakerName,
        speakerSex: v.speakerSex,
        exampleWord: v.exampleWord,
        language: v.ipaSymbol,
        pitchHz: estF0,
        durationSec: 12,
        voiceEmbedding: v.lpcVector,
        waveform: v.envelopeBars,
      };
      return {
        kind: 'voice' as const,
        id: v.id,
        title: v.title,
        subtitleMeta: `Vowel ${v.ipaSymbol} ("${v.exampleWord}") · Speaker ${v.speakerName} (${v.speakerSex})`,
        voice: item,
      };
    });
  } else if (dataset === 'zoo-species') {
    result = uciZooJson.map((z) => ({
      kind: 'zoo-species' as const,
      id: z.id,
      title: z.title,
      subtitleMeta: `${z.taxonomicGroup} · ${z.legs} legs${z.aquatic ? ' · aquatic' : ''}${z.airborne ? ' · airborne' : ''}${z.predator ? ' · predator' : ''}`,
      zoo: z,
    }));
  } else {
    result = palmerPenguinsJson.map((p) => {
      const mv = p.morphVector;
      const posture: BodyShapeItem['posture'] =
        p.species === 'Gentoo'
          ? 'tall'
          : p.species === 'Chinstrap'
            ? 'dynamic'
            : 'compact';
      const formattedSex =
        p.sex === 'MALE' ? 'Male' : p.sex === 'FEMALE' ? 'Female' : p.sex;
      const item: BodyShapeItem = {
        id: p.id,
        title: p.title,
        archetype: `${p.species} · ${p.island}`,
        posture,
        heightCm: Math.round(p.flipperLengthMm / 10),
        species: p.species,
        island: p.island,
        sex: formattedSex,
        bodyMassG: p.bodyMassG,
        flipperLengthMm: p.flipperLengthMm,
        billLengthMm: p.billLengthMm,
        billDepthMm: p.billDepthMm,
        shapeEmbedding: mv,
        proportions: {
          shoulderW: Number((0.58 + (mv[2] ?? 0.5) * 0.38).toFixed(2)),
          waistW: Number((0.46 + (mv[3] ?? 0.5) * 0.42).toFixed(2)),
          hipW: Number((0.5 + (mv[3] ?? 0.5) * 0.38).toFixed(2)),
          torsoH: Number((0.72 + (mv[0] ?? 0.5) * 0.22).toFixed(2)),
          legH: Number((0.7 + (mv[2] ?? 0.5) * 0.28).toFixed(2)),
          leanDeg: p.species === 'Chinstrap' ? 8 : p.species === 'Gentoo' ? 2 : -2,
        },
      };
      return {
        kind: 'body-shape' as const,
        id: p.id,
        title: p.title,
        subtitleMeta: `${p.species} · ${p.island} · Bill ${p.billLengthMm}×${p.billDepthMm}mm · ${p.bodyMassG}g`,
        body: item,
      };
    });
  }

  CATALOG_CACHE.set(dataset, result);
  return result;
}

export function getDatasetItemCount(dataset: DemoDatasetId): number {
  return buildDemoCatalog(dataset).length;
}

export function getDatasetSourceInfo(dataset: DemoDatasetId): OpenDatasetSourceInfo {
  return OPEN_DATASET_SOURCES[dataset];
}

export function deriveDemoEntityClusterMeta(
  ctx: ClusterDerivationContext<DemoEntity, TagTaxonomyInfo>,
): DemoClusterSummary {
  if (ctx.role === 'intermediate') {
    const memberCount = ctx.members.length;
    const exclusiveCount = ctx.members.filter((m) => m.isExclusiveVertexMember).length;
    let shortBridgeTag = ctx.subclusterLabel ?? '';
    if (!shortBridgeTag && ctx.coreTags.length > 0) {
      const topBridge = ctx.coreTags[0]!;
      shortBridgeTag = topBridge.meta?.displayTitle ?? topBridge.tag;
    }
    if (!shortBridgeTag) {
      shortBridgeTag = ctx.defaultLabel || ctx.code;
    }
    const parentContextLabel = ctx.parentContextLabel;
    return {
      title: shortBridgeTag,
      subtitle: parentContextLabel
        ? `${parentContextLabel} · ${memberCount} ${memberCount === 1 ? 'item' : 'items'}`
        : `${memberCount} ${memberCount === 1 ? 'item' : 'items'} · Sub-Cluster`,
      memberCount,
      exclusiveCount,
      metricBadge: shortBridgeTag,
      dominantType: 'bridge',
      isIntermediate: true,
      shortBridgeTag,
      parentContextLabel,
    };
  }

  const firstKind = ctx.members[0]?.item.kind;

  if (firstKind === 'knowledge' && ctx.coreTags.length > 0) {
    const knowledgeProxy: ClusterDerivationContext<KnowledgeEntry, TagTaxonomyInfo> = {
      ...ctx,
      members: ctx.members
        .filter(
          (m): m is typeof m & { readonly item: Extract<DemoEntity, { kind: 'knowledge' }> } =>
            m.item.kind === 'knowledge',
        )
        .map((m) => ({
          ...m,
          item: m.item.entry,
        })),
      representativeItems: undefined,
      allItems: undefined,
      peerClusters: undefined,
    };
    const meta = deriveDemoClusterMeta(knowledgeProxy);
    const uniqueTitle = disambiguatePeerClusterTitle(
      ctx,
      (peer) => {
        const sorted = [...peer.coreTags].sort((a, b) => {
          const wa = (a.meta?.priorityWeight ?? 1) * a.frequency;
          const wb = (b.meta?.priorityWeight ?? 1) * b.frequency;
          return wb - wa;
        });
        const top = sorted[0];
        return top ? (top.meta?.displayTitle ?? top.tag) : peer.defaultLabel;
      },
      (peer) => {
        if (peer.coreTags.length >= 2) {
          const second = peer.coreTags[1]!;
          return second.meta?.displayTitle ?? second.tag;
        }
        const firstEntry = peer.members.find((m) => m.item.kind === 'knowledge')?.item;
        return firstEntry && firstEntry.kind === 'knowledge'
          ? firstEntry.entry.repoLanguage
          : undefined;
      },
    );
    return {
      title: uniqueTitle,
      subtitle: `${meta.memberCount} items · ${ctx.coreTags.length} tags`,
      memberCount: meta.memberCount,
      exclusiveCount: meta.exclusiveCount,
      metricBadge: `${meta.memberCount} items`,
      avgReadingMinutes: meta.avgReadingMinutes,
      dominantType: meta.dominantType,
    };
  }

  const memberCount = ctx.members.length;
  const exclusiveCount = ctx.members.filter((m) => m.isExclusiveVertexMember).length;
  const cohesion = ctx.cohesion;
  let repTitle = ctx.representativeItems?.[0]?.item.title ?? ctx.defaultLabel;

  let dominantType = 'vector';
  if (firstKind === 'media') {
    let avgImdb = 0;
    for (const m of ctx.members) {
      if (m.item.kind === 'media') {
        avgImdb += m.item.media.imdbRating;
      }
    }
    avgImdb = memberCount > 0 ? avgImdb / memberCount : 0;
    repTitle = resolveDiscriminativeClusterLabel(ctx, {
      features: MEDIA_PRIMARY_FEATURES,
      getItemLabel: (e) => (e.kind === 'media' ? e.media.shortTitle : e.title),
    });
    dominantType = `IMDb ${avgImdb.toFixed(1)}`;
  } else if (firstKind === 'voice') {
    const computeVoiceTitle = (
      members: ReadonlyArray<{ readonly item: DemoEntity; readonly normalizedWeight?: number }>,
    ): string => {
      const ipaWeights = new Map<string, number>();
      for (const m of members) {
        if (m.item.kind === 'voice') {
          const w = Math.pow(m.normalizedWeight ?? 1, 1.5);
          const key = `${m.item.voice.language}`;
          ipaWeights.set(key, (ipaWeights.get(key) ?? 0) + w);
        }
      }
      return [...ipaWeights.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([k]) => k)
        .join(' · ');
    };
    repTitle = disambiguatePeerClusterTitle(
      ctx,
      (peer) => computeVoiceTitle(peer.members) || peer.defaultLabel,
      (peer) => {
        let femaleW = 0;
        let totalW = 0;
        for (const m of peer.members) {
          if (m.item.kind === 'voice') {
            const w = Math.pow(m.normalizedWeight ?? 1, 1.5);
            totalW += w;
            if (m.item.voice.speakerSex === 'Female') femaleW += w;
          }
        }
        if (totalW <= 0) return undefined;
        return femaleW / totalW >= 0.55 ? 'Female' : 'Male';
      },
    );
    dominantType = '10D LPC';
  } else if (firstKind === 'zoo-species') {
    const computeZooTitle = (
      members: ReadonlyArray<{ readonly item: DemoEntity; readonly normalizedWeight?: number }>,
    ): { title: string; topGroup: string; qualifier?: string } => {
      const groupCounts = new Map<string, number>();
      let aquaticW = 0;
      let airborneW = 0;
      let predatorW = 0;
      let catsizeW = 0;
      let domesticW = 0;
      let totalW = 0;
      for (const m of members) {
        if (m.item.kind === 'zoo-species') {
          const w = Math.pow(m.normalizedWeight ?? 1, 1.5);
          totalW += w;
          groupCounts.set(
            m.item.zoo.taxonomicGroup,
            (groupCounts.get(m.item.zoo.taxonomicGroup) ?? 0) + w,
          );
          if (m.item.zoo.aquatic) aquaticW += w;
          if (m.item.zoo.airborne) airborneW += w;
          if (m.item.zoo.predator) predatorW += w;
          if ((m.item.zoo.traits[15] ?? 0) > 0.5) catsizeW += w;
          if ((m.item.zoo.traits[14] ?? 0) > 0.5) domesticW += w;
        }
      }
      const topGroup =
        [...groupCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Fauna';
      const denom = Math.max(1e-6, totalW);
      let title = topGroup;
      if (topGroup === 'Mammal') {
        if (aquaticW / denom >= 0.45) title = 'Marine Mammals';
        else if (airborneW / denom >= 0.35) title = 'Bats';
        else if (predatorW / denom >= 0.65) title = 'Carnivores';
        else title = 'Mammals';
      } else if (topGroup === 'Bird') {
        title = aquaticW / denom >= 0.45 ? 'Waterfowl' : 'Birds';
      } else if (topGroup === 'Fish') {
        title = 'Fish';
      } else if (topGroup === 'Reptile') {
        title = 'Reptiles';
      } else if (topGroup === 'Amphibian') {
        title = 'Amphibians';
      } else if (topGroup === 'Bug / Insect') {
        title = 'Insects';
      } else if (topGroup === 'Invertebrate') {
        title = aquaticW / denom >= 0.5 ? 'Marine Fauna' : 'Invertebrates';
      }
      const qualifier =
        domesticW / denom >= 0.35
          ? 'Domestic'
          : predatorW / denom >= 0.5
            ? 'Predators'
            : catsizeW / denom >= 0.55
              ? 'Large'
              : 'Small';
      return { title, topGroup, qualifier };
    };

    const own = computeZooTitle(ctx.members);
    dominantType = own.topGroup;
    repTitle = disambiguatePeerClusterTitle(
      ctx,
      (peer) => computeZooTitle(peer.members).title,
      (peer) => computeZooTitle(peer.members).qualifier,
    );
  } else if (firstKind === 'body-shape') {
    let avgMass = 0;
    for (const m of ctx.members) {
      if (m.item.kind === 'body-shape') {
        avgMass += m.item.body.bodyMassG;
      }
    }
    avgMass = memberCount > 0 ? avgMass / memberCount : 0;
    repTitle = resolveDiscriminativeClusterLabel(ctx, {
      features: PENGUIN_PRIMARY_FEATURES,
      getItemLabel: (e) => e.title,
    });
    dominantType = `${(avgMass / 1000).toFixed(1)} kg`;
  }

  const cohText =
    cohesion !== undefined ? `${Math.round(cohesion * 100)}% coh` : `${exclusiveCount} core`;

  return {
    title: repTitle,
    subtitle: `${memberCount} items · ${dominantType}`,
    memberCount,
    exclusiveCount,
    cohesion,
    metricBadge: `${cohText} · ${dominantType}`,
    dominantType,
  };
}

/**
 * Gower-style biological trait similarity kernel S(a, b) in [0, 1] for UCI Zoo species.
 */
export function computeZooTraitSimilarity(a: DemoEntity, b: DemoEntity): number {
  if (a.kind !== 'zoo-species' || b.kind !== 'zoo-species') return 0;
  const ta = a.zoo.traits;
  const tb = b.zoo.traits;
  let score = 0;
  let weightSum = 0;
  for (let i = 0; i < ta.length; i++) {
    const va = ta[i] ?? 0;
    const vb = tb[i] ?? 0;
    // Give slightly higher weight to structural vertebrate/milk/feathers/aquatic/airborne traits
    const w = i <= 5 || i === 8 || i === 11 ? 1.35 : 1.0;
    score += w * (1 - Math.abs(va - vb));
    weightSum += w;
  }
  return weightSum > 0 ? Math.max(0, Math.min(1, score / weightSum)) : 0;
}

export function computeMediaPairwiseSimilarity(
  a: DemoEntity,
  b: DemoEntity,
  semanticWeight: number,
  styleWeight: number,
): number {
  if (a.kind !== 'media' || b.kind !== 'media') return 0;
  const cosine = (u: readonly number[], v: readonly number[]): number => {
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
  };
  const totalW = Math.max(1e-6, semanticWeight + styleWeight);
  const simSem = cosine(a.media.semanticEmbedding, b.media.semanticEmbedding);
  const simStyle = cosine(a.media.styleEmbedding, b.media.styleEmbedding);
  return Math.max(0, Math.min(1, (simSem * semanticWeight + simStyle * styleWeight) / totalW));
}

export { resolveDemoTagMeta };
