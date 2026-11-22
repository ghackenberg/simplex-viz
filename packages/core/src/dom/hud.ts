import type { SimplexColorTheme } from '../strategies.js';
import type { SimplexTimelineState } from '../timeline.js';
import type { DefaultTaggedItem } from '../types.js';
import type { SimplexZoomState } from '../zoom.js';
import { ensureSimplexContainerPositioned } from './environment.js';
import {
  asContainerOps,
  getGlobalEnv,
  type SimplexDomButtonLike,
  type SimplexDomDivLike,
  type SimplexDomDocumentLike,
  type SimplexDomElementLike,
  type SimplexDomInputLike,
  type SimplexDomSpanLike,
  type SimplexDomSvgNodeLike,
} from './types.js';

// ============================================================================
// Shared HUD Overlays (Zoom Breadcrumbs & Timeline Playback Bar)
// ============================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyHudContainerTheme(
  el: SimplexDomDivLike,
  theme: SimplexColorTheme,
): void {
  const isLight = theme === 'light';
  el.style.background = isLight
    ? 'rgba(255, 255, 255, 0.95)'
    : 'rgba(11, 15, 23, 0.93)';
  el.style.border = isLight
    ? '1px solid rgba(203, 213, 225, 0.95)'
    : '1px solid rgba(51, 65, 85, 0.92)';
  el.style.boxShadow = isLight
    ? '0 4px 14px rgba(15, 23, 42, 0.08)'
    : '0 4px 16px rgba(0, 0, 0, 0.36)';
  el.style.color = isLight ? '#0f172a' : '#e2e8f0';
}

export interface CreateSimplexZoomBreadcrumbsOverlayOptions {
  readonly hostEl: SimplexDomElementLike;
  readonly ensureHostPositioned?: boolean;
  readonly initialTheme?: SimplexColorTheme;
  readonly initialVisible?: boolean;
  readonly onDrillToDepth: (depth: number) => void;
}

