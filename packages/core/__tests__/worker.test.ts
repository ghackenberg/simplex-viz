import { describe, expect, it } from 'vitest';
import { rectToConvexPolygon } from '../src/geometry.js';
import {
  SIMPLEX_WORKER_PROTOCOL_VERSION,
  SimplexWorkerClientError,
  attachSimplexWorkerHandler,
  createSimplexWorkerClient,
  isSimplexWorkerCancelledError,
  solveSimplexSnapshotAsync,
  solveSimplexWorkerRequest,
  type SimplexTransferableLike,
  type SimplexWorkerHostScope,
  type SimplexWorkerMessageEventLike,
  type SimplexWorkerPort,
  type SimplexWorkerSolveRequest,
  type SimplexWorkerSolver,
} from '../src/worker.js';

interface DomainItem {
  readonly id: string;
  readonly tags: readonly string[];
  readonly label: string;
  /** Non-structured-cloneable method proving main-thread reference rehydration. */
  readonly formatLabel: () => string;
}

function makeDomainItems(count = 16): DomainItem[] {
  const tagSets = [
    ['geometry', 'math'],
    ['math', 'topology'],
    ['topology', 'physics'],
    ['physics', 'simulation'],
    ['simulation', 'geometry'],
    ['geometry', 'topology'],
    ['math', 'simulation'],
    ['physics', 'math'],
  ];
  return Array.from({ length: count }, (_, i) => {
    const tags = tagSets[i % tagSets.length]!;
    const label = `Record ${i + 1}`;
    return {
      id: `item-${i}`,
      tags,
      label,
      formatLabel: () => `[${tags.join('/')}] ${label}`,
    };
  });
}

interface MockWorkerPair {
  readonly clientPort: SimplexWorkerPort;
  readonly hostScope: SimplexWorkerHostScope;
  readonly postedToWorker: unknown[];
  readonly transfersToWorker: SimplexTransferableLike[][];
  readonly terminated: { value: boolean };
  emitWorkerError(message: string): void;
}

/**
 * In-memory MessageChannel-like pair enforcing real `structuredClone()` on every
 * message in both directions so any accidental non-cloneable payload fails tests.
 */
