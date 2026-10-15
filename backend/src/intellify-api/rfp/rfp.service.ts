import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import { pageWindow, paginate, type Paged } from '../paged';
import type { CreateRfpDto } from './dto/create-rfp.dto';
import type {
  CarrierInputDto,
  LineInputDto,
  MilestoneInputDto,
  RequirementInputDto,
} from './dto/list-items.dto';
import type { ListRfpsQueryDto } from './dto/list-rfps-query.dto';
import type { UpdateRfpDto } from './dto/update-rfp.dto';
import {
  existingClients,
  findClient,
  listClientPlanDesigns,
  listInsurers,
  listProducts,
} from './intellify.lookups';
import { RfpRepository, type RfpHeaderPatch } from './rfp.repository';
import {
  assertDeletable,
  assertStatusMove,
  defaultEffectiveDate,
  defaultTitle,
  isEvalCreator,
  isUuid,
  mergeSections,
  resolveCarriers,
  resolveLines,
  rfpNotFound,
  validationError,
} from './rfp.rules';
import type { Rfp, RfpSummary } from './rfp.types';

/**
 * The RFP records (api.md 2.16.4). Reads run in `READ ONLY` transactions;
 * writes touch schema `rfp` only, in one transaction per request, after the
 * Intellify checks they need have run read-only.
 */
@Injectable()
export class RfpService {
  constructor(
    private readonly db: DbService,
    private readonly repo: RfpRepository,
  ) {}

  /** `clientMissing: true` on the records whose client is gone. */
  private async markMissing<
    T extends { clientOneCode: string; clientMissing?: true },
  >(client: PoolClient, records: T[]): Promise<T[]> {
    const codes = [...new Set(records.map((r) => r.clientOneCode))];
    const live = await existingClients(client, this.db.schema, codes);
    return records.map((record) =>
      live.has(record.clientOneCode)
        ? record
        : { ...record, clientMissing: true as const },
    );
  }

  async get(id: string): Promise<Rfp> {
    if (!isUuid(id)) throw rfpNotFound(id);
    const rfp = await this.db.readOnly(async (client) => {
      const found = await this.repo.findFull(client, id);
      return found ? (await this.markMissing(client, [found]))[0] : null;
    });
    if (!rfp) throw rfpNotFound(id);
    return rfp;
  }

  async list(query: ListRfpsQueryDto): Promise<Paged<RfpSummary>> {
    const { limit, offset } = pageWindow(query);
    const { total, rows } = await this.db.readOnly(async (client) => {
      const page = await this.repo.list(
        client,
        {
          clientOneCode: query.clientOneCode,
          status: query.status,
          createdBy: query.createdBy,
        },
        limit,
        offset,
      );
      return { ...page, rows: await this.markMissing(client, page.rows) };
    });
    return paginate(total, rows, query.page, limit);
  }

  async create(body: CreateRfpDto, userHeader?: string): Promise<Rfp> {
    const found = await this.db.readOnly((client) =>
      findClient(client, this.db.schema, body.clientOneCode),
    );
    if (!found) {
      throw validationError(`Client "${body.clientOneCode}" not found`);
    }
    const createdBy = body.createdBy?.trim() || userHeader?.trim() || null;
    const id = await this.db.write((client) =>
      this.repo.insert(client, {
        clientOneCode: found.oneCode,
        clientName: found.name,
        title: body.title?.trim() || defaultTitle(found.name, body.planYear),
        planYear: body.planYear,
        effectiveDate: defaultEffectiveDate(body.planYear),
        createdBy,
      }),
    );
    return this.get(id);
  }

  async update(id: string, body: UpdateRfpDto): Promise<Rfp> {
    if (!isUuid(id)) throw rfpNotFound(id);
    await this.db.write(async (client) => {
      const current = await this.repo.findHeader(client, id, true);
      if (!current) throw rfpNotFound(id);
      if (body.status) assertStatusMove(current.status, body.status);
      const patch: RfpHeaderPatch = {
        title: body.title?.trim() || undefined,
        planYear: body.planYear,
        effectiveDate: body.effectiveDate,
        status: body.status,
        stage: body.stage,
      };
      if (body.sections) {
        patch.sections = mergeSections(current.sections, body.sections);
      }
      await this.repo.updateHeader(client, id, patch);
    });
    return this.get(id);
  }

