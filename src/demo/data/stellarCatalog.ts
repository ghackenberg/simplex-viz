/**
 * Deterministic Hertzsprung-Russell (H-R) / Morgan-Keenan (MK) Stellar Spectral Catalog.
 *
 * Models 12 continuous astrophysical stellar populations across the O/B/A/F/G/K/M spectral
 * sequence and luminosity classes (I Supergiants, III Giants, IV Subgiants, V Main Sequence,
 * VI Subdwarfs, VII White Dwarfs), plus evolutionary transition tracks so Soft-Simplex
 * embeddings naturally place hybrid stars across simplex edges and triangles.
 *
 * Each star carries a standalone 8D `Float32Array` astrophysical feature vector suitable for
 * zero-copy `ArrayBuffer` transfer into `@simplex-viz/core/worker`.
 */

export type StellarSpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | 'D';

export type StellarPopulationId =
  | 'ob-supergiants'
  | 'b-main-seq'
  | 'a-white'
  | 'f-yellow-white'
  | 'g-solar'
  | 'k-orange-dwarf'
  | 'm-red-dwarf'
  | 'red-giants'
  | 'yellow-supergiants'
  | 'red-supergiants'
  | 'white-dwarfs'
  | 'cool-subdwarfs';

export interface StellarRecord {
  readonly id: string;
  readonly catalogId: string;
  readonly name: string;
  readonly constellation: string;
  readonly spectralClass: StellarSpectralClass;
  readonly spectralType: string;
  readonly luminosityClass: string;
  readonly populationId: StellarPopulationId;
  readonly populationLabel: string;
  /** Effective surface temperature in Kelvin */
  readonly tempK: number;
  /** Bolometric luminosity in Solar luminosities (L / L☉) */
  readonly luminositySolar: number;
  /** Stellar radius in Solar radii (R / R☉) */
  readonly radiusSolar: number;
  /** Stellar mass in Solar masses (M / M☉) */
  readonly massSolar: number;
  /** Johnson B-V photometric color index */
  readonly bvColor: number;
  /** Iron abundance [Fe/H] in dex relative to the Sun */
  readonly metallicityFeH: number;
  /** Heliocentric distance in parsecs */
  readonly distancePc: number;
  /** Estimated evolutionary age in Gyr */
  readonly ageGyr: number;
  /** Surface gravity log10(g [cm/s^2]) */
  readonly logG: number;
  /**
   * 8D standardized astrophysical feature vector:
   * [logTeff, logLum, logRadius, logMass, bvColor, metallicityFeH, logAge, logG]
   */
  readonly embedding: Float32Array;
}

interface StellarPopulationSpec {
  readonly id: StellarPopulationId;
  readonly label: string;
  readonly shortLabel: string;
  readonly spectralClass: StellarSpectralClass;
  readonly spectralSubtypes: readonly string[];
  readonly luminosityClass: string;
  readonly weight: number;
  /** [logTeff, logLum, logRadius, logMass, bvColor, metallicityFeH, logAge, logG] centroid */
  readonly centroid: readonly [number, number, number, number, number, number, number, number];
  /** Per-axis spread (standard deviation) */
  readonly spread: readonly [number, number, number, number, number, number, number, number];
  readonly tempRange: readonly [number, number];
  readonly logLumRange: readonly [number, number];
  readonly logRadiusRange: readonly [number, number];
  readonly logMassRange: readonly [number, number];
  readonly bvRange: readonly [number, number];
  readonly fehRange: readonly [number, number];
  readonly ageRange: readonly [number, number];
  readonly logGRange: readonly [number, number];
  readonly neighbors: readonly StellarPopulationId[];
}

