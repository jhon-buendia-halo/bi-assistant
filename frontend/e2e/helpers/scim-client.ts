import { randomUUID } from 'node:crypto';
import type { OidcStub, StubUser } from '../../../backend/test/oidc-stub';
import { WORLD_CUP_DATASET, WORLD_CUP_DATASOURCE } from './app-actions';
import { WORLD_CUP_DB, worldCupKey } from './world-cup-db';

/**
 * Test clients for an org server (specs/system/tech-stack.md, "Org server
 * mode"): the identity provider's SCIM pushes, and an admin that assigns
 * roles and seeds shared data through the API as the bootstrap admin.
 */

/** A person the tests sign in or provision. */
export interface OrgPerson {
  email: string;
  name: string;
}

export const ADMIN: OrgPerson = {
  email: 'admin@contoso.test',
  name: 'Avery Admin',
};
export const ADA: OrgPerson = {
  email: 'ada@contoso.test',
  name: 'Ada Lovelace',
};
export const GRACE: OrgPerson = {
  email: 'grace@contoso.test',
  name: 'Grace Hopper',
};

/**
 * The stub's claims for a person. The user name (`preferred_username`, the
 * UPN) is always the email: sign-in and the bootstrap admin list match on it,
 * and SCIM provisions the same value as `userName`.
 */
export function stubUser(person: OrgPerson): StubUser {
  return {
    email: person.email,
    name: person.name,
    preferredUsername: person.email,
  };
}

/** A SCIM core User resource for `POST /scim/v2/Users`. */
export function scimUser(person: OrgPerson): Record<string, unknown> {
  const [givenName, ...rest] = person.name.split(' ');
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    userName: person.email,
    active: true,
    displayName: person.name,
    name: { givenName, familyName: rest.join(' ') },
    emails: [{ value: person.email, type: 'work', primary: true }],
    externalId: randomUUID(),
  };
}

interface ScimResource {
  id: string;
  userName?: string;
  displayName?: string;
  active?: boolean;
}

interface ScimList {
  totalResults: number;
  Resources: ScimResource[];
}

const PATCH_OP = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** The identity provider's side of SCIM 2.0 (api.md 2.14), with the token. */
export class ScimClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  /** Any SCIM call; resolves to the raw response. */
  request(path: string, method = 'GET', body?: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}/scim/v2${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined
          ? {}
          : { 'Content-Type': 'application/scim+json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async json<T>(path: string, method = 'GET', body?: unknown) {
    const res = await this.request(path, method, body);
    if (!res.ok) {
      throw new Error(
        `SCIM ${method} ${path} → HTTP ${res.status}: ${await res.text()}`,
      );
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** Provisions a person; resolves to their directory id. */
  async createUser(person: OrgPerson): Promise<string> {
    const user = await this.json<ScimResource>(
      '/Users',
      'POST',
      scimUser(person),
    );
    return user.id;
  }

  /** The SCIM user with this user name, or null. */
  async findUser(email: string): Promise<ScimResource | null> {
    const filter = encodeURIComponent(`userName eq "${email}"`);
    const list = await this.json<ScimList>(`/Users?filter=${filter}`);
    return list.Resources[0] ?? null;
  }

  /** The person's directory id, provisioning them first when needed. */
  async ensureUser(person: OrgPerson): Promise<string> {
    return (await this.findUser(person.email))?.id ?? this.createUser(person);
  }

  /** Sets `active` (false deactivates, admin R16). */
  async setActive(email: string, active: boolean): Promise<void> {
    const user = await this.findUser(email);
    if (!user) throw new Error(`No SCIM user ${email}`);
    await this.json(`/Users/${user.id}`, 'PATCH', {
      schemas: [PATCH_OP],
      Operations: [{ op: 'replace', path: 'active', value: active }],
    });
  }

  deactivate(email: string): Promise<void> {
    return this.setActive(email, false);
  }

  async deleteUser(email: string): Promise<void> {
    const user = await this.findUser(email);
    if (!user) throw new Error(`No SCIM user ${email}`);
    await this.json(`/Users/${user.id}`, 'DELETE');
  }

  /** Creates a group with these directory user ids; resolves to its id. */
  async createGroup(name: string, memberIds: string[] = []): Promise<string> {
    const group = await this.json<ScimResource>('/Groups', 'POST', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      displayName: name,
      externalId: randomUUID(),
      members: memberIds.map((value) => ({ value })),
    });
    return group.id;
  }

  async addMembers(groupId: string, memberIds: string[]): Promise<void> {
    await this.json(`/Groups/${groupId}`, 'PATCH', {
      schemas: [PATCH_OP],
      Operations: [
        {
          op: 'add',
          path: 'members',
          value: memberIds.map((value) => ({ value })),
        },
      ],
    });
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.json(`/Groups/${groupId}`, 'DELETE');
  }
}

/** The `name=value` pair of a `Set-Cookie` header named `name`. */
function cookieFrom(res: Response, name: string): string | null {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const eq = pair.indexOf('=');
    if (pair.slice(0, eq).trim() === name) {
      const value = pair.slice(eq + 1).trim();
      return value ? `${name}=${value}` : null;
    }
  }
  return null;
}

