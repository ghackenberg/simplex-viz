import {
  CanvasRendererAdapter,
  type CanvasDefaultClusterVisual,
  type CanvasDefaultContentVisual,
} from '@simplex-viz/canvas';
import {
  getHullBoundingBox,
  isPointInTriangle,
  type MeshTriangleRenderState,
  type Point2D,
  type SceneFrameSnapshot,
  type SimplexLayoutSnapshot,
  type SnapshotClusterNode,
  type SnapshotContentNode,
} from '@simplex-viz/core';
import {
  createSimplexWorkerClient,
  isSimplexWorkerCancelledError,
  type SimplexWorkerClient,
} from '@simplex-viz/core/worker';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  buildStellarCatalog,
  deriveStellarClusterTitles,
  SPECTRAL_CLASS_COLORS,
  type StellarRecord,
} from '../../demo/data/stellarCatalog';
import {
  DatasetInfoButton,
  DatasetProvenanceModal,
  resolveDatasetProvenanceMeta,
} from './DatasetProvenanceModal';
import { CssFullscreenButton, useCssFullscreen } from './useCssFullscreen';

const CORPUS_PRESETS = [
  { count: 1000, label: '1,000', shortLabel: '1k', itemRadius: 3.1, itemGapPx: 1.0 },
  { count: 2000, label: '2,000', shortLabel: '2k', itemRadius: 2.4, itemGapPx: 0.85 },
  { count: 3500, label: '3,500', shortLabel: '3.5k', itemRadius: 2.0, itemGapPx: 0.65 },
] as const;

type CorpusCount = (typeof CORPUS_PRESETS)[number]['count'];