export interface SimplexZoomBreadcrumbsOverlay {
  sync(zoomState: SimplexZoomState, visible?: boolean): void;
  setTheme(theme: SimplexColorTheme): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/**
 * Creates a theme-adaptive drill-down breadcrumb strip overlay shared by SVG and Canvas hosts.
 */
export function createSimplexZoomBreadcrumbsOverlay(
  options: CreateSimplexZoomBreadcrumbsOverlayOptions,
): SimplexZoomBreadcrumbsOverlay {
  const { hostEl, ensureHostPositioned = true, onDrillToDepth } = options;
  let currentTheme: SimplexColorTheme = options.initialTheme ?? 'dark';
  let visible = options.initialVisible ?? true;
  let lastState: SimplexZoomState | null = null;
  let overlayEl: SimplexDomDivLike | null = null;

  const sync = (zoomState: SimplexZoomState, visibleOverride?: boolean): void => {
    lastState = zoomState;
    if (visibleOverride !== undefined) {
      visible = visibleOverride;
    }
    if (visible && zoomState.mode === 'drill-down' && zoomState.depth > 0) {
      if (ensureHostPositioned) {
        ensureSimplexContainerPositioned(hostEl);
      }
      const doc = hostEl.ownerDocument ?? getGlobalEnv().document;
      if (!doc) return;
      const isLight = currentTheme === 'light';

      if (!overlayEl) {
        const el = doc.createElement('div');
        el.className = 'sv-zoom-breadcrumbs';
        el.setAttribute('role', 'navigation');
        el.setAttribute('aria-label', 'Zoom breadcrumbs');
        el.style.position = 'absolute';
        el.style.top = '12px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.zIndex = '16';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.gap = '3px';
        el.style.maxWidth = 'calc(100% - 24px)';
        el.style.overflowX = 'auto';
        el.style.whiteSpace = 'nowrap';
        el.style.padding = '4px 9px';
        el.style.borderRadius = '8px';
        el.style.backdropFilter = 'blur(8px)';
        el.style.fontFamily =
          'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif';
        el.style.fontSize = '11px';
        asContainerOps(hostEl).appendChild(el);
        overlayEl = el;
      }

      overlayEl.style.display = 'flex';
      applyHudContainerTheme(overlayEl, currentTheme);

      const elOps = asContainerOps(overlayEl);
      while (elOps.firstChild) {
        elOps.removeChild(elOps.firstChild);
      }

      zoomState.breadcrumbs.forEach((crumb, idx) => {
        if (idx > 0) {
          const sep = doc.createElement('span');
          sep.textContent = '›';
          sep.setAttribute('aria-hidden', 'true');
          sep.style.opacity = '0.48';
          sep.style.fontSize = '12px';
          sep.style.padding = '0 1px';
          elOps.appendChild(sep);
        }
        const isCurrent = idx === zoomState.depth;
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.title = crumb.label;
        if (isCurrent) {
          btn.setAttribute('aria-current', 'location');
        } else {
          btn.setAttribute('aria-label', `Zoom out to ${crumb.label}`);
        }
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '4px';
        btn.style.cursor = isCurrent ? 'default' : 'pointer';
        btn.style.fontWeight = isCurrent ? '700' : '500';
        btn.style.color = isCurrent
          ? isLight
            ? '#0f172a'
            : '#f8fafc'
          : isLight
            ? '#475569'
            : '#94a3b8';
        btn.style.background = isCurrent
          ? isLight
            ? 'rgba(241, 245, 249, 0.95)'
            : 'rgba(30, 41, 59, 0.72)'
          : 'transparent';
        btn.style.border = 'none';
        btn.style.borderRadius = '5px';
        btn.style.padding = '2px 6px';

        const segs = crumb.segments;
        if (idx > 0 && segs && segs.length > 0) {
          segs.forEach((seg, sIdx) => {
            if (sIdx > 0) {
              const dotSep = doc.createElement('span');
              dotSep.textContent = '·';
              dotSep.setAttribute('aria-hidden', 'true');
              dotSep.style.opacity = '0.5';
              btn.appendChild(dotSep);
            }
            if (seg.colorHex) {
              const pip = doc.createElement('span');
              pip.setAttribute('aria-hidden', 'true');
              pip.style.display = 'inline-block';
              pip.style.width = '6px';
              pip.style.height = '6px';
              pip.style.borderRadius = '9999px';
              pip.style.background = seg.colorHex;
              pip.style.boxShadow = isLight
                ? '0 0 0 1px rgba(15, 23, 42, 0.16)'
                : '0 0 0 1px rgba(255, 255, 255, 0.35)';
              pip.style.flexShrink = '0';
              btn.appendChild(pip);
            }
            const lbl = doc.createElement('span');
            lbl.textContent = seg.label;
            btn.appendChild(lbl);
          });
        } else {
          btn.textContent = crumb.shortLabel;
        }

        if (!isCurrent) {
          btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            onDrillToDepth(crumb.depth);
          });
        }
        elOps.appendChild(btn);
      });
    } else if (overlayEl) {
      overlayEl.style.display = 'none';
    }
  };

  return {
    sync,
    setTheme(theme: SimplexColorTheme): void {
      currentTheme = theme;
      if (lastState) {
        sync(lastState);
      }
    },
    setVisible(nextVisible: boolean): void {
      visible = nextVisible;
      if (lastState) {
        sync(lastState, nextVisible);
      } else if (!nextVisible && overlayEl) {
        overlayEl.style.display = 'none';
      }
    },
    destroy(): void {
      if (overlayEl) {
        if (overlayEl.parentElement === hostEl) {
          asContainerOps(hostEl).removeChild(overlayEl);
        } else {
          overlayEl.remove?.();
        }
        overlayEl = null;
      }
    },
  };
}

