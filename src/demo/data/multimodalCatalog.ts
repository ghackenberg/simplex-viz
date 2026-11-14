import type { ClusterDerivationContext } from '@simplex-viz/core';
import {
  buildInitialKnowledgeCatalog,
  createDynamicEntry,
  deriveDemoClusterMeta,
  resolveDemoTagMeta,
  type KnowledgeEntry,
  type TagTaxonomyInfo,
} from './knowledgeCatalog';

export type DemoDatasetId = 'knowledge' | 'media' | 'voice' | 'body-shape';

export interface VisualMediaItem {
  readonly id: string;
  readonly title: string;
  readonly mediaKind: 'image' | 'video';
  readonly durationSec?: number;
  readonly aspectRatio: '16:9' | '4:3' | '1:1';
  readonly resolutionLabel: string;
  readonly motif: 'horizon' | 'architecture' | 'macro' | 'portrait' | 'kinetic' | 'abstract';
  readonly palette: readonly [string, string];
  /** 8D semantic scene embedding: [architecture, nature, portrait, motion, macro, geometry, night, light] */
  readonly semanticEmbedding: readonly number[];
  /** 6D visual style & temporal dynamics embedding: [warmth, contrast, tempo, saturation, minimalism, depth] */
  readonly styleEmbedding: readonly number[];
}

export interface VoiceSampleItem {
  readonly id: string;
  readonly title: string;
  readonly speakerProfile: string;
  readonly language: string;
  readonly pitchHz: number;
  readonly durationSec: number;
  /** 10D acoustic voice-signature embedding: [f0Low, f0High, formantOpen, breathiness, resonance, cadence, crispness, warmth, vibrato, projection] */
  readonly voiceEmbedding: readonly number[];
  /** 14 normalized harmonic envelope bars in [0.15, 1.0] for SVG waveform rendering. */
  readonly waveform: readonly number[];
}

