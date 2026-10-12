import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  ORG_SERVER_CONFIG,
  type OrgServerConfig,
} from '../../../config/org-server.config';
import {
  CONNECTIONS_STORE,
  SETTINGS_STORE,
} from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { AssignableRoleId } from '../entities/directory.entity';
import { DirectoryRepository } from '../repositories/directory.repository';
import { RolesRepository } from '../repositories/roles.repository';
import { LOCAL_PERSONAS, type LocalPersona } from './local-personas';

/** The `settings` document that remembers applied seeds (data-model 3.2.2). */
export const LOCAL_SEED_KEY = 'local-seed';

export interface LocalSeedDoc {
  key: typeof LOCAL_SEED_KEY;
  applied: string[];
}

/** Who a seeded assignment is assigned by: local mode itself (Demo User). */
const SEEDED_BY = 'local';

/**
 * The local personas' directory (admin R69, R72; ADR-0012). At startup in
 * local mode it creates the missing personas and applies each seeded role
 * once: Mark Maker's Maker, Avery Approver's Approver, and Dana Data
 * Owner's Data owner on every datasource. Applied seeds are remembered in
 * the `local-seed` settings document, so a role an admin removes is never
 * added again. Does nothing on an org server.
 */
@Injectable()
export class LocalDirectoryService implements OnModuleInit {
  private readonly logger = new Logger(LocalDirectoryService.name);
  /** Seeds run one at a time, so two callers never apply one twice. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly directory: DirectoryRepository,
    private readonly roles: RolesRepository,
    @Inject(CONNECTIONS_STORE)
    private readonly connections: DocStore<{ id: string }>,
    @Inject(SETTINGS_STORE)
    private readonly settings: DocStore<LocalSeedDoc>,
    @Optional()
    @Inject(ORG_SERVER_CONFIG)
    private readonly config: OrgServerConfig | null = null,
  ) {}

  private get local(): boolean {
    return !this.config;
  }

  async onModuleInit(): Promise<void> {
    if (!this.local) return;
    await this.ensurePersonas();
    await this.reconcileDataOwner();
  }

  /** Creates the missing personas, then applies their role seeds once. */
  async ensurePersonas(): Promise<void> {
    if (!this.local) return;
    for (const persona of LOCAL_PERSONAS) {
      if (await this.directory.userById(persona.id)) continue;
      await this.directory.insertUser({
        id: persona.id,
        userName: persona.userName,
        email: persona.userName,
        displayName: persona.displayName,
        givenName: persona.givenName,
        familyName: persona.familyName,
        active: true,
        source: 'local',
      });
      this.logger.log(`Created local persona ${persona.displayName}`);
    }
    for (const persona of LOCAL_PERSONAS) {
      if (!persona.seedRole) continue;
      await this.applyOnce(`${persona.seedRole}:${persona.id}`, () =>
        this.assign(persona, persona.seedRole!),
      );
    }
  }

  /** Dana Data Owner's Data owner seed on every datasource (R69). */
  async reconcileDataOwner(): Promise<void> {
    if (!this.local) return;
    for (const { id } of await this.connections.find()) {
      await this.onDatasourceCreated(id);
    }
  }

  /** A datasource was created: Dana becomes its Data owner, once (R72). */
  async onDatasourceCreated(datasourceId: string): Promise<void> {
    if (!this.local) return;
    for (const persona of LOCAL_PERSONAS) {
      if (!persona.seedDataOwner) continue;
      await this.applyOnce(`data-owner:${persona.id}:${datasourceId}`, () =>
        this.assign(persona, 'data-owner', datasourceId),
      );
    }
  }

  /**
   * Runs `apply` unless `key` is already in the `local-seed` document, then
   * adds it (data-model 3.2.2).
   */
  applyOnce(key: string, apply: () => Promise<void>): Promise<void> {
    const run = this.queue.then(async () => {
      const doc = await this.settings.findOne({ key: LOCAL_SEED_KEY });
      const applied = Array.isArray(doc?.applied) ? doc.applied : [];
      if (applied.includes(key)) return;
      await apply();
      await this.settings.update(
        { key: LOCAL_SEED_KEY },
        { key: LOCAL_SEED_KEY, applied: [...applied, key] },
        { upsert: true },
      );
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async assign(
    persona: LocalPersona,
    role: AssignableRoleId,
    datasourceId?: string,
  ): Promise<void> {
    if (await this.roles.findAssignment(persona.id, role, datasourceId)) return;
    await this.roles.insertAssignment({
      userId: persona.id,
      role,
      ...(datasourceId ? { datasourceId } : {}),
      assignedBy: SEEDED_BY,
    });
  }
}
