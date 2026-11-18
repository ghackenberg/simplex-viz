import type { CollectionEntry } from 'astro:content';

/**
 * Calibration for dense technical and mathematical documentation:
 * - Technical prose: 170 words/minute
 * - Fenced code blocks & TypeScript signatures: 100 tokens/minute
 * - Embedded technical figures, parameter comparisons, & decision matrices: 0.40 minutes (24s) each
 */
const PROSE_WPM = 170;
const CODE_WPM = 100;
const FIGURE_MINUTES = 0.4;

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export interface ReadingTimeInput {
  readonly body?: string;
  readonly extraProse?: readonly string[];
  readonly extraCode?: readonly string[];
  readonly extraFigures?: number;
}

/**
 * Estimates reading time in whole minutes (minimum 1) from raw MDX source
 * plus structured template metadata rendered alongside the article body.
 */
export function estimateReadingMinutes(input: ReadingTimeInput): number {
  const rawBody = input.body ?? '';

  // 1. Extract fenced code blocks before removing MDX imports so TS snippet imports still count as code.
  let codeWords = 0;
  const withoutCode = rawBody.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code: string) => {
    codeWords += countWords(code);
    return ' ';
  });

  // 2. Strip top-level MDX import statements outside code fences.
  const withoutMdxImports = withoutCode.replace(
    /^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm,
    '',
  );

  // 3. Count PascalCase MDX diagram/figure components and strip their JSX tags safely.
  const componentMatches = withoutMdxImports.match(/<[A-Z][A-Za-z0-9]*/g);
  const figureCount = (componentMatches?.length ?? 0) + (input.extraFigures ?? 0);

  const withoutComponents = withoutMdxImports.replace(
    /<[A-Z][A-Za-z0-9]*(?:\s[\s\S]*?)?(?:\/>|>)/g,
    ' ',
  );

  // 4. Strip inline HTML tags and Markdown punctuation without breaking math operators like `a < b`.
  const plainProse = withoutComponents
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>\n]*)?\/?>/gi, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_`|>~]/g, ' ');

  let proseWords = countWords(plainProse);

  if (input.extraProse) {
    for (const chunk of input.extraProse) {
      proseWords += countWords(chunk);
    }
  }

  if (input.extraCode) {
    for (const chunk of input.extraCode) {
      codeWords += countWords(chunk);
    }
  }

  const totalMinutes =
    proseWords / PROSE_WPM +
    codeWords / CODE_WPM +
    figureCount * FIGURE_MINUTES;

  return Math.max(1, Math.round(totalMinutes));
}

export function getNoteReadingMinutes(post: CollectionEntry<'notes'>): number {
  return estimateReadingMinutes({
    body: post.body,
    extraProse: [post.data.title, post.data.description, ...post.data.summaryPoints],
  });
}

export function getDocReadingMinutes(entry: CollectionEntry<'docs'>): number {
  return estimateReadingMinutes({
    body: entry.body,
    extraProse: [entry.data.title, entry.data.description, ...entry.data.summaryPoints],
  });
}

export function getStrategyReadingMinutes(entry: CollectionEntry<'strategies'>): number {
  const optionProse = entry.data.optionsTable.flatMap((opt) => [
    opt.name,
    opt.type,
    opt.defaultValue,
    opt.description,
  ]);
  return estimateReadingMinutes({
    body: entry.body,
    extraProse: [...entry.data.whenToUse, ...optionProse],
    extraCode: [entry.data.signature],
    extraFigures: 1, // StrategyMechanismFigure rendered by template
  });
}
