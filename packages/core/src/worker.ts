import {
  defaultNormalizeTag,
  type SharedTagRuleKind,
  type SimplexAnchorRuleKind,
} from './clustering.js';
import {
  solveSimplexSnapshot,
  type SimplexLayoutSnapshot,
  type SnapshotClusterNode,
  type SnapshotContentNode,
} from './snapshot.js';
import {
  createAdaptiveHexMeshStrategy,
  createCollisionDrivenLayoutStrategy,
  createEmbeddingClusteringStrategy,
  createFixedLatticeMeshStrategy,
  createJaccardAnnealingClusteringStrategy,
  createLocalAdaptiveLayoutStrategy,
  createOklabContrastColorStrategy,
  createPaletteColorStrategy,
  createPbdUniformLayoutStrategy,
  createSoftSimplexEmbeddingClusteringStrategy,
  createSoftSimplexTagClusteringStrategy,
  createThemeAdaptiveOklabColorStrategy,
  createWarmStartPbdLayoutStrategy,
  type EmbeddingAnchorRuleKind,
  type EmbeddingVector,
  type SimplexClusteringStrategy,
  type SimplexColorStrategy,
  type SimplexColorTheme,
  type SimplexLayoutStrategy,
  type SimplexMeshStrategy,
} from './strategies.js';
import type {
  ClusterDescriptor,
  ClusterMemberRef,
  ContentLayoutContext,
  ConvexGeometry,
  DefaultTaggedItem,
  LayoutSolverOptions,
  MeshEdgeRenderState,
  MeshOptions,
  MeshTriangleRenderState,
  PeerClusterContext,
} from './types.js';

/**
 * Current wire-protocol version for `@simplex-viz/core/worker`.
 * Included in every request/response envelope so future TypeScript or Rust/WASM
 * worker backends can negotiate compatibility cleanly.
 */
export const SIMPLEX_WORKER_PROTOCOL_VERSION = 1 as const;

// ============================================================================
// Minimal, environment-agnostic Worker & AbortSignal interfaces (Zero DOM)
// ============================================================================

/** Minimal structural match for `ArrayBuffer` transferables (Browser & Node). */
export type SimplexTransferableLike = ArrayBuffer;

/** Minimal structural match for standard `AbortSignal` without requiring `lib: ["DOM"]`. */
export interface SimplexAbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { readonly once?: boolean },
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** Minimal structural match for `MessageEvent`. */
export interface SimplexWorkerMessageEventLike<TData = unknown> {
  readonly data: TData;
}

/** Minimal structural match for `ErrorEvent`. */
export interface SimplexWorkerErrorEventLike {
  readonly message?: string;
  readonly error?: unknown;
}

/**
 * Environment-agnostic Worker / MessagePort transport interface.
 * Satisfied out of the box by browser `Worker`, `MessagePort`, Node.js
 * `worker_threads.Worker`, and lightweight in-memory test channels.
 */
export interface SimplexWorkerPort {
  postMessage(message: unknown, transfer?: SimplexTransferableLike[]): void;
  addEventListener?: {
    (
      type: 'message',
      listener: (event: SimplexWorkerMessageEventLike) => void,
    ): void;
    (
      type: 'error',
      listener: (event: SimplexWorkerErrorEventLike) => void,
    ): void;
  };
  removeEventListener?: {
    (
      type: 'message',
      listener: (event: SimplexWorkerMessageEventLike) => void,
    ): void;
    (
      type: 'error',
      listener: (event: SimplexWorkerErrorEventLike) => void,
    ): void;
  };
  /** Node.js `worker_threads.Worker` / EventEmitter-style listener API. */
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  terminate?: () => void | Promise<number>;
}

/**
 * Minimal structural interface for the global scope inside a dedicated Web Worker
 * (`self`) or Node `worker_threads.parentPort`.
 */
