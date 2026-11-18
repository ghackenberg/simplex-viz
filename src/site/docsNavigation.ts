import type { CollectionEntry } from 'astro:content';
import { getStrategiesByStage } from './strategies';

export type DocsNavGroup = 'overview' | 'docs' | 'strategies' | 'api';

export interface DocsNavNode {
  readonly key: string;
  readonly href: string;
  readonly label: string;
  readonly contextLabel: string;
}

export interface DocsPagination {
  readonly prev: DocsNavNode | null;
  readonly next: DocsNavNode | null;
}

/**
 * Builds the exact linear reading sequence matching the left documentation sidebar
 * from top to bottom across Getting Started, Strategies (Stages + Sub-Pages), and API Reference.
 */
export function buildDocsNavSequence(
  allDocs: readonly CollectionEntry<'docs'>[],
  allApi: readonly CollectionEntry<'api'>[],
): readonly DocsNavNode[] {
  const sortedDocs = [...allDocs].sort((a, b) => a.data.order - b.data.order);
  const sortedApi = [...allApi].sort((a, b) => a.data.order - b.data.order);

  const gettingStartedDocs = sortedDocs.filter(
    (d) => d.data.section === 'Getting Started',
  );
  const customizationDocs = sortedDocs.filter(
    (d) => d.data.section === 'Customization',
  );
  const stageDocs = sortedDocs.filter((d) => d.data.section === 'Core Strategies');

  const nodes: DocsNavNode[] = [
    {
      key: 'overview:index',
      href: '/docs',
      label: 'Docs Overview',
      contextLabel: 'Getting Started',
    },
    ...gettingStartedDocs.map((entry) => ({
      key: `docs:${entry.id}`,
      href: `/docs/${entry.id}`,
      label: entry.data.shortTitle,
      contextLabel: 'Getting Started',
    })),
    ...customizationDocs.map((entry) => ({
      key: `docs:${entry.id}`,
      href: `/docs/${entry.id}`,
      label: entry.data.shortTitle,
      contextLabel: 'Getting Started',
    })),
    {
      key: 'strategies:index',
      href: '/docs/strategies',
      label: 'Strategies Catalog',
      contextLabel: 'Strategies',
    },
  ];

  for (const stageEntry of stageDocs) {
    const stNum = (stageEntry.data.stageNumber ?? 1) as 1 | 2 | 3 | 4 | 5;
    nodes.push({
      key: `docs:${stageEntry.id}`,
      href: `/docs/${stageEntry.id}`,
      label: stageEntry.data.shortTitle,
      contextLabel: 'Core Strategies',
    });

    for (const spec of getStrategiesByStage(stNum)) {
      nodes.push({
        key: `strategies:${spec.id}`,
        href: spec.strategyDocPath,
        label: spec.name,
        contextLabel: `Stage 0${spec.stage}`,
      });
    }
  }

  nodes.push({
    key: 'api:index',
    href: '/docs/api',
    label: 'API Reference',
    contextLabel: 'API Reference',
  });

  for (const pkg of sortedApi) {
    nodes.push({
      key: `api:${pkg.id}`,
      href: `/docs/api/${pkg.id}`,
      label: pkg.data.packageName,
      contextLabel: 'API Reference',
    });
  }

  return nodes;
}

export function resolveDocsPagination(
  sequence: readonly DocsNavNode[],
  activeGroup: DocsNavGroup,
  activeSlug: string,
): DocsPagination {
  const currentKey = `${activeGroup}:${activeSlug}`;
  const idx = sequence.findIndex((node) => node.key === currentKey);
  if (idx === -1) {
    return { prev: null, next: null };
  }
  return {
    prev: (idx > 0 ? sequence[idx - 1] : null) ?? null,
    next: (idx < sequence.length - 1 ? sequence[idx + 1] : null) ?? null,
  };
}
