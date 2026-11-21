import type {
  SimplexTimelineState,
  SimplexZoomState,
  ZoomBreadcrumb,
} from '@simplex-viz/core';
import { DatasetInfoButton } from './DatasetProvenanceModal';
import {
  RendererToggle,
  type ShowcaseRendererKind,
} from './SimplexCanvasStage';
import { CssFullscreenButton } from './useCssFullscreen';

export interface AtlasBottomBarProps {
  readonly zoomState: SimplexZoomState | null;
  readonly onDrillToDepth: (depth: number) => void;
  readonly onDrillUp: () => void;
  readonly renderer: ShowcaseRendererKind;
  readonly onRendererChange: (next: ShowcaseRendererKind) => void;
  readonly isDatasetModalOpen: boolean;
  readonly onOpenDatasetModal: () => void;
  readonly isFullscreen: boolean;
  readonly onToggleFullscreen: () => void;
  readonly isFreeCamera?: boolean;
}

function renderCrumbContent(crumb: ZoomBreadcrumb, compact = false) {
  const segs = crumb.segments;
  if (crumb.depth > 0 && segs && segs.length > 0) {
    // Show colored accent pips alongside concise label so triangle topics stay scannable
    const pips = segs
      .map((s) => s.colorHex)
      .filter((hex): hex is string => Boolean(hex))
      .slice(0, 3);
    return (
      <>
        {pips.length > 0 && (
          <span className="inline-flex shrink-0 items-center -space-x-0.5" aria-hidden="true">
            {pips.map((hex, i) => (
              <span
                key={`${hex}-${i}`}
                className="h-2 w-2 rounded-full ring-1 ring-white dark:ring-[#0E131D]"
                style={{ backgroundColor: hex }}
              />
            ))}
          </span>
        )}
        <span
          className={
            compact
              ? 'truncate'
              : 'max-w-[96px] truncate md:max-w-[140px] lg:max-w-[180px]'
          }
        >
          {crumb.shortLabel}
        </span>
      </>
    );
  }

  return (
    <>
      {crumb.accentHex && (
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: crumb.accentHex }}
        />
      )}
      <span
        className={
          compact
            ? 'truncate'
            : 'max-w-[96px] truncate md:max-w-[140px] lg:max-w-[180px]'
        }
      >
        {crumb.shortLabel || crumb.label}
      </span>
    </>
  );
}

/**
 * Single-line docked bottom control & navigation bar for Hero and Example workbenches.
 * - Left: never-wrapping middle-ellipsis breadcrumbs + one-tap Back button when zoomed in.
 * - Right: Renderer toggle (SVG | Canvas), Dataset Info, and Fullscreen (icon-compact on <sm).
 */
