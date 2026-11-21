import { estimateSimplexTextWidth, type SimplexTextMetricsInput } from '@simplex-viz/core';

export interface SvgBadgeTextMetricsInput extends SimplexTextMetricsInput {
  readonly fontFamily: string;
}

export type SvgBadgeMeasureTextFn = (input: SvgBadgeTextMetricsInput) => number;

export interface SvgBadgeLayoutInput {
  readonly variant: 'primary' | 'intermediate';
  readonly code: string;
  readonly title: string;
  readonly metaLine?: string;
  readonly parentContextLabel?: string;
  readonly showCode?: boolean;
}

export interface SvgBadgeLayout {
  readonly variant: 'primary' | 'intermediate';
  readonly hasParentCtx: boolean;
  readonly showCode: boolean;
  readonly code: string;
  readonly upperParent: string;
  readonly title: string;
  readonly metaLine: string;
  readonly codeSpan: number;
  readonly headerContentW: number;
  readonly width: number;
  readonly height: number;
  readonly cut: number;
  readonly haloPad: number;
}

/**
 * Resolves shared SVG cluster badge dimensions, header spans, and chamfer constants
 * for both live `BadgeClusterSvgView` DOM rendering and headless `@simplex-viz/svg/ssr`.
 */
export function resolveSvgBadgeLayout(
  input: SvgBadgeLayoutInput,
  measureText: SvgBadgeMeasureTextFn = estimateSimplexTextWidth,
): SvgBadgeLayout {
  const cleanCode = input.code.trim();
  const cleanTitle = input.title.trim();

  if (input.variant === 'intermediate') {
    const parentCtx = (input.parentContextLabel ?? '').trim();
    const hasParentCtx = parentCtx.length > 0;
    const hasTitleSuffix = cleanTitle.length > 0 && cleanTitle !== cleanCode;
    const mainText = (hasTitleSuffix ? cleanTitle : '') || cleanCode;

    if (hasParentCtx) {
      const upperParent = parentCtx.toUpperCase();
      const topW = measureText({
        text: upperParent,
        fontSize: 7.4,
        fontFamily: 'IBM Plex Mono, monospace',
        fontWeight: 700,
        letterSpacingEm: 0.05,
      });
      const botW = measureText({
        text: mainText,
        fontSize: 9.3,
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontWeight: 700,
      });
      const width = Math.max(66, Math.round(Math.max(topW, botW) + 28));
      return {
        variant: 'intermediate',
        hasParentCtx: true,
        showCode: false,
        code: input.code,
        upperParent,
        title: mainText,
        metaLine: '',
        codeSpan: 0,
        headerContentW: botW,
        width,
        height: 32,
        cut: 6.4,
        haloPad: 2.5,
      };
    }

    const contentW = measureText({
      text: mainText,
      fontSize: 9.1,
      fontFamily: 'Plus Jakarta Sans, sans-serif',
      fontWeight: 700,
    });
    const width = Math.max(52, Math.round(contentW + 26));
    return {
      variant: 'intermediate',
      hasParentCtx: false,
      showCode: false,
      code: input.code,
      upperParent: '',
      title: mainText,
      metaLine: '',
      codeSpan: 0,
      headerContentW: contentW,
      width,
      height: 22,
      cut: 5.5,
      haloPad: 2.4,
    };
  }

  const metaLine = input.metaLine ?? '';
  const showCode = (input.showCode ?? true) && cleanCode.length > 0;
  const codeTextW = showCode
    ? measureText({
        text: input.code,
        fontSize: 9.8,
        fontFamily: 'IBM Plex Mono, monospace',
        fontWeight: 600,
      })
    : 0;
  const codeSpan = showCode ? Math.max(20, codeTextW + 7) : 0;
  const titleTextW = measureText({
    text: cleanTitle,
    fontSize: 11,
    fontFamily: 'Plus Jakarta Sans, sans-serif',
    fontWeight: 700,
    letterSpacingEm: 0.01,
  });
  const headerContentW = codeSpan + titleTextW;
  const metaW = measureText({
    text: metaLine,
    fontSize: 9.3,
    fontFamily: 'IBM Plex Mono, monospace',
    fontWeight: 400,
  });
  const minPrimaryWidth = showCode ? 126 : 96;
  const padX = showCode ? 36 : 32;
  const width = Math.max(
    minPrimaryWidth,
    Math.round(Math.max(headerContentW + padX, metaW + padX)),
  );
  return {
    variant: 'primary',
    hasParentCtx: false,
    showCode,
    code: input.code,
    upperParent: '',
    title: cleanTitle,
    metaLine,
    codeSpan,
    headerContentW,
    width,
    height: 42,
    cut: 0,
    haloPad: 2.8,
  };
}

export function chamferRectSvgPath(
  hw: number,
  hh: number,
  cut: number,
  dy = 0,
): string {
  return [
    `M ${(-hw + cut).toFixed(1)} ${(-hh + dy).toFixed(1)}`,
    `L ${(hw - cut).toFixed(1)} ${(-hh + dy).toFixed(1)}`,
    `L ${hw.toFixed(1)} ${dy.toFixed(1)}`,
    `L ${(hw - cut).toFixed(1)} ${(hh + dy).toFixed(1)}`,
    `L ${(-hw + cut).toFixed(1)} ${(hh + dy).toFixed(1)}`,
    `L ${(-hw).toFixed(1)} ${dy.toFixed(1)}`,
    'Z',
  ].join(' ');
}

export function chamferRectSvgPoints(hw: number, hh: number, cut: number): string {
  return [
    `${(-hw + cut).toFixed(1)},${(-hh).toFixed(1)}`,
    `${(hw - cut).toFixed(1)},${(-hh).toFixed(1)}`,
    `${hw.toFixed(1)},0`,
    `${(hw - cut).toFixed(1)},${hh.toFixed(1)}`,
    `${(-hw + cut).toFixed(1)},${hh.toFixed(1)}`,
    `${(-hw).toFixed(1)},0`,
  ].join(' ');
}

export function octagonSvgPoints(radius: number, dy = 0): string {
  const d = radius * 0.7071;
  return [
    `0,${(-radius + dy).toFixed(1)}`,
    `${d.toFixed(1)},${(-d + dy).toFixed(1)}`,
    `${radius.toFixed(1)},${dy.toFixed(1)}`,
    `${d.toFixed(1)},${(d + dy).toFixed(1)}`,
    `0,${(radius + dy).toFixed(1)}`,
    `${(-d).toFixed(1)},${(d + dy).toFixed(1)}`,
    `${(-radius).toFixed(1)},${dy.toFixed(1)}`,
    `${(-d).toFixed(1)},${(-d + dy).toFixed(1)}`,
  ].join(' ');
}
