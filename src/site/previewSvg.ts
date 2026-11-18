function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Strips XML prologues and fixed dimensions from an imported SVG string so it
 * scales responsively inside a container with a consistent hover transition.
 */
export function prepareInlinePreviewSvg(
  raw: string | undefined,
  missingMessage: string,
  ariaLabel?: string,
): string {
  if (!raw || !raw.includes('<svg')) {
    throw new Error(missingMessage);
  }

  const labelAttr = ariaLabel
    ? ` role="img" aria-label="${escapeAttr(ariaLabel)}"`
    : ' aria-hidden="true"';

  return raw
    .replace(/<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/<svg\b([^>]*)>/i, (_fullMatch, rawAttrs: string) => {
      const cleanedAttrs = rawAttrs
        .replace(/\s(?:width|height|class|role|aria-label|aria-hidden)=("[^"]*"|'[^']*')/gi, '')
        .trim();
      const attrPrefix = cleanedAttrs.length > 0 ? ` ${cleanedAttrs}` : '';
      return `<svg${attrPrefix}${labelAttr} class="block h-full w-full transition-transform duration-300 group-hover:scale-[1.02]">`;
    });
}