interface CameraState {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

type HoveredTarget =
  | {
      readonly kind: 'cluster';
      readonly node: SnapshotClusterNode<StellarRecord>;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: 'star';
      readonly node: SnapshotContentNode<StellarRecord>;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: 'triangle';
      readonly triangle: MeshTriangleRenderState<StellarRecord>;
      readonly x: number;
      readonly y: number;
    };

const IDENTITY_CAMERA: CameraState = { zoom: 1, panX: 0, panY: 0 };
const MIN_ZOOM = 0.82;
const MAX_ZOOM = 14;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function formatSolarValue(value: number, unit: string): string {
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k ${unit}`;
  if (value >= 100) return `${Math.round(value).toLocaleString('en-US')} ${unit}`;
  if (value >= 1) return `${value.toFixed(1)} ${unit}`;
  if (value >= 0.01) return `${value.toFixed(2)} ${unit}`;
  return `${value.toExponential(1)} ${unit}`;
}

function normalizeWheelDeltaY(ev: WheelEvent): number {
  let dy = ev.deltaY;
  if (ev.deltaMode === 1) dy *= 24;
  else if (ev.deltaMode === 2) dy *= 280;
  return clamp(dy, -140, 140);
}

/**
 * Keeps the simplex centered when zoomed out to <=1.0x and prevents panning
 * the entire stellar cloud off-screen when zoomed in.
 */
function constrainCamera(
  cam: CameraState,
  stageW: number,
  stageH: number,
): CameraState {
  const zoom = clamp(cam.zoom, MIN_ZOOM, MAX_ZOOM);
  const worldW = stageW * zoom;
  const worldH = stageH * zoom;

  if (zoom <= 1.005) {
    const centeredPanX = (stageW - worldW) * 0.5;
    const centeredPanY = (stageH - worldH) * 0.5;
    // As zoom approaches <= 1.0x, smoothly pull pan back toward centered Overview
    const slack = clamp((zoom - MIN_ZOOM) / Math.max(0.05, 1.005 - MIN_ZOOM), 0, 1);
    const maxShiftX = stageW * 0.14 * slack;
    const maxShiftY = stageH * 0.14 * slack;
    return {
      zoom,
      panX: clamp(cam.panX, centeredPanX - maxShiftX, centeredPanX + maxShiftX),
      panY: clamp(cam.panY, centeredPanY - maxShiftY, centeredPanY + maxShiftY),
    };
  }

  const marginX = Math.max(72, stageW * 0.22);
  const marginY = Math.max(64, stageH * 0.22);
  const minPanX = stageW - worldW - marginX;
  const maxPanX = marginX;
  const minPanY = stageH - worldH - marginY;
  const maxPanY = marginY;

  return {
    zoom,
    panX: clamp(cam.panX, minPanX, maxPanX),
    panY: clamp(cam.panY, minPanY, maxPanY),
  };
}

function fitBoundsToCamera(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  stageW: number,
  stageH: number,
  minFitZoom: number,
  maxFitZoom: number,
  paddingPx = 56,
): CameraState {
  const bw = Math.max(48, bounds.maxX - bounds.minX);
  const bh = Math.max(48, bounds.maxY - bounds.minY);
  const availW = Math.max(120, stageW - paddingPx * 2);
  const availH = Math.max(120, stageH - paddingPx * 2);
  const zoom = clamp(Math.min(availW / bw, availH / bh), minFitZoom, maxFitZoom);
  const cx = (bounds.minX + bounds.maxX) * 0.5;
  const cy = (bounds.minY + bounds.maxY) * 0.5;
  return constrainCamera(
    {
      zoom,
      panX: stageW * 0.5 - cx * zoom,
      panY: stageH * 0.5 - cy * zoom,
    },
    stageW,
    stageH,
  );
}

export interface LargeScaleCanvasWorkerAtlasProps {
  readonly embedded?: boolean;
}

export function LargeScaleCanvasWorkerAtlas({
  embedded = false,
}: LargeScaleCanvasWorkerAtlasProps) {
  const [corpusCount, setCorpusCount] = useState<CorpusCount>(2000);
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : true,
  );
  const [isDatasetModalOpen, setIsDatasetModalOpen] = useState(false);
  const [isSolving, setIsSolving] = useState(true);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SimplexLayoutSnapshot<StellarRecord> | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedClusterUid, setFocusedClusterUid] = useState<string | null>(null);
  const [focusedTriangleIdx, setFocusedTriangleIdx] = useState<number | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<HoveredTarget | null>(null);
  const [hoveredListStarId, setHoveredListStarId] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraState>(IDENTITY_CAMERA);
  const [isPanning, setIsPanning] = useState(false);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: 860,
    height: 560,
  });

  const { isFullscreen, toggleFullscreen } = useCssFullscreen({
    disableEscape: Boolean(
      selectedId || focusedClusterUid || focusedTriangleIdx !== null || isDatasetModalOpen,
    ),
  });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const adapterRef = useRef<CanvasRendererAdapter<
    CanvasDefaultContentVisual,
    CanvasDefaultClusterVisual,
    StellarRecord
  > | null>(null);
  const workerClientRef = useRef<SimplexWorkerClient | null>(null);
  const badgeExtentsRef = useRef<Map<string, { halfW: number; halfH: number }>>(
    new Map(),
  );

  // Camera refs for smooth 60 FPS damping + tweening without stale closures
  const cameraRef = useRef<CameraState>(IDENTITY_CAMERA);
  const targetCameraRef = useRef<CameraState>(IDENTITY_CAMERA);
  const stageSizeRef = useRef(stageSize);
  stageSizeRef.current = stageSize;

  const animRef = useRef<{
    mode: 'idle' | 'damp' | 'tween';
    rafId: number | null;
    tweenStart: number;
    tweenDuration: number;
    tweenFrom: CameraState;
  }>({
    mode: 'idle',
    rafId: null,
    tweenStart: 0,
    tweenDuration: 320,
    tweenFrom: IDENTITY_CAMERA,
  });

  const gestureRef = useRef<{
    activePointerId: number | null;
    dragging: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    touches: Map<number, Point2D>;
    lastPinchDist: number;
  }>({
    activePointerId: null,
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    touches: new Map(),
    lastPinchDist: 0,
  });

  const cancelCameraAnimation = useCallback(() => {
    if (animRef.current.rafId !== null) {
      window.cancelAnimationFrame(animRef.current.rafId);
      animRef.current.rafId = null;
    }
    animRef.current.mode = 'idle';
  }, []);

  const prefersReducedMotion = useCallback(() => {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }, []);

  const commitCameraImmediate = useCallback(
    (next: CameraState) => {
      cancelCameraAnimation();
      const clamped = constrainCamera(
        next,
        stageSizeRef.current.width,
        stageSizeRef.current.height,
      );
      cameraRef.current = clamped;
      targetCameraRef.current = clamped;
      setCamera(clamped);
    },
    [cancelCameraAnimation],
  );

  const runCameraStep = useCallback(() => {
    const step = (now: number) => {
      const anim = animRef.current;
      const cur = cameraRef.current;
      const tgt = targetCameraRef.current;

      if (anim.mode === 'tween') {
        const rawT = clamp((now - anim.tweenStart) / Math.max(1, anim.tweenDuration), 0, 1);
        const eased = easeOutCubic(rawT);
        const next: CameraState = {
          zoom: anim.tweenFrom.zoom + (tgt.zoom - anim.tweenFrom.zoom) * eased,
          panX: anim.tweenFrom.panX + (tgt.panX - anim.tweenFrom.panX) * eased,
          panY: anim.tweenFrom.panY + (tgt.panY - anim.tweenFrom.panY) * eased,
        };
        cameraRef.current = next;
        setCamera(next);
        if (rawT < 1) {
          anim.rafId = window.requestAnimationFrame(step);
        } else {
          cameraRef.current = tgt;
          setCamera(tgt);
          anim.mode = 'idle';
          anim.rafId = null;
        }
        return;
      }

      if (anim.mode === 'damp') {
        const dz = Math.abs(tgt.zoom - cur.zoom);
        const dx = Math.abs(tgt.panX - cur.panX);
        const dy = Math.abs(tgt.panY - cur.panY);
        if (dz < 0.002 && dx < 0.25 && dy < 0.25) {
          cameraRef.current = tgt;
          setCamera(tgt);
          anim.mode = 'idle';
          anim.rafId = null;
          return;
        }
        const blend = 0.34;
        const next: CameraState = {
          zoom: cur.zoom + (tgt.zoom - cur.zoom) * blend,
          panX: cur.panX + (tgt.panX - cur.panX) * blend,
          panY: cur.panY + (tgt.panY - cur.panY) * blend,
        };
        cameraRef.current = next;
        setCamera(next);
        anim.rafId = window.requestAnimationFrame(step);
        return;
      }

      anim.rafId = null;
    };

    if (animRef.current.rafId === null) {
      animRef.current.rafId = window.requestAnimationFrame(step);
    }
  }, []);

  const animateCameraTo = useCallback(
    (next: CameraState, durationMs = 300) => {
      const clamped = constrainCamera(
        next,
        stageSizeRef.current.width,
        stageSizeRef.current.height,
      );
      if (prefersReducedMotion() || durationMs <= 0) {
        commitCameraImmediate(clamped);
        return;
      }
      targetCameraRef.current = clamped;
      animRef.current.mode = 'tween';
      animRef.current.tweenFrom = cameraRef.current;
      animRef.current.tweenStart = performance.now();
      animRef.current.tweenDuration = durationMs;
      runCameraStep();
    },
    [commitCameraImmediate, prefersReducedMotion, runCameraStep],
  );

  const dampZoomToScreenPoint = useCallback(
    (sx: number, sy: number, factor: number) => {
      const base = targetCameraRef.current;
      const nextZoom = clamp(base.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(nextZoom - base.zoom) < 1e-4) return;
      const wx = (sx - base.panX) / base.zoom;
      const wy = (sy - base.panY) / base.zoom;
      const next = constrainCamera(
        {
          zoom: nextZoom,
          panX: sx - wx * nextZoom,
          panY: sy - wy * nextZoom,
        },
        stageSizeRef.current.width,
        stageSizeRef.current.height,
      );
      if (prefersReducedMotion()) {
        commitCameraImmediate(next);
        return;
      }
      targetCameraRef.current = next;
      animRef.current.mode = 'damp';
      runCameraStep();
    },
    [commitCameraImmediate, prefersReducedMotion, runCameraStep],
  );

  useEffect(() => () => cancelCameraAnimation(), [cancelCameraAnimation]);

  // Sync light/dark theme with <html class="dark">
  useEffect(() => {
    const sync = () => setIsDark(document.documentElement.classList.contains('dark'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => obs.disconnect();
  }, []);

  // Measure stage dimensions with ResizeObserver (debounced to avoid excessive re-solves)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const applySize = (w: number, h: number) => {
      const nextW = Math.max(300, Math.round(w));
      const nextH = Math.max(360, Math.round(h));
      setStageSize((prev) =>
        Math.abs(prev.width - nextW) <= 4 && Math.abs(prev.height - nextH) <= 4
          ? prev
          : { width: nextW, height: nextH },
      );
    };

    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      applySize(rect.width, rect.height);
    }

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => applySize(width, height), 150);
    });
    ro.observe(el);

    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, [isFullscreen]);

  // Mount persistent dedicated Web Worker client
  useEffect(() => {
    const client = createSimplexWorkerClient(
      () =>
        new Worker(new URL('../../demo/simplexDemo.worker.ts', import.meta.url), {
          type: 'module',
        }),
      {
        cancelPreviousByDefault: true,
        fallbackToInThread: true,
      },
    );
    workerClientRef.current = client;
    return () => {
      client.terminate();
      workerClientRef.current = null;
    };
  }, []);

  const preset = useMemo(
    () => CORPUS_PRESETS.find((p) => p.count === corpusCount) ?? CORPUS_PRESETS[1],
    [corpusCount],
  );

  const catalog = useMemo(() => buildStellarCatalog(corpusCount), [corpusCount]);
  const theme = isDark ? 'dark' : 'light';

  // Off-main-thread layout solve whenever corpus size, theme, or stage geometry changes
  useEffect(() => {
    const client = workerClientRef.current;
    if (!client) return;

    let active = true;
    setIsSolving(true);
    setSolveError(null);

    client
      .solve(catalog, {
        getId: (star) => star.id,
        // Clone standalone Float32Array per solve so zero-copy ArrayBuffer transfer leaves catalog intact
        getEmbedding: (star) => new Float32Array(star.embedding),
        transferEmbeddings: true,
        width: stageSize.width,
        height: stageSize.height,
        itemRadius: preset.itemRadius,
        clusterRadius: 28,
        theme,
        meshStrategy: { kind: 'adaptive-hex' },
        clusteringStrategy: {
          kind: 'soft-simplex-embedding',
          metric: 'cosine',
          clusterCount: 12,
          triangleSpread: 0.82,
          balanceLoad: true,
        },
        colorStrategy: { kind: 'theme-adaptive-oklab' },
        layoutStrategy: { kind: 'pbd-uniform' },
        layoutOptions: {
          itemGapPx: preset.itemGapPx,
          relaxationIterations: 12,
          minContentScale: 0.25,
          seed: 42,
        },
      })
      .then((res) => {
        if (!active) return;
        setSnapshot(res.snapshot);
        setIsSolving(false);
        setFocusedClusterUid((prev) =>
          prev && res.snapshot.clusters.some((c) => c.cluster.clusterUid === prev)
            ? prev
            : null,
        );
        setFocusedTriangleIdx(null);
        setSelectedId((prev) =>
          prev && res.snapshot.items.some((it) => it.id === prev) ? prev : null,
        );
      })
      .catch((err: unknown) => {
        if (!active || isSimplexWorkerCancelledError(err)) return;
        setIsSolving(false);
        setSolveError(
          err instanceof Error ? err.message : 'Unable to solve stellar snapshot.',
        );
      });

    return () => {
      active = false;
    };
  }, [catalog, preset.itemGapPx, preset.itemRadius, stageSize.height, stageSize.width, theme]);

  // Reset camera cleanly when user switches corpus count
  const prevCorpusRef = useRef<CorpusCount>(corpusCount);
  useEffect(() => {
    if (prevCorpusRef.current !== corpusCount) {
      prevCorpusRef.current = corpusCount;
      setFocusedClusterUid(null);
      setFocusedTriangleIdx(null);
      commitCameraImmediate(IDENTITY_CAMERA);
    }
  }, [commitCameraImmediate, corpusCount]);

  // Precompute disambiguated astrophysical cluster titles for the solved snapshot
  const clusterTitles = useMemo(() => {
    if (!snapshot) return new Map<string, string>();
    return deriveStellarClusterTitles(
      snapshot.clusters.map((c) => ({
        id: c.id,
        members: c.cluster.members,
      })),
    );
  }, [snapshot]);

  // Mount & manage persistent CanvasRendererAdapter
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const adapter = new CanvasRendererAdapter<
      CanvasDefaultContentVisual,
      CanvasDefaultClusterVisual,
      StellarRecord
    >({
      canvas,
      theme,
      backgroundColor: isDark ? '#0B0F17' : '#F8FAFC',
      maxDevicePixelRatio: 2,
      lodThresholdPx: 3.5,
      cullMarginPx: 44,
      shapeOptions: {
        hoverScale: 1.45,
        dimmedOpacity: 0.26,
        strokeWidth: 0.9,
      },
    });
    adapterRef.current = adapter;
    return () => {
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [isDark, theme]);

  const selectedNode = useMemo(() => {
    if (!snapshot || !selectedId) return null;
    return snapshot.items.find((it) => it.id === selectedId) ?? null;
  }, [selectedId, snapshot]);

  const focusedClusterNode = useMemo(() => {
    if (!snapshot || !focusedClusterUid) return null;
    return snapshot.clusters.find((c) => c.cluster.clusterUid === focusedClusterUid) ?? null;
  }, [focusedClusterUid, snapshot]);

  const focusedTriangle = useMemo(() => {
    if (!snapshot || focusedTriangleIdx === null) return null;
    return snapshot.triangles.find((t) => t.index === focusedTriangleIdx) ?? null;
  }, [focusedTriangleIdx, snapshot]);

  // Fast lookup for item positions & cluster membership stats
  const starNodeById = useMemo(() => {
    const map = new Map<string, SnapshotContentNode<StellarRecord>>();
    if (!snapshot) return map;
    for (const item of snapshot.items) {
      map.set(item.id, item);
    }
    return map;
  }, [snapshot]);

  // Determine active highlight sets without strobing or ringing neighboring stars on hover
  const highlightContext = useMemo(() => {
    const hoveredCluster =
      hoveredTarget?.kind === 'cluster' ? hoveredTarget.node : null;
    const hoveredStar =
      hoveredTarget?.kind === 'star'
        ? hoveredTarget.node
        : hoveredListStarId
          ? (starNodeById.get(hoveredListStarId) ?? null)
          : null;
    const hoveredTri =
      hoveredTarget?.kind === 'triangle' ? hoveredTarget.triangle : null;

    // 1. Cluster hover/focus drives soft constellation dimming around that cluster
    const activeCluster = hoveredCluster ?? focusedClusterNode;
    if (activeCluster && (!selectedNode || hoveredCluster)) {
      return {
        clusterUids: new Set([activeCluster.cluster.clusterUid]),
        focusStarClusterUid: activeCluster.cluster.clusterUid,
        triangleIdx: null as number | null,
        hoveredTriangleIdx: null as number | null,
        dimNonMatching: true,
        highlightEdgesAndClusters: true,
      };
    }

    // 2. Selected star highlights its incident clusters/edges and dims unrelated context
    if (selectedNode) {
      const uids = new Set(
        selectedNode.layoutContext.unitClusters.map((u) => u.cluster.clusterUid),
      );
      return {
        clusterUids: uids,
        focusStarClusterUid: null as string | null,
        triangleIdx: null as number | null,
        hoveredTriangleIdx: null as number | null,
        dimNonMatching: true,
        highlightEdgesAndClusters: true,
      };
    }

    // 3. Focused (clicked) cluster
    if (focusedClusterNode) {
      return {
        clusterUids: new Set([focusedClusterNode.cluster.clusterUid]),
        focusStarClusterUid: focusedClusterNode.cluster.clusterUid,
        triangleIdx: null as number | null,
        hoveredTriangleIdx: null as number | null,
        dimNonMatching: true,
        highlightEdgesAndClusters: true,
      };
    }

    // 4. Focused (clicked) simplex triangle
    if (focusedTriangle) {
      const uids = new Set<string>();
      for (const c of focusedTriangle.clusters) {
        if (c) uids.add(c.clusterUid);
      }
      return {
        clusterUids: uids,
        focusStarClusterUid: null as string | null,
        triangleIdx: focusedTriangle.index,
        hoveredTriangleIdx: null as number | null,
        dimNonMatching: true,
        highlightEdgesAndClusters: true,
      };
    }

    // 5. Hovered star in idle overview: only highlight its 1-3 connected cluster pills/edges, NO dimming
    if (hoveredStar) {
      const uids = new Set(
        hoveredStar.layoutContext.unitClusters.map((u) => u.cluster.clusterUid),
      );
      return {
        clusterUids: uids,
        focusStarClusterUid: null as string | null,
        triangleIdx: null as number | null,
        hoveredTriangleIdx: null as number | null,
        dimNonMatching: false,
        highlightEdgesAndClusters: true,
      };
    }

    // 6. Hovered empty simplex triangle: gentle single-face highlight only, NO dimming
    if (hoveredTri) {
      return {
        clusterUids: null as Set<string> | null,
        focusStarClusterUid: null as string | null,
        triangleIdx: null as number | null,
        hoveredTriangleIdx: hoveredTri.index,
        dimNonMatching: false,
        highlightEdgesAndClusters: false,
      };
    }

    return {
      clusterUids: null as Set<string> | null,
      focusStarClusterUid: null as string | null,
      triangleIdx: null as number | null,
      hoveredTriangleIdx: null as number | null,
      dimNonMatching: false,
      highlightEdgesAndClusters: false,
    };
  }, [
    focusedClusterNode,
    focusedTriangle,
    hoveredListStarId,
    hoveredTarget,
    selectedNode,
    starNodeById,
  ]);

  // Pre-build base visual descriptors & measure exact Canvas cluster badge pill bounds
  const baseFrameNodes = useMemo(() => {
    if (!snapshot) return null;

    const nextExtents = new Map<string, { halfW: number; halfH: number }>();
    const adapter = adapterRef.current;

    const clusters = snapshot.clusters.map((c) => {
      const title = clusterTitles.get(c.id) ?? c.cluster.defaultLabel;
      const visual: CanvasDefaultClusterVisual = {
        kind: 'badge',
        code: c.cluster.code,
        showCode: false,
        title,
        colorHex: c.cluster.colorHex,
        memberCount: c.cluster.members.length,
        variant: c.cluster.role === 'intermediate' ? 'intermediate' : 'primary',
        parentContextLabel: c.cluster.parentContextLabel,
        theme,
      };

      let halfW = Math.max(36, Math.ceil(title.length * 3.6 + 14));
      let halfH = 14;
      if (adapter) {
        const hull = adapter.measureClusterHull(visual, `${c.id}-${title}-${theme}`);
        const bb = getHullBoundingBox(hull, 0, 0, 1);
        halfW = Math.max(halfW, (bb.maxX - bb.minX) * 0.5);
        halfH = Math.max(halfH, (bb.maxY - bb.minY) * 0.5);
      }
      nextExtents.set(c.id, { halfW, halfH });

      const memberIds = new Set(c.cluster.members.map((m) => m.itemId));
      return { raw: c, visual, title, memberIds };
    });

    badgeExtentsRef.current = nextExtents;

    const items = snapshot.items.map((it) => {
      const rank = it.layoutContext.unitClusters.length;
      const shape = rank >= 3 ? 'star' : rank === 2 ? 'diamond' : 'circle';
      const radius = it.hull.kind === 'circle' ? it.hull.radius : 3;
      const visual: CanvasDefaultContentVisual = {
        kind: 'geometric',
        shape,
        radius,
        colorHex: it.layoutContext.mixedColorHex,
        label: it.item.name,
        theme,
      };
      return { raw: it, visual };
    });

    return { clusters, items };
  }, [clusterTitles, snapshot, theme]);

  // Paint frame onto HiDPI Canvas 2D at 60 FPS
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !snapshot || !baseFrameNodes) return;

    const rafId = window.requestAnimationFrame(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      adapter.resize(stageSize.width, stageSize.height, dpr);

      const hoveredClusterId =
        hoveredTarget?.kind === 'cluster' ? hoveredTarget.node.id : null;
      const hoveredStarId =
        hoveredTarget?.kind === 'star'
          ? hoveredTarget.node.id
          : hoveredListStarId;

      const focusClusterMembers =
        highlightContext.focusStarClusterUid
          ? baseFrameNodes.clusters.find(
              (c) => c.raw.cluster.clusterUid === highlightContext.focusStarClusterUid,
            )?.memberIds ?? null
          : null;

      const focusTriangleCornerUids =
        highlightContext.triangleIdx !== null
          ? highlightContext.clusterUids
          : null;

      const triangles = snapshot.triangles.map((tri) => {
        if (highlightContext.hoveredTriangleIdx === tri.index) {
          return {
            ...tri,
            interaction: {
              ...tri.interaction,
              isHovered: true,
              isHighlighted: true,
              isDimmed: false,
            },
          };
        }
        if (!highlightContext.dimNonMatching) return tri;
        if (highlightContext.triangleIdx !== null) {
          const isMatch = tri.index === highlightContext.triangleIdx;
          return {
            ...tri,
            interaction: {
              ...tri.interaction,
              isFocused: isMatch,
              isHighlighted: isMatch,
              isDimmed: !isMatch,
            },
          };
        }
        const touchesCluster = Boolean(
          highlightContext.clusterUids &&
            tri.clusters.some((c) => c && highlightContext.clusterUids!.has(c.clusterUid)),
        );
        return {
          ...tri,
          interaction: {
            ...tri.interaction,
            isHighlighted: touchesCluster,
            isDimmed: !touchesCluster,
          },
        };
      });

      const edges = snapshot.edges.map((edge) => {
        if (!highlightContext.highlightEdgesAndClusters) return edge;
        const touchesCluster = Boolean(
          highlightContext.clusterUids &&
            edge.clusters.some((c) => c && highlightContext.clusterUids!.has(c.clusterUid)),
        );
        return {
          ...edge,
          isHighlighted: touchesCluster,
          isDimmed: highlightContext.dimNonMatching ? !touchesCluster : false,
        };
      });

      const frame: SceneFrameSnapshot<
        CanvasDefaultContentVisual,
        CanvasDefaultClusterVisual,
        StellarRecord
      > = {
        viewportWidth: stageSize.width,
        viewportHeight: stageSize.height,
        camera,
        triangles,
        edges,
        clusters: baseFrameNodes.clusters.map(({ raw: c, visual }) => {
          const isHovered = c.id === hoveredClusterId;
          const isFocused = c.cluster.clusterUid === focusedClusterUid;
          const isLinked = Boolean(
            highlightContext.clusterUids?.has(c.cluster.clusterUid),
          );
          return {
            id: c.id,
            x: c.x,
            y: c.y,
            scale: c.scale,
            opacity: 1,
            visual,
            hull: c.hull,
            cacheKey: c.id,
            interaction: {
              isHovered,
              isPinned: isFocused,
              isDimmed: Boolean(
                highlightContext.dimNonMatching && !isLinked && !isHovered,
              ),
              isHighlighted: isFocused || isLinked,
            },
            transition: null,
          };
        }),
        items: baseFrameNodes.items.map(({ raw: it, visual }) => {
          const isSelected = it.id === selectedId;
          const isHovered = it.id === hoveredStarId;
          let isDimmed = false;

          if (highlightContext.dimNonMatching) {
            if (focusClusterMembers) {
              isDimmed = !focusClusterMembers.has(it.id) && !isSelected && !isHovered;
            } else if (focusTriangleCornerUids) {
              const belongs = it.layoutContext.unitClusters.some((u) =>
                focusTriangleCornerUids.has(u.cluster.clusterUid),
              );
              isDimmed = !belongs && !isSelected && !isHovered;
            } else if (selectedId) {
              isDimmed = !isSelected && !isHovered;
            }
          }

          return {
            id: it.id,
            x: it.x,
            y: it.y,
            scale: isSelected ? it.scale * 1.28 : it.scale,
            opacity: 1,
            visual,
            hull: it.hull,
            cacheKey: it.id,
            interaction: {
              // Strictly 1 hovered star gets the crisp hover halo; never frame groups in white
              isHovered,
              isPinned: false,
              isDimmed,
              isHighlighted: false,
              isSelected,
            },
            transition: null,
          };
        }),
        showHulls: false,
      };

      adapter.renderFrame(frame);
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [
    baseFrameNodes,
    camera,
    focusedClusterUid,
    highlightContext,
    hoveredListStarId,
    hoveredTarget,
    selectedId,
    snapshot,
    stageSize.height,
    stageSize.width,
  ]);

  // Accurate layered hit-testing: Cluster Pills (top) -> Stars -> Triangles
  const hitTestWorld = useCallback(
    (
      clientX: number,
      clientY: number,
    ): {
      readonly target: HoveredTarget | null;
      readonly localX: number;
      readonly localY: number;
      readonly worldX: number;
      readonly worldY: number;
    } => {
      const canvas = canvasRef.current;
      if (!canvas || !snapshot) {
        return { target: null, localX: 0, localY: 0, worldX: 0, worldY: 0 };
      }
      const rect = canvas.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const cam = cameraRef.current;
      const wx = (localX - cam.panX) / cam.zoom;
      const wy = (localY - cam.panY) / cam.zoom;

      // 1. Cluster pill badges (drawn on top of stars, tested first with exact pill bounds)
      const padWorld = 5 / cam.zoom;
      for (let i = snapshot.clusters.length - 1; i >= 0; i--) {
        const c = snapshot.clusters[i]!;
        const ext = badgeExtentsRef.current.get(c.id) ?? { halfW: 54, halfH: 14 };
        const hw = ext.halfW * c.scale + padWorld;
        const hh = ext.halfH * c.scale + padWorld;
        if (Math.abs(wx - c.x) <= hw && Math.abs(wy - c.y) <= hh) {
          return {
            target: { kind: 'cluster', node: c, x: localX, y: localY },
            localX,
            localY,
            worldX: wx,
            worldY: wy,
          };
        }
      }

      // 2. Stars (content items) — proportional pick radius so sweeping over space feels clean
      const pickScreenPx = cam.zoom >= 1.8 ? 8.5 : 6;
      const pickRadiusWorld = Math.max(preset.itemRadius * 1.4, pickScreenPx / cam.zoom);
      const pickR2 = pickRadiusWorld * pickRadiusWorld;
      let bestStar: SnapshotContentNode<StellarRecord> | null = null;
      let bestScore = Infinity;

      for (let i = 0; i < snapshot.items.length; i++) {
        const node = snapshot.items[i]!;
        const dx = node.x - wx;
        const dy = node.y - wy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= pickR2) {
          // Slight tie-break boost for stars inside currently focused cluster
          const inFocused =
            focusedClusterUid &&
            node.layoutContext.unitClusters.some(
              (u) => u.cluster.clusterUid === focusedClusterUid,
            );
          const score = inFocused ? d2 * 0.72 : d2;
          if (score < bestScore) {
            bestScore = score;
            bestStar = node;
          }
        }
      }

      if (bestStar) {
        return {
          target: { kind: 'star', node: bestStar, x: localX, y: localY },
          localX,
          localY,
          worldX: wx,
          worldY: wy,
        };
      }

      // 3. Mesh triangles (allows clicking a triangle between 3 clusters to frame hybrids)
      for (let i = 0; i < snapshot.triangles.length; i++) {
        const tri = snapshot.triangles[i]!;
        if (isPointInTriangle(wx, wy, tri.points[0], tri.points[1], tri.points[2])) {
          return {
            target: { kind: 'triangle', triangle: tri, x: localX, y: localY },
            localX,
            localY,
            worldX: wx,
            worldY: wy,
          };
        }
      }

      return { target: null, localX, localY, worldX: wx, worldY: wy };
    },
    [focusedClusterUid, preset.itemRadius, snapshot],
  );

  // Smoothly frame a cluster badge + its 85th-percentile core stellar cloud
  const focusCluster = useCallback(
    (clusterNode: SnapshotClusterNode<StellarRecord>) => {
      if (!snapshot) return;
      const uid = clusterNode.cluster.clusterUid;
      if (focusedClusterUid === uid && !selectedId) {
        setFocusedClusterUid(null);
        setFocusedTriangleIdx(null);
        animateCameraTo(IDENTITY_CAMERA, 320);
        return;
      }

      setFocusedClusterUid(uid);
      setFocusedTriangleIdx(null);
      setSelectedId(null);

      // Gather core & nearby member coordinates so distant single outliers don't over-zoom-out
      const memberCoords: Array<{ x: number; y: number; dist: number; w: number }> = [];
      for (const m of clusterNode.cluster.members) {
        const starNode = starNodeById.get(m.itemId);
        if (!starNode) continue;
        const w = m.normalizedWeight ?? 0.5;
        if (w < 0.28) continue;
        const d = Math.hypot(starNode.x - clusterNode.x, starNode.y - clusterNode.y);
        memberCoords.push({ x: starNode.x, y: starNode.y, dist: d, w });
      }
      memberCoords.sort((a, b) => a.dist - b.dist);
      const keepCount = Math.max(1, Math.ceil(memberCoords.length * 0.86));
      const ext = badgeExtentsRef.current.get(clusterNode.id) ?? { halfW: 60, halfH: 16 };

      let minX = clusterNode.x - ext.halfW;
      let maxX = clusterNode.x + ext.halfW;
      let minY = clusterNode.y - ext.halfH;
      let maxY = clusterNode.y + ext.halfH;

      for (let i = 0; i < keepCount && i < memberCoords.length; i++) {
        const pt = memberCoords[i]!;
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }

      const fitted = fitBoundsToCamera(
        { minX, minY, maxX, maxY },
        stageSizeRef.current.width,
        stageSizeRef.current.height,
        1.85,
        4.4,
        52,
      );
      animateCameraTo(fitted, 340);
    },
    [animateCameraTo, focusedClusterUid, selectedId, snapshot, starNodeById],
  );

  // Smoothly frame a barycentric simplex triangle
  const focusTriangle = useCallback(
    (tri: MeshTriangleRenderState<StellarRecord>) => {
      if (focusedTriangleIdx === tri.index && !selectedId) {
        setFocusedTriangleIdx(null);
        setFocusedClusterUid(null);
        animateCameraTo(IDENTITY_CAMERA, 300);
        return;
      }
      setFocusedTriangleIdx(tri.index);
      setFocusedClusterUid(null);
      setSelectedId(null);

      const [p0, p1, p2] = tri.points;
      const fitted = fitBoundsToCamera(
        {
          minX: Math.min(p0.x, p1.x, p2.x),
          minY: Math.min(p0.y, p1.y, p2.y),
          maxX: Math.max(p0.x, p1.x, p2.x),
          maxY: Math.max(p0.y, p1.y, p2.y),
        },
        stageSizeRef.current.width,
        stageSizeRef.current.height,
        1.75,
        4.2,
        56,
      );
      animateCameraTo(fitted, 320);
    },
    [animateCameraTo, focusedTriangleIdx, selectedId],
  );

  const focusStarFromList = useCallback(
    (starNode: SnapshotContentNode<StellarRecord>) => {
      setSelectedId(starNode.id);
      const curZoom = cameraRef.current.zoom;
      const targetZoom = clamp(Math.max(curZoom, 3.2), 2.4, 6.5);
      animateCameraTo(
        {
          zoom: targetZoom,
          panX: stageSizeRef.current.width * 0.5 - starNode.x * targetZoom,
          panY: stageSizeRef.current.height * 0.5 - starNode.y * targetZoom,
        },
        280,
      );
    },
    [animateCameraTo],
  );

  const handleResetView = useCallback(() => {
    setSelectedId(null);
    setFocusedClusterUid(null);
    setFocusedTriangleIdx(null);
    animateCameraTo(IDENTITY_CAMERA, 300);
  }, [animateCameraTo]);

  const handleStepZoom = useCallback(
    (multiplier: number) => {
      const target = targetCameraRef.current;
      const cx = stageSizeRef.current.width * 0.5;
      const cy = stageSizeRef.current.height * 0.5;
      const nextZoom = clamp(target.zoom * multiplier, MIN_ZOOM, MAX_ZOOM);
      if (nextZoom <= 1.02 && multiplier < 1) {
        animateCameraTo(IDENTITY_CAMERA, 240);
        return;
      }
      const wx = (cx - target.panX) / target.zoom;
      const wy = (cy - target.panY) / target.zoom;
      animateCameraTo(
        {
          zoom: nextZoom,
          panX: cx - wx * nextZoom,
          panY: cy - wy * nextZoom,
        },
        220,
      );
    },
    [animateCameraTo],
  );

  // Non-passive wheel listener with deltaMode normalization & smooth damped zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;
      const dy = normalizeWheelDeltaY(ev);
      if (Math.abs(dy) < 0.01) return;
      const factor = Math.exp(-dy * 0.0022);
      dampZoomToScreenPoint(sx, sy, factor);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [dampZoomToScreenPoint]);

  // Esc clears star -> cluster/triangle focus (fullscreen handled cleanly via useCssFullscreen)
  useEffect(() => {
    if (isDatasetModalOpen) return;
    if (!selectedId && !focusedClusterUid && focusedTriangleIdx === null) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (selectedId) {
        setSelectedId(null);
      } else {
        setFocusedClusterUid(null);
        setFocusedTriangleIdx(null);
        animateCameraTo(IDENTITY_CAMERA, 260);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [animateCameraTo, focusedClusterUid, focusedTriangleIdx, isDatasetModalOpen, selectedId]);

  const handlePointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const lx = ev.clientX - rect.left;
    const ly = ev.clientY - rect.top;

    if (ev.pointerType === 'touch') {
      gestureRef.current.touches.set(ev.pointerId, { x: lx, y: ly });
      if (gestureRef.current.touches.size === 2) {
        const pts = Array.from(gestureRef.current.touches.values());
        gestureRef.current.lastPinchDist = Math.hypot(
          pts[1]!.x - pts[0]!.x,
          pts[1]!.y - pts[0]!.y,
        );
        gestureRef.current.dragging = false;
        setIsPanning(false);
        return;
      }
    }

    cancelCameraAnimation();
    try {
      ev.currentTarget.setPointerCapture(ev.pointerId);
    } catch {
      // Ignore synthetic events
    }
    gestureRef.current.activePointerId = ev.pointerId;
    gestureRef.current.dragging = true;
    gestureRef.current.moved = false;
    gestureRef.current.startX = lx;
    gestureRef.current.startY = ly;
    gestureRef.current.lastX = lx;
    gestureRef.current.lastY = ly;
  };

  const handlePointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const lx = ev.clientX - rect.left;
    const ly = ev.clientY - rect.top;

    if (ev.pointerType === 'touch' && gestureRef.current.touches.has(ev.pointerId)) {
      gestureRef.current.touches.set(ev.pointerId, { x: lx, y: ly });
      if (gestureRef.current.touches.size === 2) {
        const pts = Array.from(gestureRef.current.touches.values());
        const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
        const midX = (pts[0]!.x + pts[1]!.x) * 0.5;
        const midY = (pts[0]!.y + pts[1]!.y) * 0.5;
        if (gestureRef.current.lastPinchDist > 6 && dist > 6) {
          dampZoomToScreenPoint(midX, midY, dist / gestureRef.current.lastPinchDist);
        }
        gestureRef.current.lastPinchDist = dist;
        return;
      }
    }

    if (gestureRef.current.dragging && ev.pointerId === gestureRef.current.activePointerId) {
      const totalDist = Math.hypot(
        lx - gestureRef.current.startX,
        ly - gestureRef.current.startY,
      );
      if (totalDist > 4) {
        gestureRef.current.moved = true;
        setIsPanning(true);
        setHoveredTarget(null);
      }
      if (gestureRef.current.moved) {
        const dx = lx - gestureRef.current.lastX;
        const dy = ly - gestureRef.current.lastY;
        const next = constrainCamera(
          {
            zoom: cameraRef.current.zoom,
            panX: cameraRef.current.panX + dx,
            panY: cameraRef.current.panY + dy,
          },
          stageSizeRef.current.width,
          stageSizeRef.current.height,
        );
        cameraRef.current = next;
        targetCameraRef.current = next;
        setCamera(next);
      }
      gestureRef.current.lastX = lx;
      gestureRef.current.lastY = ly;
      return;
    }

    if (ev.pointerType === 'touch') return;
    const hit = hitTestWorld(ev.clientX, ev.clientY);
    setHoveredTarget(hit.target);
  };

  const handlePointerUp = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    gestureRef.current.touches.delete(ev.pointerId);
    if (gestureRef.current.touches.size < 2) {
      gestureRef.current.lastPinchDist = 0;
    }

    if (ev.pointerId !== gestureRef.current.activePointerId) return;
    const wasMoved = gestureRef.current.moved;
    gestureRef.current.activePointerId = null;
    gestureRef.current.dragging = false;
    gestureRef.current.moved = false;
    setIsPanning(false);

    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      try {
        ev.currentTarget.releasePointerCapture(ev.pointerId);
      } catch {
        // Ignore synthetic events
      }
    }

    if (!wasMoved) {
      const hit = hitTestWorld(ev.clientX, ev.clientY);
      if (hit.target?.kind === 'cluster') {
        focusCluster(hit.target.node);
      } else if (hit.target?.kind === 'star') {
        const star = hit.target.node;
        setSelectedId((prev) => (prev === star.id ? null : star.id));
      } else if (selectedId) {
        // Clicking empty space while a star is selected cleanly clears selection first
        setSelectedId(null);
      } else if (focusedClusterUid || focusedTriangleIdx !== null) {
        // Clicking empty space while a cluster/triangle is focused steps back to overview
        setFocusedClusterUid(null);
        setFocusedTriangleIdx(null);
        animateCameraTo(IDENTITY_CAMERA, 280);
      } else if (hit.target?.kind === 'triangle') {
        focusTriangle(hit.target.triangle);
      }
    }
  };

  const handleDoubleClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTestWorld(ev.clientX, ev.clientY);
    if (!hit.target || cameraRef.current.zoom >= 2.6) {
      handleResetView();
      return;
    }
    const targetZoom = clamp(cameraRef.current.zoom * 2.2, 2.2, 6.5);
    animateCameraTo(
      {
        zoom: targetZoom,
        panX: hit.localX - hit.worldX * targetZoom,
        panY: hit.localY - hit.worldY * targetZoom,
      },
      260,
    );
  };

  const isCameraMoved =
    Math.abs(camera.zoom - 1) > 0.03 ||
    Math.abs(camera.panX) > 3 ||
    Math.abs(camera.panY) > 3 ||
    Boolean(focusedClusterUid) ||
    focusedTriangleIdx !== null;

  const provenanceMeta = useMemo(
    () => resolveDatasetProvenanceMeta('stellar-atlas', corpusCount),
    [corpusCount],
  );

  // Cluster summary metrics for Cluster Population Inspector
  const focusedClusterStats = useMemo(() => {
    if (!focusedClusterNode) return null;
    const members = focusedClusterNode.cluster.members;
    let coreCount = 0;
    let tempSum = 0;
    let lumLogSum = 0;
    let ageSum = 0;
    for (const m of members) {
      if ((m.normalizedWeight ?? 0) >= 0.65 || m.isExclusiveVertexMember) {
        coreCount += 1;
      }
      tempSum += m.item.tempK;
      lumLogSum += Math.log10(Math.max(1e-4, m.item.luminositySolar));
      ageSum += m.item.ageGyr;
    }
    const n = Math.max(1, members.length);
    const representativeStars = [...members]
      .sort(
        (a, b) =>
          (b.normalizedWeight ?? 0) - (a.normalizedWeight ?? 0) ||
          b.item.luminositySolar - a.item.luminositySolar,
      )
      .slice(0, 8)
      .map((m) => ({
        member: m,
        node: starNodeById.get(m.itemId) ?? null,
      }))
      .filter(
        (entry): entry is {
          member: (typeof members)[number];
          node: SnapshotContentNode<StellarRecord>;
        } => Boolean(entry.node),
      );

    return {
      title: clusterTitles.get(focusedClusterNode.id) ?? focusedClusterNode.cluster.defaultLabel,
      totalCount: members.length,
      coreCount,
      bridgeCount: Math.max(0, members.length - coreCount),
      meanTempK: Math.round(tempSum / n),
      meanLumSolar: Math.pow(10, lumLogSum / n),
      meanAgeGyr: ageSum / n,
      representativeStars,
    };
  }, [clusterTitles, focusedClusterNode, starNodeById]);

  const selectedStar = selectedNode?.item ?? null;
  const selectedAccentHex =
    selectedNode?.layoutContext.mixedColorHex ??
    (selectedStar ? SPECTRAL_CLASS_COLORS[selectedStar.spectralClass] : '#38bdf8');
  const isInspectorOpen = Boolean(selectedStar || focusedClusterStats);

  // Cursor affordance: pointer on stars & cluster badges, grab on open mesh/background
  const canvasCursor = isPanning
    ? 'cursor-grabbing'
    : hoveredTarget?.kind === 'cluster' || hoveredTarget?.kind === 'star'
      ? 'cursor-pointer'
      : 'cursor-grab';

  return (
    <>
      <div
        className={`not-prose flex flex-col overflow-hidden bg-slate-50 dark:bg-[#0B0F17] ${
          isFullscreen
            ? 'sv-atlas-fullscreen'
            : embedded
              ? ''
              : 'my-6 rounded-2xl border border-slate-300/80 shadow-sm dark:border-slate-700/80'
        }`}
      >
        <div
          className="sv-workbench-container"
          data-fullscreen={isFullscreen ? 'true' : 'false'}
        >
          <div
            className="sv-workbench-body sv-workbench-example"
            data-fullscreen={isFullscreen ? 'true' : 'false'}
            data-inspector-open={isInspectorOpen ? 'true' : 'false'}
          >
            {/* Interactive HiDPI Canvas 2D Stage */}
            <div
              ref={stageRef}
              className="sv-workbench-stage bg-slate-50 dark:bg-[#0B0F17]"
            >
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={() => {
                  if (!gestureRef.current.dragging) setHoveredTarget(null);
                }}
                onDoubleClick={handleDoubleClick}
                aria-label={`Interactive Hertzsprung-Russell stellar spectral atlas with ${corpusCount} stars rendered on HTML5 Canvas`}
                className={`block h-full w-full touch-none select-none ${canvasCursor}`}
              />

              {/* Calm initial placeholder before first worker snapshot settles */}
              {!snapshot && !solveError && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="rounded-lg border border-slate-200/90 bg-white/90 px-4 py-2.5 text-xs font-medium text-slate-600 shadow-xs backdrop-blur-sm dark:border-slate-800 dark:bg-[#0B0F17]/90 dark:text-slate-300">
                    Solving {corpusCount.toLocaleString('en-US')} stellar embeddings in Web Worker…
                  </div>
                </div>
              )}

              {solveError && (
                <div className="absolute inset-0 flex items-center justify-center p-4">
                  <div className="max-w-sm rounded-lg border border-rose-300/70 bg-white px-4 py-3 text-xs text-rose-700 shadow-sm dark:border-rose-800/70 dark:bg-[#0B0F17] dark:text-rose-300">
                    {solveError}
                  </div>
                </div>
              )}

              {/* Contextual Hover Tooltip (Stars & Cluster Badges only; empty mesh stays calm) */}
              {hoveredTarget &&
                hoveredTarget.kind !== 'triangle' &&
                !isPanning && (
                  <div
                    className="pointer-events-none absolute z-20 max-w-[250px] rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-1.5 text-xs shadow-md backdrop-blur-sm dark:border-slate-700/90 dark:bg-[#0E131D]/95"
                    style={{
                      left: `${clamp(hoveredTarget.x + 14, 12, Math.max(12, stageSize.width - 260))}px`,
                      top: `${clamp(hoveredTarget.y - 46, 10, Math.max(10, stageSize.height - 66))}px`,
                    }}
                  >
                    {hoveredTarget.kind === 'cluster' && (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: hoveredTarget.node.cluster.colorHex }}
                          />
                          <span className="truncate font-semibold text-slate-950 dark:text-white">
                            {clusterTitles.get(hoveredTarget.node.id) ??
                              hoveredTarget.node.cluster.defaultLabel}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {hoveredTarget.node.cluster.members.length} stars ·{' '}
                          {focusedClusterUid === hoveredTarget.node.cluster.clusterUid
                            ? 'Click to return to overview'
                            : 'Click to frame & inspect'}
                        </div>
                      </>
                    )}

                    {hoveredTarget.kind === 'star' && (
                      <>
                        <div className="flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{
                              backgroundColor: hoveredTarget.node.layoutContext.mixedColorHex,
                            }}
                          />
                          <span className="truncate font-semibold text-slate-950 dark:text-white">
                            {hoveredTarget.node.item.name}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-slate-500 dark:text-slate-400">
                            {hoveredTarget.node.item.spectralType}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {hoveredTarget.node.item.tempK.toLocaleString('en-US')} K ·{' '}
                          {hoveredTarget.node.item.populationLabel}
                        </div>
                      </>
                    )}
                  </div>
                )}
            </div>

            {/* Adaptive Container-Query Side-Drawer: Star Details OR Cluster Population Inspector */}
            <aside
              aria-label="Stellar atlas inspector"
              className="sv-workbench-inspector not-prose bg-white dark:bg-[#0B0F17]"
            >
              {selectedStar && selectedNode ? (
                <div className="flex h-full flex-col overflow-y-auto p-4 text-xs">
                  {focusedClusterStats && (
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="mb-2.5 inline-flex w-fit cursor-pointer items-center gap-1 text-[11px] font-medium text-cyan-700 hover:underline dark:text-cyan-300"
                    >
                      ← Back to {focusedClusterStats.title}
                    </button>
                  )}

                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: selectedAccentHex }}
                        />
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                          {selectedStar.spectralType}
                        </span>
                        <span>·</span>
                        <span>{selectedStar.constellation}</span>
                        <span>·</span>
                        <span className="font-mono">{selectedStar.catalogId}</span>
                      </div>
                      <h4 className="mt-1 truncate text-sm font-bold text-slate-950 dark:text-white">
                        {selectedStar.name}
                      </h4>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {selectedStar.populationLabel}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      aria-label="Close star inspector"
                      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      ✕
                    </button>
                  </div>

                  {/* 4 Astrophysical Metric Bars */}
                  <div className="mt-4 space-y-2.5">
                    {[
                      {
                        label: 'Surface Temp',
                        value: `${selectedStar.tempK.toLocaleString('en-US')} K`,
                        pct: clamp(((Math.log10(selectedStar.tempK) - 3.4) / 1.2) * 100, 6, 100),
                      },
                      {
                        label: 'Luminosity',
                        value: formatSolarValue(selectedStar.luminositySolar, 'L☉'),
                        pct: clamp(
                          ((Math.log10(Math.max(1e-4, selectedStar.luminositySolar)) + 3.5) / 9.2) *
                            100,
                          6,
                          100,
                        ),
                      },
                      {
                        label: 'Radius',
                        value: formatSolarValue(selectedStar.radiusSolar, 'R☉'),
                        pct: clamp(
                          ((Math.log10(Math.max(1e-3, selectedStar.radiusSolar)) + 2.2) / 5.2) * 100,
                          6,
                          100,
                        ),
                      },
                      {
                        label: 'Surface Gravity',
                        value: `${selectedStar.logG.toFixed(2)} log g`,
                        pct: clamp(((selectedStar.logG + 0.4) / 8.9) * 100, 6, 100),
                      },
                    ].map((metric) => (
                      <div key={metric.label}>
                        <div className="flex items-baseline justify-between gap-2 text-[11px]">
                          <span className="text-slate-500 dark:text-slate-400">
                            {metric.label}
                          </span>
                          <span className="font-mono font-semibold text-slate-800 tabular-nums dark:text-slate-200">
                            {metric.value}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${metric.pct}%`,
                              backgroundColor: selectedAccentHex,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Astrophysical Metadata Table */}
                  <dl className="mt-4 divide-y divide-slate-200/80 border-y border-slate-200/80 text-[11px] tabular-nums dark:divide-slate-800/80 dark:border-slate-800/80">
                    <div className="flex justify-between py-1.5">
                      <dt className="text-slate-500 dark:text-slate-400">Mass</dt>
                      <dd className="font-mono font-medium text-slate-800 dark:text-slate-200">
                        {formatSolarValue(selectedStar.massSolar, 'M☉')}
                      </dd>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <dt className="text-slate-500 dark:text-slate-400">Color Index (B−V)</dt>
                      <dd className="font-mono font-medium text-slate-800 dark:text-slate-200">
                        {selectedStar.bvColor >= 0
                          ? `+${selectedStar.bvColor.toFixed(2)}`
                          : selectedStar.bvColor.toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <dt className="text-slate-500 dark:text-slate-400">Metallicity [Fe/H]</dt>
                      <dd className="font-mono font-medium text-slate-800 dark:text-slate-200">
                        {selectedStar.metallicityFeH >= 0
                          ? `+${selectedStar.metallicityFeH.toFixed(2)} dex`
                          : `${selectedStar.metallicityFeH.toFixed(2)} dex`}
                      </dd>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <dt className="text-slate-500 dark:text-slate-400">Distance / Age</dt>
                      <dd className="font-mono font-medium text-slate-800 dark:text-slate-200">
                        {selectedStar.distancePc} pc ·{' '}
                        {selectedStar.ageGyr < 0.1
                          ? `${Math.round(selectedStar.ageGyr * 1000)} Myr`
                          : `${selectedStar.ageGyr.toFixed(1)} Gyr`}
                      </dd>
                    </div>
                  </dl>

                  {/* Interactive Barycentric Simplex Weights */}
                  {selectedNode.layoutContext.unitClusters.length > 0 && (
                    <div className="mt-4">
                      <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        Simplex Barycentric Mix
                      </div>
                      <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                        {selectedNode.layoutContext.unitClusters.map((u) => (
                          <div
                            key={u.cluster.clusterUid}
                            style={{
                              width: `${Math.round(u.weight * 100)}%`,
                              backgroundColor: u.cluster.colorHex,
                            }}
                          />
                        ))}
                      </div>
                      <ul className="mt-2 space-y-1 text-[11px]">
                        {selectedNode.layoutContext.unitClusters.map((u) => {
                          const title =
                            clusterTitles.get(u.cluster.clusterUid) ?? u.cluster.defaultLabel;
                          const targetCluster = snapshot?.clusters.find(
                            (c) => c.cluster.clusterUid === u.cluster.clusterUid,
                          );
                          return (
                            <li key={u.cluster.clusterUid}>
                              <button
                                type="button"
                                onClick={() => targetCluster && focusCluster(targetCluster)}
                                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800/80"
                              >
                                <span className="flex min-w-0 items-center gap-1.5 text-slate-600 dark:text-slate-300">
                                  <span
                                    aria-hidden="true"
                                    className="h-2 w-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: u.cluster.colorHex }}
                                  />
                                  <span className="truncate">{title}</span>
                                </span>
                                <span className="shrink-0 font-mono text-slate-500 tabular-nums dark:text-slate-400">
                                  {Math.round(u.weight * 100)}%
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              ) : focusedClusterNode && focusedClusterStats ? (
                <div className="flex h-full flex-col overflow-y-auto p-4 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: focusedClusterNode.cluster.colorHex }}
                        />
                        <span>Stellar Population</span>
                        <span>·</span>
                        <span className="font-mono">
                          {focusedClusterStats.totalCount} stars
                        </span>
                      </div>
                      <h4 className="mt-1 truncate text-sm font-bold text-slate-950 dark:text-white">
                        {focusedClusterStats.title}
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetView}
                      aria-label="Close cluster inspector"
                      className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Cluster Composition Summary */}
                  <dl className="mt-4 divide-y divide-slate-200/80 border-y border-slate-200/80 text-[11px] tabular-nums dark:divide-slate-800/80 dark:border-slate-800/80">
                    <div className="flex justify-between py-1.5">
                      <dt className="text-slate-500 dark:text-slate-400">Core / Bridge Stars</dt>
                      <dd className="font-mono font-medium text-slate-800 dark:text-slate-200">
                        {focusedClusterStats.coreCount} core · {focusedClusterStats.bridgeCount} hybrid
                      </dd>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <dt className="text-slate-500 dark:text-slate-400">Mean Surface Temp</dt>
                      <dd className="font-mono font-medium text-slate-800 dark:text-slate-200">
                        {focusedClusterStats.meanTempK.toLocaleString('en-US')} K
                      </dd>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <dt className="text-slate-500 dark:text-slate-400">Geometric Mean Lum.</dt>
                      <dd className="font-mono font-medium text-slate-800 dark:text-slate-200">
                        {formatSolarValue(focusedClusterStats.meanLumSolar, 'L☉')}
                      </dd>
                    </div>
                    <div className="flex justify-between py-1.5">
                      <dt className="text-slate-500 dark:text-slate-400">Mean Age</dt>
                      <dd className="font-mono font-medium text-slate-800 dark:text-slate-200">
                        {focusedClusterStats.meanAgeGyr < 0.1
                          ? `${Math.round(focusedClusterStats.meanAgeGyr * 1000)} Myr`
                          : `${focusedClusterStats.meanAgeGyr.toFixed(1)} Gyr`}
                      </dd>
                    </div>
                  </dl>

                  {/* Clickable Representative Stars */}
                  <div className="mt-4">
                    <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Representative Stars
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {focusedClusterStats.representativeStars.map(({ member, node }) => (
                        <li key={member.itemId}>
                          <button
                            type="button"
                            onMouseEnter={() => setHoveredListStarId(member.itemId)}
                            onMouseLeave={() => setHoveredListStarId(null)}
                            onClick={() => focusStarFromList(node)}
                            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1 text-left transition-colors hover:border-slate-200/80 hover:bg-slate-50 dark:hover:border-slate-800 dark:hover:bg-[#0E131D]"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span
                                aria-hidden="true"
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: node.layoutContext.mixedColorHex }}
                              />
                              <span className="truncate font-medium text-slate-800 dark:text-slate-100">
                                {member.item.name}
                              </span>
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-slate-500 tabular-nums dark:text-slate-400">
                              {member.item.spectralType}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col justify-center px-5 py-6 text-center">
                  <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200/90 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-[#0E131D] dark:text-slate-500">
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 2v3" />
                      <path d="M12 19v3" />
                      <path d="m4.93 4.93 2.12 2.12" />
                      <path d="m16.95 16.95 2.12 2.12" />
                      <path d="M2 12h3" />
                      <path d="M19 12h3" />
                      <path d="m4.93 19.07 2.12-2.12" />
                      <path d="m16.95 7.05 2.12-2.12" />
                    </svg>
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Stellar Atlas Inspector
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    Click any cluster pill to frame and inspect a population, click a triangle to zoom into hybrids, or pick any star for astrophysical parameters.
                  </p>
                </div>
              )}
            </aside>

            {/* Single-Line Docked Bottom Bar */}
            <div className="sv-workbench-bottombar flex items-center justify-between gap-2 border-t border-slate-200/80 bg-slate-100/85 px-2.5 py-1.5 dark:border-slate-800/80 dark:bg-[#0E131D]">
              {/* Left: Calm Camera / Worker Status + Precision Zoom Controls */}
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                {isCameraMoved ? (
                  <button
                    type="button"
                    onClick={handleResetView}
                    aria-label="Return to Overview"
                    title="Reset camera to Overview"
                    className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white whitespace-nowrap"
                  >
                    <svg
                      className="h-3.5 w-3.5 shrink-0"
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
                    <span>Overview</span>
                  </button>
                ) : (
                  <div className="flex min-w-0 items-center gap-1.5 pl-1 text-xs text-slate-500 dark:text-slate-400">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        isSolving
                          ? 'animate-pulse bg-cyan-500 dark:bg-cyan-400'
                          : 'bg-indigo-500/80 dark:bg-indigo-400/80'
                      }`}
                    />
                    <span className="truncate font-medium text-slate-700 dark:text-slate-300">
                      {isSolving ? 'Solving in worker…' : 'Overview'}
                    </span>
                    <span className="hidden truncate text-slate-400 lg:inline dark:text-slate-500">
                      · Click cluster or scroll to zoom
                    </span>
                  </div>
                )}

                {/* Compact Zoom Out / In Step Buttons */}
                <div
                  role="group"
                  aria-label="Camera zoom"
                  className="inline-flex h-7 shrink-0 items-center overflow-hidden rounded-md border border-slate-200 bg-white divide-x divide-slate-200 dark:border-slate-700 dark:bg-[#0B0F17] dark:divide-slate-700"
                >
                  <button
                    type="button"
                    onClick={() => handleStepZoom(1 / 1.45)}
                    disabled={camera.zoom <= MIN_ZOOM + 0.02}
                    aria-label="Zoom out"
                    title="Zoom out"
                    className="inline-flex h-full w-7 cursor-pointer items-center justify-center text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500/70 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => handleStepZoom(1.45)}
                    disabled={camera.zoom >= MAX_ZOOM - 0.1}
                    aria-label="Zoom in"
                    title="Zoom in"
                    className="inline-flex h-full w-7 cursor-pointer items-center justify-center text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500/70 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Right: Corpus Size Switcher + Dataset Info + Fullscreen */}
              <div className="flex shrink-0 items-center gap-1.5">
                <div
                  role="group"
                  aria-label="Star catalog size"
                  className="inline-flex h-7 shrink-0 items-center rounded-md border border-slate-200 bg-white p-0.5 text-xs dark:border-slate-700 dark:bg-[#0B0F17]"
                >
                  {CORPUS_PRESETS.map((opt) => {
                    const active = opt.count === corpusCount;
                    return (
                      <button
                        key={opt.count}
                        type="button"
                        onClick={() => setCorpusCount(opt.count)}
                        aria-pressed={active}
                        title={`Solve ${opt.label} stars in Web Worker`}
                        className={`inline-flex h-6 cursor-pointer items-center justify-center rounded px-2 font-mono text-[11px] font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 ${
                          active
                            ? 'bg-indigo-600 text-white shadow-2xs dark:bg-indigo-500 dark:text-white'
                            : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100'
                        }`}
                      >
                        <span className="hidden sm:inline">{opt.label}</span>
                        <span className="sm:hidden">{opt.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>

                <DatasetInfoButton
                  isOpen={isDatasetModalOpen}
                  onOpen={() => setIsDatasetModalOpen(true)}
                  compactMobile
                />
                <CssFullscreenButton
                  isFullscreen={isFullscreen}
                  onToggle={toggleFullscreen}
                  compactMobile
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <DatasetProvenanceModal
        isOpen={isDatasetModalOpen}
        meta={provenanceMeta}
        onClose={() => setIsDatasetModalOpen(false)}
      />
    </>
  );
}
