import { useCallback, useEffect, useState } from 'react';

export function useCssFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const exitFullscreen = useCallback(() => {
    setIsFullscreen(false);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;

    const root = document.documentElement;
    root.classList.add('sv-fullscreen-lock');

    function handleKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        setIsFullscreen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      root.classList.remove('sv-fullscreen-lock');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  return { isFullscreen, toggleFullscreen, exitFullscreen };
}

interface CssFullscreenButtonProps {
  readonly isFullscreen: boolean;
  readonly onToggle: () => void;
}

export function CssFullscreenButton({
  isFullscreen,
  onToggle,
}: CssFullscreenButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isFullscreen}
      aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
      title={isFullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
        isFullscreen
          ? 'border-cyan-600/60 bg-cyan-50 text-cyan-900 hover:bg-cyan-100 dark:border-cyan-400/50 dark:bg-cyan-950/60 dark:text-cyan-200 dark:hover:bg-cyan-950'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-[#0B0F17] dark:text-slate-200 dark:hover:bg-slate-800'
      }`}
    >
      {isFullscreen ? (
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
          <path d="M8 3v3a2 2 0 0 1-2 2H3" />
          <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
          <path d="M3 16h3a2 2 0 0 1 2 2v3" />
          <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
        </svg>
      ) : (
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
          <path d="M15 3h6v6" />
          <path d="M9 21H3v-6" />
          <path d="M21 3l-7 7" />
          <path d="M3 21l7-7" />
        </svg>
      )}
      <span>{isFullscreen ? 'Exit Full Screen' : 'Full Screen'}</span>
    </button>
  );
}
