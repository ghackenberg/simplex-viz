import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getStrategySpec } from '../site/strategies';
import { SITE_META } from '../site/url';

function stripMdxImportsAndJsxIslands(rawBody: string | undefined): string {
  if (!rawBody) return '';
  return rawBody
    .replace(/<StrategyDecisionList[\s\S]*?\/>/g, '')
    .replace(/<StrategyDiagram[\s\S]*?\/>/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('import '))
    .filter(
      (line) =>
        !line.includes('<StrategyLiveSandbox') &&
        !line.includes('<UseCaseMiniAtlas'),
    )
    .join('\n')
    .trim();
}

export const GET: APIRoute = async () => {
  const docs = (await getCollection('docs')).sort((a, b) => a.data.order - b.data.order);
  const strategies = (await getCollection('strategies')).sort(
    (a, b) => a.data.order - b.data.order,
  );
  const api = (await getCollection('api')).sort((a, b) => a.data.order - b.data.order);
  const datasets = (await getCollection('datasets')).sort(
    (a, b) => a.data.order - b.data.order,
  );
  const notes = (await getCollection('notes')).sort((a, b) =>
    b.data.publishedDate.localeCompare(a.data.publishedDate),
  );

  const sections: string[] = [
    `# ${SITE_META.name} v${SITE_META.version} — Full Developer & Strategy Reference`,
    '',
    SITE_META.defaultDescription,
    '',
  ];

  for (const d of docs) {
    sections.push(
      `---`,
      `# [Guide] ${d.data.title}`,
      `${d.data.description}`,
      '',
      'Key Takeaways:',
      ...d.data.summaryPoints.map((pt) => `- ${pt}`),
      '',
      stripMdxImportsAndJsxIslands(d.body),
      '',
    );
  }

  for (const st of strategies) {
    const spec = getStrategySpec(st.data.strategyId);
    sections.push(
      `---`,
      `# [Strategy] ${spec.name} (Stage 0${spec.stage}: ${spec.stageLabel})`,
      `Factory: \`${st.data.signature}\``,
      `${spec.summary}`,
      '',
      'When to Use:',
      ...st.data.whenToUse.map((pt) => `- ${pt}`),
      '',
      stripMdxImportsAndJsxIslands(st.body),
      '',
    );
  }

  for (const pkg of api) {
    sections.push(
      `---`,
      `# [API] ${pkg.data.packageName} (v${pkg.data.version})`,
      `${pkg.data.description}`,
      `Install: \`${pkg.data.installCommand}\``,
      '',
      'Exports:',
      ...pkg.data.exportsTable.map(
        (ex) => `- \`${ex.symbol}\` (${ex.kind}): \`${ex.signature}\` — ${ex.summary}`,
      ),
      '',
      stripMdxImportsAndJsxIslands(pkg.body),
      '',
    );
  }

  for (const ds of datasets) {
    const mesh = getStrategySpec(ds.data.meshStrategy);
    const clustering = getStrategySpec(ds.data.clusteringStrategy);
    const color = getStrategySpec(ds.data.colorStrategy);
    const layout = getStrategySpec(ds.data.layoutStrategy);
    const zoom = getStrategySpec(ds.data.zoomStrategy);
    sections.push(
      `---`,
      `# [Example] ${ds.data.title}`,
      `Domain: ${ds.data.domainLabel} | Representation: ${ds.data.representationLabel} | requiresTags: ${ds.data.requiresTags}`,
      `Mesh Strategy: ${mesh.name} (\`${mesh.factoryName}\`)`,
      `Clustering Strategy: ${clustering.name} (\`${clustering.factoryName}\`)`,
      `Color Strategy: ${color.name} (\`${color.factoryName}\`)`,
      `Layout Strategy: ${layout.name} (\`${layout.factoryName}\`)`,
      `Zoom Strategy: ${zoom.name} (\`${zoom.factoryName}\`)`,
      '',
      stripMdxImportsAndJsxIslands(ds.body),
      '',
    );
  }

  for (const note of notes) {
    sections.push(
      `---`,
      `# [Note] ${note.data.title} (${note.data.publishedDate})`,
      `${note.data.description}`,
      '',
      stripMdxImportsAndJsxIslands(note.body),
      '',
    );
  }

  return new Response(sections.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
