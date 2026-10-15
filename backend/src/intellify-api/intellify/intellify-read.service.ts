import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DbService } from '../db/db.service';
import type { PlanDesignRowDto } from './intellify.dto';
import { Paged, pageWindow, paginate, PagedQueryDto } from '../paged';
import {
  aggregatedCensusQuery,
  alternatePlansQuery,
  allProductsQuery,
  carrierCreditsQuery,
  carriersQuery,
  censusPlansQuery,
  censusQuery,
  clientByCodeQuery,
  clientCensusQuery,
  clientFinancialsQuery,
  clientPlansQuery,
  clientsQuery,
  contactsQuery,
  contributionsQuery,
  eligibilityQuery,
  feesQuery,
  financialsQuery,
  fundingTypesQuery,
  locStatusesQuery,
  pagedQueries,
  planDesignsQuery,
  planTypesQuery,
  pointSolutionsQuery,
  policiesQuery,
  productsQuery,
  Query,
  remindersQuery,
  scope,
  Scope,
  surveyQuery,
  wizardsQuery,
} from './intellify.queries';
import {
  censusDetail,
  CensusRow,
  currentStatuses,
  financialTotals,
  flattenFinancial,
  Financial,
  kickOffDate,
  LocStatusRow,
  mapAggregated,
  mapCensusRow,
  RawCensus,
  renewalEffectiveDate,
  sortYearsDesc,
} from './mapping';

type Row = Record<string, unknown>;

export interface ProductRow {
  id: string;
  name: string;
  locType: string;
}
export interface WizardRow {
  id: string;
  line: string | null;
  type: string;
  status: string;
}
export interface ReminderRow {
  planDesignId: string;
  emailId: string;
  reminderDate: string;
}
export interface AlternateRow {
  id: string;
  planDesignId: string;
  name: string;
  fundingType: string | null;
  line: string | null;
}
export interface FinancialRaw {
  coverageId: string;
  clientOneCode: string;
  line: string;
  planDesignId: string | null;
  carrier: string | null;
  fundingType: string | null;
  planFinancial: unknown;
}

export interface Opts {
  includeDeleted?: boolean;
}

export interface PlanRow {
  planDesignId: string;
  clientOneCode: string;
  clientName: string;
  productId: string;
  line: string;
  locType: string;
  carrierId: string | null;
  carrier: string | null;
  fundingType: string | null;
  state: string | null;
  creationFlag: string | null;
  coverageId: string | null;
  policyNumber: string | null;
  planFinancial: unknown;
  kickOffName: string | null;
  kickOffDays: number | null;
}

export interface EligibilityRow {
  id: string;
  planDesignId: string;
  workflowStatus: string | null;
  isCurrent: boolean;
}

export interface CensusPlanRow {
  censusPlanId: string;
  name: string;
  documentId: string;
  line: string;
  productId: string;
  planDesignId: string | null;
  effectiveYear: string | null;
}

type Thunks<T extends unknown[]> = { [K in keyof T]: () => Promise<T[K]> };

/**
 * Runs the statements one after another: a pg client executes one query at a
 * time (concurrent use is deprecated), so `Promise.all` on it would queue anyway.
 */
async function series<T extends unknown[]>(thunks: [...Thunks<T>]): Promise<T> {
  const out: unknown[] = [];
  for (const thunk of thunks) out.push(await thunk());
  return out as T;
}

async function rows<T>(client: PoolClient, q: Query): Promise<T[]> {
  return (await client.query(q.text, q.values)).rows as T[];
}

/**
 * Read model over the Intellify schema (api.md 2.16.2-2.16.3). Every method
 * runs its statements in one `READ ONLY` transaction (`DbService.readOnly`).
 */
@Injectable()
export class IntellifyReadService {
  constructor(private readonly db: DbService) {}

  private sc(opts: Opts = {}): Scope {
    return scope(this.db.schema, opts.includeDeleted === true);
  }

  // --- collections --------------------------------------------------------------

  private async page<R = unknown, T = R>(
    q: PagedQueryDto,
    build: (limit: number, offset: number) => ReturnType<typeof pagedQueries>,
    map: (r: R) => T = (r) => r as unknown as T,
  ): Promise<Paged<T>> {
    const { limit, offset } = pageWindow(q);
    const { count, page } = build(limit, offset);
    return this.db.readOnly(async (client) => {
      const total = (await rows<{ n: number }>(client, count))[0]?.n ?? 0;
      const data = (await rows<R>(client, page)).map(map);
      return paginate(total, data, q.page, limit);
    });
  }