export function AtlasBottomBar({
  zoomState,
  onDrillToDepth,
  onDrillUp,
  renderer,
  onRendererChange,
  isDatasetModalOpen,
  onOpenDatasetModal,
  isFullscreen,
  onToggleFullscreen,
  isFreeCamera = false,
}: AtlasBottomBarProps) {
  const crumbs = zoomState?.breadcrumbs ?? [];
  const depth = zoomState?.depth ?? 0;
  const isDrilledIn = depth > 0 && crumbs.length > 1;
  const currentCrumb = crumbs[crumbs.length - 1];
  const fullPathTitle = crumbs.map((c) => c.label).join(' › ');

  // Middle-ellipsis trail for desktop/tablet when depth >= 3 (4+ crumbs):
  // [Root] › […] › [Parent] › [Current]
  const hasCollapsedMiddle = crumbs.length >= 4;
  const collapsedMiddleCrumbs = hasCollapsedMiddle
    ? crumbs.slice(1, crumbs.length - 2)
    : [];
  const collapsedTitle = collapsedMiddleCrumbs.map((c) => c.label).join(' › ');
  const visibleCrumbs: readonly (ZoomBreadcrumb | 'ellipsis')[] = hasCollapsedMiddle
    ? [crumbs[0]!, 'ellipsis', crumbs[crumbs.length - 2]!, crumbs[crumbs.length - 1]!]
    : crumbs;

  return (
    <div className="sv-workbench-bottombar flex items-center justify-between gap-2 border-t border-slate-200/80 bg-slate-100/85 px-2.5 py-1.5 dark:border-slate-800/80 dark:bg-[#0E131D]">
      {/* Left: Single-Line Breadcrumbs or Calm Root Status */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {isDrilledIn && currentCrumb ? (
          <>
            <button
              type="button"
              onClick={onDrillUp}
              aria-label="Zoom out one level"
              title="Zoom out one level"
              className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
            </button>

            {/* Mobile (<sm): Compact single-line current level + optional depth badge */}
            <nav
              aria-label="Zoom navigation"
              title={fullPathTitle}
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden sm:hidden"
            >
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                {renderCrumbContent(currentCrumb, true)}
              </span>
              {depth >= 2 && (
                <button
                  type="button"
                  onClick={() => onDrillToDepth(0)}
                  title={`Return to Overview (currently level ${depth})`}
                  aria-label={`Return to Overview from level ${depth}`}
                  className="shrink-0 cursor-pointer rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600 transition-colors hover:bg-slate-300/80 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
                >
                  L{depth}
                </button>
              )}
            </nav>

            {/* Tablet/Desktop (sm+): Single-line middle-ellipsis breadcrumb trail */}
            <nav
              aria-label="Zoom breadcrumbs"
              className="hidden min-w-0 flex-1 flex-nowrap items-center gap-0.5 overflow-hidden sm:flex"
            >
              {visibleCrumbs.map((entry, idx) => {
                if (entry === 'ellipsis') {
                  const targetDepth = crumbs[crumbs.length - 3]!.depth;
                  return (
                    <span
                      key="ellipsis"
                      className="inline-flex shrink-0 items-center gap-0.5"
                    >
                      <span
                        aria-hidden="true"
                        className="px-0.5 text-xs text-slate-400 dark:text-slate-500"
                      >
                        ›
                      </span>
                      <button
                        type="button"
                        onClick={() => onDrillToDepth(targetDepth)}
                        title={`Collapsed levels: ${collapsedTitle} (click to jump back)`}
                        aria-label={`Jump back to ${crumbs[crumbs.length - 3]!.label}`}
                        className="inline-flex h-6 cursor-pointer items-center rounded px-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-100"
                      >
                        …
                      </button>
                    </span>
                  );
                }

                const isCurrent = entry.depth === depth;
                return (
                  <span
                    key={`${entry.depth}-${entry.frameId}`}
                    className={`inline-flex min-w-0 items-center gap-0.5 ${
                      isCurrent ? 'shrink' : 'shrink-0'
                    }`}
                  >
                    {idx > 0 && (
                      <span
                        aria-hidden="true"
                        className="shrink-0 px-0.5 text-xs text-slate-400 dark:text-slate-500"
                      >
                        ›
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={isCurrent}
                      aria-current={isCurrent ? 'location' : undefined}
                      title={entry.label}
                      onClick={() => onDrillToDepth(entry.depth)}
                      className={`inline-flex h-6 min-w-0 items-center gap-1.5 rounded px-1.5 text-xs whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 ${
                        isCurrent
                          ? 'bg-white font-semibold text-slate-950 shadow-2xs dark:bg-[#0B0F17] dark:text-slate-100'
                          : 'cursor-pointer font-medium text-slate-600 hover:bg-white/75 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800/75 dark:hover:text-slate-100'
                      }`}
                    >
                      {renderCrumbContent(entry)}
                    </button>
                  </span>
                );
              })}
            </nav>
          </>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5 pl-1 text-xs text-slate-500 dark:text-slate-400">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                renderer === 'canvas'
                  ? 'bg-indigo-500/80 dark:bg-indigo-400/80'
                  : 'bg-cyan-500/80 dark:bg-cyan-400/80'
              }`}
            />
            <span className="truncate font-medium text-slate-700 dark:text-slate-300">
              Overview
            </span>
            <span className="hidden truncate text-slate-400 md:inline dark:text-slate-500">
              · {isFreeCamera ? 'Scroll to zoom, drag to pan' : 'Click triangle to zoom'}
            </span>
          </div>
        )}
      </div>

      {/* Right: Renderer Toggle + Dataset Info + Fullscreen */}
      <div className="flex shrink-0 items-center gap-1.5">
        <RendererToggle
          renderer={renderer}
          onChange={onRendererChange}
          compactMobile
        />
        <DatasetInfoButton
          isOpen={isDatasetModalOpen}
          onOpen={onOpenDatasetModal}
          compactMobile
        />
        <CssFullscreenButton
          isFullscreen={isFullscreen}
          onToggle={onToggleFullscreen}
          compactMobile
        />
      </div>
    </div>
  );
}

export interface AtlasTimelineBarProps<TItem> {
  readonly timelineState: SimplexTimelineState<TItem>;
  readonly onTogglePlay: () => void;
  readonly onSeek: (step: number) => void;
  readonly renderer?: ShowcaseRendererKind;
}

/**
 * Single-line docked timeline scrubber strip positioned directly above the bottom bar
 * so playback controls never float over content nodes.
 */
export function AtlasTimelineBar<TItem>({
  timelineState,
  onTogglePlay,
  onSeek,
  renderer = 'svg',
}: AtlasTimelineBarProps<TItem>) {
  if (timelineState.totalSteps <= 0) return null;

  const isCanvas = renderer === 'canvas';

  return (
    <div
      aria-label="Timeline playback controls"
      className="sv-workbench-timeline flex items-center gap-2.5 border-t border-slate-200/80 bg-slate-50/90 px-3 py-1.5 text-xs dark:border-slate-800/80 dark:bg-[#0A0F1A]"
    >
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={timelineState.playing ? 'Pause timeline' : 'Play timeline'}
        className={`inline-flex h-6.5 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 ${
          isCanvas
            ? 'border-indigo-600/35 bg-indigo-50 text-indigo-900 hover:bg-indigo-100 focus-visible:ring-indigo-500/70 dark:border-indigo-400/40 dark:bg-indigo-950/60 dark:text-indigo-200 dark:hover:bg-indigo-950'
            : 'border-cyan-600/35 bg-cyan-50 text-cyan-900 hover:bg-cyan-100 focus-visible:ring-cyan-500/70 dark:border-cyan-400/40 dark:bg-cyan-950/60 dark:text-cyan-200 dark:hover:bg-cyan-950'
        }`}
      >
        {timelineState.playing ? (
          <svg
            className="h-3 w-3 shrink-0"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg
            className="h-3 w-3 shrink-0"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
        )}
        <span>{timelineState.playing ? 'Pause' : 'Play'}</span>
      </button>

      <input
        type="range"
        aria-label="Timeline step"
        min={0}
        max={timelineState.totalSteps}
        value={timelineState.step}
        onChange={(e) => onSeek(Number(e.target.value))}
        className={`min-w-0 flex-1 cursor-pointer ${
          isCanvas
            ? 'accent-indigo-600 dark:accent-indigo-400'
            : 'accent-cyan-600 dark:accent-cyan-400'
        }`}
      />

      <span className="shrink-0 font-mono text-[11px] font-semibold text-slate-800 tabular-nums dark:text-slate-100">
        {timelineState.activeLabel}
      </span>
      <span className="hidden shrink-0 font-mono text-[10px] text-slate-400 tabular-nums sm:inline dark:text-slate-500">
        {timelineState.activeItemCount}/{timelineState.totalItemCount}
      </span>
    </div>
  );
}