export interface SimplexWorkerHostScope {
  postMessage(message: unknown, transfer?: SimplexTransferableLike[]): void;
  addEventListener?: (
    type: 'message',
    listener: (event: SimplexWorkerMessageEventLike) => void,
  ) => void;
  removeEventListener?: (
    type: 'message',
    listener: (event: SimplexWorkerMessageEventLike) => void,
  ) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

// ============================================================================
// Flat, structured-cloneable, Rust/serde-friendly DTOs
// ============================================================================

/**
 * Structured-cloneable item record transmitted across the worker boundary.
 * Arbitrary domain fields (functions, class instances, React nodes) stay on the
 * main thread and are rehydrated back onto the returned `SimplexLayoutSnapshot<TItem>`.
 */
export interface SimplexWorkerItemPayload {
  readonly id: string;
  readonly tags?: readonly string[];
  /** Single numeric embedding vector (supports `Float32Array`, `Float64Array`, or `number[]`). */
  readonly embedding?: EmbeddingVector;
  /** Multi-modal embedding vectors aligned with `clusteringStrategy.modalities`. */
  readonly embeddings?: readonly EmbeddingVector[];
  /** Optional pre-measured convex hull for this item. */
  readonly hull?: ConvexGeometry;
}

export type SimplexWorkerMeshSpec =
  | {
      readonly kind: 'adaptive-hex';
      readonly options?: Partial<MeshOptions>;
    }
  | {
      readonly kind: 'fixed-lattice';
      readonly cols: number;
      readonly rows: number;
      readonly orientation?: 'horizontal' | 'vertical' | 'auto';
      readonly wideFirst?: boolean;
      readonly innerPadding?: number;
      readonly sideLength?: number;
    };

export interface SimplexWorkerEmbeddingModalitySpec {
  readonly name?: string;
  readonly weight?: number;
}

export type SimplexWorkerClusteringSpec =
  | {
      readonly kind: 'jaccard-annealing';
      readonly sharedTagRule?: SharedTagRuleKind;
      readonly anchorRule?: SimplexAnchorRuleKind;
    }
  | {
      readonly kind: 'soft-simplex-tag';
      readonly sharedTagRule?: SharedTagRuleKind;
      readonly anchorRule?: SimplexAnchorRuleKind;
      readonly triangleSpread?: number;
      readonly balanceLoad?: boolean;
    }
  | {
      readonly kind: 'embedding';
      readonly metric?: 'cosine' | 'euclidean';
      readonly clusterCount?: number;
      readonly maxIterations?: number;
      readonly anchorRule?: EmbeddingAnchorRuleKind;
      readonly representativeCount?: number;
      readonly similaritySharpness?: number;
      readonly modalities?: readonly SimplexWorkerEmbeddingModalitySpec[];
    }
  | {
      readonly kind: 'soft-simplex-embedding';
      readonly metric?: 'cosine' | 'euclidean';
      readonly clusterCount?: number;
      readonly maxIterations?: number;
      readonly representativeCount?: number;
      readonly similaritySharpness?: number;
      readonly triangleSpread?: number;
      readonly minSecondaryWeight?: number;
      readonly balanceLoad?: boolean;
      readonly modalities?: readonly SimplexWorkerEmbeddingModalitySpec[];
    };

export type SimplexWorkerColorSpec =
  | { readonly kind: 'oklab-contrast' }
  | { readonly kind: 'theme-adaptive-oklab' }
  | { readonly kind: 'palette'; readonly colors: readonly string[] };

export type SimplexWorkerLayoutSpec =
  | { readonly kind: 'pbd-uniform' }
  | { readonly kind: 'warm-start-pbd' }
  | {
      readonly kind: 'local-adaptive';
      readonly crowdRadiusPx?: number;
      readonly minLocalScale?: number;
      readonly warmStart?: boolean;
    }
  | {
      readonly kind: 'collision-driven';
      readonly minLocalScale?: number;
      readonly shrinkFactor?: number;
      readonly warmStart?: boolean;
    };

/** Wire message instructing the worker backend to solve a simplex snapshot. */
export interface SimplexWorkerSolveRequest {
  readonly type: 'simplex-viz:solve';
  readonly protocolVersion: typeof SIMPLEX_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly generation: number;
  readonly items: readonly SimplexWorkerItemPayload[];
  readonly width?: number;
  readonly height?: number;
  readonly itemRadius?: number;
  readonly clusterRadius?: number;
  readonly theme?: SimplexColorTheme;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly meshStrategy?: SimplexWorkerMeshSpec;
  readonly clusteringStrategy?: SimplexWorkerClusteringSpec;
  readonly colorStrategy?: SimplexWorkerColorSpec;
  readonly layoutStrategy?: SimplexWorkerLayoutSpec;
  /** Optional uniform convex hull applied to every topic cluster vertex. */
  readonly clusterHull?: ConvexGeometry;
}

/** Wire message notifying the worker that earlier generations or a specific request are cancelled. */
export interface SimplexWorkerCancelRequest {
  readonly type: 'simplex-viz:cancel';
  readonly protocolVersion: typeof SIMPLEX_WORKER_PROTOCOL_VERSION;
  readonly generation: number;
  /** When set, cancels only this specific request without superseding concurrent generations. */
  readonly requestId?: number;
}

export type SimplexWorkerMessage =
  | SimplexWorkerSolveRequest
  | SimplexWorkerCancelRequest;

export interface SimplexWorkerSolveSuccessResponse {
  readonly type: 'simplex-viz:result';
  readonly protocolVersion: typeof SIMPLEX_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly generation: number;
  readonly snapshot: SimplexLayoutSnapshot<SimplexWorkerItemPayload>;
  readonly durationMs: number;
}

export type SimplexWorkerResponseErrorCode =
  | 'SOLVE_ERROR'
  | 'CANCELLED'
  | 'INVALID_REQUEST';

export interface SimplexWorkerSolveErrorResponse {
  readonly type: 'simplex-viz:error';
  readonly protocolVersion: typeof SIMPLEX_WORKER_PROTOCOL_VERSION;
  readonly requestId: number;
  readonly generation: number;
  readonly code: SimplexWorkerResponseErrorCode;
  readonly message: string;
}

export type SimplexWorkerResponse =
  | SimplexWorkerSolveSuccessResponse
  | SimplexWorkerSolveErrorResponse;

/**
 * Pluggable worker-side solver contract.
 * Defaults to the pure-TypeScript `solveSimplexWorkerRequest()` implementation,
 * and allows future native/Rust/WASM backends (e.g. `@simplex-viz/wasm`) to drop
 * into the exact same worker transport without changing client code.
 */
export type SimplexWorkerSolver = (
  request: SimplexWorkerSolveRequest,
) =>
  | SimplexLayoutSnapshot<SimplexWorkerItemPayload>
  | Promise<SimplexLayoutSnapshot<SimplexWorkerItemPayload>>;

// ============================================================================
// Structured Error Class for Client Cancellation & Transport Errors
// ============================================================================

export type SimplexWorkerClientErrorCode =
  | 'SUPERSEDED'
  | 'ABORTED'
  | 'TERMINATED'
  | 'WORKER_ERROR'
  | 'TIMEOUT';

export class SimplexWorkerClientError extends Error {
  readonly code: SimplexWorkerClientErrorCode;
  readonly generation?: number;
  readonly requestId?: number;

