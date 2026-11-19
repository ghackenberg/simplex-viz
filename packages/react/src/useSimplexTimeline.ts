import {
  SimplexTimelineController,
  type DefaultTaggedItem,
  type SimplexTimelineState,
} from '@simplex-viz/core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';

/**
 * Minimal structural contract satisfied by `SimplexSvgController<TItem, ...>` regardless of visual/meta generics.
 */
export interface SimplexTimelineHost<TItem = DefaultTaggedItem> {
  getTimeline(): SimplexTimelineController<TItem> | null;
  subscribeTimeline(
    listener: (state: SimplexTimelineState<TItem> | null) => void,
  ): () => void;
}

/**
 * Input source accepted by `useSimplexTimeline`:
 * either a `controllerRef` from `useSimplexGraphController()` or a standalone `SimplexTimelineController`.
 */
export type SimplexTimelineSource<TItem = DefaultTaggedItem> =
  | RefObject<SimplexTimelineHost<TItem> | null>
  | SimplexTimelineController<TItem>
  | null
  | undefined;

/**
 * Reactive playback state and imperative controls returned by `useSimplexTimeline`.
 */
export interface UseSimplexTimelineResult<TItem = DefaultTaggedItem> {
  /** Current timeline state, or `null` when timeline mode is disabled or not yet mounted. */
  readonly state: SimplexTimelineState<TItem> | null;
  /** `true` once a timeline controller is attached and ready. */
  readonly isReady: boolean;
  /** Starts playback (rewinding to step `0` first when already at the end). */
  readonly play: () => void;
  /** Pauses playback at the current step. */
  readonly pause: () => void;
  /** Toggles between playing and paused states. */
  readonly toggle: () => void;
  /** Steps forward or backward by `delta` frames. */
  readonly stepBy: (delta: number) => void;
  /** Jumps directly to a specific step index (`0..totalSteps`). */
  readonly seek: (step: number) => void;
  /** Pauses playback and jumps to the final full-corpus frame (`totalSteps`). */
  readonly resetToEnd: () => void;
  /** Updates playback speed multiplier (`> 0`). */
  readonly setSpeed: (speed: number) => void;
  /** Updates base step interval in milliseconds at `speed = 1`. */
  readonly setStepIntervalMs: (stepIntervalMs: number) => void;
  /** Enables or disables looping playback. */
  readonly setLoop: (loop: boolean) => void;
  /** Returns the underlying headless `SimplexTimelineController`, if attached. */
  readonly getController: () => SimplexTimelineController<TItem> | null;
}

function isControllerRef<TItem>(
  source: SimplexTimelineSource<TItem>,
): source is RefObject<SimplexTimelineHost<TItem> | null> {
  return (
    typeof source === 'object' &&
    source !== null &&
    !(source instanceof SimplexTimelineController) &&
    'current' in source
  );
}

/**
 * Declarative React hook subscribing to chronological timeline playback state and returning
 * stable control callbacks (`play`, `pause`, `toggle`, `stepBy`, `seek`, `resetToEnd`, `setSpeed`).
 *
 * Accepts either the `controllerRef` from `useSimplexGraphController()` (paired with
 * `<SimplexTopicGraph controllerRef={controllerRef} timeline={...} />`) or a standalone
 * `SimplexTimelineController` created via `createSimplexTimeline(...)`.
 */
export function useSimplexTimeline<TItem = DefaultTaggedItem>(
  source: SimplexTimelineSource<TItem>,
): UseSimplexTimelineResult<TItem> {
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const resolveTimeline = useCallback((): SimplexTimelineController<TItem> | null => {
    const current = sourceRef.current;
    if (!current) return null;
    if (current instanceof SimplexTimelineController) {
      return current;
    }
    return current.current?.getTimeline() ?? null;
  }, []);

  const [state, setState] = useState<SimplexTimelineState<TItem> | null>(() => {
    if (source instanceof SimplexTimelineController) {
      return source.getState();
    }
    if (isControllerRef(source)) {
      return source.current?.getTimeline()?.getState() ?? null;
    }
    return null;
  });

  useEffect(() => {
    if (!source) {
      setState(null);
      return;
    }

    if (source instanceof SimplexTimelineController) {
      setState(source.getState());
      return source.subscribe((next) => {
        setState(next);
      });
    }

    if (isControllerRef(source)) {
      const ctrl = source.current;
      if (ctrl) {
        return ctrl.subscribeTimeline((next) => {
          setState(next);
        });
      }
      setState(null);
    }
    return undefined;
  }, [source]);

  const play = useCallback(() => {
    resolveTimeline()?.play();
  }, [resolveTimeline]);

  const pause = useCallback(() => {
    resolveTimeline()?.pause();
  }, [resolveTimeline]);

  const toggle = useCallback(() => {
    resolveTimeline()?.toggle();
  }, [resolveTimeline]);

  const stepBy = useCallback(
    (delta: number) => {
      resolveTimeline()?.stepBy(delta);
    },
    [resolveTimeline],
  );

  const seek = useCallback(
    (step: number) => {
      resolveTimeline()?.seek(step);
    },
    [resolveTimeline],
  );

  const resetToEnd = useCallback(() => {
    resolveTimeline()?.resetToEnd();
  }, [resolveTimeline]);

  const setSpeed = useCallback(
    (speed: number) => {
      resolveTimeline()?.setSpeed(speed);
    },
    [resolveTimeline],
  );

  const setStepIntervalMs = useCallback(
    (stepIntervalMs: number) => {
      resolveTimeline()?.setStepIntervalMs(stepIntervalMs);
    },
    [resolveTimeline],
  );

  const setLoop = useCallback(
    (loop: boolean) => {
      resolveTimeline()?.setLoop(loop);
    },
    [resolveTimeline],
  );

  return {
    state,
    isReady: state !== null,
    play,
    pause,
    toggle,
    stepBy,
    seek,
    resetToEnd,
    setSpeed,
    setStepIntervalMs,
    setLoop,
    getController: resolveTimeline,
  };
}
