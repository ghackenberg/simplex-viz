import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { ALL_STRATEGY_IDS, getStrategySpec } from '../site/strategies';
import { SITE_META, withBase } from '../site/url';

export const GET: APIRoute = async () => {
  const docs = (await getCollection('docs')).sort((a, b) => a.data.order - b.data.order);
  const api = (await getCollection('api')).sort((a, b) => a.data.order - b.data.order);
  const datasets = (await getCollection('datasets')).sort(
    (a, b) => a.data.order - b.data.order,
  );
  const notes = (await getCollection('notes')).sort((a, b) =>
    b.data.publishedDate.localeCompare(a.data.publishedDate),
  );

  const origin = SITE_META.canonicalOrigin;
  const toAbs = (p: string) => new URL(withBase(p), origin).toString();

  const lines: string[] = [
    `# ${SITE_META.name} (v${SITE_META.version})`,
    '',
    `> ${SITE_META.defaultDescription}`,
    '',
    `Complete concatenated Markdown corpus for AI agents: ${toAbs('/llms-full.txt')}`,
    '',
    '## Packages',
    '- `@simplex-viz/core`: Zero-dependency, DOM-free TypeScript engine (mesh, clustering, OKLab, convex SAT layout, 1:4 hierarchical zoom).',
    '- `@simplex-viz/svg`: Framework-agnostic SVG scene graph, view plugins, offscreen getBBox() hull measurement, and breadcrumbs.',
    '- `@simplex-viz/react`: Type-safe React 18/19 `<SimplexTopicGraph />` component and `useSimplexGraphController()` hook.',
    '- `@simplex-viz/wc`: Framework-agnostic `<simplex-topic-graph>` Web Component (zero React dependency) with SSR-safe `@simplex-viz/wc/define` registration.',
    '',
    '## Guides & Stage Overviews',
    ...docs.map(
      (d) => `- [${d.data.title}](${toAbs(`/docs/${d.id}`)}): ${d.data.description}`,
    ),
    '',
    '## Individual Strategy Reference Pages (18)',
    ...ALL_STRATEGY_IDS.map((id) => {
      const spec = getStrategySpec(id);
      return `- [${spec.name}](${toAbs(spec.strategyDocPath)}) (\`${spec.factoryName}\`, Stage ${spec.stage}): ${spec.summary}`;
    }),
    '',
    '## API Reference',
    ...api.map(
      (a) => `- [${a.data.packageName}](${toAbs(`/docs/api/${a.id}`)}): ${a.data.description}`,
    ),
    '',
    '## Interactive Examples & Standalone Playground',
    `- [Tagged Dataset Playground](${toAbs('/playground')}): Interactive sandbox to build custom tagged datasets or import/export JSON via paste, file dialog, or desktop drag-and-drop.`,
    ...datasets.map(
      (ds) =>
        `- [${ds.data.title}](${toAbs(`/examples/${ds.id}`)}): ${ds.data.description}`,
    ),
    '',
    '## Notes',
    ...notes.map(
      (n) => `- [${n.data.title}](${toAbs(`/notes/${n.id}`)}): ${n.data.description}`,
    ),
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