  clients(q: PagedQueryDto & { q?: string; includeDeleted?: boolean }) {
    const sc = this.sc(q);
    return this.page(q, (l, o) => clientsQuery(sc, { q: q.q }, l, o));
  }

  products(q: PagedQueryDto & Opts) {
    const sc = this.sc(q);
    return this.page(q, (l, o) => productsQuery(sc, l, o));
  }

  fundingTypes(q: PagedQueryDto) {
    const sc = this.sc();
    return this.page(q, (l, o) => fundingTypesQuery(sc, l, o));
  }

  planTypes(q: PagedQueryDto & { line?: string }) {
    const sc = this.sc();
    return this.page(q, (l, o) => planTypesQuery(sc, q, l, o));
  }

  carriers(
    q: PagedQueryDto & Opts & { line?: string; clientOneCode?: string },
  ) {
    const sc = this.sc(q);
    return this.page(q, (l, o) => carriersQuery(sc, q, l, o));
  }

  planDesigns(
    q: PagedQueryDto & Opts & { clientOneCode?: string; line?: string },
  ) {
    const sc = this.sc(q);
    return this.page<PlanRow, PlanDesignRowDto>(
      q,
      (l, o) => planDesignsQuery(sc, q, l, o),
      (r) => {
        const f = flattenFinancial(r.planFinancial, {
          coverageId: r.coverageId ?? '',
          clientOneCode: r.clientOneCode,
          line: r.line,
          planDesignId: r.planDesignId,
          carrier: r.carrier,
          fundingType: r.fundingType,
        });
        return {
          id: r.planDesignId,
          clientOneCode: r.clientOneCode,
          clientName: r.clientName,
          line: r.line,
          planType: f.planType,
          carrier: r.carrier ?? null,
          fundingType: f.fundingType,
          state: r.state ?? null,
          creationFlag: r.creationFlag ?? null,
          policyNumber: r.policyNumber ?? null,
          enrolledEmployees: f.enrolledEmployees,
          annualPremium: f.annualPremium,
          planYear: f.planYear,
        };
      },
    );
  }

  policies(q: PagedQueryDto & Opts & { clientOneCode?: string }) {
    const sc = this.sc(q);
    return this.page(q, (l, o) => policiesQuery(sc, q, l, o));
  }

  financials(
    q: PagedQueryDto &
      Opts & { clientOneCode?: string; line?: string; planYear?: number },
  ) {
    const sc = this.sc(q);
    return this.page<FinancialRaw, Financial>(
      q,
      (l, o) => financialsQuery(sc, q, l, o),
      toFinancial,
    );
  }

  census(q: PagedQueryDto & Opts & { clientOneCode?: string; year?: string }) {
    const sc = this.sc(q);
    return this.page<RawCensus, CensusRow>(
      q,
      (l, o) => censusQuery(sc, q, l, o),
      mapCensusRow,
    );
  }

  // --- per-client ---------------------------------------------------------------

  private async client(c: PoolClient, sc: Scope, oneCode: string) {
    const [client] = await rows<{
      id: string;
      oneCode: string;
      name: string;
      tenantKey: string | null;
      deleted: boolean;
    }>(c, clientByCodeQuery(sc, oneCode));
    if (!client) {
      throw new NotFoundException(`Client "${oneCode}" not found`);
    }
    return client;
  }

  /** Plan rows with the plan's data shaped once, shared by several routes. */
  private async plans(
    c: PoolClient,
    sc: Scope,
    clientId: string,
    f: { line?: string; planDesignId?: string } = {},
  ): Promise<PlanRow[]> {
    return rows<PlanRow>(c, clientPlansQuery(sc, clientId, f));
  }

  async clientDetail(oneCode: string, opts: Opts = {}) {
    const sc = this.sc(opts);
    return this.db.readOnly(async (c) => {
      const client = await this.client(c, sc, oneCode);
      const [contacts, statuses, products, plans, census] = await series([
        () =>
          rows<{
            email: string;
            contactType: string | null;
            country: string | null;
          }>(c, contactsQuery(sc, client.id)),
        () => rows<LocStatusRow>(c, locStatusesQuery(sc, client.id)),
        () => rows<ProductRow>(c, allProductsQuery(sc)),
        () => this.plans(c, sc, client.id),
        () => rows<RawCensus>(c, clientCensusQuery(sc, oneCode)),
      ]);
      const current = currentStatuses(statuses);
      const counts = new Map<string, number>();
      for (const p of plans) {
        counts.set(p.productId, (counts.get(p.productId) ?? 0) + 1);
      }
      const lines = products
        .filter((p) => current.has(p.id) || counts.has(p.id))
        .map((p) => ({
          line: p.name,
          locType: p.locType,
          status: current.get(p.id)?.status ?? null,
          statusSince: current.get(p.id)?.since ?? null,
          planDesigns: counts.get(p.id) ?? 0,
        }));
      const latest = census[0] ? mapCensusRow(census[0]) : null;
      return {
        client,
        contacts: contacts.map((r) => ({
          email: r.email,
          contactType: r.contactType ?? null,
          country: r.country ?? null,
        })),
        headcount: latest?.totalEmployees ?? null,
        latestCensusYear: latest?.effectiveYear ?? null,
        lines,
      };
    });
  }

