import {
  createFinalSeededClusteringStrategy,
  createFinalSeededLayoutStrategy,
  type FinalSeededLayoutScaleMode,
  type SimplexClusteringStrategy,
  type SimplexLayoutStrategy,
} from './strategies.js';
import type { DefaultTaggedItem } from './types.js';

/**
 * Accepted return types for `SimplexTimelineOptions.getTimestamp`.
 * Numbers may be Unix timestamps in milliseconds or plain numeric coordinates (e.g., years like `2024`).
 */
export type TimelineTimestampValue = number | Date | string | null | undefined;

/**
 * Single chronological frame in a `SimplexTimelineController`.
 */
export interface SimplexTimelineFrame<TItem = DefaultTaggedItem> {
  /** Zero-based step index (`0..totalSteps`). */
  readonly index: number;
  /** Stable string key identifying this frame. */
  readonly key: string;
  /** Human-readable display label (e.g. `'2024'`, `'Mar 2024'`, `'Baseline'`). */
  readonly label: string;
  /** Parsed numeric timestamp or coordinate when timestamp-driven. */
  readonly timestamp?: number;
  /** Items newly introduced at this frame. */
  readonly items: readonly TItem[];
  /** Cumulative active items visible at this step (`0..index`). */
  readonly cumulativeItems: readonly TItem[];
  /** `true` when this frame represents undated baseline items or an empty start frame. */
  readonly isBaseline: boolean;
}

/**
 * Context passed to `SimplexTimelineOptions.formatFrameLabel`.
 */
export interface SimplexTimelineLabelContext {
  readonly key: string;
  readonly timestamp?: number;
  readonly stepIndex: number;
  readonly totalSteps: number;
  readonly itemCount: number;
  readonly cumulativeItemCount: number;
  readonly isBaseline: boolean;
}

/**
 * Immutable snapshot of playback and frame state emitted by `SimplexTimelineController`.
 */
export interface SimplexTimelineState<TItem = DefaultTaggedItem> {
  /** Current active step (`0..totalSteps`). */
  readonly step: number;
  /** Maximum valid step index (`frames.length - 1`, or `0` when empty). */
  readonly totalSteps: number;
  /** `true` while automatic playback is advancing via `tick(dtMs)`. */
  readonly playing: boolean;
  /** Playback speed multiplier (`> 0`). Default: `1`. */
  readonly speed: number;
  /** Base interval between steps in milliseconds at `speed = 1`. Default: `900`. */
  readonly stepIntervalMs: number;
  /** `true` when playback wraps back to `0` after `totalSteps`. */
  readonly loop: boolean;
  /** `true` when `step <= 0`. */
  readonly atStart: boolean;
  /** `true` when `step >= totalSteps`. */
  readonly atEnd: boolean;
  /** Normalized progress in `[0, 1]` (`1` when `totalSteps === 0`). */
  readonly progress: number;
  /** Display label for the current active frame. */
  readonly activeLabel: string;
  /** Current frame descriptor, or `null` when no frames exist. */
  readonly activeFrame: SimplexTimelineFrame<TItem> | null;
  /** Cumulative item slice visible at the current `step`. */
  readonly activeItems: readonly TItem[];
  /** Number of visible items at the current `step`. */
  readonly activeItemCount: number;
  /** Total number of items in the full corpus. */
  readonly totalItemCount: number;
  /** Ordered cumulative frames (`0..totalSteps`). */
  readonly frames: readonly SimplexTimelineFrame<TItem>[];
}

/**
 * Configuration options for `SimplexTimelineController` / `createSimplexTimeline`.
 */