export interface BodyShapeItem {
  readonly id: string;
  readonly title: string;
  readonly archetype: string;
  readonly posture: 'upright' | 'dynamic' | 'athletic' | 'compact' | 'tall';
  readonly heightCm: number;
  /** 8D biomechanical & anthropometric latent vector: [stature, shoulderW, waistTaper, hipRatio, limbReach, torsoMass, lean, agility] */
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

export type DemoEntity =
  | {
      readonly kind: 'knowledge';
      readonly id: string;
      readonly title: string;
      readonly entry: KnowledgeEntry;
    }
  | {
      readonly kind: 'media';
      readonly id: string;
      readonly title: string;
      readonly media: VisualMediaItem;
    }
  | {
      readonly kind: 'voice';
      readonly id: string;
      readonly title: string;
      readonly voice: VoiceSampleItem;
    }
  | {
      readonly kind: 'body-shape';
      readonly id: string;
      readonly title: string;
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
}

export const DATASET_DESCRIPTIONS: Record<
  DemoDatasetId,
  {
    readonly label: string;
    readonly shortLabel: string;
    readonly clusteringModeLabel: string;
  }
> = {
  knowledge: {
    label: 'Knowledge Articles (Tags)',
    shortLabel: 'Knowledge · Tags',
    clusteringModeLabel: 'Tag Co-Occurrence',
  },
  media: {
    label: 'Images & Videos (Dual Embeddings)',
    shortLabel: 'Media · Multi-Modal',
    clusteringModeLabel: '2-Modal Vector + Similarity',
  },
  voice: {
    label: 'Voice Samples (Audio Signatures)',
    shortLabel: 'Voice · Speaker Vectors',
    clusteringModeLabel: '10D Acoustic Embedding',
  },
  'body-shape': {
    label: 'Body Shapes (Latent Vectors)',
    shortLabel: 'Body · Latent Geometry',
    clusteringModeLabel: '8D Parametric Shape Vector',
  },
};

function makeSeededRand(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function jitterVec(base: readonly number[], seed: number, spread = 0.08): readonly number[] {
  const rand = makeSeededRand(seed);
  return base.map((v) =>
    Number(Math.max(0.02, Math.min(1.0, v + (rand() - 0.5) * 2 * spread)).toFixed(3)),
  );
}

const MEDIA_SEEDS: readonly Omit<VisualMediaItem, 'id'>[] = [
  {
    title: 'Brutalist Concrete Atrium',
    mediaKind: 'image',
    aspectRatio: '4:3',
    resolutionLabel: '4K RAW',
    motif: 'architecture',
    palette: ['#38bdf8', '#0f172a'],
    semanticEmbedding: [0.95, 0.08, 0.05, 0.10, 0.18, 0.92, 0.25, 0.72],
    styleEmbedding: [0.22, 0.88, 0.12, 0.20, 0.90, 0.78],
  },
  {
    title: 'Glass Facade Dusk Reflections',
    mediaKind: 'image',
    aspectRatio: '16:9',
    resolutionLabel: '5K RAW',
    motif: 'architecture',
    palette: ['#0ea5e9', '#1e1b4b'],
    semanticEmbedding: [0.90, 0.14, 0.06, 0.22, 0.12, 0.86, 0.68, 0.55],
    styleEmbedding: [0.35, 0.82, 0.20, 0.45, 0.75, 0.85],
  },
  {
    title: 'Spiral Staircase Isometric',
    mediaKind: 'image',
    aspectRatio: '1:1',
    resolutionLabel: '3K PNG',
    motif: 'abstract',
    palette: ['#22d3ee', '#1e293b'],
    semanticEmbedding: [0.82, 0.05, 0.02, 0.18, 0.35, 0.98, 0.30, 0.65],
    styleEmbedding: [0.28, 0.85, 0.26, 0.32, 0.88, 0.70],
  },
  {
    title: 'Alpine Ridge First Light',
    mediaKind: 'image',
    aspectRatio: '16:9',
    resolutionLabel: '6K RAW',
    motif: 'horizon',
    palette: ['#34d399', '#064e3b'],
    semanticEmbedding: [0.10, 0.96, 0.04, 0.16, 0.15, 0.22, 0.12, 0.92],
    styleEmbedding: [0.68, 0.55, 0.18, 0.64, 0.52, 0.94],
  },
  {
    title: 'Coastal Tide Drone Sweep',
    mediaKind: 'video',
    durationSec: 28,
    aspectRatio: '16:9',
    resolutionLabel: '4K60',
    motif: 'horizon',
    palette: ['#10b981', '#0c4a6e'],
    semanticEmbedding: [0.12, 0.92, 0.05, 0.76, 0.12, 0.26, 0.15, 0.82],
    styleEmbedding: [0.54, 0.60, 0.74, 0.72, 0.42, 0.90],
  },
  {
    title: 'Misty Cedar Canopy',
    mediaKind: 'image',
    aspectRatio: '4:3',
    resolutionLabel: '4K RAW',
    motif: 'horizon',
    palette: ['#4ade80', '#14532d'],
    semanticEmbedding: [0.06, 0.95, 0.05, 0.14, 0.28, 0.16, 0.38, 0.50],
    styleEmbedding: [0.46, 0.44, 0.15, 0.58, 0.64, 0.86],
  },
  {
    title: 'Studio Chiaroscuro Portrait',
    mediaKind: 'image',
    aspectRatio: '4:3',
    resolutionLabel: '4K RAW',
    motif: 'portrait',
    palette: ['#f472b6', '#500724'],
    semanticEmbedding: [0.12, 0.08, 0.96, 0.14, 0.22, 0.18, 0.78, 0.45],
    styleEmbedding: [0.78, 0.92, 0.10, 0.48, 0.72, 0.68],
  },
  {
    title: 'Backlit Musician Close-Up',
    mediaKind: 'video',
    durationSec: 19,
    aspectRatio: '16:9',
    resolutionLabel: '4K30',
    motif: 'portrait',
    palette: ['#fb7185', '#4c0519'],
    semanticEmbedding: [0.16, 0.06, 0.90, 0.62, 0.26, 0.20, 0.74, 0.58],
    styleEmbedding: [0.84, 0.86, 0.66, 0.62, 0.45, 0.64],
  },
  {
    title: 'Raindrop Leaf Macro 100mm',
    mediaKind: 'image',
    aspectRatio: '1:1',
    resolutionLabel: '4K RAW',
    motif: 'macro',
    palette: ['#a3e635', '#1a2e05'],
    semanticEmbedding: [0.04, 0.74, 0.02, 0.12, 0.96, 0.42, 0.18, 0.78],
    styleEmbedding: [0.48, 0.66, 0.14, 0.80, 0.68, 0.40],
  },
  {
    title: 'Quartz Crystal Refraction',
    mediaKind: 'image',
    aspectRatio: '1:1',
    resolutionLabel: '5K PNG',
    motif: 'macro',
    palette: ['#c084fc', '#2e1065'],
    semanticEmbedding: [0.28, 0.16, 0.02, 0.20, 0.94, 0.86, 0.42, 0.88],
    styleEmbedding: [0.38, 0.84, 0.22, 0.78, 0.76, 0.52],
  },
  {
    title: 'Neon Subway Time-Lapse',
    mediaKind: 'video',
    durationSec: 14,
    aspectRatio: '16:9',
    resolutionLabel: '4K60',
    motif: 'kinetic',
    palette: ['#f59e0b', '#311042'],
    semanticEmbedding: [0.68, 0.05, 0.28, 0.96, 0.10, 0.56, 0.92, 0.62],
    styleEmbedding: [0.74, 0.90, 0.96, 0.94, 0.22, 0.76],
  },
  {
    title: 'Skatepark Whip-Pan Sequence',
    mediaKind: 'video',
    durationSec: 22,
    aspectRatio: '16:9',
    resolutionLabel: '4K120',
    motif: 'kinetic',
    palette: ['#fb923c', '#431407'],
    semanticEmbedding: [0.44, 0.24, 0.54, 0.94, 0.08, 0.38, 0.18, 0.84],
    styleEmbedding: [0.82, 0.76, 0.98, 0.82, 0.26, 0.62],
  },
  {
    title: 'Bioluminescent Reef Slow-Mo',
    mediaKind: 'video',
    durationSec: 36,
    aspectRatio: '16:9',
    resolutionLabel: '4K60',
    motif: 'abstract',
    palette: ['#2dd4bf', '#042f2e'],
    semanticEmbedding: [0.06, 0.68, 0.04, 0.74, 0.62, 0.46, 0.88, 0.70],
    styleEmbedding: [0.24, 0.86, 0.62, 0.96, 0.34, 0.72],
  },
  {
    title: 'Tokyo Lantern Rain Walk',
    mediaKind: 'video',
    durationSec: 41,
    aspectRatio: '16:9',
    resolutionLabel: '4K30',
    motif: 'kinetic',
    palette: ['#f43f5e', '#172554'],
    semanticEmbedding: [0.62, 0.10, 0.48, 0.78, 0.18, 0.40, 0.95, 0.52],
    styleEmbedding: [0.80, 0.88, 0.76, 0.88, 0.28, 0.80],
  },
  {
    title: 'Monolith Desert Noon Shadow',
    mediaKind: 'image',
    aspectRatio: '4:3',
    resolutionLabel: '6K RAW',
    motif: 'architecture',
    palette: ['#fbbf24', '#451a03'],
    semanticEmbedding: [0.72, 0.64, 0.04, 0.08, 0.12, 0.84, 0.08, 0.96],
    styleEmbedding: [0.90, 0.84, 0.08, 0.56, 0.86, 0.92],
  },
  {
    title: 'Stage Dancer Motion Trails',
    mediaKind: 'video',
    durationSec: 17,
    aspectRatio: '16:9',
    resolutionLabel: '4K60',
    motif: 'portrait',
    palette: ['#e879f9', '#3b0764'],
    semanticEmbedding: [0.18, 0.04, 0.78, 0.90, 0.14, 0.36, 0.86, 0.64],
    styleEmbedding: [0.70, 0.90, 0.90, 0.88, 0.32, 0.58],
  },
  {
    title: 'Circuit Wafer Gold Traces',
    mediaKind: 'image',
    aspectRatio: '1:1',
    resolutionLabel: '5K RAW',
    motif: 'macro',
    palette: ['#facc15', '#1c1917'],
    semanticEmbedding: [0.46, 0.02, 0.02, 0.10, 0.92, 0.96, 0.34, 0.74],
    styleEmbedding: [0.66, 0.88, 0.16, 0.72, 0.82, 0.34],
  },
  {
    title: 'Observatory Dome Starlapse',
    mediaKind: 'video',
    durationSec: 45,
    aspectRatio: '16:9',
    resolutionLabel: '6K24',
    motif: 'horizon',
    palette: ['#60a5fa', '#090d16'],
    semanticEmbedding: [0.64, 0.72, 0.02, 0.58, 0.10, 0.78, 0.98, 0.44],
    styleEmbedding: [0.18, 0.92, 0.52, 0.66, 0.68, 0.96],
  },
  {
    title: 'Ink Diffusion in Glycerin',
    mediaKind: 'video',
    durationSec: 24,
    aspectRatio: '1:1',
    resolutionLabel: '4K60',
    motif: 'abstract',
    palette: ['#818cf8', '#1e1b4b'],
    semanticEmbedding: [0.10, 0.22, 0.04, 0.82, 0.80, 0.52, 0.48, 0.62],
    styleEmbedding: [0.36, 0.78, 0.72, 0.92, 0.56, 0.48],
  },
  {
    title: 'Botanical Greenhouse Glass',
    mediaKind: 'image',
    aspectRatio: '4:3',
    resolutionLabel: '4K RAW',
    motif: 'architecture',
    palette: ['#22c55e', '#052e16'],
    semanticEmbedding: [0.76, 0.82, 0.04, 0.12, 0.34, 0.74, 0.14, 0.86],
    styleEmbedding: [0.56, 0.58, 0.14, 0.68, 0.58, 0.82],
  },
  {
    title: 'Biker Canyon Switchbacks',
    mediaKind: 'video',
    durationSec: 32,
    aspectRatio: '16:9',
    resolutionLabel: '4K60',
    motif: 'kinetic',
    palette: ['#f97316', '#27272a'],
    semanticEmbedding: [0.22, 0.78, 0.24, 0.92, 0.08, 0.44, 0.12, 0.88],
    styleEmbedding: [0.80, 0.78, 0.94, 0.78, 0.30, 0.88],
  },
  {
    title: 'Editorial Twins Outdoor',
    mediaKind: 'image',
    aspectRatio: '4:3',
    resolutionLabel: '4K RAW',
    motif: 'portrait',
    palette: ['#ec4899', '#1f2937'],
    semanticEmbedding: [0.22, 0.48, 0.92, 0.18, 0.16, 0.24, 0.16, 0.84],
    styleEmbedding: [0.74, 0.62, 0.20, 0.64, 0.54, 0.74],
  },
  {
    title: 'Kinetic Prism Caustics',
    mediaKind: 'video',
    durationSec: 12,
    aspectRatio: '1:1',
    resolutionLabel: '4K60',
    motif: 'abstract',
    palette: ['#06b6d4', '#312e81'],
    semanticEmbedding: [0.32, 0.08, 0.02, 0.80, 0.72, 0.90, 0.66, 0.86],
    styleEmbedding: [0.42, 0.92, 0.84, 0.94, 0.62, 0.50],
  },
  {
    title: 'Fjord Kayak Dawn Aerial',
    mediaKind: 'video',
    durationSec: 38,
    aspectRatio: '16:9',
    resolutionLabel: '5K30',
    motif: 'horizon',
    palette: ['#38bdf8', '#0f766e'],
    semanticEmbedding: [0.10, 0.94, 0.20, 0.68, 0.10, 0.28, 0.22, 0.78],
    styleEmbedding: [0.44, 0.64, 0.58, 0.68, 0.58, 0.96],
  },
];

function makeWaveform(seed: number, energy: number, smoothness: number): readonly number[] {
  const rand = makeSeededRand(seed);
  const bars: number[] = [];
  let prev = 0.5;
  for (let i = 0; i < 14; i++) {
    const env = Math.sin(((i + 0.5) / 14) * Math.PI);
    const raw = (0.25 + rand() * 0.75) * (0.55 + energy * 0.45) * (0.45 + 0.65 * env);
    const val = prev * smoothness + raw * (1 - smoothness);
    prev = val;
    bars.push(Number(Math.max(0.16, Math.min(1.0, val)).toFixed(2)));
  }
  return bars;
}

const VOICE_SEEDS: readonly Omit<VoiceSampleItem, 'id' | 'waveform'>[] = [
  {
    title: 'Warm Baritone Narration',
    speakerProfile: 'Deep Studio Baritone',
    language: 'EN-US',
    pitchHz: 108,
    durationSec: 18,
    voiceEmbedding: [0.95, 0.08, 0.62, 0.22, 0.92, 0.34, 0.68, 0.94, 0.18, 0.82],
  },
  {
    title: 'Documentary Bass Voiceover',
    speakerProfile: 'Low Resonant Bass',
    language: 'EN-UK',
    pitchHz: 94,
    durationSec: 26,
    voiceEmbedding: [0.98, 0.04, 0.58, 0.18, 0.96, 0.28, 0.72, 0.90, 0.12, 0.88],
  },
  {
    title: 'Late-Night Radio Host',
    speakerProfile: 'Velvet Close-Mic Baritone',
    language: 'DE-DE',
    pitchHz: 118,
    durationSec: 21,
    voiceEmbedding: [0.86, 0.14, 0.68, 0.46, 0.84, 0.40, 0.60, 0.96, 0.20, 0.66],
  },
  {
    title: 'Bright Soprano Dialogue',
    speakerProfile: 'Crisp High Soprano',
    language: 'EN-US',
    pitchHz: 256,
    durationSec: 12,
    voiceEmbedding: [0.10, 0.95, 0.84, 0.28, 0.42, 0.68, 0.90, 0.48, 0.56, 0.76],
  },
  {
    title: 'Expressive Opera Mezzosoprano',
    speakerProfile: 'Lyrical Vibrato Vocal',
    language: 'IT-IT',
    pitchHz: 234,
    durationSec: 16,
    voiceEmbedding: [0.18, 0.86, 0.90, 0.20, 0.78, 0.46, 0.78, 0.72, 0.96, 0.94],
  },
  {
    title: 'Airy Whisper ASMR Read',
    speakerProfile: 'Soft Breathy Alto',
    language: 'JP-JP',
    pitchHz: 196,
    durationSec: 30,
    voiceEmbedding: [0.28, 0.58, 0.44, 0.96, 0.24, 0.22, 0.40, 0.78, 0.10, 0.16],
  },
  {
    title: 'Calm Meditation Guide',
    speakerProfile: 'Warm Breathy Tenor',
    language: 'EN-AU',
    pitchHz: 146,
    durationSec: 34,
    voiceEmbedding: [0.56, 0.34, 0.52, 0.82, 0.58, 0.18, 0.48, 0.90, 0.14, 0.32],
  },
  {
    title: 'Rapid Sports Play-by-Play',
    speakerProfile: 'High-Tempo Broadcaster',
    language: 'ES-ES',
    pitchHz: 174,
    durationSec: 11,
    voiceEmbedding: [0.42, 0.54, 0.76, 0.14, 0.66, 0.98, 0.94, 0.44, 0.22, 0.96],
  },
  {
    title: 'Crisp News Anchor Read',
    speakerProfile: 'Articulate Mid-Alto',
    language: 'DE-DE',
    pitchHz: 184,
    durationSec: 15,
    voiceEmbedding: [0.34, 0.64, 0.78, 0.16, 0.62, 0.74, 0.96, 0.54, 0.16, 0.84],
  },
  {
    title: 'Keynote Tech Presenter',
    speakerProfile: 'Punchy Mid-Tenor',
    language: 'EN-US',
    pitchHz: 152,
    durationSec: 19,
    voiceEmbedding: [0.48, 0.48, 0.74, 0.18, 0.70, 0.80, 0.90, 0.62, 0.18, 0.88],
  },
  {
    title: 'Indie Acoustic Singer',
    speakerProfile: 'Breathy Falsetto Blend',
    language: 'FR-FR',
    pitchHz: 222,
    durationSec: 22,
    voiceEmbedding: [0.22, 0.78, 0.68, 0.74, 0.50, 0.38, 0.56, 0.82, 0.76, 0.52],
  },
  {
    title: 'Classical Tenor Aria',
    speakerProfile: 'Projecting Tenor Vibrato',
    language: 'IT-IT',
    pitchHz: 178,
    durationSec: 20,
    voiceEmbedding: [0.44, 0.66, 0.88, 0.12, 0.90, 0.42, 0.80, 0.76, 0.94, 0.96],
  },
  {
    title: 'Conversational Podcast Co-Host',
    speakerProfile: 'Natural Mid-Alto',
    language: 'EN-CA',
    pitchHz: 198,
    durationSec: 24,
    voiceEmbedding: [0.26, 0.68, 0.66, 0.42, 0.54, 0.64, 0.76, 0.74, 0.18, 0.58],
  },
  {
    title: 'E-Learning Tutorial Voice',
    speakerProfile: 'Clear Neutral Baritone',
    language: 'DE-DE',
    pitchHz: 132,
    durationSec: 28,
    voiceEmbedding: [0.68, 0.28, 0.64, 0.24, 0.72, 0.52, 0.88, 0.78, 0.12, 0.70],
  },
  {
    title: 'Animated Character Sprite',
    speakerProfile: 'Bright Energetic High',
    language: 'EN-US',
    pitchHz: 282,
    durationSec: 9,
    voiceEmbedding: [0.06, 0.98, 0.86, 0.22, 0.38, 0.92, 0.88, 0.40, 0.44, 0.82],
  },
  {
    title: 'Storybook Elderly Sage',
    speakerProfile: 'Gravelly Warm Bass',
    language: 'EN-UK',
    pitchHz: 102,
    durationSec: 25,
    voiceEmbedding: [0.92, 0.10, 0.50, 0.48, 0.86, 0.24, 0.52, 0.92, 0.36, 0.62],
  },
  {
    title: 'Auctioneer Speed Call',
    speakerProfile: 'Staccato Rapid Tenor',
    language: 'EN-US',
    pitchHz: 164,
    durationSec: 10,
    voiceEmbedding: [0.46, 0.48, 0.72, 0.10, 0.58, 0.99, 0.98, 0.34, 0.12, 0.90],
  },
  {
    title: 'Jazz Lounge Alto Vocal',
    speakerProfile: 'Smoky Warm Alto',
    language: 'FR-FR',
    pitchHz: 188,
    durationSec: 23,
    voiceEmbedding: [0.36, 0.58, 0.64, 0.66, 0.72, 0.32, 0.54, 0.92, 0.74, 0.60],
  },
  {
    title: 'Cockpit ATC Telemetry',
    speakerProfile: 'Compressed Crisp Mid',
    language: 'EN-US',
    pitchHz: 158,
    durationSec: 8,
    voiceEmbedding: [0.50, 0.42, 0.60, 0.10, 0.48, 0.84, 0.96, 0.28, 0.08, 0.86],
  },
  {
    title: 'Lullaby Humming Alto',
    speakerProfile: 'Gentle Soft Soprano',
    language: 'SE-SE',
    pitchHz: 214,
    durationSec: 29,
    voiceEmbedding: [0.22, 0.76, 0.46, 0.86, 0.46, 0.18, 0.44, 0.88, 0.52, 0.30],
  },
];

const BODY_SEEDS: readonly Omit<BodyShapeItem, 'id'>[] = [
  {
    title: 'Marathon Runner Silhouette',
    archetype: 'Endurance Ectomorph',
    posture: 'tall',
    heightCm: 181,
    shapeEmbedding: [0.84, 0.36, 0.74, 0.30, 0.92, 0.28, 0.34, 0.90],
    proportions: { shoulderW: 0.62, waistW: 0.42, hipW: 0.48, torsoH: 0.82, legH: 0.98, leanDeg: 4 },
  },
  {
    title: 'Basketball Wing Frame',
    archetype: 'Tall Lean Reach',
    posture: 'tall',
    heightCm: 198,
    shapeEmbedding: [0.98, 0.64, 0.70, 0.38, 0.98, 0.44, 0.28, 0.88],
    proportions: { shoulderW: 0.78, waistW: 0.48, hipW: 0.52, torsoH: 0.88, legH: 1.04, leanDeg: 2 },
  },
  {
    title: 'Swimmer V-Taper Build',
    archetype: 'Broad-Shoulder Athletic',
    posture: 'athletic',
    heightCm: 186,
    shapeEmbedding: [0.82, 0.96, 0.94, 0.42, 0.88, 0.68, 0.22, 0.86],
    proportions: { shoulderW: 0.98, waistW: 0.48, hipW: 0.54, torsoH: 0.86, legH: 0.88, leanDeg: 0 },
  },
  {
    title: 'Gymnast Ring Specialist',
    archetype: 'Compact Upper-Body Power',
    posture: 'athletic',
    heightCm: 165,
    shapeEmbedding: [0.34, 0.94, 0.88, 0.40, 0.44, 0.78, 0.26, 0.94],
    proportions: { shoulderW: 0.96, waistW: 0.50, hipW: 0.52, torsoH: 0.74, legH: 0.70, leanDeg: -2 },
  },
  {
    title: 'Olympic Weightlifter Stance',
    archetype: 'Dense Power Mesomorph',
    posture: 'compact',
    heightCm: 171,
    shapeEmbedding: [0.44, 0.90, 0.34, 0.82, 0.42, 0.96, 0.32, 0.68],
    proportions: { shoulderW: 0.94, waistW: 0.76, hipW: 0.82, torsoH: 0.76, legH: 0.72, leanDeg: 5 },
  },
  {
    title: 'Shot Put Rotational Frame',
    archetype: 'Heavy Mass Power',
    posture: 'compact',
    heightCm: 184,
    shapeEmbedding: [0.76, 0.88, 0.22, 0.90, 0.64, 0.98, 0.40, 0.52],
    proportions: { shoulderW: 0.94, waistW: 0.84, hipW: 0.86, torsoH: 0.86, legH: 0.82, leanDeg: 8 },
  },
  {
    title: 'Ballet Principal Line',
    archetype: 'Poised Balanced Slender',
    posture: 'upright',
    heightCm: 172,
    shapeEmbedding: [0.64, 0.44, 0.86, 0.46, 0.84, 0.24, 0.06, 0.94],
    proportions: { shoulderW: 0.64, waistW: 0.38, hipW: 0.56, torsoH: 0.76, legH: 0.92, leanDeg: -3 },
  },
  {
    title: 'High-Fashion Runway Posture',
    archetype: 'Elongated Upright Column',
    posture: 'tall',
    heightCm: 180,
    shapeEmbedding: [0.88, 0.48, 0.78, 0.44, 0.90, 0.22, 0.10, 0.74],
    proportions: { shoulderW: 0.66, waistW: 0.40, hipW: 0.54, torsoH: 0.80, legH: 0.96, leanDeg: -2 },
  },
  {
    title: 'Sprinter Drive-Phase Lean',
    archetype: 'Explosive Asymmetric Mesh',
    posture: 'dynamic',
    heightCm: 178,
    shapeEmbedding: [0.68, 0.78, 0.82, 0.52, 0.76, 0.62, 0.94, 0.98],
    proportions: { shoulderW: 0.84, waistW: 0.48, hipW: 0.58, torsoH: 0.80, legH: 0.86, leanDeg: 18 },
  },
  {
    title: 'Parkour Vault Mid-Stride',
    archetype: 'Agile Forward Tilt',
    posture: 'dynamic',
    heightCm: 174,
    shapeEmbedding: [0.58, 0.68, 0.78, 0.46, 0.72, 0.52, 0.90, 0.96],
    proportions: { shoulderW: 0.76, waistW: 0.48, hipW: 0.54, torsoH: 0.76, legH: 0.84, leanDeg: 15 },
  },
  {
    title: 'Sumo Low-Center Stance',
    archetype: 'Wide Grounded Center',
    posture: 'compact',
    heightCm: 179,
    shapeEmbedding: [0.64, 0.82, 0.14, 0.96, 0.52, 0.98, 0.54, 0.42],
    proportions: { shoulderW: 0.90, waistW: 0.92, hipW: 0.94, torsoH: 0.84, legH: 0.76, leanDeg: 10 },
  },
  {
    title: 'Hourglass Studio Neutral',
    archetype: 'Balanced Hip-Shoulder Curve',
    posture: 'upright',
    heightCm: 168,
    shapeEmbedding: [0.46, 0.64, 0.92, 0.82, 0.56, 0.46, 0.12, 0.72],
    proportions: { shoulderW: 0.74, waistW: 0.44, hipW: 0.78, torsoH: 0.74, legH: 0.80, leanDeg: 0 },
  },
  {
    title: 'Pear-Ratio Walker',
    archetype: 'Lower-Dominant Neutral',
    posture: 'upright',
    heightCm: 166,
    shapeEmbedding: [0.42, 0.44, 0.72, 0.90, 0.54, 0.50, 0.16, 0.66],
    proportions: { shoulderW: 0.60, waistW: 0.48, hipW: 0.84, torsoH: 0.72, legH: 0.78, leanDeg: 2 },
  },
  {
    title: 'Rock Climber Lean Reach',
    archetype: 'High Arm-Span Ratio',
    posture: 'dynamic',
    heightCm: 173,
    shapeEmbedding: [0.58, 0.80, 0.88, 0.36, 0.92, 0.42, 0.62, 0.94],
    proportions: { shoulderW: 0.84, waistW: 0.42, hipW: 0.48, torsoH: 0.78, legH: 0.82, leanDeg: 11 },
  },
  {
    title: 'Track Cyclist Aero Tuck',
    archetype: 'Quad-Power Forward Angle',
    posture: 'dynamic',
    heightCm: 176,
    shapeEmbedding: [0.62, 0.66, 0.64, 0.72, 0.66, 0.64, 0.96, 0.84],
    proportions: { shoulderW: 0.74, waistW: 0.52, hipW: 0.72, torsoH: 0.78, legH: 0.84, leanDeg: 22 },
  },
  {
    title: 'Martial Arts Ready Stance',
    archetype: 'Centered Mesomorph',
    posture: 'athletic',
    heightCm: 177,
    shapeEmbedding: [0.64, 0.82, 0.80, 0.58, 0.74, 0.66, 0.42, 0.92],
    proportions: { shoulderW: 0.86, waistW: 0.52, hipW: 0.60, torsoH: 0.80, legH: 0.82, leanDeg: 6 },
  },
  {
    title: 'Rowing Ergometer Build',
    archetype: 'Long-Lever Athletic',
    posture: 'tall',
    heightCm: 192,
    shapeEmbedding: [0.94, 0.86, 0.78, 0.54, 0.94, 0.68, 0.30, 0.82],
    proportions: { shoulderW: 0.88, waistW: 0.54, hipW: 0.62, torsoH: 0.88, legH: 0.96, leanDeg: 4 },
  },
  {
    title: 'Desk Ergonomics Neutral',
    archetype: 'Average Urban Reference',
    posture: 'upright',
    heightCm: 174,
    shapeEmbedding: [0.58, 0.60, 0.52, 0.58, 0.58, 0.56, 0.24, 0.54],
    proportions: { shoulderW: 0.72, waistW: 0.58, hipW: 0.64, torsoH: 0.78, legH: 0.80, leanDeg: 3 },
  },
];

export function buildDemoCatalog(dataset: DemoDatasetId): readonly DemoEntity[] {
  if (dataset === 'knowledge') {
    return buildInitialKnowledgeCatalog().map((entry) => ({
      kind: 'knowledge' as const,
      id: entry.slug,
      title: entry.headline,
      entry,
    }));
  }

  if (dataset === 'media') {
    return MEDIA_SEEDS.map((m, idx) => ({
      kind: 'media' as const,
      id: `media-${idx + 1}`,
      title: m.title,
      media: { id: `media-${idx + 1}`, ...m },
    }));
  }

  if (dataset === 'voice') {
    return VOICE_SEEDS.map((v, idx) => ({
      kind: 'voice' as const,
      id: `voice-${idx + 1}`,
      title: v.title,
      voice: {
        id: `voice-${idx + 1}`,
        ...v,
        waveform: makeWaveform(900 + idx * 31, v.voiceEmbedding[5]!, 0.35),
      },
    }));
  }

  return BODY_SEEDS.map((b, idx) => ({
    kind: 'body-shape' as const,
    id: `body-${idx + 1}`,
    title: b.title,
    body: { id: `body-${idx + 1}`, ...b },
  }));
}

export function createDynamicDemoEntity(
  dataset: DemoDatasetId,
  seq: number,
): DemoEntity {
  if (dataset === 'knowledge') {
    const entry = createDynamicEntry(seq);
    return {
      kind: 'knowledge',
      id: entry.slug,
      title: entry.headline,
      entry,
    };
  }

  if (dataset === 'media') {
    const base = MEDIA_SEEDS[seq % MEDIA_SEEDS.length]!;
    const id = `media-dyn-${seq}`;
    const variantTitle = `${base.title} #${seq}`;
    return {
      kind: 'media',
      id,
      title: variantTitle,
      media: {
        ...base,
        id,
        title: variantTitle,
        semanticEmbedding: jitterVec(base.semanticEmbedding, seq * 17 + 3, 0.09),
        styleEmbedding: jitterVec(base.styleEmbedding, seq * 29 + 7, 0.09),
      },
    };
  }

  if (dataset === 'voice') {
    const base = VOICE_SEEDS[seq % VOICE_SEEDS.length]!;
    const id = `voice-dyn-${seq}`;
    const variantTitle = `${base.title} · Take ${seq}`;
    return {
      kind: 'voice',
      id,
      title: variantTitle,
      voice: {
        ...base,
        id,
        title: variantTitle,
        pitchHz: Math.max(80, Math.round(base.pitchHz + ((seq % 7) - 3) * 4)),
        voiceEmbedding: jitterVec(base.voiceEmbedding, seq * 41 + 5, 0.08),
        waveform: makeWaveform(seq * 53 + 11, base.voiceEmbedding[5]!, 0.32),
      },
    };
  }

  const base = BODY_SEEDS[seq % BODY_SEEDS.length]!;
  const id = `body-dyn-${seq}`;
  const variantTitle = `${base.title} #${seq}`;
  const factor = 0.94 + (seq % 5) * 0.03;
  return {
    kind: 'body-shape',
    id,
    title: variantTitle,
    body: {
      ...base,
      id,
      title: variantTitle,
      heightCm: Math.round(base.heightCm * factor),
      shapeEmbedding: jitterVec(base.shapeEmbedding, seq * 61 + 13, 0.08),
      proportions: {
        ...base.proportions,
        shoulderW: Number((base.proportions.shoulderW * factor).toFixed(2)),
        hipW: Number((base.proportions.hipW * (2 - factor)).toFixed(2)),
      },
    },
  };
}

export function deriveDemoEntityClusterMeta(
  ctx: ClusterDerivationContext<DemoEntity, TagTaxonomyInfo>,
): DemoClusterSummary {
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
    };
    const meta = deriveDemoClusterMeta(knowledgeProxy);
    return {
      title: meta.title,
      subtitle: `${meta.memberCount} items · ${ctx.coreTags.length} tags · avg ${meta.avgReadingMinutes.toFixed(0)}m`,
      memberCount: meta.memberCount,
      exclusiveCount: meta.exclusiveCount,
      metricBadge: `${meta.dominantType} · ${meta.avgReadingMinutes.toFixed(0)}m`,
      avgReadingMinutes: meta.avgReadingMinutes,
      dominantType: meta.dominantType,
    };
  }

