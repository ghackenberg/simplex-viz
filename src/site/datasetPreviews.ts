import { prepareInlinePreviewSvg } from './previewSvg';

const rawPreviewSvgs = import.meta.glob<string>(
  '../content/datasets/*/preview.svg',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

const previewBySlug = new Map<string, string>();
for (const [filePath, svgSource] of Object.entries(rawPreviewSvgs)) {
  const match = /\/content\/datasets\/([^/]+)\/preview\.svg$/.exec(filePath);
  if (match?.[1]) {
    previewBySlug.set(match[1], svgSource);
  }
}

/**
 * Loads the mandatory colocated `preview.svg` for an example dataset bundle and
 * prepares its root `<svg>` attributes for responsive inline rendering.
 */
export function getDatasetPreviewSvg(slug: string, ariaLabel?: string): string {
  return prepareInlinePreviewSvg(
    previewBySlug.get(slug),
    `Missing mandatory preview.svg for example "${slug}". Expected src/content/datasets/${slug}/preview.svg.`,
    ariaLabel,
  );
}