  /** Locks the record for the write, or answers 404. */
  private async lock(client: PoolClient, id: string) {
    const current = await this.repo.findHeader(client, id, true);
    if (!current) throw rfpNotFound(id);
    return current;
  }

  /** The client of an existing record, read before a list write. */
  private async clientOf(id: string): Promise<string> {
    if (!isUuid(id)) throw rfpNotFound(id);
    const header = await this.db.readOnly((client) =>
      this.repo.findHeader(client, id),
    );
    if (!header) throw rfpNotFound(id);
    return header.clientOneCode;
  }

  async replaceLines(id: string, items: LineInputDto[]): Promise<Rfp> {
    const clientOneCode = await this.clientOf(id);
    const { products, planDesigns } = await this.db.readOnly(
      async (client) => ({
        products: await listProducts(client, this.db.schema),
        planDesigns: await listClientPlanDesigns(
          client,
          this.db.schema,
          clientOneCode,
        ),
      }),
    );
    const rows = resolveLines(items, products, planDesigns, clientOneCode);
    await this.db.write(async (client) => {
      await this.lock(client, id);
      await this.repo.replaceLines(client, id, rows);
    });
    return this.get(id);
  }

  async replaceCarriers(id: string, items: CarrierInputDto[]): Promise<Rfp> {
    await this.clientOf(id);
    const { insurers, products } = await this.db.readOnly(async (client) => ({
      insurers: await listInsurers(client, this.db.schema),
      products: await listProducts(client, this.db.schema),
    }));
    const rows = resolveCarriers(items, insurers, products);
    await this.db.write(async (client) => {
      await this.lock(client, id);
      await this.repo.replaceCarriers(client, id, rows);
    });
    return this.get(id);
  }

  async replaceRequirements(
    id: string,
    items: RequirementInputDto[],
  ): Promise<Rfp> {
    if (!isUuid(id)) throw rfpNotFound(id);
    const rows = items.map((item) => ({
      section: item.section.trim(),
      question: item.question.trim(),
      required: item.required ?? true,
      answerType: item.answerType ?? 'text',
    }));
    await this.db.write(async (client) => {
      await this.lock(client, id);
      await this.repo.replaceRequirements(client, id, rows);
    });
    return this.get(id);
  }

  async replaceTimeline(id: string, items: MilestoneInputDto[]): Promise<Rfp> {
    if (!isUuid(id)) throw rfpNotFound(id);
    const rows = items.map((item) => {
      const row: {
        milestone: string;
        dueDate: string;
        owner?: string;
        notes?: string;
      } = { milestone: item.milestone.trim(), dueDate: item.dueDate };
      if (item.owner?.trim()) row.owner = item.owner.trim();
      if (item.notes?.trim()) row.notes = item.notes.trim();
      return row;
    });
    await this.db.write(async (client) => {
      await this.lock(client, id);
      await this.repo.replaceTimeline(client, id, rows);
    });
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    if (!isUuid(id)) throw rfpNotFound(id);
    await this.db.write(async (client) => {
      const current = await this.lock(client, id);
      assertDeletable(id, current.status);
      await this.repo.delete(client, id);
    });
  }

  /**
   * The bulk clean-up (api.md I29): the drafts `createdBy` made, or every
   * record of an eval run (`eval:<jobId>`), whatever its status, since a run
   * that reaches stage 7 leaves a `ready` record (rfp R14).
   */
  async removeDrafts(createdBy: string): Promise<{ deleted: number }> {
    const deleted = await this.db.write((client) =>
      this.repo.deleteCreatedBy(client, createdBy, isEvalCreator(createdBy)),
    );
    return { deleted };
  }
}