export interface CreateSimplexTimelineBarOverlayOptions {
  readonly hostEl: SimplexDomElementLike;
  readonly ensureHostPositioned?: boolean;
  readonly initialTheme?: SimplexColorTheme;
  readonly onTogglePlay: () => void;
  readonly onStepBy: (delta: number) => void;
  readonly onSeek: (step: number) => void;
}

export interface SimplexTimelineBarOverlay<TItem = DefaultTaggedItem> {
  sync(
    state: SimplexTimelineState<TItem> | null,
    options?: {
      readonly visible?: boolean;
      readonly position?: 'bottom' | 'top';
      readonly theme?: SimplexColorTheme;
    },
  ): void;
  setTheme(theme: SimplexColorTheme): void;
  destroy(): void;
}

function createTimelineIconNode(
  doc: SimplexDomDocumentLike,
  kind: 'play' | 'pause' | 'prev' | 'next',
): SimplexDomSvgNodeLike | SimplexDomSpanLike {
  if (typeof doc.createElementNS === 'function') {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 12 12');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    if (kind === 'play') {
      const poly = doc.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', '3,1.8 10.2,6 3,10.2');
      svg.appendChild(poly);
    } else if (kind === 'pause') {
      const r1 = doc.createElementNS(SVG_NS, 'rect');
      r1.setAttribute('x', '2.5');
      r1.setAttribute('y', '2');
      r1.setAttribute('width', '2.5');
      r1.setAttribute('height', '8');
      r1.setAttribute('rx', '0.6');
      const r2 = doc.createElementNS(SVG_NS, 'rect');
      r2.setAttribute('x', '7');
      r2.setAttribute('y', '2');
      r2.setAttribute('width', '2.5');
      r2.setAttribute('height', '8');
      r2.setAttribute('rx', '0.6');
      svg.appendChild(r1);
      svg.appendChild(r2);
    } else if (kind === 'prev') {
      const bar = doc.createElementNS(SVG_NS, 'rect');
      bar.setAttribute('x', '2');
      bar.setAttribute('y', '2.2');
      bar.setAttribute('width', '1.6');
      bar.setAttribute('height', '7.6');
      bar.setAttribute('rx', '0.5');
      const poly = doc.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', '9.8,2.2 4.2,6 9.8,9.8');
      svg.appendChild(bar);
      svg.appendChild(poly);
    } else {
      const poly = doc.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', '2.2,2.2 7.8,6 2.2,9.8');
      const bar = doc.createElementNS(SVG_NS, 'rect');
      bar.setAttribute('x', '8.4');
      bar.setAttribute('y', '2.2');
      bar.setAttribute('width', '1.6');
      bar.setAttribute('height', '7.6');
      bar.setAttribute('rx', '0.5');
      svg.appendChild(poly);
      svg.appendChild(bar);
    }
    return svg;
  }
  const fallback = doc.createElement('span');
  fallback.setAttribute('aria-hidden', 'true');
  fallback.textContent =
    kind === 'play' ? '▶' : kind === 'pause' ? '⏸' : kind === 'prev' ? '⏮' : '⏭';
  return fallback;
}

function applyTimelineButtonStyle(
  btn: SimplexDomButtonLike,
  isLight: boolean,
  disabled: boolean,
  accent = false,
): void {
  btn.disabled = disabled;
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.justifyContent = 'center';
  btn.style.width = '24px';
  btn.style.height = '24px';
  btn.style.padding = '0';
  btn.style.borderRadius = '6px';
  btn.style.border = 'none';
  btn.style.flexShrink = '0';
  btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
  btn.style.opacity = disabled ? '0.38' : '1';
  if (accent) {
    btn.style.background = isLight
      ? 'rgba(15, 23, 42, 0.92)'
      : 'rgba(226, 232, 240, 0.94)';
    btn.style.color = isLight ? '#f8fafc' : '#0f172a';
  } else {
    btn.style.background = isLight
      ? 'rgba(241, 245, 249, 0.9)'
      : 'rgba(30, 41, 59, 0.72)';
    btn.style.color = isLight ? '#334155' : '#cbd5e1';
  }
}

