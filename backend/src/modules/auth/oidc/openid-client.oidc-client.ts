import type { OrgServerConfig } from '../../../config/org-server.config';
import type { OidcClaims, OidcClient, OidcRoundTrip } from './oidc-client';

type OpenIdClient = typeof import('openid-client');
type Configuration = import('openid-client').Configuration;

/**
 * `OidcClient` on `openid-client@6` (ADR-0011). The library is ESM-only, so it
 * is imported with `await import()` on first use; local mode never gets here.
 * Discovery is cached once it succeeds and retried after a failure.
 */
export class OpenIdClientOidcClient implements OidcClient {
  private lib?: Promise<OpenIdClient>;
  private configuration?: Promise<Configuration>;

  constructor(
    private readonly config: Pick<
      OrgServerConfig,
      'issuer' | 'clientId' | 'clientSecret'
    >,
  ) {}

  async startSignIn(
    redirectUri: string,
  ): Promise<{ url: string; roundTrip: OidcRoundTrip }> {
    const client = await this.client();
    const configuration = await this.discover();
    const roundTrip: OidcRoundTrip = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      codeVerifier: client.randomPKCECodeVerifier(),
    };
    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      response_type: 'code',
      code_challenge: await client.calculatePKCECodeChallenge(
        roundTrip.codeVerifier,
      ),
      code_challenge_method: 'S256',
      state: roundTrip.state,
      nonce: roundTrip.nonce,
    });
    return { url: url.href, roundTrip };
  }

  async finishSignIn(
    callbackUrl: URL,
    roundTrip: OidcRoundTrip,
  ): Promise<OidcClaims> {
    const client = await this.client();
    const configuration = await this.discover();
    const tokens = await client.authorizationCodeGrant(
      configuration,
      callbackUrl,
      {
        pkceCodeVerifier: roundTrip.codeVerifier,
        expectedState: roundTrip.state,
        expectedNonce: roundTrip.nonce,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();
    if (!claims) throw new Error('The identity provider sent no ID token');
    return claims;
  }

  async endSessionUrl(postLogoutRedirectUri: string): Promise<string | null> {
    try {
      const client = await this.client();
      const configuration = await this.discover();
      if (!configuration.serverMetadata().end_session_endpoint) return null;
      return client.buildEndSessionUrl(configuration, {
        client_id: this.config.clientId,
        post_logout_redirect_uri: postLogoutRedirectUri,
      }).href;
    } catch {
      return null;
    }
  }

  private client(): Promise<OpenIdClient> {
    this.lib ??= import('openid-client');
    return this.lib;
  }

  private discover(): Promise<Configuration> {
    if (!this.configuration) {
      this.configuration = this.client().then((client) =>
        client.discovery(
          new URL(this.config.issuer),
          this.config.clientId,
          this.config.clientSecret,
          undefined,
          // A plain-http issuer is only for development and tests (admin R4).
          this.config.issuer.startsWith('http://')
            ? { execute: [client.allowInsecureRequests] }
            : undefined,
        ),
      );
      this.configuration.catch(() => {
        this.configuration = undefined;
      });
    }
    return this.configuration;
  }
}
