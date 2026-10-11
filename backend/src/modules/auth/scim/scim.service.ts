import { Inject, Injectable } from '@nestjs/common';
import {
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../../config/org-server.config';
import { ActivityService } from '../activity.service';
import { AuthSessionsService } from '../auth-sessions.service';
import type { GroupDoc, UserDoc } from '../entities/directory.entity';
import { DirectoryRepository } from '../repositories/directory.repository';
import { RolesRepository } from '../repositories/roles.repository';
import { ScimError } from './scim-error';

export const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** The `count` default and maximum (api.md 2.14). */
export const MAX_RESULTS = 100;

export interface ScimMeta {
  resourceType: 'User' | 'Group';
  created?: string;
  lastModified?: string;
  location: string;
}

export interface ScimUserResource {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  name: { givenName?: string; familyName?: string };
  displayName: string;
  emails: { value: string; type: 'work'; primary: true }[];
  active: boolean;
  meta: ScimMeta;
}

export interface ScimGroupResource {
  schemas: string[];
  id: string;
  externalId?: string;
  displayName: string;
  members?: { value: string; display?: string }[];
  meta: ScimMeta;
}

export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimListQuery {
  filter?: string;
  startIndex?: string;
  count?: string;
  excludedAttributes?: string;
}

/** The SCIM attributes of a user the app keeps (api.md 2.14). */
interface UserAttributes {
  userName?: string;
  externalId?: string;
  active?: boolean;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  formatted?: string;
  email?: string;
}

interface PatchOperation {
  op: 'add' | 'replace' | 'remove';
  path?: string;
  value?: unknown;
}

const USER_PATH_PREFIX = `${USER_SCHEMA.toLowerCase()}:`;
const GROUP_PATH_PREFIX = `${GROUP_SCHEMA.toLowerCase()}:`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Entra ID sends booleans as `"True"` / `"False"` strings. */
function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  throw new ScimError(400, 'active must be true or false', 'invalidValue');
}

/** The work email of an `emails` array: `type eq "work"`, else primary, else first. */
function workEmail(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const emails = value.filter(isObject);
  const pick =
    emails.find((e) => e.type === 'work') ??
    emails.find((e) => e.primary === true || e.primary === 'True') ??
    emails[0];
  return text(pick?.value);
}

