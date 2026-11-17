import type { SimplexTheme } from '@simplex-viz/react';
import { useEffect, useState } from 'react';

/**
 * Synchronizes React island themes with BaseLayout's `<html class="dark">` state.
 */
export function useDocumentDarkTheme(): SimplexTheme {
  const [theme, setTheme] = useState<SimplexTheme>(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    const sync = () => {
      setTheme(
        document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      );
    };
    sync();

    const onCustom = () => sync();
    window.addEventListener('simplex-theme-change', onCustom);

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      window.removeEventListener('simplex-theme-change', onCustom);
      observer.disconnect();
    };
  }, []);

  return theme;
}