export interface SimplexTimelineOptions<TItem = DefaultTaggedItem> {
  /**
   * Extracts a chronological timestamp (epoch ms, numeric year, `Date`, or ISO string) from an item.
   * Items returning `null`/`undefined`/`NaN` are placed in the step-0 baseline.
   * When omitted together with `getFrameKey`, common item fields (`timestamp`, `date`, `year`,
   * `createdAt`, `publishedAt`, `time`) are inspected automatically, falling back to sequential
   * 1-item-per-step frames when no date field is present.
   */
  readonly getTimestamp?: (item: TItem) => TimelineTimestampValue;
  /**
   * Explicit frame grouping key (e.g. `'Q1 2024'`, `'v2.0'`, `2024`).
   * Takes precedence over `getTimestamp` when provided.
   * Items returning `null`/`undefined` are placed in the step-0 baseline.
   */
  readonly getFrameKey?: (item: TItem) => string | number | null | undefined;
  /**
   * Optional comparator ordering distinct frame keys when using `getFrameKey`.
   * Defaults to timestamp order (if `getTimestamp` is also provided), numeric order
   * (if all keys are numeric), or first-seen order otherwise.
   */
  readonly compareFrameKeys?: (a: string | number, b: string | number) => number;
  /** Custom formatter converting frame metadata into a concise human-readable label. */
  readonly formatFrameLabel?: (ctx: SimplexTimelineLabelContext) => string;
  /**
   * Custom formatter converting a full `SimplexTimelineFrame<TItem>` (including `index`,
   * `key`, default `label`, `timestamp`, `items`, `cumulativeItems`, and `isBaseline`)
   * into a human-readable step label. Takes precedence over `formatFrameLabel` when provided.
   */
  readonly formatStepLabel?: (frame: SimplexTimelineFrame<TItem>) => string;
  /** Display label for the step-0 undated baseline frame. Default: `'Baseline'`. */
  readonly baselineLabel?: string;
  /**
   * When `true` and no undated baseline items exist, prepends an empty step `0`
   * so stepping starts from 0 visible items. Default: `false`.
   */
  readonly includeEmptyStart?: boolean;
  /** Display label for the empty start frame when `includeEmptyStart: true`. Default: `'Start'`. */
  readonly emptyStartLabel?: string;
  /**
   * Initial step index or `'start'` / `'end'`.
   * Defaults to `'start'` when `autoPlay: true`, and `'end'` otherwise so initial full-corpus
   * rendering (including `createFinalSeededClusteringStrategy`) starts with all items visible.
   */
  readonly initialStep?: number | 'start' | 'end';
  /** Base interval per step in milliseconds at `speed = 1`. Default: `900`. */
  readonly stepIntervalMs?: number;
  /** Playback speed multiplier (`> 0`). Default: `1`. */
  readonly speed?: number;
  /** Whether playback loops back to step `0` after reaching `totalSteps`. Default: `false`. */
  readonly loop?: boolean;
  /** Whether playback begins automatically on creation. Default: `false`. */
  readonly autoPlay?: boolean;
  /** Optional callback fired whenever the active cumulative item slice changes. */
  readonly onItemsChange?: (
    activeItems: readonly TItem[],
    state: SimplexTimelineState<TItem>,
  ) => void;
}

export type SimplexTimelineListener<TItem = DefaultTaggedItem> = (
  state: SimplexTimelineState<TItem>,
) => void;

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const DEFAULT_TIMESTAMP_KEYS = [
  'timestamp',
  'date',
  'year',
  'createdAt',
  'publishedAt',
  'time',
] as const;

const NUMERIC_STRING_RE = /^-?\d+(?:\.\d+)?$/;

