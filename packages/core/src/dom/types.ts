// ============================================================================
// Minimal Structural DOM Interfaces (Zero dependency on TypeScript's DOM lib)
// ============================================================================

export interface SimplexDomRectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SimplexDomStyleLike {
  position: string;
  width: string;
  height: string;
  padding: string;
  margin: string;
  overflow: string;
  clip: string;
  clipPath: string;
  whiteSpace: string;
  border: string;
  pointerEvents: string;
  display: string;
  left: string;
  top: string;
  bottom?: string;
  transform?: string;
  alignItems?: string;
  justifyContent?: string;
  gap?: string;
  flexShrink?: string;
  overflowX?: string;
  paddingLeft?: string;
  opacity?: string;
  backdropFilter?: string;
  fontWeight?: string;
  fontVariantNumeric?: string;
  accentColor?: string;
  background: string;
  color: string;
  boxShadow: string;
  cursor: string;
  touchAction: string;
  maxWidth?: string;
  minWidth?: string;
  borderRadius?: string;
  fontFamily?: string;
  fontSize?: string;
  lineHeight?: string;
  zIndex?: string;
}

export interface SimplexDomElementLike {
  readonly ownerDocument: SimplexDomDocumentLike | null;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly parentElement: SimplexDomElementLike | null;
  readonly style: SimplexDomStyleLike;
  textContent: string | null;
  getBoundingClientRect(): SimplexDomRectLike;
  setAttribute(name: string, value: string): void;
}

/** @internal Structural subset used for child-node mutation and event propagation guards. */
export interface SimplexDomContainerOpsLike {
  readonly firstChild?: unknown;
  appendChild(node: unknown): unknown;
  removeChild(child: unknown): unknown;
  addEventListener?(type: string, listener: (ev: { stopPropagation(): void }) => void): void;
}

export interface SimplexDomDivLike extends SimplexDomElementLike {
  className: string;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly dataset?: Record<string, string | undefined>;
  remove?: () => void;
}

export interface SimplexDomSpanLike extends SimplexDomElementLike {
  className: string;
}

export interface SimplexDomButtonLike extends SimplexDomElementLike {
  type: string;
  title: string;
  disabled: boolean;
  readonly firstChild: unknown;
  appendChild(node: unknown): unknown;
  removeChild(child: unknown): unknown;
  addEventListener(type: string, listener: (ev: { stopPropagation(): void }) => void): void;
}

export interface SimplexDomInputLike extends SimplexDomElementLike {
  type: string;
  min: string;
  max: string;
  step: string;
  value: string;
  disabled: boolean;
  addEventListener(
    type: string,
    listener: (ev: { stopPropagation(): void; readonly target: unknown }) => void,
  ): void;
}

export interface SimplexDomSvgNodeLike {
  setAttribute(name: string, value: string): void;
  appendChild(node: unknown): unknown;
}

export interface SimplexDomFontSetLike {
  readonly status?: string;
  readonly ready?: Promise<unknown>;
  addEventListener?: (type: 'loadingdone', listener: () => void) => void;
  removeEventListener?: (type: 'loadingdone', listener: () => void) => void;
}

export interface SimplexDomMediaQueryListLike {
  readonly matches: boolean;
  addEventListener?: (
    type: 'change',
    listener: (event?: { readonly matches?: boolean }) => void,
  ) => void;
  removeEventListener?: (
    type: 'change',
    listener: (event?: { readonly matches?: boolean }) => void,
  ) => void;
  addListener?: (
    listener: (event?: { readonly matches?: boolean }) => void,
  ) => void;
  removeListener?: (
    listener: (event?: { readonly matches?: boolean }) => void,
  ) => void;
}

export interface SimplexDomWindowLike {
  matchMedia?: (query: string) => SimplexDomMediaQueryListLike;
}

export interface SimplexDomDocumentLike {
  readonly defaultView?: SimplexDomWindowLike | null;
  readonly fonts?: SimplexDomFontSetLike;
  readonly activeElement?: unknown;
  createElement(tagName: 'div'): SimplexDomDivLike;
  createElement(tagName: 'span'): SimplexDomSpanLike;
  createElement(tagName: 'button'): SimplexDomButtonLike;
  createElement(tagName: 'input'): SimplexDomInputLike;
  createElementNS?(namespaceURI: string, qualifiedName: string): SimplexDomSvgNodeLike;
  querySelector<TElement extends SimplexDomElementLike = SimplexDomElementLike>(
    selectors: string,
  ): TElement | null;
}

export interface SimplexDomPointerEventLike {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export interface SimplexDomMouseEventLike {
  readonly button: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  preventDefault(): void;
}

export interface SimplexDomWheelEventLike {
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  preventDefault(): void;
}

export interface SimplexDomTouchEventLike {
  readonly touches: {
    readonly length: number;
    [index: number]: { readonly clientX: number; readonly clientY: number } | undefined;
  };
  preventDefault(): void;
}

export interface SimplexDomKeyboardEventLike {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  preventDefault(): void;
}

export interface SimplexDomInteractiveSurfaceLike {
  readonly ownerDocument: SimplexDomDocumentLike | null;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly style: {
    cursor: string;
    touchAction: string;
  };
  getBoundingClientRect(): SimplexDomRectLike;
  setPointerCapture?(pointerId: number): void;
  addEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: boolean | { readonly passive?: boolean },
  ): void;
  removeEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: boolean,
  ): void;
}

/** @internal */
export interface GlobalEnvLike {
  readonly document?: SimplexDomDocumentLike;
  readonly window?: SimplexDomWindowLike;
  readonly ResizeObserver?: new (
    callback: (
      entries: readonly {
        readonly contentRect: { readonly width: number; readonly height: number };
      }[],
    ) => void,
  ) => {
    observe(target: SimplexDomElementLike): void;
    disconnect(): void;
  };
  readonly getComputedStyle?: (el: SimplexDomElementLike) => {
    readonly position: string;
  };
  readonly performance?: { now(): number };
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

/** @internal */
export function getGlobalEnv(): GlobalEnvLike {
  return globalThis as unknown as GlobalEnvLike;
}

/** @internal */
export function nowMs(): number {
  const perf = getGlobalEnv().performance;
  return perf ? perf.now() : Date.now();
}

/** @internal Single structural boundary helper for container DOM node mutation ops. */
export function asContainerOps(
  el: SimplexDomElementLike,
): SimplexDomContainerOpsLike {
  return el as unknown as SimplexDomContainerOpsLike;
}