  constructor(
    code: SimplexWorkerClientErrorCode,
    message: string,
    meta?: { readonly generation?: number; readonly requestId?: number },
  ) {
    super(message);
    this.name = 'SimplexWorkerClientError';
    this.code = code;
    this.generation = meta?.generation;
    this.requestId = meta?.requestId;
  }
}

/**
 * Returns `true` when `error` represents an expected cancellation
 * (`SUPERSEDED` by a newer generation, `ABORTED` via `AbortSignal`, or `TERMINATED`).
 */
export function isSimplexWorkerCancelledError(
  error: unknown,
): error is SimplexWorkerClientError {
  return (
    error instanceof SimplexWorkerClientError &&
    (error.code === 'SUPERSEDED' ||
      error.code === 'ABORTED' ||
      error.code === 'TERMINATED')
  );
}

// ============================================================================
// Worker-side Strategy Resolution & Solver
// ============================================================================

function resolveMeshStrategySpec(
  spec: SimplexWorkerMeshSpec | undefined,
): SimplexMeshStrategy<SimplexWorkerItemPayload> {
  if (!spec || spec.kind === 'adaptive-hex') {
    return createAdaptiveHexMeshStrategy<SimplexWorkerItemPayload>(
      spec?.kind === 'adaptive-hex' ? spec.options : undefined,
    );
  }
  return createFixedLatticeMeshStrategy<SimplexWorkerItemPayload>({
    cols: spec.cols,
    rows: spec.rows,
    orientation: spec.orientation,
    wideFirst: spec.wideFirst,
    innerPadding: spec.innerPadding,
    sideLength: spec.sideLength,
  });
}

function resolveClusteringStrategySpec(
  spec: SimplexWorkerClusteringSpec | undefined,
): SimplexClusteringStrategy<SimplexWorkerItemPayload> {
  if (!spec || spec.kind === 'jaccard-annealing') {
    return createJaccardAnnealingClusteringStrategy<SimplexWorkerItemPayload>(
      spec?.kind === 'jaccard-annealing'
        ? {
            sharedTagRule: spec.sharedTagRule,
            anchorRule: spec.anchorRule,
          }
        : undefined,
    );
  }

  if (spec.kind === 'soft-simplex-tag') {
    return createSoftSimplexTagClusteringStrategy<SimplexWorkerItemPayload>({
      sharedTagRule: spec.sharedTagRule,
      anchorRule: spec.anchorRule,
      triangleSpread: spec.triangleSpread,
      balanceLoad: spec.balanceLoad,
    });
  }

  const getEmbedding =
    spec.modalities && spec.modalities.length > 0
      ? spec.modalities.map((mod, idx) => ({
          name: mod.name,
          weight: mod.weight,
          getVector: (item: SimplexWorkerItemPayload): EmbeddingVector =>
            item.embeddings?.[idx] ?? item.embedding ?? [],
        }))
      : (item: SimplexWorkerItemPayload): EmbeddingVector =>
          item.embedding ?? item.embeddings?.[0] ?? [];

  if (spec.kind === 'embedding') {
    return createEmbeddingClusteringStrategy<SimplexWorkerItemPayload>({
      getEmbedding,
      metric: spec.metric,
      clusterCount: spec.clusterCount,
      maxIterations: spec.maxIterations,
      anchorRule: spec.anchorRule,
      representativeCount: spec.representativeCount,
      similaritySharpness: spec.similaritySharpness,
    });
  }

  return createSoftSimplexEmbeddingClusteringStrategy<SimplexWorkerItemPayload>({
    getEmbedding,
    metric: spec.metric,
    clusterCount: spec.clusterCount,
    maxIterations: spec.maxIterations,
    representativeCount: spec.representativeCount,
    similaritySharpness: spec.similaritySharpness,
    triangleSpread: spec.triangleSpread,
    minSecondaryWeight: spec.minSecondaryWeight,
    balanceLoad: spec.balanceLoad,
  });
}

function resolveColorStrategySpec(
  spec: SimplexWorkerColorSpec | undefined,
): SimplexColorStrategy<SimplexWorkerItemPayload> {
  if (!spec || spec.kind === 'oklab-contrast') {
    return createOklabContrastColorStrategy<SimplexWorkerItemPayload>();
  }
  if (spec.kind === 'theme-adaptive-oklab') {
    return createThemeAdaptiveOklabColorStrategy<SimplexWorkerItemPayload>();
  }
  return createPaletteColorStrategy<SimplexWorkerItemPayload>(spec.colors);
}

function resolveLayoutStrategySpec(
  spec: SimplexWorkerLayoutSpec | undefined,
): SimplexLayoutStrategy {
  if (!spec || spec.kind === 'pbd-uniform') {
    return createPbdUniformLayoutStrategy();
  }
  if (spec.kind === 'warm-start-pbd') {
    return createWarmStartPbdLayoutStrategy();
  }
  if (spec.kind === 'local-adaptive') {
    return createLocalAdaptiveLayoutStrategy({
      crowdRadiusPx: spec.crowdRadiusPx,
      minLocalScale: spec.minLocalScale,
      warmStart: spec.warmStart,
    });
  }
  return createCollisionDrivenLayoutStrategy({
    minLocalScale: spec.minLocalScale,
    shrinkFactor: spec.shrinkFactor,
    warmStart: spec.warmStart,
  });
}

function nowMs(): number {
  const perf = (globalThis as { readonly performance?: { now(): number } }).performance;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

/**
 * Pure, zero-DOM solver executing a structured-cloneable `SimplexWorkerSolveRequest`
 * via `@simplex-viz/core`'s `solveSimplexSnapshot()`.
 */
export function solveSimplexWorkerRequest(
  request: SimplexWorkerSolveRequest,
): SimplexLayoutSnapshot<SimplexWorkerItemPayload> {
  const itemRadius = Math.max(2, request.itemRadius ?? 10);
  const clusterRadius = Math.max(4, request.clusterRadius ?? 24);
  const defaultItemHull: ConvexGeometry = { kind: 'circle', radius: itemRadius };
  const defaultClusterHull: ConvexGeometry = request.clusterHull ?? {
    kind: 'circle',
    radius: clusterRadius,
  };

  return solveSimplexSnapshot<SimplexWorkerItemPayload>(request.items, {
    getId: (it) => it.id,
    getTags: (it) => it.tags ?? [],
    width: request.width,
    height: request.height,
    itemRadius,
    clusterRadius,
    theme: request.theme,
    meshOptions: request.meshOptions,
    layoutOptions: request.layoutOptions,
    meshStrategy: resolveMeshStrategySpec(request.meshStrategy),
    clusteringStrategy: resolveClusteringStrategySpec(request.clusteringStrategy),
    colorStrategy: resolveColorStrategySpec(request.colorStrategy),
    layoutStrategy: resolveLayoutStrategySpec(request.layoutStrategy),
    measureContentHull: (item) => item.hull ?? defaultItemHull,
    measureClusterHull: () => defaultClusterHull,
  });
}

function isSimplexWorkerMessage(value: unknown): value is SimplexWorkerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly type?: unknown };
  return (
    candidate.type === 'simplex-viz:solve' ||
    candidate.type === 'simplex-viz:cancel'
  );
}

function isSimplexWorkerResponse(value: unknown): value is SimplexWorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly type?: unknown };
  return (
    candidate.type === 'simplex-viz:result' ||
    candidate.type === 'simplex-viz:error'
  );
}