const POPULATION_SPECS: readonly StellarPopulationSpec[] = [
  {
    id: 'ob-supergiants',
    label: 'O-B Blue Supergiants',
    shortLabel: 'O-B Supergiants',
    spectralClass: 'O',
    spectralSubtypes: ['O6 Ia', 'O8 Ib', 'O9.5 Ia', 'B0 Ia', 'B1 Ib', 'B2 Ia'],
    luminosityClass: 'Ia/Ib',
    weight: 0.065,
    centroid: [2.4, 2.3, 1.4, 2.4, -1.7, 0.4, -1.9, -1.1],
    spread: [0.34, 0.34, 0.3, 0.32, 0.25, 0.26, 0.24, 0.3],
    tempRange: [21500, 39500],
    logLumRange: [4.2, 5.7],
    logRadiusRange: [1.1, 1.8],
    logMassRange: [1.15, 1.65],
    bvRange: [-0.33, -0.18],
    fehRange: [-0.08, 0.22],
    ageRange: [0.004, 0.03],
    logGRange: [2.5, 3.4],
    neighbors: ['b-main-seq', 'yellow-supergiants'],
  },
  {
    id: 'b-main-seq',
    label: 'B-Type Main Sequence',
    shortLabel: 'B Main Seq.',
    spectralClass: 'B',
    spectralSubtypes: ['B2 V', 'B4 V', 'B6 V', 'B7 V', 'B8 V', 'B9 V'],
    luminosityClass: 'V',
    weight: 0.08,
    centroid: [1.75, 1.05, 0.35, 1.35, -1.25, 0.25, -1.35, 0.2],
    spread: [0.34, 0.36, 0.28, 0.3, 0.24, 0.28, 0.28, 0.28],
    tempRange: [10800, 19800],
    logLumRange: [1.6, 3.4],
    logRadiusRange: [0.42, 0.82],
    logMassRange: [0.45, 0.96],
    bvRange: [-0.21, -0.06],
    fehRange: [-0.15, 0.2],
    ageRange: [0.03, 0.25],
    logGRange: [3.85, 4.25],
    neighbors: ['ob-supergiants', 'a-white'],
  },
  {
    id: 'a-white',
    label: 'A-Type White Stars',
    shortLabel: 'A White Stars',
    spectralClass: 'A',
    spectralSubtypes: ['A0 V', 'A1 V', 'A3 V', 'A5 IV', 'A7 V', 'A9 V'],
    luminosityClass: 'V/IV',
    weight: 0.095,
    centroid: [1.1, 0.45, 0.08, 0.65, -0.78, 0.15, -0.75, 0.32],
    spread: [0.32, 0.3, 0.26, 0.26, 0.24, 0.28, 0.3, 0.26],
    tempRange: [7500, 9900],
    logLumRange: [0.75, 1.55],
    logRadiusRange: [0.16, 0.42],
    logMassRange: [0.2, 0.4],
    bvRange: [-0.02, 0.28],
    fehRange: [-0.2, 0.24],
    ageRange: [0.2, 0.95],
    logGRange: [3.95, 4.32],
    neighbors: ['b-main-seq', 'f-yellow-white'],
  },
  {
    id: 'f-yellow-white',
    label: 'F-Type Yellow-White',
    shortLabel: 'F Yellow-White',
    spectralClass: 'F',
    spectralSubtypes: ['F0 V', 'F2 V', 'F5 V', 'F6 IV', 'F8 V', 'F9 V'],
    luminosityClass: 'V/IV',
    weight: 0.095,
    centroid: [0.55, 0.05, -0.05, 0.22, -0.25, 0.08, -0.18, 0.36],
    spread: [0.28, 0.28, 0.24, 0.24, 0.24, 0.28, 0.3, 0.26],
    tempRange: [6050, 7400],
    logLumRange: [0.2, 0.85],
    logRadiusRange: [0.05, 0.24],
    logMassRange: [0.04, 0.2],
    bvRange: [0.3, 0.56],
    fehRange: [-0.28, 0.22],
    ageRange: [1.1, 3.8],
    logGRange: [4.05, 4.4],
    neighbors: ['a-white', 'g-solar', 'yellow-supergiants'],
  },
  {
    id: 'g-solar',
    label: 'G-Type Solar Analogs',
    shortLabel: 'G Solar Analogs',
    spectralClass: 'G',
    spectralSubtypes: ['G0 V', 'G2 V', 'G4 V', 'G5 V', 'G8 V', 'G9 IV'],
    luminosityClass: 'V',
    weight: 0.1,
    centroid: [0.05, -0.28, -0.22, -0.05, 0.25, 0.02, 0.35, 0.5],
    spread: [0.28, 0.26, 0.24, 0.22, 0.24, 0.28, 0.28, 0.24],
    tempRange: [5250, 6000],
    logLumRange: [-0.22, 0.26],
    logRadiusRange: [-0.08, 0.1],
    logMassRange: [-0.08, 0.06],
    bvRange: [0.58, 0.78],
    fehRange: [-0.32, 0.28],
    ageRange: [3.0, 7.6],
    logGRange: [4.25, 4.55],
    neighbors: ['f-yellow-white', 'k-orange-dwarf', 'red-giants'],
  },
  {
    id: 'k-orange-dwarf',
    label: 'K-Type Orange Dwarfs',
    shortLabel: 'K Orange Dwarfs',
    spectralClass: 'K',
    spectralSubtypes: ['K0 V', 'K2 V', 'K4 V', 'K5 V', 'K7 V', 'K9 V'],
    luminosityClass: 'V',
    weight: 0.095,
    centroid: [-0.55, -0.78, -0.52, -0.45, 0.78, -0.04, 0.8, 0.72],
    spread: [0.28, 0.28, 0.24, 0.24, 0.24, 0.28, 0.28, 0.24],
    tempRange: [3950, 5180],
    logLumRange: [-0.95, -0.24],
    logRadiusRange: [-0.24, -0.06],
    logMassRange: [-0.26, -0.08],
    bvRange: [0.82, 1.32],
    fehRange: [-0.35, 0.25],
    ageRange: [4.5, 10.2],
    logGRange: [4.48, 4.72],
    neighbors: ['g-solar', 'm-red-dwarf', 'cool-subdwarfs'],
  },
  {
    id: 'm-red-dwarf',
    label: 'M-Type Red Dwarfs',
    shortLabel: 'M Red Dwarfs',
    spectralClass: 'M',
    spectralSubtypes: ['M0 V', 'M1.5 V', 'M3 V', 'M4 V', 'M5 V', 'M6 V'],
    luminosityClass: 'V',
    weight: 0.1,
    centroid: [-1.35, -1.65, -1.05, -1.15, 1.48, -0.1, 1.15, 1.05],
    spread: [0.3, 0.34, 0.28, 0.28, 0.26, 0.28, 0.28, 0.26],
    tempRange: [2650, 3850],
    logLumRange: [-2.85, -1.05],
    logRadiusRange: [-0.75, -0.26],
    logMassRange: [-0.85, -0.28],
    bvRange: [1.38, 1.92],
    fehRange: [-0.4, 0.2],
    ageRange: [5.5, 11.8],
    logGRange: [4.75, 5.18],
    neighbors: ['k-orange-dwarf', 'cool-subdwarfs'],
  },
  {
    id: 'red-giants',
    label: 'Red Giant Branch',
    shortLabel: 'Red Giants',
    spectralClass: 'K',
    spectralSubtypes: ['G8 III', 'K0 III', 'K2 III', 'K5 III', 'M0 III', 'M2 III'],
    luminosityClass: 'III',
    weight: 0.09,
    centroid: [-0.62, 1.12, 1.32, 0.32, 1.08, -0.25, 0.72, -1.32],
    spread: [0.3, 0.32, 0.3, 0.28, 0.26, 0.3, 0.3, 0.28],
    tempRange: [3450, 4950],
    logLumRange: [1.55, 2.75],
    logRadiusRange: [0.95, 1.62],
    logMassRange: [-0.04, 0.45],
    bvRange: [0.98, 1.62],
    fehRange: [-0.65, 0.12],
    ageRange: [3.2, 9.8],
    logGRange: [1.4, 2.65],
    neighbors: ['g-solar', 'red-supergiants', 'yellow-supergiants'],
  },
  {
    id: 'yellow-supergiants',
    label: 'Yellow Supergiants',
    shortLabel: 'Yellow Supergiants',
    spectralClass: 'F',
    spectralSubtypes: ['F5 Ib', 'F8 Ia', 'G0 Ib', 'G2 Ia', 'G5 Ib', 'G8 II'],
    luminosityClass: 'Ia/Ib',
    weight: 0.065,
    centroid: [0.22, 1.95, 1.85, 1.45, 0.42, 0.18, -1.45, -1.65],
    spread: [0.3, 0.32, 0.3, 0.3, 0.26, 0.28, 0.28, 0.28],
    tempRange: [4950, 6900],
    logLumRange: [3.3, 4.8],
    logRadiusRange: [1.62, 2.28],
    logMassRange: [0.82, 1.28],
    bvRange: [0.38, 1.02],
    fehRange: [-0.12, 0.24],
    ageRange: [0.02, 0.12],
    logGRange: [0.95, 2.05],
    neighbors: ['ob-supergiants', 'f-yellow-white', 'red-supergiants'],
  },
  {
    id: 'red-supergiants',
    label: 'Red Supergiants',
    shortLabel: 'Red Supergiants',
    spectralClass: 'M',
    spectralSubtypes: ['K5 Ib', 'M0 Iab', 'M1 Ia', 'M2 Iab', 'M3 Ia', 'M4 Ib'],
    luminosityClass: 'Ia/Iab',
    weight: 0.065,
    centroid: [-1.22, 2.15, 2.45, 1.55, 1.62, 0.08, -1.35, -2.35],
    spread: [0.3, 0.34, 0.32, 0.3, 0.26, 0.28, 0.28, 0.3],
    tempRange: [3150, 4050],
    logLumRange: [4.1, 5.45],
    logRadiusRange: [2.35, 3.0],
    logMassRange: [0.95, 1.38],
    bvRange: [1.52, 2.05],
    fehRange: [-0.22, 0.2],
    ageRange: [0.01, 0.06],
    logGRange: [-0.3, 0.75],
    neighbors: ['red-giants', 'yellow-supergiants'],
  },
  {
    id: 'white-dwarfs',
    label: 'Hot White Dwarfs',
    shortLabel: 'White Dwarfs',
    spectralClass: 'D',
    spectralSubtypes: ['DA2 VII', 'DA3 VII', 'DA4 VII', 'DB3 VII', 'DC5 VII', 'DO1 VII'],
    luminosityClass: 'VII',
    weight: 0.075,
    centroid: [1.55, -2.25, -2.55, -0.35, -1.15, -0.15, 0.95, 2.55],
    spread: [0.36, 0.34, 0.28, 0.24, 0.28, 0.3, 0.3, 0.28],
    tempRange: [9500, 29000],
    logLumRange: [-3.4, -1.4],
    logRadiusRange: [-2.12, -1.84],
    logMassRange: [-0.28, -0.05],
    bvRange: [-0.28, 0.18],
    fehRange: [-0.5, 0.1],
    ageRange: [4.0, 10.5],
    logGRange: [7.65, 8.45],
    neighbors: ['b-main-seq', 'a-white'],
  },
  {
    id: 'cool-subdwarfs',
    label: 'Halo Cool Subdwarfs',
    shortLabel: 'Halo Subdwarfs',
    spectralClass: 'K',
    spectralSubtypes: ['sdF8 VI', 'sdG4 VI', 'sdK1 VI', 'sdK5 VI', 'sdM0 VI', 'sdM2 VI'],
    luminosityClass: 'VI',
    weight: 0.075,
    centroid: [-0.72, -1.18, -0.78, -0.68, 0.55, -2.15, 1.55, 0.92],
    spread: [0.32, 0.3, 0.26, 0.26, 0.26, 0.34, 0.26, 0.26],
    tempRange: [3500, 5600],
    logLumRange: [-1.75, -0.45],
    logRadiusRange: [-0.45, -0.14],
    logMassRange: [-0.48, -0.18],
    bvRange: [0.65, 1.42],
    fehRange: [-2.2, -1.05],
    ageRange: [10.2, 13.1],
    logGRange: [4.62, 5.02],
    neighbors: ['k-orange-dwarf', 'm-red-dwarf', 'red-giants'],
  },
];

