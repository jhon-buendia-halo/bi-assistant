// Two delivery modes share one build:
//  - Electron renderer (file:// origin): talks to the local NestJS backend that
//    the main process spawns (electron/main.cjs) on port 3000.
//  - Web mode (`npx questions-to-insights`): the backend serves this app itself,
//    so API calls are same-origin relative URLs (empty base, e.g. `/sessions`).
export const API_BASE_URL: string =
  typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? 'http://localhost:3000'
    : '';