export interface AttachSimplexWorkerHandlerOptions {
  /**
   * Worker host scope (`self` in a Web Worker or `parentPort` in Node `worker_threads`).
   * Automatically resolves `globalThis` when omitted inside a browser Web Worker.
   */
  readonly scope?: SimplexWorkerHostScope;
  /**
   * Custom solver backend (synchronous or async, e.g. a future `@simplex-viz/wasm`
   * Rust/WASM solver). Defaults to `solveSimplexWorkerRequest`.
   */
  readonly solver?: SimplexWorkerSolver;
}

/**
 * Attaches the SimplexViz message handler inside a Web Worker or Node `worker_threads`
 * worker script. Supports stale-generation cancellation for both queued and async solvers,
 * and returns a detach cleanup function.
 */
export function attachSimplexWorkerHandler(
  options: AttachSimplexWorkerHandlerOptions = {},
): () => void {
  const scope: SimplexWorkerHostScope | undefined =
    options.scope ??
    (typeof (globalThis as { postMessage?: unknown }).postMessage === 'function'
      ? (globalThis as unknown as SimplexWorkerHostScope)
      : undefined);

  if (!scope) {
    throw new Error(
      'attachSimplexWorkerHandler(): no worker scope found. Pass `{ scope }` explicitly when running outside a DedicatedWorkerGlobalScope.',
    );
  }

  const solver: SimplexWorkerSolver = options.solver ?? solveSimplexWorkerRequest;
  let latestGeneration = 0;
  const cancelledRequestIds = new Set<number>();

  const isRequestCancelled = (req: SimplexWorkerSolveRequest): boolean =>
    req.generation < latestGeneration || cancelledRequestIds.has(req.requestId);

  const handlePayload = (rawData: unknown): void => {
    if (!isSimplexWorkerMessage(rawData)) return;

    if (rawData.type === 'simplex-viz:cancel') {
      if (rawData.requestId !== undefined) {
        cancelledRequestIds.add(rawData.requestId);
        if (cancelledRequestIds.size > 256) {
          const oldest = cancelledRequestIds.values().next().value;
          if (oldest !== undefined) cancelledRequestIds.delete(oldest);
        }
      } else if (rawData.generation >= latestGeneration) {
        latestGeneration = rawData.generation;
      }
      return;
    }

    const req = rawData;
    if (isRequestCancelled(req)) {
      cancelledRequestIds.delete(req.requestId);
      const cancelled: SimplexWorkerSolveErrorResponse = {
        type: 'simplex-viz:error',
        protocolVersion: SIMPLEX_WORKER_PROTOCOL_VERSION,
        requestId: req.requestId,
        generation: req.generation,
        code: 'CANCELLED',
        message: `Generation ${req.generation} superseded or cancelled.`,
      };
      scope.postMessage(cancelled);
      return;
    }

    latestGeneration = Math.max(latestGeneration, req.generation);
    const started = nowMs();

    Promise.resolve()
      .then(() => solver(req))
      .then((snapshot) => {
        if (isRequestCancelled(req)) {
          cancelledRequestIds.delete(req.requestId);
          const cancelled: SimplexWorkerSolveErrorResponse = {
            type: 'simplex-viz:error',
            protocolVersion: SIMPLEX_WORKER_PROTOCOL_VERSION,
            requestId: req.requestId,
            generation: req.generation,
            code: 'CANCELLED',
            message: `Generation ${req.generation} cancelled while solving.`,
          };
          scope.postMessage(cancelled);
          return;
        }
        const response: SimplexWorkerSolveSuccessResponse = {
          type: 'simplex-viz:result',
          protocolVersion: SIMPLEX_WORKER_PROTOCOL_VERSION,
          requestId: req.requestId,
          generation: req.generation,
          snapshot,
          durationMs: Math.max(0, nowMs() - started),
        };
        scope.postMessage(response);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : String(err ?? 'Unknown worker error');
        const response: SimplexWorkerSolveErrorResponse = {
          type: 'simplex-viz:error',
          protocolVersion: SIMPLEX_WORKER_PROTOCOL_VERSION,
          requestId: req.requestId,
          generation: req.generation,
          code: 'SOLVE_ERROR',
          message,
        };
        scope.postMessage(response);
      });
  };

  if (typeof scope.addEventListener === 'function') {
    const listener = (event: SimplexWorkerMessageEventLike) => {
      handlePayload(event.data);
    };
    scope.addEventListener('message', listener);
    return () => {
      scope.removeEventListener?.('message', listener);
    };
  }

  if (typeof scope.on === 'function') {
    const listener = (data: unknown) => {
      handlePayload(data);
    };
    scope.on('message', listener);
    return () => {
      scope.off?.('message', listener);
    };
  }

  throw new Error(
    'attachSimplexWorkerHandler(): provided worker scope supports neither addEventListener() nor on().',
  );
}

// ============================================================================
// Main-Thread Rehydration (Payload Snapshot -> Original TItem References)
// ============================================================================

function rehydrateClusterMembers<TItem>(
  members: readonly ClusterMemberRef<SimplexWorkerItemPayload>[],
  itemById: ReadonlyMap<string, TItem>,
): readonly ClusterMemberRef<TItem>[] {
  return members.map((m) => ({
    ...m,
    item: itemById.get(m.itemId) ?? (m.item as unknown as TItem),
  }));
}

function rehydrateClusterDescriptor<TItem>(
  cluster: ClusterDescriptor<SimplexWorkerItemPayload>,
  itemById: ReadonlyMap<string, TItem>,
  originalItems: readonly TItem[],
): ClusterDescriptor<TItem> {
  const {
    members: rawMembers,
    representativeItems: rawRepItems,
    allItems: rawAllItems,
    peerClusters: rawPeerClusters,
    ...clusterRest
  } = cluster;

  const peerClusters: readonly PeerClusterContext<TItem, undefined>[] | undefined =
    rawPeerClusters?.map((peer) => {
      const {
        members: peerMembers,
        representativeItems: peerRepItems,
        ...peerRest
      } = peer;
      return {
        ...peerRest,
        members: rehydrateClusterMembers(peerMembers, itemById),
        ...(peerRepItems !== undefined
          ? {
              representativeItems: rehydrateClusterMembers(peerRepItems, itemById),
            }
          : {}),
      };
    });

  return {
    ...clusterRest,
    members: rehydrateClusterMembers(rawMembers, itemById),
    ...(rawRepItems !== undefined
      ? {
          representativeItems: rehydrateClusterMembers(rawRepItems, itemById),
        }
      : {}),
    ...(rawAllItems !== undefined ? { allItems: originalItems } : {}),
    ...(peerClusters !== undefined ? { peerClusters } : {}),
  };
}

