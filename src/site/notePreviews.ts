import { prepareInlinePreviewSvg } from './previewSvg';

const rawPreviewSvgs = import.meta.glob<string>(
  '../content/notes/*/preview.svg',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

const previewBySlug = new Map<string, string>();
for (const [filePath, svgSource] of Object.entries(rawPreviewSvgs)) {
  const match = /\/content\/notes\/([^/]+)\/preview\.svg$/.exec(filePath);
  if (match?.[1]) {
    previewBySlug.set(match[1], svgSource);
  }
}

/**
 * Loads the mandatory colocated `preview.svg` for a note bundle and prepares
 * its root `<svg>` attributes for responsive inline rendering.
 */
export function getNotePreviewSvg(slug: string, ariaLabel?: string): string {
  return prepareInlinePreviewSvg(
    previewBySlug.get(slug),
    `Missing mandatory preview.svg for note "${slug}". Expected src/content/notes/${slug}/preview.svg.`,
    ariaLabel,
  );
}