const POP_BY_ID = new Map<StellarPopulationId, StellarPopulationSpec>(
  POPULATION_SPECS.map((p) => [p.id, p]),
);

const CONSTELLATIONS = [
  'Ori', 'Cyg', 'Car', 'Sco', 'Cen', 'Lyr', 'Aql', 'Per', 'Tau', 'Gem',
  'Cas', 'UMa', 'Cru', 'Vela', 'Sgr', 'Aur', 'Boo', 'Vir', 'Leo', 'Psc',
  'Dra', 'Her', 'Peg', 'And', 'Cyg', 'Pup', 'CMa', 'Mon', 'Eri', 'Cet',
] as const;

const BAYER_PREFIXES = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho',
  'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega',
] as const;

export const SPECTRAL_CLASS_COLORS: Record<StellarSpectralClass, string> = {
  O: '#60a5fa',
  B: '#7dd3fc',
  A: '#cbd5e1',
  F: '#fef08a',
  G: '#facc15',
  K: '#fb923c',
  M: '#f87171',
  D: '#a78bfa',
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nextGaussian(rand: () => number): number {
  const u1 = Math.max(1e-7, rand());
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const STELLAR_CACHE = new Map<number, readonly StellarRecord[]>();

/**
 * Generates a deterministic astrophysical star catalog of size `count`
 * (e.g., `1000`, `2000`, or `3500` records), cached by count.
 */
export function buildStellarCatalog(count = 2000): readonly StellarRecord[] {
  const cached = STELLAR_CACHE.get(count);
  if (cached) return cached;

  const rand = mulberry32(0x5374656c ^ (count * 2654435761));
  const totalWeight = POPULATION_SPECS.reduce((acc, p) => acc + p.weight, 0);
  const cumulative: { spec: StellarPopulationSpec; threshold: number }[] = [];
  let running = 0;
  for (const spec of POPULATION_SPECS) {
    running += spec.weight / totalWeight;
    cumulative.push({ spec, threshold: running });
  }

  const pickSpec = (u: number): StellarPopulationSpec => {
    for (const entry of cumulative) {
      if (u <= entry.threshold) return entry.spec;
    }
    return POPULATION_SPECS[POPULATION_SPECS.length - 1]!;
  };

  const records: StellarRecord[] = new Array(count);

  for (let i = 0; i < count; i++) {
    // Ensure balanced early coverage across all 12 populations, then weighted draw
    const primary =
      i < POPULATION_SPECS.length * 4
        ? POPULATION_SPECS[i % POPULATION_SPECS.length]!
        : pickSpec(rand());

    // ~34% of stars lie along evolutionary transition tracks between neighboring populations
    const isTransition = rand() < 0.34 && primary.neighbors.length > 0;
    const secondary = isTransition
      ? POP_BY_ID.get(
          primary.neighbors[Math.floor(rand() * primary.neighbors.length)]!,
        ) ?? primary
      : primary;
    const blend = isTransition ? 0.16 + rand() * 0.28 : 0;

    const emb = new Float32Array(8);
    for (let d = 0; d < 8; d++) {
      const mean = lerp(primary.centroid[d]!, secondary.centroid[d]!, blend);
      const sd = lerp(primary.spread[d]!, secondary.spread[d]!, blend);
      emb[d] = Number((mean + nextGaussian(rand) * sd).toFixed(4));
    }

    const u0 = clamp(0.5 + nextGaussian(rand) * 0.2, 0.02, 0.98);
    const u1 = clamp(0.5 + nextGaussian(rand) * 0.2, 0.02, 0.98);
    const tempK = Math.round(
      lerp(
        lerp(primary.tempRange[0], primary.tempRange[1], u0),
        lerp(secondary.tempRange[0], secondary.tempRange[1], u0),
        blend,
      ),
    );
    const logLum = lerp(
      lerp(primary.logLumRange[0], primary.logLumRange[1], u1),
      lerp(secondary.logLumRange[0], secondary.logLumRange[1], u1),
      blend,
    );
    const logRad = lerp(
      lerp(primary.logRadiusRange[0], primary.logRadiusRange[1], u1),
      lerp(secondary.logRadiusRange[0], secondary.logRadiusRange[1], u1),
      blend,
    );
    const logMass = lerp(
      lerp(primary.logMassRange[0], primary.logMassRange[1], u0),
      lerp(secondary.logMassRange[0], secondary.logMassRange[1], u0),
      blend,
    );
    const bvColor = Number(
      lerp(
        lerp(primary.bvRange[0], primary.bvRange[1], 1 - u0),
        lerp(secondary.bvRange[0], secondary.bvRange[1], 1 - u0),
        blend,
      ).toFixed(2),
    );
    const metallicityFeH = Number(
      lerp(
        lerp(primary.fehRange[0], primary.fehRange[1], rand()),
        lerp(secondary.fehRange[0], secondary.fehRange[1], rand()),
        blend,
      ).toFixed(2),
    );
    const ageGyr = Number(
      Math.max(
        0.003,
        lerp(
          lerp(primary.ageRange[0], primary.ageRange[1], rand()),
          lerp(secondary.ageRange[0], secondary.ageRange[1], rand()),
          blend,
        ),
      ).toFixed(3),
    );
    const logG = Number(
      lerp(
        lerp(primary.logGRange[0], primary.logGRange[1], 1 - u1),
        lerp(secondary.logGRange[0], secondary.logGRange[1], 1 - u1),
        blend,
      ).toFixed(2),
    );

    const hipNum = 10040 + i * 29 + Math.floor(rand() * 19);
    const catalogId = `HIP ${hipNum}`;
    const constellation = CONSTELLATIONS[(i * 7 + Math.floor(rand() * 5)) % CONSTELLATIONS.length]!;
    const subtype =
      primary.spectralSubtypes[
        Math.floor(rand() * primary.spectralSubtypes.length)
      ]!;
    const distancePc = Number(
      Math.pow(10, 0.7 + rand() * 2.15 + (primary.luminosityClass.startsWith('I') ? 0.55 : 0)).toFixed(1),
    );

    const name =
      i < 72
        ? `${BAYER_PREFIXES[i % BAYER_PREFIXES.length]} ${constellation}`
        : `HD ${102400 + i * 47}`;

    records[i] = {
      id: `hip-${hipNum}`,
      catalogId,
      name,
      constellation,
      spectralClass: primary.spectralClass,
      spectralType: subtype,
      luminosityClass: primary.luminosityClass,
      populationId: primary.id,
      populationLabel: primary.label,
      tempK,
      luminositySolar: Number(Math.pow(10, logLum).toPrecision(3)),
      radiusSolar: Number(Math.pow(10, logRad).toPrecision(3)),
      massSolar: Number(Math.pow(10, logMass).toPrecision(3)),
      bvColor,
      metallicityFeH,
      distancePc,
      ageGyr,
      logG,
      embedding: emb,
    };
  }

  STELLAR_CACHE.set(count, records);
  return records;
}

/**
 * Derives disambiguated astrophysical cluster titles for a solved snapshot on the main thread.
 */
export function deriveStellarClusterTitles(
  clusters: ReadonlyArray<{
    readonly id: string;
    readonly members: ReadonlyArray<{
      readonly item: StellarRecord;
      readonly normalizedWeight?: number;
    }>;
  }>,
): ReadonlyMap<string, string> {
  const raw = clusters.map((c) => {
    const counts = new Map<StellarPopulationId, number>();
    let tempSum = 0;
    let weightSum = 0;
    for (const m of c.members) {
      const w = Math.pow(m.normalizedWeight ?? 1, 1.5);
      counts.set(m.item.populationId, (counts.get(m.item.populationId) ?? 0) + w);
      tempSum += m.item.tempK * w;
      weightSum += w;
    }
    const topPopId =
      [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'g-solar';
    const spec = POP_BY_ID.get(topPopId);
    const meanTemp = weightSum > 0 ? Math.round(tempSum / weightSum) : 5778;
    return {
      id: c.id,
      baseTitle: spec?.shortLabel ?? 'Stellar Population',
      meanTemp,
    };
  });

  const freq = new Map<string, number>();
  for (const r of raw) {
    freq.set(r.baseTitle, (freq.get(r.baseTitle) ?? 0) + 1);
  }

  const result = new Map<string, string>();
  for (const r of raw) {
    if ((freq.get(r.baseTitle) ?? 0) > 1) {
      result.set(r.id, `${r.baseTitle} (${(r.meanTemp / 1000).toFixed(1)}k K)`);
    } else {
      result.set(r.id, r.baseTitle);
    }
  }
  return result;
}
