// Two delivery modes share one build:
//  - Electron renderer (file:// origin): talks to the local NestJS backend that
//    the main process spawns (electron/main.cjs) on port 3000.
//  - Web mode (`npx questions-to-insights`): the backend serves this app itself,
//    so API calls are same-origin relative URLs (empty base, e.g. `/sessions`).
const ELECTRON_API_BASE_URL = 'http://localhost:3000';
const OVERRIDE_KEY = 'qti.apiBaseUrl';

/**
 * Where the renderer talks to. Electron always gets its spawned backend. A
 * browser session can point at another backend — to try a second build beside
 * the running app — with `?api=http://localhost:3107` once; the choice is kept
 * in localStorage for that origin, and `?api=` (empty) clears it.
 */
function resolveApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  if (window.location.protocol === 'file:') return ELECTRON_API_BASE_URL;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('api')) {
      const requested = (params.get('api') ?? '').trim().replace(/\/+$/, '');
      if (requested) {
        window.localStorage.setItem(OVERRIDE_KEY, requested);
        return requested;
      }
      window.localStorage.removeItem(OVERRIDE_KEY);
      return '';
    }
    return window.localStorage.getItem(OVERRIDE_KEY) || '';
  } catch {
    return '';
  }
}

export const API_BASE_URL: string = resolveApiBaseUrl();