type RoleId = 'maker' | 'data-owner' | 'approver' | 'platform-admin';

interface StyleA {
  ok: boolean;
  message: string;
}

/**
 * The bootstrap admin, calling the API directly: role assignments
 * (`/admin/role-assignments`) and the shared World Cup datasource and dataset.
 * It signs in through the real round trip on first use, so it changes who
 * the stub signs in next; UI sign-ins always choose their own person.
 */
export class AdminClient {
  private cookie: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly stub: OidcStub,
    private readonly scim: ScimClient,
    private readonly person: OrgPerson = ADMIN,
  ) {}

  private async signIn(): Promise<string> {
    this.stub.signInAs(stubUser(this.person));
    const login = await fetch(`${this.baseUrl}/auth/login`, {
      redirect: 'manual',
    });
    const oidc = cookieFrom(login, 'qti_oidc');
    const authorize = await fetch(login.headers.get('location') ?? '', {
      redirect: 'manual',
    });
    const callback = await fetch(authorize.headers.get('location') ?? '', {
      redirect: 'manual',
      headers: oidc ? { Cookie: oidc } : {},
    });
    const cookie = cookieFrom(callback, 'qti_session');
    if (!cookie) {
      throw new Error(
        `Admin sign-in failed: redirected to ${callback.headers.get('location')}`,
      );
    }
    return cookie;
  }

  /** A JSON call as the admin, with the Origin the server checks (R27). */
  async call<T extends StyleA>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    this.cookie ??= await this.signIn();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Cookie: this.cookie,
        Origin: this.baseUrl,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${method} ${path} → HTTP ${res.status}: ${text}`);
    }
    const parsed = JSON.parse(text) as T;
    if (parsed.ok === false) {
      throw new Error(`${method} ${path}: ${parsed.message}`);
    }
    return parsed;
  }

  /**
   * Gives a person a direct role, provisioning them through SCIM first when
   * they are not in the directory yet. Resolves to the assignment id.
   */
  async assignRole(
    person: OrgPerson,
    role: RoleId,
    datasourceId?: string,
  ): Promise<string> {
    const userId = await this.scim.ensureUser(person);
    const { assignment } = await this.call<
      StyleA & { assignment: { id: string } }
    >('POST', '/admin/role-assignments', {
      userId,
      role,
      ...(datasourceId ? { datasourceId } : {}),
    });
    return assignment.id;
  }

  /** Removes a person's direct role assignment. */
  async removeRole(person: OrgPerson, role: RoleId): Promise<void> {
    // Assigning again answers the existing assignment (api.md 79).
    const id = await this.assignRole(person, role);
    await this.call(
      'DELETE',
      `/admin/role-assignments/${encodeURIComponent(id)}`,
    );
  }

  /**
   * Saves the shared World Cup datasource and the "World Cup Core" dataset
   * over `matches`; resolves to the datasource id.
   */
  async seedWorldCup(): Promise<string> {
    const { datasource } = await this.call<
      StyleA & { datasource: { id: string } }
    >('POST', '/datasources', {
      kind: 'postgres',
      name: WORLD_CUP_DATASOURCE,
      config: { ...WORLD_CUP_DB, ssl: false },
    });
    const key = worldCupKey('matches');
    await this.call('POST', '/datasets', {
      name: WORLD_CUP_DATASET,
      tables: [key],
      entities: [
        {
          key,
          columns: [{ name: 'match_number', type: 'integer', nullable: false }],
        },
      ],
      datasourceId: datasource.id,
      datasourceKind: 'postgres',
    });
    return datasource.id;
  }
}
