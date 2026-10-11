/**
 * Org server configuration (admin R1-R4, R18; api.md 1.9 and 6.1; ADR-0010;
 * non-functional N77).
 * Read once at startup from the `ORG_*` environment. None of the required
 * variables set means local mode; some but not all is a startup error that
 * names the missing ones, so a server never falls back to local mode by
 * accident. Free of Nest imports so entry points can use it before bootstrap.
 */

/** Injection token of the `OrgServerConfig` (or `null` in local mode). */
export const ORG_SERVER_CONFIG = 'ORG_SERVER_CONFIG';

export interface OrgServerConfig {
  /** `ORG_OIDC_ISSUER`, without trailing slashes. Names one tenant (R3). */
  issuer: string;
  /**
   * The tenant id the issuer names: its first path segment when that is a
   * GUID (Entra ID, `https://login.microsoftonline.com/<tenant id>/v2.0`),
   * lowercased; `null` for another issuer. A token whose `tid` differs fails
   * sign-in (R7).
   */
  tenantId: string | null;
  clientId: string;
  /** Never logged. */
  clientSecret: string;
  /** `ORG_PUBLIC_BASE_URL`, without trailing slashes. */
  publicBaseUrl: string;
  /** The origin of the public base URL, for the Origin check (R27). */
  publicOrigin: string;
  /** Cookies are `Secure` unless the public base URL is `http://` (R8). */
  secureCookies: boolean;
  /** Never logged. */
  scimToken: string;
  /**
   * `ORG_BOOTSTRAP_ADMINS`: user names (Entra ID UPNs), lowercased, blanks
   * dropped (R18). Matched against `userName`, never the email.
   */
  bootstrapAdmins: string[];
}

export const REQUIRED_ORG_SETTINGS = [
  'ORG_OIDC_ISSUER',
  'ORG_OIDC_CLIENT_ID',
  'ORG_OIDC_CLIENT_SECRET',
  'ORG_PUBLIC_BASE_URL',
  'ORG_SCIM_TOKEN',
] as const;

/** The SCIM token's minimum length (non-functional N73). */
export const MIN_SCIM_TOKEN_LENGTH = 32;

/** Entra ID's shared endpoints, which accept any tenant's accounts (N77). */
const MULTI_TENANT_SEGMENTS = new Set(['common', 'organizations', 'consumers']);

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OrgServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrgServerConfigError';
  }
}

function httpUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OrgServerConfigError(`${name} must be a URL, got "${value}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new OrgServerConfigError(`${name} must be an https:// URL`);
  }
  return url;
}

/**
 * The org server configuration, or `null` for local mode. Throws an
 * `OrgServerConfigError` on a partial or invalid configuration.
 */
export function loadOrgServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): OrgServerConfig | null {
  const read = (name: string) => env[name]?.trim() || undefined;
  const missing = REQUIRED_ORG_SETTINGS.filter((name) => !read(name));
  if (missing.length === REQUIRED_ORG_SETTINGS.length) return null;
  if (missing.length) {
    throw new OrgServerConfigError(
      `Org server mode needs every required ORG_* setting; missing: ${missing.join(', ')}`,
    );
  }

  const issuer = read('ORG_OIDC_ISSUER')!.replace(/\/+$/, '');
  const issuerUrl = httpUrl('ORG_OIDC_ISSUER', issuer);
  // The tenant segment of a login.microsoftonline.com-style issuer.
  const tenant = issuerUrl.pathname.split('/').find(Boolean) ?? '';
  if (MULTI_TENANT_SEGMENTS.has(tenant.toLowerCase())) {
    throw new OrgServerConfigError(
      `ORG_OIDC_ISSUER must name one tenant (https://login.microsoftonline.com/<tenant id>/v2.0), not "${tenant}"`,
    );
  }
  const publicBaseUrl = read('ORG_PUBLIC_BASE_URL')!.replace(/\/+$/, '');
  const base = httpUrl('ORG_PUBLIC_BASE_URL', publicBaseUrl);
  const scimToken = read('ORG_SCIM_TOKEN')!;
  if (scimToken.length < MIN_SCIM_TOKEN_LENGTH) {
    throw new OrgServerConfigError(
      `ORG_SCIM_TOKEN must be at least ${MIN_SCIM_TOKEN_LENGTH} characters`,
    );
  }

  return {
    issuer,
    tenantId: GUID.test(tenant) ? tenant.toLowerCase() : null,
    clientId: read('ORG_OIDC_CLIENT_ID')!,
    clientSecret: read('ORG_OIDC_CLIENT_SECRET')!,
    publicBaseUrl,
    publicOrigin: base.origin,
    secureCookies: base.protocol === 'https:',
    scimToken,
    bootstrapAdmins: (env.ORG_BOOTSTRAP_ADMINS ?? '')
      .split(',')
      .map((userName) => userName.trim().toLowerCase())
      .filter(Boolean),
  };
}