function parseTimestampValue(raw: TimelineTimestampValue): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? ms : undefined;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined;
    if (NUMERIC_STRING_RE.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : undefined;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function detectAutoTimestampKey<TItem>(items: readonly TItem[]): string | null {
  for (const key of DEFAULT_TIMESTAMP_KEYS) {
    for (const item of items) {
      if (typeof item === 'object' && item !== null && key in item) {
        const val = (item as Record<string, unknown>)[key];
        if (
          parseTimestampValue(val as TimelineTimestampValue) !== undefined
        ) {
          return key;
        }
      }
    }
  }
  return null;
}

function isEpochMsTimestamp(ts: number): boolean {
  // Epoch ms values outside plain calendar years / small indices (e.g. >= 1971 or <= 1969 in ms)
  return Math.abs(ts) >= 10_000_000_000;
}

function formatDefaultTimestampLabel(
  ts: number,
  allTimestamps: readonly number[],
): string {
  if (Number.isInteger(ts) && ts >= 1000 && ts <= 2999) {
    return String(ts);
  }
  if (isEpochMsTimestamp(ts)) {
    const allEpoch = allTimestamps.every(isEpochMsTimestamp);
    const d = new Date(ts);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const day = d.getUTCDate();
    if (allEpoch) {
      const allJanFirst = allTimestamps.every((t) => {
        const dt = new Date(t);
        return dt.getUTCMonth() === 0 && dt.getUTCDate() === 1;
      });
      if (allJanFirst) {
        return String(year);
      }
      const allFirstOfMonth = allTimestamps.every(
        (t) => new Date(t).getUTCDate() === 1,
      );
      if (allFirstOfMonth) {
        return `${SHORT_MONTHS[month]} ${year}`;
      }
    }
    return `${SHORT_MONTHS[month]} ${day}, ${year}`;
  }
  return String(ts);
}

interface RawFrameBucket<TItem> {
  readonly key: string;
  readonly rawKey: string | number;
  readonly timestamp?: number;
  readonly items: TItem[];
  readonly isBaseline: boolean;
  readonly defaultLabel?: string;
}

function buildTimelineFrames<TItem>(
  items: readonly TItem[],
  options: SimplexTimelineOptions<TItem>,
): readonly SimplexTimelineFrame<TItem>[] {
  const baselineLabel = options.baselineLabel ?? 'Baseline';
  const emptyStartLabel = options.emptyStartLabel ?? 'Start';

  if (items.length === 0) {
    if (options.includeEmptyStart) {
      const ctx: SimplexTimelineLabelContext = {
        key: '__start__',
        stepIndex: 0,
        totalSteps: 0,
        itemCount: 0,
        cumulativeItemCount: 0,
        isBaseline: true,
      };
      const baseLabel = options.formatFrameLabel
        ? options.formatFrameLabel(ctx)
        : emptyStartLabel;
      const baseFrame: SimplexTimelineFrame<TItem> = {
        index: 0,
        key: '__start__',
        label: baseLabel,
        items: [],
        cumulativeItems: [],
        isBaseline: true,
      };
      const label = options.formatStepLabel
        ? options.formatStepLabel(baseFrame)
        : baseLabel;
      return [
        label === baseLabel ? baseFrame : { ...baseFrame, label },
      ];
    }
    return [];
  }

  const baselineItems: TItem[] = [];
  const buckets: RawFrameBucket<TItem>[] = [];

  if (options.getFrameKey) {
    const byKey = new Map<string, RawFrameBucket<TItem>>();
    for (const item of items) {
      const rawKey = options.getFrameKey(item);
      if (rawKey === null || rawKey === undefined || rawKey === '') {
        baselineItems.push(item);
        continue;
      }
      const strKey = String(rawKey);
      const ts = options.getTimestamp
        ? parseTimestampValue(options.getTimestamp(item))
        : undefined;
      let bucket = byKey.get(strKey);
      if (!bucket) {
        bucket = {
          key: strKey,
          rawKey,
          timestamp: ts,
          items: [],
          isBaseline: false,
          defaultLabel: strKey,
        };
        byKey.set(strKey, bucket);
        buckets.push(bucket);
      } else if (
        ts !== undefined &&
        (bucket.timestamp === undefined || ts < bucket.timestamp)
      ) {
        (bucket as { timestamp?: number }).timestamp = ts;
      }
      bucket.items.push(item);
    }

    if (options.compareFrameKeys) {
      const cmp = options.compareFrameKeys;
      buckets.sort((a, b) => cmp(a.rawKey, b.rawKey));
    } else if (buckets.every((b) => b.timestamp !== undefined)) {
      buckets.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    } else if (
      buckets.every(
        (b) =>
          typeof b.rawKey === 'number' ||
          (typeof b.rawKey === 'string' && NUMERIC_STRING_RE.test(b.rawKey)),
      )
    ) {
      buckets.sort((a, b) => Number(a.rawKey) - Number(b.rawKey));
    }
  } else {
    let timestampFn: ((item: TItem) => TimelineTimestampValue) | null =
      options.getTimestamp ?? null;

    if (!timestampFn) {
      const detectedKey = detectAutoTimestampKey(items);
      if (detectedKey) {
        timestampFn = (item: TItem) =>
          typeof item === 'object' && item !== null
            ? ((item as Record<string, unknown>)[
                detectedKey
              ] as TimelineTimestampValue)
            : undefined;
      }
    }

    if (timestampFn) {
      const byTs = new Map<number, RawFrameBucket<TItem>>();
      for (const item of items) {
        const ts = parseTimestampValue(timestampFn(item));
        if (ts === undefined) {
          baselineItems.push(item);
          continue;
        }
        let bucket = byTs.get(ts);
        if (!bucket) {
          bucket = {
            key: String(ts),
            rawKey: ts,
            timestamp: ts,
            items: [],
            isBaseline: false,
          };
          byTs.set(ts, bucket);
          buckets.push(bucket);
        }
        bucket.items.push(item);
      }
      buckets.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    } else {
      // Zero-config fallback: 1 item per chronological step
      items.forEach((item, idx) => {
        buckets.push({
          key: `step-${idx + 1}`,
          rawKey: idx + 1,
          items: [item],
          isBaseline: false,
          defaultLabel: `Step ${idx + 1}`,
        });
      });
    }
  }

  const orderedBuckets: RawFrameBucket<TItem>[] = [];
  if (baselineItems.length > 0) {
    orderedBuckets.push({
      key: '__baseline__',
      rawKey: '__baseline__',
      items: baselineItems,
      isBaseline: true,
      defaultLabel: baselineLabel,
    });
  } else if (options.includeEmptyStart) {
    orderedBuckets.push({
      key: '__start__',
      rawKey: '__start__',
      items: [],
      isBaseline: true,
      defaultLabel: emptyStartLabel,
    });
  }
  orderedBuckets.push(...buckets);

  const allNumericTimestamps = buckets
    .map((b) => b.timestamp)
    .filter((t): t is number => t !== undefined);

  const totalSteps = Math.max(0, orderedBuckets.length - 1);
  const cumulative: TItem[] = [];
  const frames: SimplexTimelineFrame<TItem>[] = [];

  orderedBuckets.forEach((bucket, stepIndex) => {
    cumulative.push(...bucket.items);
    const cumulativeSnapshot = cumulative.slice();
    const defaultLabel = bucket.isBaseline
      ? (bucket.defaultLabel ?? baselineLabel)
      : bucket.defaultLabel !== undefined
        ? bucket.defaultLabel
        : bucket.timestamp !== undefined
          ? formatDefaultTimestampLabel(bucket.timestamp, allNumericTimestamps)
          : bucket.key;

    const labelCtx: SimplexTimelineLabelContext = {
      key: bucket.key,
      timestamp: bucket.timestamp,
      stepIndex,
      totalSteps,
      itemCount: bucket.items.length,
      cumulativeItemCount: cumulativeSnapshot.length,
      isBaseline: bucket.isBaseline,
    };
    const baseLabel = options.formatFrameLabel
      ? options.formatFrameLabel(labelCtx)
      : defaultLabel;
    const baseFrame: SimplexTimelineFrame<TItem> = {
      index: stepIndex,
      key: bucket.key,
      label: baseLabel,
      timestamp: bucket.timestamp,
      items: bucket.items.slice(),
      cumulativeItems: cumulativeSnapshot,
      isBaseline: bucket.isBaseline,
    };
    const label = options.formatStepLabel
      ? options.formatStepLabel(baseFrame)
      : baseLabel;

    frames.push(label === baseLabel ? baseFrame : { ...baseFrame, label });
  });

  return frames;
}

function clampStep(step: number, totalSteps: number): number {
  if (!Number.isFinite(step) || totalSteps <= 0) return 0;
  return Math.max(0, Math.min(totalSteps, Math.round(step)));
}

/**
 * Headless, DOM-free chronological timeline & playback controller for `@simplex-viz/core`.
 *
 * Groups items into ordered cumulative frames (with optional undated baseline items at step `0`),
 * manages play/pause/step/seek/speed/loop state, and advances deterministically via `tick(dtMs)`.
 * Composes naturally with `createFinalSeededClusteringStrategy` and `createWarmStartPbdLayoutStrategy`
 * so cluster anchors stay pinned across `0..N` playback frames.
 */
export class SimplexTimelineController<TItem = DefaultTaggedItem> {
  private readonly options: SimplexTimelineOptions<TItem>;
  private readonly listeners = new Set<SimplexTimelineListener<TItem>>();

  private allItems: readonly TItem[];
  private frames: readonly SimplexTimelineFrame<TItem>[];
  private step: number;
  private playing: boolean;
  private speed: number;
  private stepIntervalMs: number;
  private loop: boolean;
  private accumMs = 0;
  private destroyed = false;
  private cachedState: SimplexTimelineState<TItem>;

  constructor(
    items: readonly TItem[],
    options: SimplexTimelineOptions<TItem> = {},
  ) {
    this.options = options;
    this.allItems = items.slice();
    this.speed =
      options.speed !== undefined && Number.isFinite(options.speed) && options.speed > 0
        ? options.speed
        : 1;
    this.stepIntervalMs =
      options.stepIntervalMs !== undefined &&
      Number.isFinite(options.stepIntervalMs) &&
      options.stepIntervalMs > 0
        ? options.stepIntervalMs
        : 900;
    this.loop = options.loop ?? false;

    this.frames = buildTimelineFrames(this.allItems, this.options);
    const totalSteps = Math.max(0, this.frames.length - 1);

    const requestedInitial =
      options.initialStep ?? (options.autoPlay ? 'start' : 'end');
    if (requestedInitial === 'start') {
      this.step = 0;
    } else if (requestedInitial === 'end') {
      this.step = totalSteps;
    } else {
      this.step = clampStep(requestedInitial, totalSteps);
    }

    this.playing = Boolean(options.autoPlay) && totalSteps > 0;
    this.cachedState = this.buildState();
  }

  private buildState(): SimplexTimelineState<TItem> {
    const totalSteps = Math.max(0, this.frames.length - 1);
    const activeFrame = this.frames[this.step] ?? null;
    const activeItems = activeFrame ? activeFrame.cumulativeItems : [];
    return {
      step: this.step,
      totalSteps,
      playing: this.playing,
      speed: this.speed,
      stepIntervalMs: this.stepIntervalMs,
      loop: this.loop,
      atStart: this.step <= 0,
      atEnd: this.step >= totalSteps,
      progress: totalSteps > 0 ? this.step / totalSteps : 1,
      activeLabel: activeFrame ? activeFrame.label : '',
      activeFrame,
      activeItems,
      activeItemCount: activeItems.length,
      totalItemCount: this.allItems.length,
      frames: this.frames,
    };
  }

  private commit(itemsChanged: boolean): SimplexTimelineState<TItem> {
    this.cachedState = this.buildState();
    if (this.destroyed) return this.cachedState;
    if (itemsChanged) {
      this.options.onItemsChange?.(this.cachedState.activeItems, this.cachedState);
    }
    for (const listener of this.listeners) {
      listener(this.cachedState);
    }
    return this.cachedState;
  }

  /** Returns the current immutable timeline playback state. */
  getState(): SimplexTimelineState<TItem> {
    return this.cachedState;
  }

  /** Returns the cumulative item slice visible at the current step. */
  getActiveItems(): readonly TItem[] {
    return this.cachedState.activeItems;
  }

  /** Returns the full underlying corpus passed to the timeline. */
  getAllItems(): readonly TItem[] {
    return this.allItems;
  }

  /**
   * Replaces the full corpus and recomputes chronological frames.
   * By default, stays pinned to `totalSteps` if the timeline was already at the end;
   * pass `{ preserveStep: true }` to keep the numeric step index (clamped).
   */
  setItems(
    items: readonly TItem[],
    options?: { readonly preserveStep?: boolean },
  ): SimplexTimelineState<TItem> {
    const wasAtEnd = this.cachedState.atEnd;
    this.allItems = items.slice();
    this.frames = buildTimelineFrames(this.allItems, this.options);
    const nextTotalSteps = Math.max(0, this.frames.length - 1);

    if (options?.preserveStep) {
      this.step = clampStep(this.step, nextTotalSteps);
    } else if (wasAtEnd) {
      this.step = nextTotalSteps;
    } else {
      this.step = clampStep(this.step, nextTotalSteps);
    }

    if (nextTotalSteps === 0) {
      this.playing = false;
      this.accumMs = 0;
    }

    return this.commit(true);
  }

  /**
   * Starts automatic playback. When already at `totalSteps`, rewinds to step `0` first.
   */
  play(): SimplexTimelineState<TItem> {
    if (this.destroyed) return this.cachedState;
    const totalSteps = Math.max(0, this.frames.length - 1);
    if (totalSteps <= 0) {
      return this.cachedState;
    }
    let itemsChanged = false;
    if (this.step >= totalSteps) {
      this.step = 0;
      itemsChanged = true;
    }
    if (this.playing && !itemsChanged) {
      return this.cachedState;
    }
    this.playing = true;
    this.accumMs = 0;
    return this.commit(itemsChanged);
  }

  /** Pauses automatic playback without altering the current step. */
  pause(): SimplexTimelineState<TItem> {
    if (!this.playing) return this.cachedState;
    this.playing = false;
    this.accumMs = 0;
    return this.commit(false);
  }

  /** Toggles between playing and paused states. */
  toggle(): SimplexTimelineState<TItem> {
    return this.playing ? this.pause() : this.play();
  }

  /**
   * Steps forward or backward by `delta` frames (clamped to `[0, totalSteps]`).
   * Pauses playback if stepping manually to the final frame (when `loop` is `false`).
   */
  stepBy(delta: number): SimplexTimelineState<TItem> {
    if (!Number.isFinite(delta) || delta === 0) return this.cachedState;
    return this.seek(this.step + Math.trunc(delta));
  }

  /** Jumps directly to `step` (clamped to `[0, totalSteps]`). */
  seek(step: number): SimplexTimelineState<TItem> {
    if (this.destroyed) return this.cachedState;
    const totalSteps = Math.max(0, this.frames.length - 1);
    const nextStep = clampStep(step, totalSteps);
    const stepChanged = nextStep !== this.step;
    const shouldPauseAtEnd = !this.loop && nextStep >= totalSteps && this.playing;

    if (!stepChanged && !shouldPauseAtEnd) {
      return this.cachedState;
    }
    this.step = nextStep;
    this.accumMs = 0;
    if (shouldPauseAtEnd) {
      this.playing = false;
    }
    return this.commit(stepChanged);
  }

  /** Pauses playback and jumps to the final full-corpus frame (`totalSteps`). */
  resetToEnd(): SimplexTimelineState<TItem> {
    if (this.destroyed) return this.cachedState;
    const totalSteps = Math.max(0, this.frames.length - 1);
    const stepChanged = this.step !== totalSteps;
    const playingChanged = this.playing;
    if (!stepChanged && !playingChanged) {
      return this.cachedState;
    }
    this.step = totalSteps;
    this.playing = false;
    this.accumMs = 0;
    return this.commit(stepChanged);
  }

  /** Updates playback speed multiplier (`> 0`). */
  setSpeed(speed: number): SimplexTimelineState<TItem> {
    if (!Number.isFinite(speed) || speed <= 0 || speed === this.speed) {
      return this.cachedState;
    }
    this.speed = speed;
    return this.commit(false);
  }

  /** Updates the base step duration in milliseconds at `speed = 1`. */
  setStepIntervalMs(stepIntervalMs: number): SimplexTimelineState<TItem> {
    if (
      !Number.isFinite(stepIntervalMs) ||
      stepIntervalMs <= 0 ||
      stepIntervalMs === this.stepIntervalMs
    ) {
      return this.cachedState;
    }
    this.stepIntervalMs = stepIntervalMs;
    return this.commit(false);
  }

  /** Enables or disables looping playback. */
  setLoop(loop: boolean): SimplexTimelineState<TItem> {
    if (this.loop === loop) return this.cachedState;
    this.loop = loop;
    return this.commit(false);
  }

  /**
   * Advances the internal playback clock by `dtMs` milliseconds.
   * Designed to be called from `requestAnimationFrame` or deterministic tests.
   * Returns `true` when the active frame or playing state changed.
   */
  tick(dtMs: number): boolean {
    if (
      this.destroyed ||
      !this.playing ||
      !Number.isFinite(dtMs) ||
      dtMs <= 0
    ) {
      return false;
    }
    const totalSteps = Math.max(0, this.frames.length - 1);
    if (totalSteps <= 0) {
      this.playing = false;
      this.accumMs = 0;
      this.commit(false);
      return true;
    }

    this.accumMs += dtMs * this.speed;
    if (this.accumMs < this.stepIntervalMs) {
      return false;
    }

    const stepsToAdvance = Math.floor(this.accumMs / this.stepIntervalMs);
    this.accumMs -= stepsToAdvance * this.stepIntervalMs;

    let nextStep: number;
    if (this.loop) {
      nextStep = (this.step + stepsToAdvance) % this.frames.length;
    } else {
      nextStep = Math.min(totalSteps, this.step + stepsToAdvance);
      if (nextStep >= totalSteps) {
        this.playing = false;
        this.accumMs = 0;
      }
    }

    const stepChanged = nextStep !== this.step;
    this.step = nextStep;
    this.commit(stepChanged);
    return true;
  }

  /** Subscribes to every state transition and returns an unsubscribe cleanup function. */
  subscribe(listener: SimplexTimelineListener<TItem>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stops playback and releases all subscribers. */
  destroy(): void {
    this.destroyed = true;
    this.playing = false;
    this.accumMs = 0;
    this.listeners.clear();
  }
}

/**
 * Convenience factory creating a headless `SimplexTimelineController`.
 */
export function createSimplexTimeline<TItem = DefaultTaggedItem>(
  items: readonly TItem[],
  options?: SimplexTimelineOptions<TItem>,
): SimplexTimelineController<TItem> {
  return new SimplexTimelineController(items, options);
}

/**
 * Normalizes `autoFinalSeedLayout` (`boolean | 'pinned' | 'adaptive'`) into a concrete scale mode or `false`.
 */
export function normalizeTimelineLayoutScaleMode(
  option: boolean | FinalSeededLayoutScaleMode | undefined,
): false | FinalSeededLayoutScaleMode {
  if (option === true) return 'pinned';
  if (option === 'pinned' || option === 'adaptive') return option;
  return false;
}

/**
 * Wraps a base clustering strategy in `createFinalSeededClusteringStrategy` when timeline auto-seeding is active.
 */
export function wrapClusteringStrategyForTimeline<
  TItem = DefaultTaggedItem,
  TTagMeta = undefined,
>(
  baseStrategy: SimplexClusteringStrategy<TItem, TTagMeta> | undefined,
  seedItems: readonly TItem[],
  enabled: boolean,
): SimplexClusteringStrategy<TItem, TTagMeta> | undefined {
  if (!enabled || seedItems.length === 0) {
    return baseStrategy;
  }
  if (baseStrategy && baseStrategy.name.startsWith('final-seeded(')) {
    return baseStrategy;
  }
  return createFinalSeededClusteringStrategy<TItem, TTagMeta>(baseStrategy, {
    seedItems,
  });
}

/**
 * Wraps a base layout strategy in `createFinalSeededLayoutStrategy` when timeline layout seeding is enabled.
 */
export function wrapLayoutStrategyForTimeline(
  baseStrategy: SimplexLayoutStrategy | undefined,
  scaleMode: false | FinalSeededLayoutScaleMode,
): SimplexLayoutStrategy | undefined {
  if (!scaleMode) {
    return baseStrategy;
  }
  if (baseStrategy && baseStrategy.name.startsWith('final-seeded(')) {
    return baseStrategy;
  }
  return createFinalSeededLayoutStrategy(baseStrategy, {
    scaleMode,
  });
}