  async renewals(oneCode: string, opts: Opts = {}) {
    const sc = this.sc(opts);
    return this.db.readOnly(async (c) => {
      const client = await this.client(c, sc, oneCode);
      const [plans, statuses, reminders, wizards] = await series([
        () => this.plans(c, sc, client.id),
        () => rows<LocStatusRow>(c, locStatusesQuery(sc, client.id)),
        () => rows<ReminderRow>(c, remindersQuery(sc, client.id)),
        () => rows<WizardRow>(c, wizardsQuery(sc, client.id)),
      ]);
      const current = currentStatuses(statuses);
      const withYear = plans
        .map((p) => ({ p, fin: toFinancialOfPlan(p) }))
        .filter((x) => x.fin.planYear !== null);
      const planYear = withYear.length
        ? Math.max(...withYear.map((x) => x.fin.planYear as number))
        : null;
      const renewals = withYear
        .filter((x) => x.fin.planYear === planYear)
        .map(({ p, fin }) => {
          const effectiveDate = renewalEffectiveDate(fin.planYear);
          return {
            line: p.line,
            carrier: p.carrier,
            policyNumber: p.policyNumber,
            effectiveDate,
            kickOffTiming: p.kickOffName
              ? { name: p.kickOffName, days: p.kickOffDays }
              : null,
            kickOffDate: kickOffDate(effectiveDate, p.kickOffDays ?? null),
            locStatus: current.get(p.productId)?.status ?? null,
            annualPremium: fin.annualPremium,
            renewalIncreasePct: fin.renewalIncreasePct,
            reminders: reminders
              .filter((r) => r.planDesignId === p.planDesignId)
              .map((r) => ({
                emailId: r.emailId,
                reminderDate: r.reminderDate,
              })),
          };
        });
      return {
        planYear,
        renewals,
        upcomingWizards: wizards
          .filter((w) => w.status === 'inProgress')
          .map((w) => ({ type: w.type, status: w.status })),
      };
    });
  }

