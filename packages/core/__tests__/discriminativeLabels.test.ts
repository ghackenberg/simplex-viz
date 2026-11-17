import { describe, expect, it } from 'vitest';
import {
  assignDiscriminativeClusterLabels,
  createAdaptiveHexMeshStrategy,
  createFixedLatticeMeshStrategy,
  createSoftSimplexEmbeddingClusteringStrategy,
  disambiguatePeerClusterTitle,
  resolveDiscriminativeClusterLabel,
  solveSimplexSnapshot,
  type SubspaceZoomFeature,
} from '../src';

interface MockFilm {
  readonly id: string;
  readonly shortTitle: string;
  readonly genre: string;
  readonly budgetMusd: number;
  readonly grossMusd: number;
  readonly runtimeMin: number;
  readonly releaseYear: number;
  readonly rottenTomatoes: number;
  readonly vec: readonly number[];
}

describe('Discriminative & Collision-Free Primary Cluster Labeling', () => {
  it('suppresses high-base-rate background categories (e.g. 77% Drama) and assigns unique facet labels across all clusters', () => {
    // 48 films where 37/48 (~77%) carry genre = "Drama"
    const films: MockFilm[] = Array.from({ length: 48 }, (_, i) => {
      const bucket = i % 6;
      const genre =
        i % 9 === 0 ? 'Adventure' : i % 11 === 0 ? 'Action' : 'Drama';
      const budgetMusd =
        bucket === 0 ? 22 : bucket === 1 ? 14 : bucket === 2 ? 0.35 : 2.8 + (i % 3);
      const grossMusd =
        bucket === 1 ? 140 : bucket === 0 ? 55 : bucket === 3 ? 42 : 6 + (i % 5);
      const runtimeMin =
        bucket === 0 ? 215 : bucket === 4 ? 86 : 115 + (i % 4) * 6;
      const releaseYear =
        bucket === 2 ? 1974 : bucket === 5 ? 1939 : 1954 + (i % 6);
      const rottenTomatoes =
        bucket === 3 ? 98 : bucket === 2 ? 72 : 84 + (i % 7);

      return {
        id: `f-${i}`,
        shortTitle: `Film ${i + 1}`,
        genre,
        budgetMusd,
        grossMusd,
        runtimeMin,
        releaseYear,
        rottenTomatoes,
        vec: [
          Math.log10(budgetMusd + 0.1) / 2,
          Math.log10(grossMusd + 0.5) / 2.5,
          (runtimeMin - 80) / 160,
          (rottenTomatoes - 60) / 40,
          (releaseYear - 1935) / 45,
        ],
      };
    });

    const features: readonly SubspaceZoomFeature<MockFilm>[] = [
      {
        id: 'gross',
        label: 'Gross',
        weight: 1.2,
        getValue: (f) => Math.log10(f.grossMusd),
        highLabel: 'Box-Office Hits',
        lowLabel: 'Modest Gross',
      },
      {
        id: 'budget',
        label: 'Budget',
        weight: 1.2,
        getValue: (f) => Math.log10(f.budgetMusd),
        highLabel: 'Big-Budget Epics',
        lowLabel: 'Low-Budget Cult',
      },
      {
        id: 'runtime',
        label: 'Runtime',
        weight: 1.1,
        getValue: (f) => f.runtimeMin,
        highLabel: 'Epic Runtime',
        lowLabel: 'Compact Classics',
      },
      {
        id: 'era',
        label: 'Era',
        weight: 1.0,
        getValue: (f) => f.releaseYear,
        highLabel: 'New Hollywood',
        lowLabel: 'Golden Age',
      },
      {
        id: 'critics',
        label: 'Critics',
        weight: 1.15,
        getValue: (f) => f.rottenTomatoes,
        highLabel: 'Critic Classics',
        lowLabel: 'Crowd-Pleasers',
      },
      {
        id: 'genre',
        label: 'Genre',
        weight: 0.95,
        getValue: (f) => f.genre,
      },
    ];

    const snap = solveSimplexSnapshot(films, {
      viewportWidth: 800,
      viewportHeight: 500,
      meshStrategy: createFixedLatticeMeshStrategy({ cols: 3, rows: 2 }),
      clusteringStrategy: createSoftSimplexEmbeddingClusteringStrategy({
        getEmbedding: (f) => f.vec,
        features,
      }),
      deriveClusterMeta: (ctx) => ({
        title: resolveDiscriminativeClusterLabel(ctx, { features }),
      }),
    });

    const titles = snap.clusters.map((c) => c.cluster.meta!.title);
    const defaultLabels = snap.clusters.map((c) => c.cluster.defaultLabel);

    expect(titles.length).toBe(5);
    expect(new Set(titles.map((t) => t.toLowerCase())).size).toBe(titles.length);
    expect(new Set(defaultLabels.map((t) => t.toLowerCase())).size).toBe(defaultLabels.length);
    expect(titles.filter((t) => t === 'Drama').length).toBeLessThanOrEqual(1);
  });

  it('keeps singleton primary categories unadorned while symmetrically disambiguating shared primary species', () => {
    interface MockPenguin {
      readonly id: string;
      readonly species: string;
      readonly sex: 'Male' | 'Female';
      readonly massG: number;
    }

    const gentoo: MockPenguin[] = Array.from({ length: 10 }, (_, i) => ({
      id: `g-${i}`,
      species: 'Gentoo',
      sex: i % 2 === 0 ? 'Male' : 'Female',
      massG: 5200 + i * 30,
    }));
    const chinstrapMale: MockPenguin[] = Array.from({ length: 10 }, (_, i) => ({
      id: `cm-${i}`,
      species: 'Chinstrap',
      sex: 'Male',
      massG: 4100 + i * 20,
    }));
    const chinstrapFemale: MockPenguin[] = Array.from({ length: 10 }, (_, i) => ({
      id: `cf-${i}`,
      species: 'Chinstrap',
      sex: 'Female',
      massG: 3350 + i * 20,
    }));

    const allItems = [...gentoo, ...chinstrapMale, ...chinstrapFemale];
    const labels = assignDiscriminativeClusterLabels(
      [
        { members: gentoo.map((item) => ({ item, normalizedWeight: 1 })) },
        { members: chinstrapMale.map((item) => ({ item, normalizedWeight: 1 })) },
        { members: chinstrapFemale.map((item) => ({ item, normalizedWeight: 1 })) },
      ],
      {
        features: [
          { id: 'species', label: 'Species', weight: 1.45, getValue: (p) => p.species },
          { id: 'sex', label: 'Sex', weight: 1.15, getValue: (p) => p.sex },
          {
            id: 'mass',
            label: 'Mass',
            weight: 1.1,
            getValue: (p) => p.massG,
            highLabel: 'Heavy',
            lowLabel: 'Compact',
          },
        ],
      },
      allItems,
    );

    expect(labels[0]).toBe('Gentoo');
    expect(labels[1]).toContain('Chinstrap ·');
    expect(labels[2]).toContain('Chinstrap ·');
    expect(new Set(labels).size).toBe(3);
  });

  it('disambiguates colliding custom titles via disambiguatePeerClusterTitle across sibling clusters', () => {
    const items = Array.from({ length: 24 }, (_, i) => ({
      id: `v-${i}`,
      group: i < 8 ? 'Alpha' : 'Beta',
      sub: i < 8 ? 'X' : i < 16 ? 'High' : 'Low',
      vec: i < 8 ? [1, 0, 0] : i < 16 ? [0, 1, 0.2] : [0, 0.2, 1],
    }));

    const snap = solveSimplexSnapshot(items, {
      viewportWidth: 640,
      viewportHeight: 420,
      meshStrategy: createAdaptiveHexMeshStrategy(),
      clusteringStrategy: createSoftSimplexEmbeddingClusteringStrategy({
        getEmbedding: (x) => x.vec,
        clusterCount: 3,
      }),
      deriveClusterMeta: (ctx) => ({
        title: disambiguatePeerClusterTitle(
          ctx,
          (peer) => {
            const counts = new Map<string, number>();
            for (const m of peer.members) {
              counts.set(m.item.group, (counts.get(m.item.group) ?? 0) + m.normalizedWeight);
            }
            return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? peer.code;
          },
          (peer) => {
            const counts = new Map<string, number>();
            for (const m of peer.members) {
              counts.set(m.item.sub, (counts.get(m.item.sub) ?? 0) + m.normalizedWeight);
            }
            return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
          },
        ),
      }),
    });

    const titles = snap.clusters.map((c) => c.cluster.meta!.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