function rehydrateSnapshot<TItem>(
  raw: SimplexLayoutSnapshot<SimplexWorkerItemPayload>,
  originalItems: readonly TItem[],
  idsByIndex: readonly string[],
): SimplexLayoutSnapshot<TItem> {
  const itemById = new Map<string, TItem>();
  for (let i = 0; i < originalItems.length; i++) {
    const id = idsByIndex[i];
    if (id !== undefined) {
      itemById.set(id, originalItems[i]!);
    }
  }

  const clusterByUid = new Map<string, ClusterDescriptor<TItem>>();
  const clusters: SnapshotClusterNode<TItem>[] = raw.clusters.map((node) => {
    const rehydratedCluster = rehydrateClusterDescriptor(
      node.cluster,
      itemById,
      originalItems,
    );
    clusterByUid.set(rehydratedCluster.clusterUid, rehydratedCluster);
    return {
      ...node,
      cluster: rehydratedCluster,
    };
  });

  const resolveCluster = (
    c: ClusterDescriptor<SimplexWorkerItemPayload> | undefined,
  ): ClusterDescriptor<TItem> | undefined => {
    if (!c) return undefined;
    return (
      clusterByUid.get(c.clusterUid) ??
      rehydrateClusterDescriptor(c, itemById, originalItems)
    );
  };

  const items: SnapshotContentNode<TItem>[] = raw.items.map((node) => {
    const origItem = itemById.get(node.id) ?? (node.item as unknown as TItem);
    const rehydratedUnits = node.layoutContext.unitClusters.map((uc) => ({
      cluster: resolveCluster(uc.cluster)!,
      weight: uc.weight,
      coverage: uc.coverage,
    }));
    const layoutContext: ContentLayoutContext<TItem> = {
      ...node.layoutContext,
      unitClusters: rehydratedUnits,
    };
    return {
      ...node,
      item: origItem,
      layoutContext,
    };
  });

  const triangles: MeshTriangleRenderState<TItem>[] = raw.triangles.map((tri) => ({
    ...tri,
    clusters: [
      resolveCluster(tri.clusters[0]),
      resolveCluster(tri.clusters[1]),
      resolveCluster(tri.clusters[2]),
    ] as const,
  }));

  const edges: MeshEdgeRenderState<TItem>[] = raw.edges.map((edge) => ({
    ...edge,
    clusters: [
      resolveCluster(edge.clusters[0]),
      resolveCluster(edge.clusters[1]),
    ] as const,
  }));

  return {
    width: raw.width,
    height: raw.height,
    mesh: raw.mesh,
    triangles,
    edges,
    clusters,
    items,
    metrics: raw.metrics,
  };
}

// ============================================================================
// Main-Thread Extraction & Client Adapter
// ============================================================================

function defaultGetId<TItem>(item: TItem): string {
  if (typeof item === 'object' && item !== null && 'id' in item) {
    const raw = (item as { readonly id: string }).id;
    return typeof raw === 'string' ? raw : String(raw);
  }
  return '';
}

function defaultGetTags<TItem>(item: TItem): readonly string[] {
  if (typeof item === 'object' && item !== null && 'tags' in item) {
    const raw = (item as { readonly tags: readonly string[] }).tags;
    return Array.isArray(raw) ? raw : [];
  }
  return [];
}

/**
 * Per-call options for `SimplexWorkerClient.solve()` and `solveSimplexSnapshotAsync()`.
 */
export interface SimplexWorkerSolveOptions<TItem = DefaultTaggedItem> {
  /** Custom item ID extractor (defaults to `item.id`). */
  readonly getId?: (item: TItem) => string;
  /** Custom tag extractor for tag clustering strategies (defaults to `item.tags`). */
  readonly getTags?: (item: TItem) => readonly string[];
  /** Optional tag normalizer run before serialization. */
  readonly normalizeTag?: (rawTag: string) => string;
  /**
   * Single or multi-modal embedding extractor(s) for `'embedding'` and
   * `'soft-simplex-embedding'` worker strategies.
   */
  readonly getEmbedding?:
    | ((item: TItem) => EmbeddingVector)
    | readonly ((item: TItem) => EmbeddingVector)[];
  /**
   * Optional pre-measurement callback computing each item's convex hull on the
   * main thread (e.g., via `rectToConvexPolygon` or SVG `getBBox()`) before sending to the worker.
   */
  readonly measureContentHull?: (item: TItem) => ConvexGeometry;
  /** Optional uniform convex hull applied to topic clusters. */
  readonly clusterHull?: ConvexGeometry;
  readonly width?: number;
  readonly height?: number;
  readonly itemRadius?: number;
  readonly clusterRadius?: number;
  readonly theme?: SimplexColorTheme;
  readonly meshOptions?: MeshOptions;
  readonly layoutOptions?: LayoutSolverOptions;
  readonly meshStrategy?: SimplexWorkerMeshSpec;
  readonly clusteringStrategy?: SimplexWorkerClusteringSpec;
  readonly colorStrategy?: SimplexWorkerColorSpec;
  readonly layoutStrategy?: SimplexWorkerLayoutSpec;
  /**
   * When `true` (default), supersedes and rejects any earlier in-flight solve
   * request on this client so stale responses from rapid resize/filter/item updates
   * are discarded automatically. Set `false` to allow concurrent independent solves.
   */
  readonly cancelPrevious?: boolean;
  /** Optional `AbortSignal` cancelling this solve request. */
  readonly signal?: SimplexAbortSignalLike;
  /** Optional per-request timeout in milliseconds (`<= 0` disables timeout). */
  readonly timeoutMs?: number;
  /**
   * When `true`, transfers unique `ArrayBuffer`s backing `Float32Array` / `Float64Array`
   * embedding vectors via `postMessage(req, transferList)` for zero-copy handoff.
   * Warning: transferred buffers become detached on the calling thread. Default: `false`.
   */
  readonly transferEmbeddings?: boolean;
}

