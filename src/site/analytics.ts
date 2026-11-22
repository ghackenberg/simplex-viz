import { init } from '@plausible-analytics/tracker';

export const PLAUSIBLE_DOMAIN = 'hackenberg.tech/simplex-viz';
export const PLAUSIBLE_ENDPOINT = 'https://analytics.mentawise.com/api/event';
export const PLAUSIBLE_IGNORE_KEY = 'plausible_ignore';

let initialized = false;

/**
 * Checks whether the visitor has opted out of Plausible Analytics in localStorage.
 */
export function isPlausibleOptedOut(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PLAUSIBLE_IGNORE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Persists the visitor's analytics opt-out preference using Plausible's native
 * `plausible_ignore` localStorage key and initializes tracking immediately when re-enabled.
 */
export function setPlausibleOptOut(optOut: boolean): boolean {
  if (typeof window === 'undefined') return optOut;
  try {
    if (optOut) {
      window.localStorage.setItem(PLAUSIBLE_IGNORE_KEY, 'true');
    } else {
      window.localStorage.removeItem(PLAUSIBLE_IGNORE_KEY);
      initPlausibleAnalytics();
    }
  } catch {
    // Ignore storage access errors in restricted private browsing modes
  }

  const nextState = isPlausibleOptedOut();
  window.dispatchEvent(
    new CustomEvent('simplex-analytics-change', {
      detail: { optedOut: nextState },
    }),
  );
  return nextState;
}

/**
 * Initializes cookieless Plausible Analytics tracking once per browser session,
 * unless the visitor has opted out via `plausible_ignore`.
 */
export function initPlausibleAnalytics(): void {
  if (typeof window === 'undefined' || initialized || isPlausibleOptedOut()) {
    return;
  }
  initialized = true;
  init({
    domain: PLAUSIBLE_DOMAIN,
    endpoint: PLAUSIBLE_ENDPOINT,
    outboundLinks: true,
    logging: false,
  });
}
