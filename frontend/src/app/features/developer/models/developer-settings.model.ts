export interface DeveloperSettings {
  observabilityEnabled: boolean;
  phoenixEndpoint: string;
  otlpEndpoint: string;
}

/** `saved` is the file now; `active` is what the running backend started with. */
export interface DeveloperSettingsView {
  saved: DeveloperSettings;
  active: DeveloperSettings;
  restartRequired: boolean;
}

export interface DeveloperSettingsSaveResult {
  ok: boolean;
  message: string;
  settings?: DeveloperSettingsView;
}

export interface EndpointProbeResult {
  ok: boolean;
  message: string;
}

/**
 * Mirrors the backend rule: trim, drop trailing slashes, and accept only an
 * absolute http(s) URL. Returns null when the value is not one.
 */
export function normalizeEndpoint(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
  } catch {
    return null;
  }
  return trimmed;
}