export interface SimplexWorkerSolveResult<TItem = DefaultTaggedItem> {
  readonly snapshot: SimplexLayoutSnapshot<TItem>;
  readonly generation: number;
  readonly requestId: number;
  readonly durationMs: number;
  readonly usedWorker: boolean;
}

export interface SimplexWorkerClientOptions {
  /**
   * Default behavior for superseding older in-flight solve requests when a new
   * `solve()` call starts. Default: `true`.
   */
  readonly cancelPreviousByDefault?: boolean;
  /**
   * Default timeout in milliseconds for worker requests (`0` / `undefined` = no timeout).
   */
  readonly timeoutMs?: number;
  /**
   * When `true` (default), gracefully falls back to async in-thread solving if
   * `workerOrFactory` is `null`/`undefined` or throws during creation (e.g., in SSR).
   */
  readonly fallbackToInThread?: boolean;
  /**
   * Optional in-thread solver override used when operating in fallback mode
   * (defaults to `solveSimplexWorkerRequest`).
   */
  readonly fallbackSolver?: SimplexWorkerSolver;
}

export interface SimplexWorkerClient {
  /**
   * Solves a full `SimplexLayoutSnapshot<TItem>` off the main thread (or via async
   * fallback when no worker is attached), rehydrating original `TItem` references.
   */
  solve<TItem = DefaultTaggedItem>(
    items: readonly TItem[],
    options?: SimplexWorkerSolveOptions<TItem>,
  ): Promise<SimplexWorkerSolveResult<TItem>>;
  /** Cancels all currently pending solve requests with `SimplexWorkerClientError('ABORTED')`. */
  cancelPending(reason?: string): void;
  /** Latest monotonically increasing generation number issued by this client. */
  getGeneration(): number;
  /** Number of currently in-flight solve requests. */
  getPendingCount(): number;
  /** `true` when backed by an active Worker port (vs. async in-thread fallback). */
  isUsingWorker(): boolean;
  /** `true` once `terminate()` / `dispose()` has been called. */
  isTerminated(): boolean;
  /** Terminates the underlying worker (if any), detaches listeners, and cancels pending requests. */
  terminate(): void;
  /** Alias for `terminate()`. */
  dispose(): void;
}

interface PendingSolveEntry {
  readonly requestId: number;
  readonly generation: number;
  readonly settleResolve: (response: SimplexWorkerSolveSuccessResponse) => void;
  readonly settleReject: (error: Error) => void;
  readonly cleanup: () => void;
}