/**
 * Creates a compact, theme-adaptive Play/Pause/Step/Scrubber HUD bar overlay
 * shared by `@simplex-viz/svg` and `@simplex-viz/canvas`.
 */
export function createSimplexTimelineBarOverlay<TItem = DefaultTaggedItem>(
  options: CreateSimplexTimelineBarOverlayOptions,
): SimplexTimelineBarOverlay<TItem> {
  const { hostEl, ensureHostPositioned = true, onTogglePlay, onStepBy, onSeek } = options;
  let currentTheme: SimplexColorTheme = options.initialTheme ?? 'dark';
  let currentPosition: 'bottom' | 'top' = 'bottom';
  let currentVisible = true;
  let lastState: SimplexTimelineState<TItem> | null = null;
  let overlayEl: SimplexDomDivLike | null = null;
  let refs: {
    readonly playBtn: SimplexDomButtonLike;
    readonly prevBtn: SimplexDomButtonLike;
    readonly nextBtn: SimplexDomButtonLike;
    readonly scrubber: SimplexDomInputLike;
    readonly labelEl: SimplexDomSpanLike;
    readonly countEl: SimplexDomSpanLike;
  } | null = null;

  const sync = (
    state: SimplexTimelineState<TItem> | null,
    overrides?: {
      readonly visible?: boolean;
      readonly position?: 'bottom' | 'top';
      readonly theme?: SimplexColorTheme;
    },
  ): void => {
    lastState = state;
    if (overrides?.visible !== undefined) currentVisible = overrides.visible;
    if (overrides?.position !== undefined) currentPosition = overrides.position;
    if (overrides?.theme !== undefined) currentTheme = overrides.theme;

    if (!state || !currentVisible || state.frames.length === 0) {
      if (overlayEl) {
        overlayEl.style.display = 'none';
      }
      return;
    }

    const doc = hostEl.ownerDocument ?? getGlobalEnv().document;
    if (!doc) return;
    if (ensureHostPositioned) {
      ensureSimplexContainerPositioned(hostEl);
    }

    if (!overlayEl || !refs) {
      const el = doc.createElement('div');
      el.className = 'sv-timeline-bar';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Timeline playback controls');
      el.style.position = 'absolute';
      el.style.left = '50%';
      el.style.transform = 'translateX(-50%)';
      el.style.zIndex = '17';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.gap = '6px';
      el.style.maxWidth = 'calc(100% - 24px)';
      el.style.padding = '5px 10px';
      el.style.borderRadius = '8px';
      el.style.backdropFilter = 'blur(8px)';
      el.style.fontFamily =
        'Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif';
      el.style.fontSize = '11px';

      const elOps = asContainerOps(el);
      const stopEvt = (ev: { stopPropagation(): void }) => {
        ev.stopPropagation();
      };
      elOps.addEventListener?.('pointerdown', stopEvt);
      elOps.addEventListener?.('click', stopEvt);
      elOps.addEventListener?.('wheel', stopEvt);

      const playBtn = doc.createElement('button');
      playBtn.type = 'button';
      playBtn.setAttribute('data-sv-timeline-action', 'toggle');
      playBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onTogglePlay();
      });

      const prevBtn = doc.createElement('button');
      prevBtn.type = 'button';
      prevBtn.setAttribute('data-sv-timeline-action', 'prev');
      prevBtn.setAttribute('aria-label', 'Previous step');
      prevBtn.title = 'Previous step';
      prevBtn.appendChild(createTimelineIconNode(doc, 'prev'));
      prevBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onStepBy(-1);
      });

      const scrubber = doc.createElement('input');
      scrubber.type = 'range';
      scrubber.min = '0';
      scrubber.step = '1';
      scrubber.setAttribute('data-sv-timeline-action', 'scrubber');
      scrubber.setAttribute('aria-label', 'Timeline step');
      scrubber.style.width = '128px';
      scrubber.style.minWidth = '64px';
      scrubber.style.margin = '0 2px';
      scrubber.style.cursor = 'pointer';
      scrubber.addEventListener('input', (ev) => {
        ev.stopPropagation();
        const nextVal = Number((ev.target as { readonly value?: string }).value);
        onSeek(nextVal);
      });

      const nextBtn = doc.createElement('button');
      nextBtn.type = 'button';
      nextBtn.setAttribute('data-sv-timeline-action', 'next');
      nextBtn.setAttribute('aria-label', 'Next step');
      nextBtn.title = 'Next step';
      nextBtn.appendChild(createTimelineIconNode(doc, 'next'));
      nextBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onStepBy(1);
      });

      const labelEl = doc.createElement('span');
      labelEl.setAttribute('data-sv-timeline-label', '');
      labelEl.style.fontWeight = '600';
      labelEl.style.whiteSpace = 'nowrap';
      labelEl.style.paddingLeft = '2px';

      const countEl = doc.createElement('span');
      countEl.setAttribute('data-sv-timeline-count', '');
      countEl.style.fontVariantNumeric = 'tabular-nums';
      countEl.style.whiteSpace = 'nowrap';
      countEl.style.fontSize = '10px';

      elOps.appendChild(playBtn);
      elOps.appendChild(prevBtn);
      elOps.appendChild(scrubber);
      elOps.appendChild(nextBtn);
      elOps.appendChild(labelEl);
      elOps.appendChild(countEl);

      asContainerOps(hostEl).appendChild(el);
      overlayEl = el;
      refs = { playBtn, prevBtn, nextBtn, scrubber, labelEl, countEl };
    }

    const isLight = currentTheme === 'light';
    overlayEl.style.display = 'flex';
    if (currentPosition === 'top') {
      overlayEl.style.top = '12px';
      overlayEl.style.bottom = '';
    } else {
      overlayEl.style.bottom = '12px';
      overlayEl.style.top = '';
    }
    applyHudContainerTheme(overlayEl, currentTheme);

    while (refs.playBtn.firstChild) {
      refs.playBtn.removeChild(refs.playBtn.firstChild);
    }
    refs.playBtn.appendChild(
      createTimelineIconNode(doc, state.playing ? 'pause' : 'play'),
    );
    refs.playBtn.setAttribute(
      'aria-label',
      state.playing ? 'Pause timeline' : 'Play timeline',
    );
    refs.playBtn.title = state.playing ? 'Pause' : 'Play';
    applyTimelineButtonStyle(
      refs.playBtn,
      isLight,
      state.totalSteps <= 0,
      true,
    );
    applyTimelineButtonStyle(refs.prevBtn, isLight, state.atStart);
    applyTimelineButtonStyle(refs.nextBtn, isLight, state.atEnd);

    refs.scrubber.max = String(state.totalSteps);
    refs.scrubber.value = String(state.step);
    refs.scrubber.disabled = state.totalSteps <= 0;
    refs.scrubber.style.accentColor = isLight ? '#0f172a' : '#e2e8f0';

    refs.labelEl.textContent = state.activeLabel;
    refs.labelEl.style.color = isLight ? '#0f172a' : '#f8fafc';
    refs.countEl.textContent = `${state.activeItemCount}/${state.totalItemCount}`;
    refs.countEl.style.color = isLight ? '#64748b' : '#94a3b8';
  };

  return {
    sync,
    setTheme(theme: SimplexColorTheme): void {
      currentTheme = theme;
      if (lastState) {
        sync(lastState, { theme });
      }
    },
    destroy(): void {
      if (overlayEl) {
        if (overlayEl.parentElement === hostEl) {
          asContainerOps(hostEl).removeChild(overlayEl);
        } else {
          overlayEl.remove?.();
        }
        overlayEl = null;
        refs = null;
      }
    },
  };
}
