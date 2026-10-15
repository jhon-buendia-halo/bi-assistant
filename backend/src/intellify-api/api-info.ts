/**
 * The only in-process link between the app and the embedded Intellify RFP API
 * (ADR-0027): where the API listens and the key it accepts. The bootstrap sets
 * it once the API is listening; the Testing Data loader reads it to register
 * the API as a REST datasource. Everything else goes over HTTP.
 */
export interface IntellifyApiInfo {
  /** Base URL without a trailing slash, e.g. `http://127.0.0.1:3100`. */
  url: string;
  /** A key the API accepts in `X-API-Key`. */
  apiKey: string;
}

let current: IntellifyApiInfo | null = null;

export function setIntellifyApiInfo(info: IntellifyApiInfo | null): void {
  current = info;
}

/** `null` when the embedded API is off or failed to start. */
export function getIntellifyApiInfo(): IntellifyApiInfo | null {
  return current;
}
