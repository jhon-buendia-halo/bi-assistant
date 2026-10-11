import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ACTIVITY_EVENTS_STORE } from '../../infrastructure/database/doc-store';
import type { DocStore } from '../../infrastructure/database/doc-store';
import type {
  ActivityEventDoc,
  ActivityEventType,
  UserDoc,
} from './entities/directory.entity';
import { DirectoryRepository } from './repositories/directory.repository';

/** At most one `scim.request` event per this many ms (data-model 3.14.7). */
const SCIM_EVENT_INTERVAL_MS = 60_000;

const utcDay = (iso: string) => iso.slice(0, 10);

/**
 * Records the activity events of org server mode (admin R36, data-model
 * 3.14.7). Append-only; read by the admin screens.
 */
@Injectable()
export class ActivityService {
  private lastScimEventAt = 0;
  /** `<userId>:<UTC day>` already recorded, so concurrent requests add one. */
  private readonly activeDays = new Set<string>();

  constructor(
    @Inject(ACTIVITY_EVENTS_STORE)
    private readonly store: DocStore<ActivityEventDoc>,
    private readonly directory: DirectoryRepository,
  ) {}

  async record(
    type: ActivityEventType,
    fields: Pick<ActivityEventDoc, 'actorId' | 'subjectId' | 'details'> = {},
  ): Promise<void> {
    const event: ActivityEventDoc = {
      id: randomUUID(),
      type,
      at: new Date().toISOString(),
    };
    if (fields.actorId) event.actorId = fields.actorId;
    if (fields.subjectId) event.subjectId = fields.subjectId;
    if (fields.details) event.details = fields.details;
    await this.store.insert(event);
  }

  /** When the newest event of `type` happened, if any ("Last sync"). */
  async newestAt(type: ActivityEventType): Promise<string | null> {
    return (
      (await this.store.findOne({ type }, { sort: { at: -1 } }))?.at ?? null
    );
  }

  /** A SCIM request: at most one event a minute ("Last sync", admin R54). */
  async recordScimRequest(): Promise<void> {
    const now = Date.now();
    if (now - this.lastScimEventAt < SCIM_EVENT_INTERVAL_MS) return;
    this.lastScimEventAt = now;
    await this.record('scim.request');
  }

  /**
   * The user's first authenticated request of a UTC day: stamps
   * `lastActiveAt` and records `user.active` (admin R36, R39).
   */
  async markActive(user: UserDoc): Promise<void> {
    const now = new Date().toISOString();
    const today = utcDay(now);
    if (user.lastActiveAt && utcDay(user.lastActiveAt) === today) return;
    const key = `${user.id}:${today}`;
    if (this.activeDays.has(key)) return;
    this.activeDays.add(key);
    await this.directory.updateUser(user.id, { lastActiveAt: now });
    await this.record('user.active', { actorId: user.id, subjectId: user.id });
  }
}
