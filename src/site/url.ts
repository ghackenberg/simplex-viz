import corePkg from '../../packages/core/package.json';

/**
 * Resolves internal site routes safely whether served at `/` (local dev & AI Studio)
 * or under a GitHub Pages sub-path such as `/simplex-viz/`.
 */
export function withBase(targetPath: string): string {
  const rawBase = import.meta.env.BASE_URL || '/';
  const cleanBase = rawBase === '/' ? '' : rawBase.replace(/\/+$/, '');
  if (!targetPath || targetPath === '/') {
    return cleanBase ? `${cleanBase}/` : '/';
  }
  if (
    targetPath.startsWith('http://') ||
    targetPath.startsWith('https://') ||
    targetPath.startsWith('#') ||
    targetPath.startsWith('mailto:')
  ) {
    return targetPath;
  }
  const normalizedTarget = targetPath.startsWith('/')
    ? targetPath
    : `/${targetPath}`;
  return `${cleanBase}${normalizedTarget}`;
}

export const SITE_META = {
  name: 'SimplexViz',
  defaultTitle: 'SimplexViz — Triangulation Content Atlas',
  defaultDescription:
    'Overlap-free 60-degree simplex triangulation engine for vector embeddings, pairwise similarities, and tagged collections in TypeScript, SVG, and React.',
  canonicalOrigin: 'https://hackenberg.tech',
  authorName: 'Dr. Georg Hackenberg',
  authorUrl: 'https://hackenberg.tech',
  repoUrl: 'https://github.com/ghackenberg/simplex-viz',
  licenseUrl: 'https://github.com/ghackenberg/simplex-viz/blob/main/LICENSE',
  releasesUrl: 'https://github.com/ghackenberg/simplex-viz/releases',
  issuesUrl: 'https://github.com/ghackenberg/simplex-viz/issues',
  npmUrl: 'https://www.npmjs.com/search?q=%40simplex-viz',
  npmCoreUrl: 'https://www.npmjs.com/package/@simplex-viz/core',
  npmSvgUrl: 'https://www.npmjs.com/package/@simplex-viz/svg',
  npmReactUrl: 'https://www.npmjs.com/package/@simplex-viz/react',
  version: corePkg.version,
} as const;