  const memberCount = ctx.members.length;
  const exclusiveCount = ctx.members.filter((m) => m.isExclusiveVertexMember).length;
  const cohesion = ctx.cohesion;
  const repTitle =
    ctx.representativeItems?.[0]?.item.title ?? ctx.defaultLabel;

  let dominantType = 'vector';
  if (firstKind === 'media') {
    let imgCount = 0;
    let vidCount = 0;
    for (const m of ctx.members) {
      if (m.item.kind === 'media') {
        if (m.item.media.mediaKind === 'image') imgCount += 1;
        else vidCount += 1;
      }
    }
    dominantType = vidCount > imgCount ? 'video' : 'image';
  } else if (firstKind === 'voice') {
    const avgHz =
      memberCount > 0
        ? ctx.members.reduce(
            (acc, m) => acc + (m.item.kind === 'voice' ? m.item.voice.pitchHz : 0),
            0,
          ) / memberCount
        : 0;
    dominantType = `${Math.round(avgHz)} Hz`;
  } else if (firstKind === 'body-shape') {
    const avgCm =
      memberCount > 0
        ? ctx.members.reduce(
            (acc, m) => acc + (m.item.kind === 'body-shape' ? m.item.body.heightCm : 0),
            0,
          ) / memberCount
        : 0;
    dominantType = `${Math.round(avgCm)} cm`;
  }

  const cohText =
    cohesion !== undefined ? `${Math.round(cohesion * 100)}% coh` : `${exclusiveCount} core`;

  return {
    title: repTitle,
    subtitle: `${memberCount} items · ${cohText} · ${dominantType}`,
    memberCount,
    exclusiveCount,
    cohesion,
    metricBadge: `${cohText} · ${dominantType}`,
    dominantType,
  };
}

/**
 * Custom multimodal similarity kernel used when `media` dataset is switched to
 * `createSimilarityClusteringStrategy`.
 */
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
  const kindBonus = a.media.mediaKind === b.media.mediaKind ? 0.04 : 0;
  return Math.max(
    0,
    Math.min(1, (simSem * semanticWeight + simStyle * styleWeight) / totalW + kindBonus),
  );
}

export { resolveDemoTagMeta };
