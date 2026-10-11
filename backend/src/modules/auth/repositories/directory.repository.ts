import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  GROUP_MEMBERS_STORE,
  GROUPS_STORE,
  USERS_STORE,
} from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type {
  GroupDoc,
  GroupMemberDoc,
  UserDoc,
} from '../entities/directory.entity';

const lower = (value: string | undefined) => value?.trim().toLowerCase();

/**
 * The directory: users, groups and memberships (data-model 3.14.1-3.14.3).
 * Not owner-scoped: these are read across all users by sign-in, SCIM and
 * the admin module. Case-insensitive lookups walk the collection, which the
 * SQLite store does in-process anyway.
 */
@Injectable()
export class DirectoryRepository {
  constructor(
    @Inject(USERS_STORE) private readonly users: DocStore<UserDoc>,
    @Inject(GROUPS_STORE) private readonly groups: DocStore<GroupDoc>,
    @Inject(GROUP_MEMBERS_STORE)
    private readonly members: DocStore<GroupMemberDoc>,
  ) {}

  // Users

  allUsers(): Promise<UserDoc[]> {
    return this.users.find({}, { sort: { createdAt: 1 } });
  }

  userById(id: string): Promise<UserDoc | null> {
    return this.users.findOne({ id });
  }

  userBySubject(subject: string): Promise<UserDoc | null> {
    return this.users.findOne({ oidcSubject: subject });
  }

  /**
   * By user name, case-insensitively. Sign-in matches on this, never on the
   * email (admin R13).
   */
  async userByUserName(userName: string): Promise<UserDoc | null> {
    const wanted = lower(userName);
    return (
      (await this.users.find()).find((u) => lower(u.userName) === wanted) ??
      null
    );
  }

  async insertUser(user: Omit<UserDoc, 'id'>): Promise<UserDoc> {
    return this.users.insert({ ...user, id: randomUUID() });
  }

  updateUser(id: string, patch: Partial<UserDoc>): Promise<UserDoc | null> {
    return this.users.update({ id }, patch);
  }

  unsetUserField(id: string, field: keyof UserDoc): Promise<UserDoc | null> {
    return this.users.unset({ id }, field);
  }

  // Groups

  allGroups(): Promise<GroupDoc[]> {
    return this.groups.find({}, { sort: { createdAt: 1 } });
  }

  groupById(id: string): Promise<GroupDoc | null> {
    return this.groups.findOne({ id });
  }

  /** By display name, case-insensitively (the name is unique). */
  async groupByDisplayName(displayName: string): Promise<GroupDoc | null> {
    const wanted = lower(displayName);
    return (
      (await this.groups.find()).find((g) => lower(g.displayName) === wanted) ??
      null
    );
  }

  insertGroup(group: Omit<GroupDoc, 'id'>): Promise<GroupDoc> {
    return this.groups.insert({ ...group, id: randomUUID() });
  }

  updateGroup(id: string, patch: Partial<GroupDoc>): Promise<GroupDoc | null> {
    return this.groups.update({ id }, patch);
  }

  unsetGroupField(id: string, field: keyof GroupDoc): Promise<GroupDoc | null> {
    return this.groups.unset({ id }, field);
  }

  deleteGroup(id: string): Promise<number> {
    return this.groups.deleteOne({ id });
  }

  // Memberships

  membersOf(groupId: string): Promise<GroupMemberDoc[]> {
    return this.members.find({ groupId }, { sort: { createdAt: 1 } });
  }

  async groupIdsOf(userId: string): Promise<string[]> {
    return (await this.members.find({ userId })).map((m) => m.groupId);
  }

  /** Idempotent: a user is a member of a group at most once. */
  async addMember(groupId: string, userId: string): Promise<void> {
    if (await this.members.findOne({ groupId, userId })) return;
    await this.members.insert({ id: randomUUID(), groupId, userId });
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    await this.members.deleteMany({ groupId, userId });
  }

  async removeAllMembers(groupId: string): Promise<void> {
    await this.members.deleteMany({ groupId });
  }

  async removeFromAllGroups(userId: string): Promise<void> {
    await this.members.deleteMany({ userId });
  }
}
