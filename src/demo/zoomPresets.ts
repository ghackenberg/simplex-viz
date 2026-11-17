import {
  createBarycentricZoomStrategy,
  createFreeCameraZoomStrategy,
  createSemanticZoomStrategy,
  createSubspaceZoomStrategy,
  type BarycentricClusterZoomMode,
  type SimplexZoomStrategy,
  type SubspaceZoomFeature,
} from '@simplex-viz/react';
import type { TagTaxonomyInfo } from './data/knowledgeCatalog';
import {
  computeZooTraitSimilarity,
  type DemoClusterSummary,
  type DemoDatasetId,
  type DemoEntity,
} from './data/multimodalCatalog';
import type { CanonicalZoomStrategyId } from '../site/strategies';

const SHORT_GENRE_LABELS: Record<string, string> = {
  'Thriller/Suspense': 'Thriller',
  'Romantic Comedy': 'Rom-Com',
  'Black Comedy': 'Dark Comedy',
};

/**
 * Domain subspace features for Vega Cinema (`media`).
 * Evaluates budget scale, era, runtime, box-office ROI, critical consensus, and genre locally.
 */
export const MEDIA_ZOOM_FEATURES: readonly SubspaceZoomFeature<DemoEntity>[] = [
  {
    id: 'budget',
    label: 'Budget',
    weight: 1.15,
    getValue: (e) =>
      e.kind === 'media' ? Math.log10(Math.max(0.1, e.media.budgetMusd)) : null,
    highLabel: 'High Budget',
    lowLabel: 'Low Budget',
  },
  {
    id: 'era',
    label: 'Release Era',
    weight: 1.05,
    getValue: (e) => (e.kind === 'media' ? e.media.releaseYear : null),
    highLabel: 'New Hollywood',
    lowLabel: 'Golden Age',
  },
  {
    id: 'runtime',
    label: 'Runtime',
    weight: 0.95,
    getValue: (e) => (e.kind === 'media' ? e.media.runtimeMin : null),
    highLabel: 'Epic Runtime',
    lowLabel: 'Compact Film',
  },
  {
    id: 'roi',
    label: 'Box-Office ROI',
    weight: 1.0,
    getValue: (e) =>
      e.kind === 'media'
        ? Math.log10(
            Math.max(
              0.2,
              e.media.worldwideGrossMusd / Math.max(0.1, e.media.budgetMusd),
            ),
          )
        : null,
    highLabel: 'Box-Office Hit',
    lowLabel: 'Cult / Niche',
  },
  {
    id: 'critics',
    label: 'Critics Score',
    weight: 0.95,
    getValue: (e) => (e.kind === 'media' ? e.media.rottenTomatoes : null),
    highLabel: 'Critic Acclaim',
    lowLabel: 'Audience Pick',
  },
  {
    id: 'genre',
    label: 'Genre',
    weight: 0.9,
    getValue: (e) =>
      e.kind === 'media'
        ? (SHORT_GENRE_LABELS[e.media.genre] ?? e.media.genre)
        : null,
  },
];

/**
 * Strictly the 16 authentic attributes of Richard S. Forsyth's UCI Zoo dataset:
 * `hair`, `feathers`, `eggs`, `milk`, `airborne`, `aquatic`, `predator`, `toothed`,
 * `backbone`, `breathes`, `venomous`, `fins`, `legs`, `tail`, `domestic`, `catsize`.
 *
 * Constant parent traits inside a zoomed cluster (e.g. `milk = true` inside Mammals)
 * automatically drop to zero local variance so intra-group traits take over.
 */