function createStructuredCloneWorkerPair(options?: {
  readonly mode?: 'eventTarget' | 'eventEmitter';
  readonly delayMs?: number;
}): MockWorkerPair {
  const mode = options?.mode ?? 'eventTarget';
  const delayMs = options?.delayMs ?? 0;

  const clientMsgListeners = new Set<(ev: SimplexWorkerMessageEventLike) => void>();
  const clientErrListeners = new Set<(err: unknown) => void>();
  const hostMsgListeners = new Set<(ev: SimplexWorkerMessageEventLike) => void>();

  const clientEmitterMsg = new Set<(...args: unknown[]) => void>();
  const clientEmitterErr = new Set<(...args: unknown[]) => void>();
  const hostEmitterMsg = new Set<(...args: unknown[]) => void>();

  const postedToWorker: unknown[] = [];
  const transfersToWorker: SimplexTransferableLike[][] = [];
  const terminated = { value: false };

  const deliver = (fn: () => void): void => {
    if (delayMs > 0) {
      setTimeout(fn, delayMs);
    } else {
      setTimeout(fn, 0);
    }
  };

  const clientPort: SimplexWorkerPort = {
    postMessage(message: unknown, transfer?: SimplexTransferableLike[]): void {
      if (terminated.value) return;
      const cloned =
        transfer && transfer.length > 0
          ? structuredClone(message, { transfer })
          : structuredClone(message);
      postedToWorker.push(cloned);
      if (transfer) transfersToWorker.push([...transfer]);
      deliver(() => {
        if (terminated.value) return;
        for (const fn of hostMsgListeners) fn({ data: cloned });
        for (const fn of hostEmitterMsg) fn(cloned);
      });
    },
    ...(mode === 'eventTarget'
      ? {
          addEventListener(type: 'message' | 'error', listener: unknown): void {
            if (type === 'message') {
              clientMsgListeners.add(
                listener as (ev: SimplexWorkerMessageEventLike) => void,
              );
            } else {
              clientErrListeners.add(listener as (err: unknown) => void);
            }
          },
          removeEventListener(type: 'message' | 'error', listener: unknown): void {
            if (type === 'message') {
              clientMsgListeners.delete(
                listener as (ev: SimplexWorkerMessageEventLike) => void,
              );
            } else {
              clientErrListeners.delete(listener as (err: unknown) => void);
            }
          },
        }
      : {
          on(event: string, listener: (...args: unknown[]) => void): void {
            if (event === 'message') clientEmitterMsg.add(listener);
            if (event === 'error') clientEmitterErr.add(listener);
          },
          off(event: string, listener: (...args: unknown[]) => void): void {
            if (event === 'message') clientEmitterMsg.delete(listener);
            if (event === 'error') clientEmitterErr.delete(listener);
          },
        }),
    terminate(): void {
      terminated.value = true;
    },
  };

  const hostScope: SimplexWorkerHostScope = {
    postMessage(message: unknown, transfer?: SimplexTransferableLike[]): void {
      if (terminated.value) return;
      const cloned =
        transfer && transfer.length > 0
          ? structuredClone(message, { transfer })
          : structuredClone(message);
      deliver(() => {
        if (terminated.value) return;
        for (const fn of clientMsgListeners) fn({ data: cloned });
        for (const fn of clientEmitterMsg) fn(cloned);
      });
    },
    ...(mode === 'eventTarget'
      ? {
          addEventListener(
            _type: 'message',
            listener: (ev: SimplexWorkerMessageEventLike) => void,
          ): void {
            hostMsgListeners.add(listener);
          },
          removeEventListener(
            _type: 'message',
            listener: (ev: SimplexWorkerMessageEventLike) => void,
          ): void {
            hostMsgListeners.delete(listener);
          },
        }
      : {
          on(event: string, listener: (...args: unknown[]) => void): void {
            if (event === 'message') hostEmitterMsg.add(listener);
          },
          off(event: string, listener: (...args: unknown[]) => void): void {
            if (event === 'message') hostEmitterMsg.delete(listener);
          },
        }),
  };

  return {
    clientPort,
    hostScope,
    postedToWorker,
    transfersToWorker,
    terminated,
    emitWorkerError(message: string): void {
      for (const fn of clientErrListeners) fn({ message });
      for (const fn of clientEmitterErr) fn(new Error(message));
    },
  };
}

