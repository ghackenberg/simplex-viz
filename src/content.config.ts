import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { DEMO_DATASET_IDS } from './demo/data/multimodalCatalog';
import {
  ALL_STRATEGY_IDS,
  CLUSTERING_STRATEGY_IDS,
  COLOR_STRATEGY_IDS,
  LAYOUT_STRATEGY_IDS,
  MESH_STRATEGY_IDS,
  ZOOM_STRATEGY_IDS,
} from './site/strategies';

/**
 * 1. Guides & Stage Overviews (`/docs/[slug]`)
 */
const docs = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    shortTitle: z.string(),
    description: z.string(),
    section: z.enum(['Getting Started', 'Core Strategies', 'Customization']),
    order: z.number().int().positive(),
    stageNumber: z.number().int().min(1).max(5).optional(),
    updatedDate: z.string(),
    summaryPoints: z.array(z.string()).min(2).max(5),
    relatedApiSlug: z.enum(['core', 'svg', 'canvas', 'react', 'wc']).optional(),
  }),
});

/**
 * 2. Individual Strategy Reference Sub-Pages (`/docs/strategies/[slug]`)
 */
const strategies = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/strategies' }),
  schema: z.object({
    strategyId: z.enum(ALL_STRATEGY_IDS),
    order: z.number().int().positive(),
    signature: z.string(),
    updatedDate: z.string(),
    whenToUse: z.array(z.string()).min(2).max(4),
    optionsTable: z.array(
      z.object({
        name: z.string(),
        type: z.string(),
        defaultValue: z.string(),
        description: z.string(),
      }),
    ),
  }),
});

/**
 * 3. Package API Reference (`/docs/api/[slug]`)
 */
const api = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/api' }),
  schema: z.object({
    title: z.string(),
    packageName: z.enum([
      '@simplex-viz/core',
      '@simplex-viz/svg',
      '@simplex-viz/canvas',
      '@simplex-viz/react',
      '@simplex-viz/wc',
    ]),
    version: z.string(),
    layerLabel: z.string(),
    description: z.string(),
    order: z.number().int().positive(),
    zeroRuntimeDeps: z.boolean(),
    installCommand: z.string(),
    entryPoints: z
      .array(
        z.object({
          subpath: z.string(),
          importPath: z.string(),
          environment: z.string(),
          domFree: z.boolean(),
          sideEffects: z.boolean(),
          rootReExported: z.boolean(),
          summary: z.string(),
        }),
      )
      .min(1),
    exportsTable: z.array(
      z.object({
        symbol: z.string(),
        entrypoint: z.string().optional(),
        kind: z.enum([
          'Class',
          'Function',
          'Component',
          'Hook',
          'Interface',
          'View Plugin',
          'Subpath',
        ]),
        signature: z.string(),
        summary: z.string(),
      }),
    ),
  }),
});

/**
 * 4. Interactive Real-World Open Dataset Examples (`/examples/[slug]`)
 * Item counts and source attributions are derived dynamically from `multimodalCatalog.ts`
 * so displayed counts can never drift out of sync with actual data arrays.
 */
const datasets = defineCollection({
  loader: glob({ pattern: '*/index.mdx', base: './src/content/datasets' }),
  schema: z.object({
    title: z.string(),
    datasetId: z.enum(DEMO_DATASET_IDS),
    domainLabel: z.string(),
    representationLabel: z.string(),
    requiresTags: z.boolean(),
    dimensionsSummary: z.string(),
    meshStrategy: z.enum(MESH_STRATEGY_IDS),
    clusteringStrategy: z.enum(CLUSTERING_STRATEGY_IDS),
    colorStrategy: z.enum(COLOR_STRATEGY_IDS),
    layoutStrategy: z.enum(LAYOUT_STRATEGY_IDS),
    zoomStrategy: z.enum(ZOOM_STRATEGY_IDS),
    nodeView: z.enum(['domain', 'geometric', 'multisector', 'react-card']),
    timelineEnabled: z.boolean().optional(),
    publishedDate: z.string(),
    description: z.string(),
    order: z.number().int().positive(),
  }),
});

/**
 * 5. Engineering & Release Notes (`/notes/[slug]`)
 */
const notes = defineCollection({
  loader: glob({ pattern: '*/index.mdx', base: './src/content/notes' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedDate: z.string(),
    author: z.string(),
    authorRole: z.string(),
    category: z.enum(['Release', 'Geometry', 'Architecture']).optional(),
    featured: z.boolean().default(false),
    summaryPoints: z.array(z.string()).min(2).max(5),
  }),
});

export const collections = {
  docs,
  strategies,
  api,
  datasets,
  notes,
};
