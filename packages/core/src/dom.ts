/**
 * `@simplex-viz/core/dom` — Shared browser/DOM utilities, structural DOM interfaces,
 * accessibility formatters, floating tooltips, HUD overlays, interactive viewport
 * gesture binding, and WCAG keyboard navigation for renderer hosts (`@simplex-viz/svg`,
 * `@simplex-viz/canvas`, `@simplex-viz/react`, `@simplex-viz/wc`).
 *
 * Intentionally exposed exclusively via the `@simplex-viz/core/dom` subpath so the
 * root `@simplex-viz/core` and `@simplex-viz/core/worker` entry points remain strictly
 * headless and DOM-free.
 */

export type {
  SimplexDomButtonLike,
  SimplexDomDivLike,
  SimplexDomDocumentLike,
  SimplexDomElementLike,
  SimplexDomFontSetLike,
  SimplexDomInputLike,
  SimplexDomInteractiveSurfaceLike,
  SimplexDomKeyboardEventLike,
  SimplexDomMediaQueryListLike,
  SimplexDomMouseEventLike,
  SimplexDomPointerEventLike,
  SimplexDomRectLike,
  SimplexDomSpanLike,
  SimplexDomStyleLike,
  SimplexDomSvgNodeLike,
  SimplexDomTouchEventLike,
  SimplexDomWheelEventLike,
  SimplexDomWindowLike,
} from './dom/types.js';

export {
  ensureSimplexContainerPositioned,
  measureSimplexContainer,
  observeSimplexContainerResize,
  resolveSimplexContainer,
  resolveSimplexReducedMotion,
  subscribeSimplexFontLoadRelayout,
  subscribeSimplexReducedMotionMedia,
  type ObserveSimplexContainerResizeOptions,
  type SimplexMeasuredContainerSize,
  type SimplexResizeObserverHandle,
} from './dom/environment.js';

export {
  computeSimplexZoomAnnouncementSignature,
  createSimplexSrAnnouncer,
  formatSimplexClusterAriaMetadata,
  formatSimplexInteractiveTargetAriaLabel,
  formatSimplexItemAriaMetadata,
  formatSimplexTriangleAriaMetadata,
  formatSimplexZoomLevelAnnouncement,
  type SimplexSrAnnouncerHandle,
  type SimplexTargetAriaMetadata,
} from './dom/a11y.js';

export {
  applySimplexTooltipTheme,
  buildSimplexTooltipContentModel,
  computeSimplexTooltipCoords,
  createSimplexTooltipOverlay,
  formatSimplexTooltipText,
  getSimplexTooltipThemeTokens,
  positionSimplexTooltipElement,
  type BuildSimplexTooltipModelOptions,
  type ComputeSimplexTooltipCoordsInput,
  type CreateSimplexTooltipOverlayOptions,
  type PositionSimplexTooltipOptions,
  type SimplexDomTooltipRendererLike,
  type SimplexStructuredTooltipFormatterLike,
  type SimplexTooltipContentModel,
  type SimplexTooltipCoords,
  type SimplexTooltipOverlay,
  type SimplexTooltipOverlayOptionLike,
  type SimplexTooltipTargetInput,
  type SimplexTooltipThemeTokens,
} from './dom/tooltip.js';

export {
  applySimplexPinchDrillTarget,
  dispatchSimplexDefaultLeftClick,
  isSameSimplexKeyboardTarget,
  isSimplexHoverEventConsumed,
  normalizeSimplexMarqueeRect,
  resolveNextSimplexKeyboardFocusIndex,
  resolveSimplexCursorForPoint,
  resolveSimplexPinchDrillTarget,
  stepSimplexDrillDownWheelPinch,
  toSimplexKeyboardFocusTargetRef,
  toSimplexNormalizedPointerEvent,
  zoomSimplexViewportByFactor,
  type SimplexCursorKind,
  type SimplexInteractiveEngineSlice,
  type SimplexPinchDrillTarget,
  type SimplexWheelPinchState,
} from './dom/interactions.js';

export {
  bindSimplexInteractiveViewport,
  type BindSimplexInteractiveViewportOptions,
  type SimplexInteractiveViewportHandle,
} from './dom/viewport.js';

export {
  createSimplexTimelineBarOverlay,
  createSimplexZoomBreadcrumbsOverlay,
  type CreateSimplexTimelineBarOverlayOptions,
  type CreateSimplexZoomBreadcrumbsOverlayOptions,
  type SimplexTimelineBarOverlay,
  type SimplexZoomBreadcrumbsOverlay,
} from './dom/hud.js';

export {
  createSimplexKeyboardNavigator,
  type SimplexKeyboardNavigator,
  type SimplexKeyboardNavigatorOptions,
} from './dom/keyboard.js';
