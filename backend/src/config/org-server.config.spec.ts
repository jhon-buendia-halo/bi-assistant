import { loadOrgServerConfig } from './org-server.config';

const FULL = {
  ORG_OIDC_ISSUER: 'https://login.microsoftonline.com/tenant/v2.0/',
  ORG_OIDC_CLIENT_ID: 'client',
  ORG_OIDC_CLIENT_SECRET: 'secret',
  ORG_PUBLIC_BASE_URL: 'https://insights.contoso.com//',
  ORG_SCIM_TOKEN: 't'.repeat(32),
};

describe('loadOrgServerConfig (admin R1-R4, R18)', () => {
  it('is local mode when no required setting is present', () => {
    expect(loadOrgServerConfig({})).toBeNull();
    expect(loadOrgServerConfig({ ORG_BOOTSTRAP_ADMINS: 'a@b.c' })).toBeNull();
    expect(loadOrgServerConfig({ ORG_SCIM_TOKEN: '   ' })).toBeNull();
  });

  it('refuses a partial configuration, naming every missing setting', () => {
    expect(() =>
      loadOrgServerConfig({ ORG_OIDC_ISSUER: FULL.ORG_OIDC_ISSUER }),
    ).toThrow(
      'missing: ORG_OIDC_CLIENT_ID, ORG_OIDC_CLIENT_SECRET, ORG_PUBLIC_BASE_URL, ORG_SCIM_TOKEN',
    );
  });

  it('refuses a short SCIM token and a base URL that is not http(s)', () => {
    expect(() =>
      loadOrgServerConfig({ ...FULL, ORG_SCIM_TOKEN: 'short' }),
    ).toThrow('ORG_SCIM_TOKEN must be at least 32 characters');
    expect(() =>
      loadOrgServerConfig({ ...FULL, ORG_PUBLIC_BASE_URL: 'ftp://x' }),
    ).toThrow('ORG_PUBLIC_BASE_URL must be an https:// URL');
  });

  it('normalises URLs, the cookie flag and the bootstrap list', () => {
    const config = loadOrgServerConfig({
      ...FULL,
      ORG_BOOTSTRAP_ADMINS: ' Alice@Contoso.com, ,bob@contoso.com ',
    });
    expect(config).toMatchObject({
      issuer: 'https://login.microsoftonline.com/tenant/v2.0',
      publicBaseUrl: 'https://insights.contoso.com',
      publicOrigin: 'https://insights.contoso.com',
      secureCookies: true,
      bootstrapAdmins: ['alice@contoso.com', 'bob@contoso.com'],
    });
    const dev = loadOrgServerConfig({
      ...FULL,
      ORG_PUBLIC_BASE_URL: 'http://127.0.0.1:4000',
    });
    expect(dev?.secureCookies).toBe(false);
  });
});