describe('@simplex-viz/core/worker offloading adapter (Issue #22)', () => {
  it('solves over a structuredClone worker boundary and strictly rehydrates non-cloneable TItem references', async () => {
    const pair = createStructuredCloneWorkerPair();
    const detach = attachSimplexWorkerHandler({ scope: pair.hostScope });
    const client = createSimplexWorkerClient(pair.clientPort);

    try {
      const items = makeDomainItems(18);
      const itemById = new Map(items.map((it) => [it.id, it]));

      expect(client.isUsingWorker()).toBe(true);
      expect(client.isTerminated()).toBe(false);

      const res = await client.solve(items, {
        width: 900,
        height: 620,
        theme: 'dark',
        measureContentHull: (it) =>
          rectToConvexPolygon(40 + (it.label.length % 5) * 6, 22),
        clusterHull: rectToConvexPolygon(96, 30),
        colorStrategy: { kind: 'theme-adaptive-oklab' },
        layoutStrategy: { kind: 'collision-driven', minLocalScale: 0.55 },
      });

      expect(res.usedWorker).toBe(true);
      expect(res.generation).toBe(1);
      expect(res.requestId).toBe(1);
      expect(res.durationMs).toBeGreaterThanOrEqual(0);
      expect(res.snapshot.items).toHaveLength(items.length);
      expect(res.snapshot.metrics.overlapCount).toBe(0);
      expect(res.snapshot.clusters.length).toBeGreaterThan(0);

      // Verify strict main-thread reference identity across all rehydrated structures
      for (const node of res.snapshot.items) {
        const expected = itemById.get(node.id);
        expect(node.item).toBe(expected);
        expect(node.item.formatLabel()).toContain(expected!.label);
        expect(node.layoutContext.unitClusters.length).toBeGreaterThan(0);
        for (const uc of node.layoutContext.unitClusters) {
          for (const member of uc.cluster.members) {
            expect(member.item).toBe(itemById.get(member.itemId));
          }
        }
      }

      for (const clusterNode of res.snapshot.clusters) {
        for (const member of clusterNode.cluster.members) {
          expect(member.item).toBe(itemById.get(member.itemId));
        }
        for (const rep of clusterNode.cluster.representativeItems ?? []) {
          expect(rep.item).toBe(itemById.get(rep.itemId));
        }
      }

      for (const tri of res.snapshot.triangles) {
        for (const c of tri.clusters) {
          if (!c) continue;
          for (const m of c.members) {
            expect(m.item).toBe(itemById.get(m.itemId));
          }
        }
      }
    } finally {
      client.terminate();
      detach();
    }

    expect(pair.terminated.value).toBe(true);
    expect(client.isTerminated()).toBe(true);
    expect(client.isUsingWorker()).toBe(false);
  });

  it('supports embedding strategies with Float32Array zero-copy ArrayBuffer transfers and fixed-lattice / palette / soft-simplex specs', async () => {
    const pair = createStructuredCloneWorkerPair();
    const detach = attachSimplexWorkerHandler({ scope: pair.hostScope });
    const client = createSimplexWorkerClient(pair.clientPort);

    try {
      const vecItems = Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        const emb = new Float32Array([
          Math.cos(angle),
          Math.sin(angle),
          i % 3 === 0 ? 1 : 0,
        ]);
        const secondary = new Float32Array([
          Math.sin(angle * 2),
          Math.cos(angle * 2),
        ]);
        return {
          id: `vec-${i}`,
          embedding: emb,
          secondary,
        };
      });

      const res = await client.solve(vecItems, {
        width: 800,
        height: 540,
        getEmbedding: [(it) => it.embedding, (it) => it.secondary],
        transferEmbeddings: true,
        meshStrategy: { kind: 'fixed-lattice', cols: 3, rows: 2 },
        clusteringStrategy: {
          kind: 'soft-simplex-embedding',
          metric: 'cosine',
          clusterCount: 5,
          modalities: [
            { name: 'primary', weight: 0.7 },
            { name: 'secondary', weight: 0.3 },
          ],
        },
        colorStrategy: {
          kind: 'palette',
          colors: ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#d97706'],
        },
        layoutStrategy: { kind: 'local-adaptive', minLocalScale: 0.6 },
      });

      expect(res.snapshot.items).toHaveLength(12);
      expect(res.snapshot.clusters.length).toBeGreaterThanOrEqual(3);
      expect(res.snapshot.metrics.overlapCount).toBe(0);
      // 12 items * 2 Float32Arrays = 24 unique ArrayBuffers transferred
      expect(pair.transfersToWorker).toHaveLength(1);
      expect(pair.transfersToWorker[0]).toHaveLength(24);
      // Original buffers were detached by zero-copy transfer
      expect(vecItems[0]!.embedding.byteLength).toBe(0);

      // Also exercise single-modality 'embedding' + 'soft-simplex-tag' specs
      const tagRes = await client.solve(makeDomainItems(10), {
        clusteringStrategy: { kind: 'soft-simplex-tag', triangleSpread: 0.85 },
        layoutStrategy: { kind: 'warm-start-pbd' },
      });
      expect(tagRes.snapshot.items).toHaveLength(10);
      expect(tagRes.snapshot.metrics.overlapCount).toBe(0);
    } finally {
      client.dispose();
      detach();
    }
  });

  it('supersedes stale generations on rapid solve() bursts and sends simplex-viz:cancel', async () => {
    const pair = createStructuredCloneWorkerPair({ delayMs: 8 });
    let solverCalls = 0;
    const asyncSolver: SimplexWorkerSolver = async (req) => {
      solverCalls += 1;
      await new Promise((r) => setTimeout(r, 15));
      return solveSimplexWorkerRequest(req);
    };
    const detach = attachSimplexWorkerHandler({
      scope: pair.hostScope,
      solver: asyncSolver,
    });
    const client = createSimplexWorkerClient(pair.clientPort);

    try {
      const items = makeDomainItems(10);
      const p1 = client.solve(items, { width: 600, height: 400 });
      const p2 = client.solve(items, { width: 700, height: 450 });
      const p3 = client.solve(items, { width: 820, height: 520 });

      const [r1, r2, r3] = await Promise.allSettled([p1, p2, p3]);

      expect(r1.status).toBe('rejected');
      expect(r2.status).toBe('rejected');
      expect(r3.status).toBe('fulfilled');

      if (r1.status === 'rejected') {
        expect(isSimplexWorkerCancelledError(r1.reason)).toBe(true);
        expect((r1.reason as SimplexWorkerClientError).code).toBe('SUPERSEDED');
      }
      if (r2.status === 'rejected') {
        expect(isSimplexWorkerCancelledError(r2.reason)).toBe(true);
        expect((r2.reason as SimplexWorkerClientError).code).toBe('SUPERSEDED');
      }
      if (r3.status === 'fulfilled') {
        expect(r3.value.generation).toBe(3);
        expect(r3.value.snapshot.width).toBe(820);
        expect(r3.value.snapshot.height).toBe(520);
      }

      const cancelMessages = pair.postedToWorker.filter(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          (m as { type?: string }).type === 'simplex-viz:cancel',
      );
      expect(cancelMessages.length).toBeGreaterThanOrEqual(2);
      expect(client.getGeneration()).toBe(3);
      expect(client.getPendingCount()).toBe(0);
      expect(solverCalls).toBeGreaterThanOrEqual(1);
    } finally {
      client.terminate();
      detach();
    }
  });

  it('supports concurrent solves (cancelPrevious: false) and isolated per-request AbortSignal cancellation', async () => {
    const pair = createStructuredCloneWorkerPair({ delayMs: 5 });
    const slowSolver: SimplexWorkerSolver = async (req) => {
      await new Promise((r) => setTimeout(r, 25));
      return solveSimplexWorkerRequest(req);
    };
    const detach = attachSimplexWorkerHandler({
      scope: pair.hostScope,
      solver: slowSolver,
    });
    const client = createSimplexWorkerClient(pair.clientPort, {
      cancelPreviousByDefault: false,
    });

    try {
      const items = makeDomainItems(8);
      const ac = new AbortController();

      const pAborted = client.solve(items, {
        width: 500,
        height: 400,
        signal: ac.signal,
      });
      const pKept = client.solve(items, {
        width: 760,
        height: 520,
      });

      expect(client.getPendingCount()).toBe(2);
      ac.abort();

      const [rAborted, rKept] = await Promise.allSettled([pAborted, pKept]);

      expect(rAborted.status).toBe('rejected');
      if (rAborted.status === 'rejected') {
        expect(isSimplexWorkerCancelledError(rAborted.reason)).toBe(true);
        expect((rAborted.reason as SimplexWorkerClientError).code).toBe('ABORTED');
      }

      expect(rKept.status).toBe('fulfilled');
      if (rKept.status === 'fulfilled') {
        expect(rKept.value.snapshot.width).toBe(760);
      }
      expect(client.getPendingCount()).toBe(0);
    } finally {
      client.terminate();
      detach();
    }
  });

  it('handles pre-aborted AbortSignal, cancelPending(), timeouts, terminate(), and custom solver errors', async () => {
    const pair = createStructuredCloneWorkerPair({ delayMs: 5 });
    let mode: 'hang' | 'throw' = 'hang';
    const customSolver: SimplexWorkerSolver = async (req: SimplexWorkerSolveRequest) => {
      if (mode === 'throw') {
        throw new Error(`WASM trap on gen ${req.generation}`);
      }
      await new Promise((r) => setTimeout(r, 120));
      return solveSimplexWorkerRequest(req);
    };

    const detach = attachSimplexWorkerHandler({
      scope: pair.hostScope,
      solver: customSolver,
    });
    const client = createSimplexWorkerClient(pair.clientPort);

    try {
      const items = makeDomainItems(6);

      // Pre-aborted signal
      const preAborted = new AbortController();
      preAborted.abort();
      await expect(
        client.solve(items, { signal: preAborted.signal }),
      ).rejects.toMatchObject({
        name: 'SimplexWorkerClientError',
        code: 'ABORTED',
      });

      // Timeout
      await expect(
        client.solve(items, { timeoutMs: 15 }),
      ).rejects.toMatchObject({
        name: 'SimplexWorkerClientError',
        code: 'TIMEOUT',
      });

      // cancelPending()
      const pendingPromise = client.solve(items);
      client.cancelPending('User changed route');
      await expect(pendingPromise).rejects.toMatchObject({
        name: 'SimplexWorkerClientError',
        code: 'ABORTED',
        message: 'User changed route',
      });

      // Pluggable solver error propagation (e.g. WASM failure)
      mode = 'throw';
      await expect(client.solve(items)).rejects.toMatchObject({
        name: 'SimplexWorkerClientError',
        code: 'WORKER_ERROR',
      });

      // Fatal worker ErrorEvent
      mode = 'hang';
      const errPromise = client.solve(items);
      pair.emitWorkerError('Uncaught worker crash');
      await expect(errPromise).rejects.toMatchObject({
        name: 'SimplexWorkerClientError',
        code: 'WORKER_ERROR',
        message: 'Uncaught worker crash',
      });

      // terminate() rejects in-flight and subsequent calls
      const inflight = client.solve(items);
      client.terminate();
      await expect(inflight).rejects.toMatchObject({
        code: 'TERMINATED',
      });
      await expect(client.solve(items)).rejects.toMatchObject({
        code: 'TERMINATED',
      });
    } finally {
      detach();
    }
  });

  it('supports Node.js worker_threads EventEmitter (on/off) ports', async () => {
    const pair = createStructuredCloneWorkerPair({ mode: 'eventEmitter' });
    const detach = attachSimplexWorkerHandler({ scope: pair.hostScope });
    const client = createSimplexWorkerClient(pair.clientPort);

    try {
      const items = makeDomainItems(10);
      const res = await client.solve(items, { width: 640, height: 480 });
      expect(res.usedWorker).toBe(true);
      expect(res.snapshot.items).toHaveLength(10);
      expect(res.snapshot.items[0]!.item).toBe(items[0]);
      expect(SIMPLEX_WORKER_PROTOCOL_VERSION).toBe(1);
    } finally {
      client.terminate();
      detach();
    }
  });

  it('gracefully falls back to async in-thread solving when no Worker is available (SSR) and via solveSimplexSnapshotAsync()', async () => {
    // Factory throwing (e.g. ReferenceError: Worker is not defined in SSR)
    const fallbackClient = createSimplexWorkerClient(
      () => {
        throw new Error('Worker is not defined');
      },
      { fallbackToInThread: true },
    );

    try {
      expect(fallbackClient.isUsingWorker()).toBe(false);
      const items = makeDomainItems(12);
      const res = await fallbackClient.solve(items, { width: 720, height: 480 });
      expect(res.usedWorker).toBe(false);
      expect(res.snapshot.items).toHaveLength(12);
      expect(res.snapshot.items[0]!.item).toBe(items[0]);
      expect(res.snapshot.metrics.overlapCount).toBe(0);

      // Standalone helper without client (async macrotask fallback)
      const directSnapshot = await solveSimplexSnapshotAsync(items, {
        width: 720,
        height: 480,
      });
      expect(directSnapshot.items).toHaveLength(12);
      expect(directSnapshot.items[0]!.item).toBe(items[0]);

      // Standalone helper delegating to an existing client
      const viaClient = await solveSimplexSnapshotAsync(items, {
        client: fallbackClient,
        width: 720,
        height: 480,
      });
      expect(viaClient.items).toHaveLength(12);
    } finally {
      fallbackClient.terminate();
    }

    // fallbackToInThread: false rethrows worker construction errors
    expect(() =>
      createSimplexWorkerClient(
        () => {
          throw new Error('Strict worker required');
        },
        { fallbackToInThread: false },
      ),
    ).toThrow('Strict worker required');
  });
});