  async program(oneCode: string, f: { line?: string } & Opts = {}) {
    const sc = this.sc(f);
    return this.db.readOnly(async (c) => {
      const client = await this.client(c, sc, oneCode);
      const [plans, statuses, products, elig, censusPlans, census] =
        await series([
          () => this.plans(c, sc, client.id, { line: f.line }),
          () => rows<LocStatusRow>(c, locStatusesQuery(sc, client.id)),
          () => rows<ProductRow>(c, allProductsQuery(sc)),
          () => rows<EligibilityRow>(c, eligibilityQuery(sc, client.id)),
          () => rows<CensusPlanRow>(c, censusPlansQuery(sc, client.id)),
          () => rows<RawCensus>(c, clientCensusQuery(sc, oneCode)),
        ]);
      const current = currentStatuses(statuses);
      const latestDoc = census[0]?.documentId ?? null;
      const lines = products
        .filter((p) => !f.line || p.name.toLowerCase() === f.line.toLowerCase())
        .filter(
          (p) => current.has(p.id) || plans.some((pl) => pl.productId === p.id),
        )
        .map((p) => ({
          line: p.name,
          locType: p.locType,
          status: current.get(p.id)?.status ?? null,
          plans: plans
            .filter((pl) => pl.productId === p.id)
            .map((pl) => planSummary(pl, elig, censusPlans, latestDoc)),
        }));
      const byCarrier = new Map<string, Set<string>>();
      for (const pl of plans) {
        if (!pl.carrier) continue;
        if (!byCarrier.has(pl.carrier)) byCarrier.set(pl.carrier, new Set());
        byCarrier.get(pl.carrier)!.add(pl.line);
      }
      return {
        lines,
        carriers: [...byCarrier]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([carrier, ls]) => ({ carrier, lines: [...ls].sort() })),
      };
    });
  }

  async plan(oneCode: string, planDesignId: string, opts: Opts = {}) {
    const sc = this.sc(opts);
    return this.db.readOnly(async (c) => {
      const client = await this.client(c, sc, oneCode);
      const [plan] = await this.plans(c, sc, client.id, { planDesignId });
      if (!plan) {
        throw new NotFoundException(
          `Plan design "${planDesignId}" not found for client "${oneCode}"`,
        );
      }
      const [elig, censusPlans, census, alternates, reminders] = await series([
        () => rows<EligibilityRow>(c, eligibilityQuery(sc, client.id)),
        () => rows<CensusPlanRow>(c, censusPlansQuery(sc, client.id)),
        () => rows<RawCensus>(c, clientCensusQuery(sc, oneCode)),
        () => rows<AlternateRow>(c, alternatePlansQuery(sc, client.id)),
        () => rows<ReminderRow>(c, remindersQuery(sc, client.id)),
      ]);
      const mine = <T extends { planDesignId: string | null }>(xs: T[]) =>
        xs.filter((x) => x.planDesignId === planDesignId);
      return {
        ...planSummary(plan, elig, censusPlans, census[0]?.documentId ?? null),
        line: plan.line,
        planFinancial: (plan.planFinancial as object | null) ?? null,
        eligibilityVersions: mine(elig).map((e) => ({
          id: e.id,
          workflowStatus: e.workflowStatus,
          isCurrent: e.isCurrent,
        })),
        censusPlans: mine(censusPlans).map((m) => ({
          censusPlanId: m.censusPlanId,
          name: m.name,
          documentId: m.documentId,
          effectiveYear: m.effectiveYear,
        })),
        alternatePlans: mine(alternates).map((a) => ({
          id: a.id,
          name: a.name,
          fundingType: a.fundingType ?? null,
          line: a.line ?? null,
        })),
        reminders: mine(reminders).map((r) => ({
          emailId: r.emailId,
          reminderDate: r.reminderDate,
        })),
      };
    });
  }

  async clientFinancials(
    oneCode: string,
    f: { line?: string; planYear?: number } & Opts = {},
  ) {
    const sc = this.sc(f);
    return this.db.readOnly(async (c) => {
      await this.client(c, sc, oneCode);
      let list = (
        await rows<FinancialRaw>(c, clientFinancialsQuery(sc, oneCode, f))
      ).map(toFinancial);
      // Without `planYear` the route answers for the latest plan year.
      const planYear =
        f.planYear ??
        (list.length
          ? Math.max(...list.map((r) => r.planYear ?? 0)) || null
          : null);
      if (f.planYear === undefined && planYear !== null) {
        list = list.filter((r) => r.planYear === planYear);
      }
      return { planYear, rows: list, totals: financialTotals(list) };
    });
  }

  async clientCensus(oneCode: string, f: { year?: string } & Opts = {}) {
    const sc = this.sc(f);
    return this.db.readOnly(async (c) => {
      const client = await this.client(c, sc, oneCode);
      const census = await rows<RawCensus>(c, clientCensusQuery(sc, oneCode));
      const years = sortYearsDesc(census.map((r) => r.effectiveYear));
      const year = f.year ?? years[0];
      const selected = census.find((r) => r.effectiveYear === year);
      if (!selected) {
        throw new NotFoundException(
          `Census for year "${f.year ?? ''}" not found for client "${oneCode}"`,
        );
      }
      const [censusPlans, plans, aggregated] = await series([
        () => rows<CensusPlanRow>(c, censusPlansQuery(sc, client.id)),
        () => this.plans(c, sc, client.id),
        () =>
          rows<{ census: unknown }>(c, aggregatedCensusQuery(sc, client.id)),
      ]);
      const agg = aggregated.find(
        (a) =>
          (a.census as Row | null)?.effectiveYear === selected.effectiveYear,
      );
      const seen = new Set<string>();
      const planList = censusPlans
        .filter((cp) => cp.documentId === selected.documentId)
        .filter((cp) => !seen.has(cp.censusPlanId) && seen.add(cp.censusPlanId))
        .map((cp) => {
          const pl = plans.find((p) => p.planDesignId === cp.planDesignId);
          return {
            line: cp.line,
            censusPlanName: cp.name,
            mappedTo: pl
              ? {
                  planDesignId: pl.planDesignId,
                  planType: toFinancialOfPlan(pl).planType,
                  carrier: pl.carrier,
                }
              : null,
          };
        });
      return {
        years,
        selected: censusDetail(selected),
        plans: planList,
        aggregated: agg ? mapAggregated(agg.census) : null,
      };
    });
  }

  async commercials(oneCode: string, opts: Opts = {}) {
    const sc = this.sc(opts);
    return this.db.readOnly(async (c) => {
      const client = await this.client(c, sc, oneCode);
      const [contributions, credits, fees, survey, points] = await series([
        () => rows<Row>(c, contributionsQuery(sc, client.id)),
        () => rows<Row>(c, carrierCreditsQuery(sc, client.id)),
        () => rows<Row>(c, feesQuery(sc, client.id)),
        () => rows<Row>(c, surveyQuery(sc, client.id)),
        () => rows<Row>(c, pointSolutionsQuery(sc, client.id)),
      ]);
      return {
        contributions,
        carrierCredits: credits,
        fees,
        survey: survey[0] ?? null,
        pointSolutions: points,
      };
    });
  }

  async wizards(oneCode: string, opts: Opts = {}) {
    const sc = this.sc(opts);
    return this.db.readOnly(async (c) => {
      const client = await this.client(c, sc, oneCode);
      const [wizards, alternates, plans] = await series([
        () => rows<WizardRow>(c, wizardsQuery(sc, client.id)),
        () => rows<AlternateRow>(c, alternatePlansQuery(sc, client.id)),
        () => this.plans(c, sc, client.id),
      ]);
      return {
        wizards,
        alternatePlans: alternates.map((a) => {
          const pl = plans.find((p) => p.planDesignId === a.planDesignId);
          return {
            planDesignId: a.planDesignId,
            planType: pl ? toFinancialOfPlan(pl).planType : null,
            name: a.name,
            fundingType: a.fundingType ?? null,
            line: a.line ?? null,
          };
        }),
      };
    });
  }
}