export const UCI_ZOO_ZOOM_FEATURES: readonly SubspaceZoomFeature<DemoEntity>[] = [
  {
    id: 'hair',
    label: 'Hair',
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[0] ?? 0) > 0.5 : null,
    highLabel: 'Furred',
    lowLabel: 'Hairless',
  },
  {
    id: 'feathers',
    label: 'Feathers',
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[1] ?? 0) > 0.5 : null,
    highLabel: 'Feathered',
  },
  {
    id: 'eggs',
    label: 'Eggs',
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[2] ?? 0) > 0.5 : null,
    highLabel: 'Egg-Laying',
    lowLabel: 'Live Birth',
  },
  {
    id: 'milk',
    label: 'Milk',
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[3] ?? 0) > 0.5 : null,
    highLabel: 'Mammalian',
  },
  {
    id: 'airborne',
    label: 'Airborne',
    weight: 1.1,
    getValue: (e) => (e.kind === 'zoo-species' ? e.zoo.airborne : null),
    highLabel: 'Airborne',
    lowLabel: 'Flightless',
  },
  {
    id: 'aquatic',
    label: 'Aquatic',
    weight: 1.15,
    getValue: (e) => (e.kind === 'zoo-species' ? e.zoo.aquatic : null),
    highLabel: 'Aquatic',
    lowLabel: 'Terrestrial',
  },
  {
    id: 'predator',
    label: 'Predator',
    weight: 1.15,
    getValue: (e) => (e.kind === 'zoo-species' ? e.zoo.predator : null),
    highLabel: 'Predators',
    lowLabel: 'Non-Predator',
  },
  {
    id: 'toothed',
    label: 'Toothed',
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[7] ?? 0) > 0.5 : null,
    highLabel: 'Toothed',
    lowLabel: 'Toothless',
  },
  {
    id: 'backbone',
    label: 'Backbone',
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[8] ?? 0) > 0.5 : null,
    highLabel: 'Vertebrate',
    lowLabel: 'Invertebrate',
  },
  {
    id: 'breathes',
    label: 'Breathes',
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[9] ?? 0) > 0.5 : null,
    highLabel: 'Air-Breathing',
    lowLabel: 'Gilled',
  },
  {
    id: 'venomous',
    label: 'Venomous',
    weight: 1.05,
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[10] ?? 0) > 0.5 : null,
    highLabel: 'Venomous',
  },
  {
    id: 'fins',
    label: 'Fins',
    weight: 1.05,
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[11] ?? 0) > 0.5 : null,
    highLabel: 'Finned',
  },
  {
    id: 'legs',
    label: 'Legs',
    weight: 1.1,
    getValue: (e) =>
      e.kind === 'zoo-species'
        ? e.zoo.legs === 0
          ? 'Legless'
          : `${e.zoo.legs} Legs`
        : null,
  },
  {
    id: 'tail',
    label: 'Tail',
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[13] ?? 0) > 0.5 : null,
    highLabel: 'Tailed',
    lowLabel: 'Tailless',
  },
  {
    id: 'domestic',
    label: 'Domestic',
    weight: 1.05,
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[14] ?? 0) > 0.5 : null,
    highLabel: 'Domestic',
    lowLabel: 'Wild',
  },
  {
    id: 'catsize',
    label: 'Catsize',
    weight: 1.15,
    getValue: (e) =>
      e.kind === 'zoo-species' ? (e.zoo.traits[15] ?? 0) > 0.5 : null,
    highLabel: 'Large Size',
    lowLabel: 'Small Size',
  },
];

/**
 * Morphometric & ecological subspace features for Palmer Penguins (`body-shape`).
 */
export const PENGUIN_ZOOM_FEATURES: readonly SubspaceZoomFeature<DemoEntity>[] = [
  {
    id: 'island',
    label: 'Island',
    weight: 1.15,
    getValue: (e) => (e.kind === 'body-shape' ? `${e.body.island} Isl.` : null),
  },
  {
    id: 'sex',
    label: 'Sex',
    weight: 1.1,
    getValue: (e) =>
      e.kind === 'body-shape' && (e.body.sex === 'Male' || e.body.sex === 'Female')
        ? e.body.sex
        : null,
  },
  {
    id: 'mass',
    label: 'Body Mass',
    weight: 1.1,
    getValue: (e) => (e.kind === 'body-shape' ? e.body.bodyMassG : null),
    highLabel: 'Heavy Mass',
    lowLabel: 'Light Mass',
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
    lowLabel: 'Compact Flipper',
  },
];

/**
 * Acoustic & speaker subspace features for Deterding Spoken Vowels (`voice`).
 */
export const VOICE_ZOOM_FEATURES: readonly SubspaceZoomFeature<DemoEntity>[] = [
  {
    id: 'vowel',
    label: 'Vowel Phoneme',
    weight: 1.2,
    getValue: (e) => (e.kind === 'voice' ? `Vowel ${e.voice.language}` : null),
  },
  {
    id: 'speakerSex',
    label: 'Speaker Sex',
    weight: 1.15,
    getValue: (e) =>
      e.kind === 'voice' ? `${e.voice.speakerSex} Voice` : null,
  },
  {
    id: 'pitch',
    label: 'Pitch F0',
    weight: 1.0,
    getValue: (e) => (e.kind === 'voice' ? e.voice.pitchHz : null),
    highLabel: 'High Pitch',
    lowLabel: 'Low Pitch',
  },
];

/**
 * Metadata & tag-augmented subspace features for arXiv / GitHub corpora.
 */