interface GlobalTimersLike {
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

function scheduleAsyncTurn(fn: () => void): () => void {
  const timers = globalThis as GlobalTimersLike;
  if (typeof timers.setTimeout === 'function') {
    const handle = timers.setTimeout(fn, 0);
    return () => {
      timers.clearTimeout?.(handle);
    };
  }
  let cancelled = false;
  void Promise.resolve().then(() => {
    if (!cancelled) fn();
  });
  return () => {
    cancelled = true;
  };
}

function scheduleTimeout(fn: () => void, ms: number): (() => void) | null {
  const timers = globalThis as GlobalTimersLike;
  if (typeof timers.setTimeout !== 'function') return null;
  const handle = timers.setTimeout(fn, ms);
  return () => {
    timers.clearTimeout?.(handle);
  };
}

function extractWorkerPayload<TItem>(
  items: readonly TItem[],
  options: SimplexWorkerSolveOptions<TItem>,
): {
  readonly payloads: readonly SimplexWorkerItemPayload[];
  readonly idsByIndex: readonly string[];
  readonly transferList: SimplexTransferableLike[];
} {
  const getId = options.getId ?? defaultGetId;
  const getTags = options.getTags ?? defaultGetTags;
  const normalizeTag = options.normalizeTag ?? defaultNormalizeTag;
  const isEmbeddingStrategy =
    options.clusteringStrategy?.kind === 'embedding' ||
    options.clusteringStrategy?.kind === 'soft-simplex-embedding';
  const transferSet = options.transferEmbeddings
    ? new Set<SimplexTransferableLike>()
    : null;

  const trackBuffer = (vec: EmbeddingVector | undefined): void => {
    if (!transferSet || !vec) return;
    if (vec instanceof Float32Array || vec instanceof Float64Array) {
      // Only transfer standalone ArrayBuffers (never SharedArrayBuffer or sliced views)
      if (
        vec.buffer instanceof ArrayBuffer &&
        vec.byteOffset === 0 &&
        vec.byteLength === vec.buffer.byteLength
      ) {
        transferSet.add(vec.buffer);
      }
    }
  };

  const idsByIndex: string[] = new Array(items.length);
  const payloads: SimplexWorkerItemPayload[] = new Array(items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const id = getId(item);
    idsByIndex[i] = id;

    let tags: readonly string[] | undefined;
    if (!isEmbeddingStrategy) {
      const rawTags = getTags(item);
      if (rawTags.length > 0) {
        const normalized: string[] = [];
        for (let t = 0; t < rawTags.length; t++) {
          const clean = normalizeTag(rawTags[t]!);
          if (clean) normalized.push(clean);
        }
        tags = normalized;
      } else {
        tags = [];
      }
    }

    let embedding: EmbeddingVector | undefined;
    let embeddings: readonly EmbeddingVector[] | undefined;
    if (options.getEmbedding) {
      if (Array.isArray(options.getEmbedding)) {
        const vecs = (
          options.getEmbedding as readonly ((it: TItem) => EmbeddingVector)[]
        ).map((fn) => fn(item));
        for (const v of vecs) trackBuffer(v);
        embeddings = vecs;
      } else {
        embedding = (options.getEmbedding as (it: TItem) => EmbeddingVector)(item);
        trackBuffer(embedding);
      }
    }

    const hull = options.measureContentHull
      ? options.measureContentHull(item)
      : undefined;

    payloads[i] = {
      id,
      ...(tags !== undefined ? { tags } : {}),
      ...(embedding !== undefined ? { embedding } : {}),
      ...(embeddings !== undefined ? { embeddings } : {}),
      ...(hull !== undefined ? { hull } : {}),
    };
  }

  return {
    payloads,
    idsByIndex,
    transferList: transferSet ? Array.from(transferSet) : [],
  };
}

/**
 * Creates a reusable, generation-aware Worker client for off-main-thread
 * QAP annealing and PBD/SAT layout solving.
 *
 * Accepts a browser `Worker`, `MessagePort`, Node.js `worker_threads.Worker`,
 * a lazy factory `() => Worker`, or `null`/`undefined` (in-thread async fallback).
 */
export function createSimplexWorkerClient(
  workerOrFactory?: SimplexWorkerPort | (() => SimplexWorkerPort) | null,
  options: SimplexWorkerClientOptions = {},
): SimplexWorkerClient {
  const cancelPreviousByDefault = options.cancelPreviousByDefault ?? true;
  const defaultTimeoutMs = options.timeoutMs ?? 0;
  const fallbackToInThread = options.fallbackToInThread ?? true;
  const fallbackSolver = options.fallbackSolver ?? solveSimplexWorkerRequest;

  let port: SimplexWorkerPort | null = null;
  if (typeof workerOrFactory === 'function') {
    try {
      port = workerOrFactory();
    } catch (err) {
      if (!fallbackToInThread) {
        throw err;
      }
      port = null;
    }
  } else if (workerOrFactory) {
    port = workerOrFactory;
  }

  let terminated = false;
  let generation = 0;
  let requestSeq = 0;
  const pending = new Map<number, PendingSolveEntry>();

  const rejectAllPending = (
    code: SimplexWorkerClientErrorCode,
    message: string,
  ): void => {
    const entries = Array.from(pending.values());
    pending.clear();
    for (const entry of entries) {
      entry.cleanup();
      entry.settleReject(
        new SimplexWorkerClientError(code, message, {
          generation: entry.generation,
          requestId: entry.requestId,
        }),
      );
    }
  };

  const handleWorkerMessage = (rawData: unknown): void => {
    if (!isSimplexWorkerResponse(rawData)) return;
    const entry = pending.get(rawData.requestId);
    if (!entry) return;
    pending.delete(rawData.requestId);
    entry.cleanup();

    if (rawData.type === 'simplex-viz:result') {
      entry.settleResolve(rawData);
      return;
    }

    const mappedCode: SimplexWorkerClientErrorCode =
      rawData.code === 'CANCELLED' ? 'SUPERSEDED' : 'WORKER_ERROR';
    entry.settleReject(
      new SimplexWorkerClientError(mappedCode, rawData.message, {
        generation: rawData.generation,
        requestId: rawData.requestId,
      }),
    );
  };

  const handleWorkerError = (errEvent: unknown): void => {
    const ev = errEvent as SimplexWorkerErrorEventLike | Error | undefined;
    const message =
      ev instanceof Error
        ? ev.message
        : typeof ev?.message === 'string' && ev.message.length > 0
          ? ev.message
          : 'Worker execution failed.';
    rejectAllPending('WORKER_ERROR', message);
  };

  let detachPortListeners: (() => void) | null = null;
  if (port) {
    if (typeof port.addEventListener === 'function') {
      const onMsg = (ev: SimplexWorkerMessageEventLike) => {
        handleWorkerMessage(ev.data);
      };
      const onErr = (ev: SimplexWorkerErrorEventLike) => {
        handleWorkerError(ev);
      };
      port.addEventListener('message', onMsg);
      port.addEventListener('error', onErr);
      const boundPort = port;
      detachPortListeners = () => {
        boundPort.removeEventListener?.('message', onMsg);
        boundPort.removeEventListener?.('error', onErr);
      };
    } else if (typeof port.on === 'function') {
      const onMsg = (data: unknown) => {
        handleWorkerMessage(data);
      };
      const onErr = (err: unknown) => {
        handleWorkerError(err);
      };
      port.on('message', onMsg);
      port.on('error', onErr);
      const boundPort = port;
      detachPortListeners = () => {
        boundPort.off?.('message', onMsg);
        boundPort.off?.('error', onErr);
      };
    }
  }

  const cancelPending = (reason = 'Pending solve cancelled.'): void => {
    if (pending.size === 0) return;
    generation += 1;
    if (port && !terminated) {
      const cancelMsg: SimplexWorkerCancelRequest = {
        type: 'simplex-viz:cancel',
        protocolVersion: SIMPLEX_WORKER_PROTOCOL_VERSION,
        generation,
      };
      port.postMessage(cancelMsg);
    }
    rejectAllPending('ABORTED', reason);
  };

  const terminate = (): void => {
    if (terminated) return;
    terminated = true;
    rejectAllPending('TERMINATED', 'SimplexWorkerClient was terminated.');
    detachPortListeners?.();
    detachPortListeners = null;
    if (port) {
      try {
        port.terminate?.();
      } catch {
        // Ignore teardown errors on already-closed workers
      }
      port = null;
    }
  };

  const solve = <TItem = DefaultTaggedItem>(
    items: readonly TItem[],
    callOptions: SimplexWorkerSolveOptions<TItem> = {},
  ): Promise<SimplexWorkerSolveResult<TItem>> => {
    if (terminated) {
      return Promise.reject(
        new SimplexWorkerClientError(
          'TERMINATED',
          'Cannot solve on a terminated SimplexWorkerClient.',
        ),
      );
    }

    if (callOptions.signal?.aborted) {
      return Promise.reject(
        new SimplexWorkerClientError('ABORTED', 'Solve request was already aborted.'),
      );
    }

    const shouldCancelPrevious =
      callOptions.cancelPrevious ?? cancelPreviousByDefault;
    generation += 1;
    const reqGeneration = generation;
    requestSeq += 1;
    const requestId = requestSeq;

    if (shouldCancelPrevious && pending.size > 0) {
      const stale = Array.from(pending.values()).filter(
        (entry) => entry.generation < reqGeneration,
      );
      for (const entry of stale) {
        pending.delete(entry.requestId);
        entry.cleanup();
        entry.settleReject(
          new SimplexWorkerClientError(
            'SUPERSEDED',
            `Solve generation ${entry.generation} superseded by ${reqGeneration}.`,
            { generation: entry.generation, requestId: entry.requestId },
          ),
        );
      }
      if (port) {
        const cancelMsg: SimplexWorkerCancelRequest = {
          type: 'simplex-viz:cancel',
          protocolVersion: SIMPLEX_WORKER_PROTOCOL_VERSION,
          generation: reqGeneration,
        };
        port.postMessage(cancelMsg);
      }
    }

    const originalItems = items.slice();
    const { payloads, idsByIndex, transferList } = extractWorkerPayload(
      originalItems,
      callOptions,
    );

    const request: SimplexWorkerSolveRequest = {
      type: 'simplex-viz:solve',
      protocolVersion: SIMPLEX_WORKER_PROTOCOL_VERSION,
      requestId,
      generation: reqGeneration,
      items: payloads,
      width: callOptions.width,
      height: callOptions.height,
      itemRadius: callOptions.itemRadius,
      clusterRadius: callOptions.clusterRadius,
      theme: callOptions.theme,
      meshOptions: callOptions.meshOptions,
      layoutOptions: callOptions.layoutOptions,
      meshStrategy: callOptions.meshStrategy,
      clusteringStrategy: callOptions.clusteringStrategy,
      colorStrategy: callOptions.colorStrategy,
      layoutStrategy: callOptions.layoutStrategy,
      clusterHull: callOptions.clusterHull,
    };

    const timeoutMs = callOptions.timeoutMs ?? defaultTimeoutMs;
    const signal = callOptions.signal;
    const activePort = port;

    return new Promise<SimplexWorkerSolveResult<TItem>>((resolve, reject) => {
      let settled = false;
      let cancelTimeout: (() => void) | null = null;
      let cancelFallbackTurn: (() => void) | null = null;

      const cleanup = (): void => {
        if (cancelTimeout !== null) {
          cancelTimeout();
          cancelTimeout = null;
        }
        if (cancelFallbackTurn !== null) {
          cancelFallbackTurn();
          cancelFallbackTurn = null;
        }
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const finishReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        pending.delete(requestId);
        cleanup();
        reject(err);
      };

      const finishResolve = (res: SimplexWorkerSolveSuccessResponse): void => {
        if (settled) return;
        settled = true;
        pending.delete(requestId);
        cleanup();
        const rehydrated = rehydrateSnapshot(
          res.snapshot,
          originalItems,
          idsByIndex,
        );
        resolve({
          snapshot: rehydrated,
          generation: res.generation,
          requestId: res.requestId,
          durationMs: res.durationMs,
          usedWorker: activePort !== null,
        });
      };

      const onAbort = signal
        ? () => {
            if (activePort && !terminated) {
              const cancelMsg: SimplexWorkerCancelRequest = {
                type: 'simplex-viz:cancel',
                protocolVersion: SIMPLEX_WORKER_PROTOCOL_VERSION,
                generation: reqGeneration,
                requestId,
              };
              activePort.postMessage(cancelMsg);
            }
            finishReject(
              new SimplexWorkerClientError('ABORTED', 'Solve request aborted.', {
                generation: reqGeneration,
                requestId,
              }),
            );
          }
        : null;

      if (signal && onAbort) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      if (timeoutMs > 0) {
        cancelTimeout = scheduleTimeout(() => {
          finishReject(
            new SimplexWorkerClientError(
              'TIMEOUT',
              `Worker solve timed out after ${timeoutMs} ms.`,
              { generation: reqGeneration, requestId },
            ),
          );
        }, timeoutMs);
      }

      pending.set(requestId, {
        requestId,
        generation: reqGeneration,
        settleResolve: finishResolve,
        settleReject: finishReject,
        cleanup,
      });

      if (activePort) {
        try {
          if (transferList.length > 0) {
            activePort.postMessage(request, transferList);
          } else {
            activePort.postMessage(request);
          }
        } catch (err) {
          finishReject(
            new SimplexWorkerClientError(
              'WORKER_ERROR',
              err instanceof Error ? err.message : String(err),
              { generation: reqGeneration, requestId },
            ),
          );
        }
        return;
      }

      // In-thread async fallback: yield a macrotask turn so UI paints first
      cancelFallbackTurn = scheduleAsyncTurn(() => {
        if (settled) return;
        const started = nowMs();
        Promise.resolve()
          .then(() => fallbackSolver(request))
          .then((snapshot) => {
            finishResolve({
              type: 'simplex-viz:result',
              protocolVersion: SIMPLEX_WORKER_PROTOCOL_VERSION,
              requestId,
              generation: reqGeneration,
              snapshot,
              durationMs: Math.max(0, nowMs() - started),
            });
          })
          .catch((err: unknown) => {
            finishReject(
              new SimplexWorkerClientError(
                'WORKER_ERROR',
                err instanceof Error ? err.message : String(err),
                { generation: reqGeneration, requestId },
              ),
            );
          });
      });
    });
  };

  return {
    solve,
    cancelPending,
    getGeneration: () => generation,
    getPendingCount: () => pending.size,
    isUsingWorker: () => port !== null && !terminated,
    isTerminated: () => terminated,
    terminate,
    dispose: terminate,
  };
}

// ============================================================================
// Standalone Async Snapshot Helper
// ============================================================================

export interface SolveSimplexSnapshotAsyncOptions<TItem = DefaultTaggedItem>
  extends SimplexWorkerSolveOptions<TItem> {
  /**
   * Optional reusable `SimplexWorkerClient` to offload computation off the main thread.
   * When omitted, solves asynchronously in a yielded macrotask turn with `AbortSignal` support.
   */
  readonly client?: SimplexWorkerClient;
}

/**
 * Asynchronous counterpart to `solveSimplexSnapshot()`.
 *
 * When given `{ client }`, offloads QAP annealing and PBD/SAT solving to the attached
 * Web Worker (or Node `worker_threads`) with stale-generation cancellation. Without a
 * worker client, yields a macrotask turn before solving so browser paint frames stay responsive.
 */
export async function solveSimplexSnapshotAsync<TItem = DefaultTaggedItem>(
  items: readonly TItem[],
  options: SolveSimplexSnapshotAsyncOptions<TItem> = {},
): Promise<SimplexLayoutSnapshot<TItem>> {
  const { client, ...solveOpts } = options;
  if (client) {
    const result = await client.solve(items, solveOpts);
    return result.snapshot;
  }

  const ephemeral = createSimplexWorkerClient(null, {
    cancelPreviousByDefault: false,
  });
  try {
    const result = await ephemeral.solve(items, solveOpts);
    return result.snapshot;
  } finally {
    ephemeral.terminate();
  }
}