// --- row -> shape helpers -------------------------------------------------------

function toFinancial(r: FinancialRaw): Financial {
  return flattenFinancial(r.planFinancial, {
    coverageId: r.coverageId,
    clientOneCode: r.clientOneCode,
    line: r.line,
    planDesignId: r.planDesignId ?? null,
    carrier: r.carrier ?? null,
    fundingType: r.fundingType ?? null,
  });
}

function toFinancialOfPlan(p: PlanRow): Financial {
  return flattenFinancial(p.planFinancial, {
    coverageId: p.coverageId ?? '',
    clientOneCode: p.clientOneCode,
    line: p.line,
    planDesignId: p.planDesignId,
    carrier: p.carrier,
    fundingType: p.fundingType,
  });
}

/** The plan as in api.md I15; I16 adds the full detail around it. */
export function planSummary(
  p: PlanRow,
  eligibility: EligibilityRow[],
  censusPlans: CensusPlanRow[],
  latestCensusDocument: string | null,
) {
  const fin = toFinancialOfPlan(p);
  const versions = eligibility.filter((e) => e.planDesignId === p.planDesignId);
  const currentVersion = versions.find((e) => e.isCurrent) ?? versions.at(-1);
  const mapped = new Set(
    censusPlans
      .filter((m) => m.planDesignId === p.planDesignId)
      .map((m) => m.censusPlanId),
  );
  const mappedAny = new Set(
    censusPlans.filter((m) => m.planDesignId).map((m) => m.censusPlanId),
  );
  const unmapped = [
    ...new Set(
      censusPlans
        .filter(
          (m) =>
            m.productId === p.productId &&
            !mappedAny.has(m.censusPlanId) &&
            (latestCensusDocument === null ||
              m.documentId === latestCensusDocument),
        )
        .map((m) => m.name),
    ),
  ];
  return {
    planDesignId: p.planDesignId,
    planType: fin.planType,
    carrier: p.carrier,
    carrierId: p.carrierId,
    fundingType: fin.fundingType,
    state: p.state,
    creationFlag: p.creationFlag,
    policyNumber: p.policyNumber,
    eligibility: {
      workflowStatus: currentVersion?.workflowStatus ?? null,
      versions: versions.length,
    },
    censusMapping: { mapped: mapped.size, unmapped },
    financials: p.planFinancial
      ? {
          planYear: fin.planYear,
          enrolledEmployees: fin.enrolledEmployees,
          coveredLives: fin.coveredLives,
          annualPremium: fin.annualPremium,
          priorYearAnnualPremium: fin.priorYearAnnualPremium,
          renewalIncreasePct: fin.renewalIncreasePct,
          employerPct: fin.employerPct,
        }
      : null,
  };
}