export const KNOWLEDGE_ZOOM_FEATURES: readonly SubspaceZoomFeature<DemoEntity>[] = [
  {
    id: 'year',
    label: 'Publication Year',
    weight: 0.85,
    getValue: (e) =>
      e.kind === 'knowledge' && !e.entry.repoStars ? e.entry.publishedYear : null,
    highLabel: 'Recent Papers',
    lowLabel: 'Foundational',
  },
  {
    id: 'reading',
    label: 'Depth',
    weight: 0.8,
    getValue: (e) => (e.kind === 'knowledge' ? e.entry.readingMinutes : null),
    highLabel: 'Deep Monograph',
    lowLabel: 'Concise Note',
  },
  {
    id: 'language',
    label: 'Language',
    weight: 1.0,
    getValue: (e) => (e.kind === 'knowledge' ? e.entry.repoLanguage ?? null : null),
  },
];

export function createDemoSubspaceZoomStrategy(
  datasetId: DemoDatasetId,
  clusterZoomMode: BarycentricClusterZoomMode = 'incident-star',
): SimplexZoomStrategy<DemoEntity, TagTaxonomyInfo, DemoClusterSummary> {
  if (datasetId === 'media') {
    return createSubspaceZoomStrategy<
      DemoEntity,
      TagTaxonomyInfo,
      DemoClusterSummary
    >({
      features: MEDIA_ZOOM_FEATURES,
      getItemLabel: (e) => (e.kind === 'media' ? e.media.shortTitle : e.title),
      clusterZoomMode,
    });
  }

  if (datasetId === 'zoo-species') {
    return createSubspaceZoomStrategy<
      DemoEntity,
      TagTaxonomyInfo,
      DemoClusterSummary
    >({
      features: UCI_ZOO_ZOOM_FEATURES,
      getSimilarity: computeZooTraitSimilarity,
      getItemLabel: (e) => e.title,
      clusterZoomMode,
    });
  }

  if (datasetId === 'body-shape') {
    return createSubspaceZoomStrategy<
      DemoEntity,
      TagTaxonomyInfo,
      DemoClusterSummary
    >({
      features: PENGUIN_ZOOM_FEATURES,
      getVector: (e) => (e.kind === 'body-shape' ? e.body.shapeEmbedding : []),
      getItemLabel: (e) => e.title,
      clusterZoomMode,
    });
  }

  if (datasetId === 'voice') {
    return createSubspaceZoomStrategy<
      DemoEntity,
      TagTaxonomyInfo,
      DemoClusterSummary
    >({
      features: VOICE_ZOOM_FEATURES,
      getVector: (e) => (e.kind === 'voice' ? e.voice.voiceEmbedding : []),
      getItemLabel: (e) => e.title,
      clusterZoomMode,
    });
  }

  return createSubspaceZoomStrategy<
    DemoEntity,
    TagTaxonomyInfo,
    DemoClusterSummary
  >({
    features: KNOWLEDGE_ZOOM_FEATURES,
    getItemLabel: (e) => e.title,
    clusterZoomMode,
  });
}

export function createDemoZoomStrategy(
  datasetId: DemoDatasetId,
  zoomId: CanonicalZoomStrategyId,
  clusterZoomMode: BarycentricClusterZoomMode = 'incident-star',
): SimplexZoomStrategy<DemoEntity, TagTaxonomyInfo, DemoClusterSummary> {
  const isTagged = datasetId === 'knowledge' || datasetId === 'github-repos';

  if (zoomId === 'free-camera-zoom') {
    return createFreeCameraZoomStrategy<
      DemoEntity,
      TagTaxonomyInfo,
      DemoClusterSummary
    >();
  }

  if (zoomId === 'subspace-recluster-zoom') {
    return createDemoSubspaceZoomStrategy(datasetId, clusterZoomMode);
  }

  if (zoomId === 'semantic-tag-split-zoom' && isTagged) {
    return createSemanticZoomStrategy<
      DemoEntity,
      TagTaxonomyInfo,
      DemoClusterSummary
    >({ clusterZoomMode });
  }

  return createBarycentricZoomStrategy<
    DemoEntity,
    TagTaxonomyInfo,
    DemoClusterSummary
  >({ clusterZoomMode });
}

export function createHeroZoomStrategy(
  datasetId: DemoDatasetId,
): SimplexZoomStrategy<DemoEntity, TagTaxonomyInfo, DemoClusterSummary> {
  if (datasetId === 'knowledge' || datasetId === 'github-repos') {
    return createSemanticZoomStrategy<
      DemoEntity,
      TagTaxonomyInfo,
      DemoClusterSummary
    >({ clusterZoomMode: 'incident-star' });
  }
  return createDemoSubspaceZoomStrategy(datasetId, 'incident-star');
}