function parseFilter(
  filter: string | undefined,
  attributes: string[],
): { attribute: string; value: string } | null {
  if (filter === undefined || !filter.trim()) return null;
  const match = /^\s*([A-Za-z.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  const attribute = attributes.find(
    (a) => a.toLowerCase() === match?.[1].toLowerCase(),
  );
  if (!match || !attribute) {
    throw new ScimError(
      400,
      `Unsupported filter: only ${attributes.map((a) => `${a} eq "<value>"`).join(' or ')}`,
      'invalidFilter',
    );
  }
  return { attribute, value: match[2].replace(/\\(.)/g, '$1') };
}

function readOperations(body: unknown): PatchOperation[] {
  const operations = isObject(body) ? body.Operations : undefined;
  if (!Array.isArray(operations)) {
    throw new ScimError(400, 'Operations must be a list', 'invalidSyntax');
  }
  return operations.map((raw) => {
    const op =
      isObject(raw) && typeof raw.op === 'string' ? raw.op.toLowerCase() : '';
    if (op !== 'add' && op !== 'replace' && op !== 'remove') {
      throw new ScimError(
        400,
        `Unsupported op: ${String(isObject(raw) ? raw.op : raw)}`,
        'invalidSyntax',
      );
    }
    return {
      op,
      path:
        isObject(raw) && typeof raw.path === 'string'
          ? raw.path.trim()
          : undefined,
      value: isObject(raw) ? raw.value : undefined,
    };
  });
}

/**
 * The SCIM 2.0 subset Microsoft Entra ID's provisioning service sends
 * (admin R14-R17; api.md 2.14; ADR-0011), on the directory collections.
 */
@Injectable()
export class ScimService {
  constructor(
    @Inject(ORG_SERVER_CONFIG) private readonly config: OrgServerConfig,
    private readonly directory: DirectoryRepository,
    private readonly roles: RolesRepository,
    private readonly sessions: AuthSessionsService,
    private readonly activity: ActivityService,
  ) {}

  location(kind: 'Users' | 'Groups', id: string): string {
    return `${this.config.publicBaseUrl}/scim/v2/${kind}/${id}`;
  }

  // Users

  async listUsers(
    query: ScimListQuery,
  ): Promise<ScimListResponse<ScimUserResource>> {
    const filter = parseFilter(query.filter, ['userName', 'externalId']);
    let users = (await this.directory.allUsers()).filter((u) => !u.scimDeleted);
    if (filter?.attribute === 'userName') {
      users = users.filter((u) => u.userName === filter.value.toLowerCase());
    } else if (filter?.attribute === 'externalId') {
      users = users.filter((u) => u.externalId === filter.value);
    }
    return this.page(
      users.map((u) => this.renderUser(u)),
      query,
    );
  }

  async getUser(id: string): Promise<ScimUserResource> {
    return this.renderUser(await this.visibleUser(id));
  }

  async createUser(body: unknown): Promise<ScimUserResource> {
    const input = this.readUser(body);
    const userName = this.requireUserName(input.userName);
    let existing = await this.directory.userByUserName(userName);
    if (existing && this.isSomeoneElse(existing, input.externalId)) {
      await this.release(existing);
      existing = null;
    }
    if (existing && !existing.scimDeleted) {
      throw new ScimError(409, `User ${userName} already exists`, 'uniqueness');
    }
    const fields = this.userFields({ ...input, userName });
    if (existing) {
      // A user removed through SCIM comes back under the same id (api.md 2.14).
      await this.directory.unsetUserField(existing.id, 'scimDeleted');
      const user = await this.save(existing, {
        ...fields,
        active: input.active ?? true,
      });
      return this.renderUser(user);
    }
    const user = await this.directory.insertUser({
      ...fields,
      active: input.active ?? true,
      source: 'scim',
    });
    return this.renderUser(user);
  }

  async replaceUser(id: string, body: unknown): Promise<ScimUserResource> {
    const user = await this.visibleUser(id);
    const input = this.readUser(body);
    const userName = this.requireUserName(input.userName);
    await this.assertUserNameFree(userName, user.id);
    for (const field of [
      'externalId',
      'givenName',
      'familyName',
      'email',
    ] as const) {
      if (input[field] === undefined && user[field] !== undefined) {
        await this.directory.unsetUserField(user.id, field);
        delete user[field];
      }
    }
    const saved = await this.save(user, {
      ...this.userFields({ ...input, userName }),
      active: input.active ?? user.active,
    });
    return this.renderUser(saved);
  }

  async patchUser(id: string, body: unknown): Promise<ScimUserResource> {
    const user = await this.visibleUser(id);
    const working: UserAttributes = {
      userName: user.userName,
      externalId: user.externalId,
      active: user.active,
      displayName: user.displayName,
      givenName: user.givenName,
      familyName: user.familyName,
      email: user.email,
    };
    for (const operation of readOperations(body)) {
      if (operation.path) {
        this.applyUserPath(working, operation);
      } else if (operation.op !== 'remove' && isObject(operation.value)) {
        Object.assign(working, this.readUser(operation.value));
      } else {
        throw new ScimError(
          400,
          'A patch operation needs a path or an object value',
          'invalidSyntax',
        );
      }
    }
    const userName = this.requireUserName(working.userName);
    await this.assertUserNameFree(userName, user.id);
    for (const field of [
      'externalId',
      'givenName',
      'familyName',
      'email',
    ] as const) {
      if (working[field] === undefined && user[field] !== undefined) {
        await this.directory.unsetUserField(user.id, field);
        delete user[field];
      }
    }
    const saved = await this.save(user, {
      ...this.userFields({ ...working, userName }),
      active: working.active ?? user.active,
    });
    return this.renderUser(saved);
  }

  /**
   * Whether a create of `user`'s name is for a different person (admin R16;
   * api.md 2.14): `user` was removed through SCIM, or is deactivated and has
   * signed in, and both carry an `externalId` and the two differ. Without an
   * `externalId` on either side the old user comes back as before.
   */
  private isSomeoneElse(user: UserDoc, externalId?: string): boolean {
    const gone = !!user.scimDeleted || (!user.active && !!user.oidcSubject);
    return (
      gone &&
      !!externalId &&
      !!user.externalId &&
      user.externalId !== externalId
    );
  }

  /** Free the name; the user keeps its id, data and ownership (R16). */
  private async release(user: UserDoc): Promise<void> {
    await this.directory.releaseUserName(user);
    await this.sessions.endAllOf(user.id);
    await this.directory.removeFromAllGroups(user.id);
  }

  /** Deactivate, hide from SCIM, end sessions, leave groups (api.md 2.14). */
  async deleteUser(id: string): Promise<void> {
    const user = await this.visibleUser(id);
    await this.directory.updateUser(user.id, {
      active: false,
      scimDeleted: true,
    });
    await this.sessions.endAllOf(user.id);
    await this.directory.removeFromAllGroups(user.id);
    if (user.active) {
      await this.activity.record('user.deactivated', { subjectId: user.id });
    }
  }

  // Groups

  async listGroups(
    query: ScimListQuery,
  ): Promise<ScimListResponse<ScimGroupResource>> {
    const filter = parseFilter(query.filter, ['displayName', 'externalId']);
    let groups = await this.directory.allGroups();
    if (filter?.attribute === 'displayName') {
      const wanted = filter.value.toLowerCase();
      groups = groups.filter((g) => g.displayName.toLowerCase() === wanted);
    } else if (filter?.attribute === 'externalId') {
      groups = groups.filter((g) => g.externalId === filter.value);
    }
    const withMembers = !this.excludesMembers(query.excludedAttributes);
    const resources = await Promise.all(
      groups.map((g) => this.renderGroup(g, withMembers)),
    );
    return this.page(resources, query);
  }

  async getGroup(
    id: string,
    excludedAttributes?: string,
  ): Promise<ScimGroupResource> {
    return this.renderGroup(
      await this.existingGroup(id),
      !this.excludesMembers(excludedAttributes),
    );
  }

  async createGroup(body: unknown): Promise<ScimGroupResource> {
    const value = isObject(body) ? body : {};
    const displayName = text(value.displayName);
    if (!displayName) {
      throw new ScimError(400, 'displayName is required', 'invalidValue');
    }
    await this.assertGroupNameFree(displayName);
    const group = await this.directory.insertGroup({
      displayName,
      ...(text(value.externalId) ? { externalId: text(value.externalId) } : {}),
    });
    await this.addMembers(group.id, value.members);
    return this.renderGroup(group, true);
  }

  async patchGroup(id: string, body: unknown): Promise<ScimGroupResource> {
    let group = await this.existingGroup(id);
    for (const { op, path, value } of readOperations(body)) {
      const attribute = path?.toLowerCase().replace(GROUP_PATH_PREFIX, '');
      if (!attribute) {
        if (op === 'remove' || !isObject(value)) {
          throw new ScimError(
            400,
            'A patch operation needs a path or an object value',
            'invalidSyntax',
          );
        }
        if (value.displayName !== undefined)
          group = await this.renameGroup(group, value.displayName);
        if (value.externalId !== undefined)
          group = await this.setGroupExternalId(group, value.externalId);
        if (value.members !== undefined) {
          await this.directory.removeAllMembers(group.id);
          await this.addMembers(group.id, value.members);
        }
        continue;
      }
      const memberFilter = /^members\[\s*value\s+eq\s+"([^"]*)"\s*\]$/i.exec(
        path ?? '',
      );
      if (memberFilter) {
        if (op !== 'remove') {
          throw new ScimError(
            400,
            `Unsupported path for ${op}: ${path}`,
            'invalidPath',
          );
        }
        await this.directory.removeMember(group.id, memberFilter[1]);
      } else if (attribute === 'members') {
        if (op === 'add') {
          await this.addMembers(group.id, value);
        } else if (op === 'replace') {
          await this.directory.removeAllMembers(group.id);
          await this.addMembers(group.id, value);
        } else if (Array.isArray(value)) {
          for (const member of value.filter(isObject)) {
            if (typeof member.value === 'string') {
              await this.directory.removeMember(group.id, member.value);
            }
          }
        } else {
          await this.directory.removeAllMembers(group.id);
        }
      } else if (attribute === 'displayname') {
        if (op === 'remove') {
          throw new ScimError(400, 'displayName is required', 'invalidValue');
        }
        group = await this.renameGroup(group, value);
      } else if (attribute === 'externalid') {
        group = await this.setGroupExternalId(
          group,
          op === 'remove' ? undefined : value,
        );
      }
      // Other attributes are accepted and ignored.
    }
    return this.renderGroup(group, true);
  }

  /** The group, its memberships and its group mappings go (admin R17). */
  async deleteGroup(id: string): Promise<void> {
    const group = await this.existingGroup(id);
    await this.directory.removeAllMembers(group.id);
    await this.roles.deleteMappingsOf(group.id);
    await this.directory.deleteGroup(group.id);
  }

  // Helpers

  private page<T>(all: T[], query: ScimListQuery): ScimListResponse<T> {
    const startIndex = Math.max(
      1,
      Number.parseInt(query.startIndex ?? '1', 10) || 1,
    );
    const requested = Number.parseInt(query.count ?? `${MAX_RESULTS}`, 10);
    const count = Number.isNaN(requested)
      ? MAX_RESULTS
      : Math.min(MAX_RESULTS, Math.max(0, requested));
    const Resources = all.slice(startIndex - 1, startIndex - 1 + count);
    return {
      schemas: [LIST_SCHEMA],
      totalResults: all.length,
      startIndex,
      itemsPerPage: Resources.length,
      Resources,
    };
  }

  private excludesMembers(excluded: string | undefined): boolean {
    return (excluded ?? '')
      .split(',')
      .some((a) => a.trim().toLowerCase() === 'members');
  }

  /** A user SCIM can see: in the directory and not removed through SCIM. */
  private async visibleUser(id: string): Promise<UserDoc> {
    const user = await this.directory.userById(id);
    if (!user || user.scimDeleted) {
      throw new ScimError(404, `User ${id} not found`);
    }
    return user;
  }

  private async existingGroup(id: string): Promise<GroupDoc> {
    const group = await this.directory.groupById(id);
    if (!group) throw new ScimError(404, `Group ${id} not found`);
    return group;
  }

  private requireUserName(userName: string | undefined): string {
    if (!userName)
      throw new ScimError(400, 'userName is required', 'invalidValue');
    return userName.toLowerCase();
  }

  private async assertUserNameFree(
    userName: string,
    ownId: string,
  ): Promise<void> {
    const other = await this.directory.userByUserName(userName);
    if (other && other.id !== ownId) {
      throw new ScimError(409, `User ${userName} already exists`, 'uniqueness');
    }
  }

  private async assertGroupNameFree(
    displayName: string,
    ownId?: string,
  ): Promise<void> {
    const other = await this.directory.groupByDisplayName(displayName);
    if (other && other.id !== ownId) {
      throw new ScimError(
        409,
        `Group ${displayName} already exists`,
        'uniqueness',
      );
    }
  }

  private async renameGroup(
    group: GroupDoc,
    value: unknown,
  ): Promise<GroupDoc> {
    const displayName = text(value);
    if (!displayName)
      throw new ScimError(400, 'displayName is required', 'invalidValue');
    await this.assertGroupNameFree(displayName, group.id);
    return (
      (await this.directory.updateGroup(group.id, { displayName })) ?? group
    );
  }

  private async setGroupExternalId(
    group: GroupDoc,
    value: unknown,
  ): Promise<GroupDoc> {
    const externalId = text(value);
    if (externalId) {
      return (
        (await this.directory.updateGroup(group.id, { externalId })) ?? group
      );
    }
    return (
      (await this.directory.unsetGroupField(group.id, 'externalId')) ?? group
    );
  }

  /** Add `[{ value: <user id> }]`; ids that name no visible user are ignored. */
  private async addMembers(groupId: string, members: unknown): Promise<void> {
    if (members === undefined) return;
    if (!Array.isArray(members)) {
      throw new ScimError(400, 'members must be a list', 'invalidValue');
    }
    for (const member of members.filter(isObject)) {
      if (typeof member.value !== 'string') continue;
      const user = await this.directory.userById(member.value);
      if (user && !user.scimDeleted) {
        await this.directory.addMember(groupId, user.id);
      }
    }
  }

  /** The supported attributes of a SCIM User object (others are ignored). */
  private readUser(body: unknown): UserAttributes {
    if (!isObject(body)) {
      throw new ScimError(400, 'The body must be a SCIM User', 'invalidSyntax');
    }
    const input: UserAttributes = {};
    for (const [rawKey, value] of Object.entries(body)) {
      const key = rawKey.toLowerCase().replace(USER_PATH_PREFIX, '');
      this.applyUserAttribute(input, key, value);
    }
    return input;
  }

  private applyUserAttribute(
    input: UserAttributes,
    key: string,
    value: unknown,
  ): void {
    switch (key) {
      case 'username':
        input.userName = text(value);
        break;
      case 'externalid':
        input.externalId = text(value);
        break;
      case 'active':
        input.active = bool(value);
        break;
      case 'displayname':
        input.displayName = text(value);
        break;
      case 'name':
        if (isObject(value)) {
          for (const [part, partValue] of Object.entries(value)) {
            this.applyUserAttribute(
              input,
              `name.${part.toLowerCase()}`,
              partValue,
            );
          }
        }
        break;
      case 'name.givenname':
        input.givenName = text(value);
        break;
      case 'name.familyname':
        input.familyName = text(value);
        break;
      case 'name.formatted':
        input.formatted = text(value);
        break;
      case 'emails':
        input.email = workEmail(value);
        break;
      case 'emails[type eq "work"].value':
        input.email = text(value);
        break;
      default:
      // Accepted and ignored (api.md 2.14). A full resource also carries
      // `schemas`, `id` and `meta`.
    }
  }

  private applyUserPath(
    working: UserAttributes,
    { op, path, value }: PatchOperation,
  ): void {
    const key = (path ?? '')
      .toLowerCase()
      .replace(USER_PATH_PREFIX, '')
      .replace(/\s+/g, ' ');
    if (op === 'remove') {
      if (key === 'username' || key === 'active') {
        throw new ScimError(400, `${path} cannot be removed`, 'invalidValue');
      }
      this.applyUserAttribute(working, key, undefined);
      return;
    }
    this.applyUserAttribute(working, key, value);
  }

  /** The stored fields for these attributes (data-model 3.14.1). */
  private userFields(
    input: UserAttributes & { userName: string },
  ): Omit<UserDoc, 'id' | 'active' | 'source'> {
    const fields: Omit<UserDoc, 'id' | 'active' | 'source'> = {
      userName: input.userName,
      displayName:
        input.displayName ??
        input.formatted ??
        ([input.givenName, input.familyName].filter(Boolean).join(' ') ||
          input.userName),
    };
    if (input.externalId) fields.externalId = input.externalId;
    if (input.givenName) fields.givenName = input.givenName;
    if (input.familyName) fields.familyName = input.familyName;
    if (input.email) fields.email = input.email.toLowerCase();
    return fields;
  }

  /**
   * Write a user's new fields. A SCIM write makes a just-in-time user a
   * provisioned one, and a change of `active` ends sessions or records the
   * reactivation (admin R16).
   */
  private async save(
    user: UserDoc,
    fields: Omit<UserDoc, 'id' | 'source'>,
  ): Promise<UserDoc> {
    const saved =
      (await this.directory.updateUser(user.id, {
        ...fields,
        source: 'scim',
      })) ?? user;
    const wasActive = user.active && !user.scimDeleted;
    if (wasActive && !saved.active) {
      await this.sessions.endAllOf(user.id);
      await this.activity.record('user.deactivated', { subjectId: user.id });
    } else if (!wasActive && saved.active) {
      await this.activity.record('user.reactivated', { subjectId: user.id });
    }
    return saved;
  }

  private renderUser(user: UserDoc): ScimUserResource {
    const resource: ScimUserResource = {
      schemas: [USER_SCHEMA],
      id: user.id,
      userName: user.userName,
      name: {},
      displayName: user.displayName,
      emails: user.email
        ? [{ value: user.email, type: 'work', primary: true }]
        : [],
      active: user.active,
      meta: {
        resourceType: 'User',
        created: user.createdAt,
        lastModified: user.updatedAt,
        location: this.location('Users', user.id),
      },
    };
    if (user.externalId) resource.externalId = user.externalId;
    if (user.givenName) resource.name.givenName = user.givenName;
    if (user.familyName) resource.name.familyName = user.familyName;
    return resource;
  }

  private async renderGroup(
    group: GroupDoc,
    withMembers: boolean,
  ): Promise<ScimGroupResource> {
    const resource: ScimGroupResource = {
      schemas: [GROUP_SCHEMA],
      id: group.id,
      displayName: group.displayName,
      meta: {
        resourceType: 'Group',
        created: group.createdAt,
        lastModified: group.updatedAt,
        location: this.location('Groups', group.id),
      },
    };
    if (group.externalId) resource.externalId = group.externalId;
    if (withMembers) {
      const members: { value: string; display?: string }[] = [];
      for (const member of await this.directory.membersOf(group.id)) {
        const user = await this.directory.userById(member.userId);
        if (user && !user.scimDeleted) {
          members.push({ value: user.id, display: user.displayName });
        }
      }
      resource.members = members;
    }
    return resource;
  }
}
