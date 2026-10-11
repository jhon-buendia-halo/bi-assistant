/**
 * The OpenID Connect operations sign-in needs (ADR-0011). The app depends on
 * this interface only; `OpenIdClientOidcClient` implements it with
 * `openid-client`, which is ESM-only and loaded lazily, and unit tests mock
 * it. Local mode never creates one.
 */

export const OIDC_CLIENT = 'OIDC_CLIENT';

/** What the round trip must remember until the callback (admin R7). */
export interface OidcRoundTrip {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/** The ID token claims the app reads (api.md 62). */
export interface OidcClaims {
  sub: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  /** Entra ID tenant and object ids. */
  tid?: string;
  oid?: string;
  [claim: string]: unknown;
}

export interface OidcClient {
  /**
   * A fresh round trip and the identity provider's authorization URL for it
   * (code flow, PKCE S256, `state`, `nonce`). Rejects when the provider is
   * unreachable.
   */
  startSignIn(
    redirectUri: string,
  ): Promise<{ url: string; roundTrip: OidcRoundTrip }>;

  /**
   * Exchange the callback's code (with the PKCE verifier) and validate the
   * ID token: signature, issuer, audience, expiry and nonce. Rejects on any
   * failed check.
   */
  finishSignIn(callbackUrl: URL, roundTrip: OidcRoundTrip): Promise<OidcClaims>;

  /** The provider's end-session URL, or `null` when it has none. */
  endSessionUrl(postLogoutRedirectUri: string): Promise<string | null>;
}
