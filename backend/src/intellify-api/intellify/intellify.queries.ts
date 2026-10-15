/**
 * SQL of the read routes (api.md 2.16.2-2.16.3). The only value interpolated
 * is the schema name (configuration, quoted); every request value is a `$n`
 * parameter. Dates leave SQL as `YYYY-MM-DD` text and numbers as float8, so
 * the driver never hands back Date objects or numeric strings.
 */

export interface Query {
  text: string;
  values: unknown[];
}

/** Collects `$n` parameters while a statement is assembled. */
export class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** Quotes the configured schema name for use as an identifier. */
export function qi(schema: string): string {
  return `"${schema.replace(/"/g, '""')}"`;
}

const DATE = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;

export interface Scope {
  /** Schema name, already quoted (`qi`). */
  s: string;
  includeDeleted: boolean;
  /** `NOT alias.deleted`, or `TRUE` under `includeDeleted`. */
  nd(alias: string): string;
}

export function scope(schema: string, includeDeleted = false): Scope {
  return {
    s: qi(schema),
    includeDeleted,
    nd: (alias) => (includeDeleted ? 'TRUE' : `NOT ${alias}.deleted`),
  };
}

export interface Paged {
  select: string;
  from: string;
  where: string[];
  params: Params;
  order: string;
  /**
   * How many leading `params` the WHERE uses; the rest belong to SELECT and
   * are bound only by the page statement (an unused parameter is a bind error).
   */
  whereParamCount?: number;
  limit: number;
  offset: number;
}

/** Count and page statements sharing one FROM / WHERE. */
export function pagedQueries(p: Paged): { count: Query; page: Query } {
  const where = p.where.length ? `WHERE ${p.where.join(' AND ')}` : '';
  const values = [...p.params.values];
  const countValues = values.slice(0, p.whereParamCount ?? values.length);
  const limit = `$${values.length + 1}`;
  const offset = `$${values.length + 2}`;
  return {
    count: {
      text: `SELECT count(*)::int AS n FROM ${p.from} ${where}`,
      values: countValues,
    },
    page: {
      text: `SELECT ${p.select} FROM ${p.from} ${where} ORDER BY ${p.order} LIMIT ${limit} OFFSET ${offset}`,
      values: [...values, p.limit, p.offset],
    },
  };
}

// --- shared fragments ---------------------------------------------------------

/** Coverage -> policy -> financial of a plan design (at most one row). */
function coverageLateral(sc: Scope): string {
  return `LEFT JOIN LATERAL (
      SELECT pc.id AS coverage_id, po.id AS policy_id, po.number AS policy_number,
             po.kick_off_timing_kick_off_timing_id AS kick_off_id, pf.plan_financial
      FROM ${sc.s}.policy_coverages pc
      JOIN ${sc.s}.policies po ON po.id = pc.policy_info_policy_id AND ${sc.nd('po')}
      LEFT JOIN ${sc.s}.policy_financials pf
        ON pf.policy_coverage_policy_coverage_id = pc.id AND ${sc.nd('pf')}
      WHERE pc.plan_design_plan_design_id = pd.id AND ${sc.nd('pc')}
      ORDER BY pc.id LIMIT 1
    ) cv ON TRUE`;
}

/** One row per plan design with its product, carrier, funding, state and coverage. */
export function planDesignFrom(sc: Scope): string {
  return `${sc.s}.plan_designs pd
    JOIN ${sc.s}.clients c ON c.id = pd.client_client_id
    JOIN ${sc.s}.products p ON p.id = pd.loc_product_id
    LEFT JOIN ${sc.s}.insurers i ON i.id = pd.insurer_insurer_id
    LEFT JOIN ${sc.s}.funding_types ft ON ft.id = pd.plan_info_funding_type_id
    LEFT JOIN ${sc.s}.plan_states st ON st.id = pd.plan_info_state_id
    ${coverageLateral(sc)}`;
}

/** Coverage -> financial rows (api.md I10). */
export function financialFrom(sc: Scope): string {
  return `${sc.s}.policy_financials pf
    JOIN ${sc.s}.policy_coverages pc ON pc.id = pf.policy_coverage_policy_coverage_id
    JOIN ${sc.s}.policies po ON po.id = pc.policy_info_policy_id
    JOIN ${sc.s}.clients c ON c.id = po.client_client_id
    JOIN ${sc.s}.products p ON p.id = pc.loc_product_id
    LEFT JOIN ${sc.s}.insurers i ON i.id = pc.insurer_insurer_id
    LEFT JOIN ${sc.s}.plan_designs pd ON pd.id = pc.plan_design_plan_design_id
    LEFT JOIN ${sc.s}.funding_types ft ON ft.id = pd.plan_info_funding_type_id`;
}

export function financialWhere(
  sc: Scope,
  params: Params,
  f: { clientOneCode?: string; line?: string; planYear?: number },
): string[] {
  const where = [sc.nd('pf'), sc.nd('pc'), sc.nd('po'), sc.nd('c')];
  if (f.clientOneCode !== undefined) {
    where.push(`lower(c.one_code) = lower(${params.add(f.clientOneCode)})`);
  }
  if (f.line !== undefined) {
    where.push(`lower(p.name) = lower(${params.add(f.line)})`);
  }
  if (f.planYear !== undefined) {
    where.push(
      `(pf.plan_financial->>'planYear')::int = ${params.add(f.planYear)}`,
    );
  }
  return where;
}

export const FINANCIAL_SELECT = `pc.id AS "coverageId", c.one_code AS "clientOneCode", p.name AS line,
    pd.id AS "planDesignId", i.name AS carrier, ft.name AS "fundingType",
    pf.plan_financial AS "planFinancial"`;

export const FINANCIAL_ORDER = 'c.one_code, p.display_order, p.name, pc.id';

// --- collections ----------------------------------------------------------------

export function clientsQuery(
  sc: Scope,
  f: { q?: string },
  limit: number,
  offset: number,
) {
  const params = new Params();
  const where = [sc.nd('c')];
  if (f.q) {
    const q = params.add(f.q);
    where.push(
      `(position(lower(${q}) in lower(c.name)) > 0 OR position(lower(${q}) in lower(c.one_code)) > 0)`,
    );
  }
  return pagedQueries({
    select: `c.id, c.one_code AS "oneCode", c.name, c.tenant_key AS "tenantKey",
      lc.total AS headcount, lc.effective_year AS "latestCensusYear",
      (SELECT count(DISTINCT pd.loc_product_id)::int FROM ${sc.s}.plan_designs pd
         WHERE pd.client_client_id = c.id AND ${sc.nd('pd')}) AS "linesOffered",
      (SELECT ${DATE(`min(make_date((pf.plan_financial->>'planYear')::int + 1, 1, 1))`)}
         FROM ${sc.s}.policy_financials pf
         JOIN ${sc.s}.policy_coverages pc ON pc.id = pf.policy_coverage_policy_coverage_id
         JOIN ${sc.s}.policies po ON po.id = pc.policy_info_policy_id
         WHERE po.client_client_id = c.id AND ${sc.nd('pf')} AND ${sc.nd('pc')} AND ${sc.nd('po')}
           AND make_date((pf.plan_financial->>'planYear')::int + 1, 1, 1) >= current_date
      ) AS "nextRenewalEffectiveDate"`,
    from: `${sc.s}.clients c
      LEFT JOIN LATERAL (
        SELECT ca.effective_year, (ca.answers->>'totalEmployees')::float8 AS total
        FROM ${sc.s}.census_answers ca
        WHERE ca.client_one_code = c.one_code AND ${sc.nd('ca')}
        ORDER BY ca.effective_year DESC, ca.document_id DESC LIMIT 1
      ) lc ON TRUE`,
    where,
    params,
    order: 'c.name, c.one_code',
    limit,
    offset,
  });
}

export function productsQuery(sc: Scope, limit: number, offset: number) {
  return pagedQueries({
    select: `p.id, p.name, p.loc_type AS "locType", p.display_order AS "displayOrder"`,
    from: `${sc.s}.products p`,
    where: [sc.nd('p')],
    params: new Params(),
    order: 'p.display_order, p.name',
    limit,
    offset,
  });
}

export function fundingTypesQuery(sc: Scope, limit: number, offset: number) {
  return pagedQueries({
    select: `ft.id, ft.name, ft.display_order AS "displayOrder", ft.theme`,
    from: `${sc.s}.funding_types ft`,
    where: [],
    params: new Params(),
    order: 'ft.display_order, ft.name',
    limit,
    offset,
  });
}

export function planTypesQuery(
  sc: Scope,
  f: { line?: string },
  limit: number,
  offset: number,
) {
  const params = new Params();
  const where: string[] = [];
  if (f.line !== undefined) {
    where.push(`lower(p.name) = lower(${params.add(f.line)})`);
  }
  return pagedQueries({
    select: `t.id, p.name AS line, t.name`,
    from: `${sc.s}.plan_types t JOIN ${sc.s}.products p ON p.id = t.loc_product_id`,
    where,
    params,
    order: 'p.display_order, p.name, t.name',
    limit,
    offset,
  });
}

export function carriersQuery(
  sc: Scope,
  f: { line?: string; clientOneCode?: string },
  limit: number,
  offset: number,
) {
  const params = new Params();
  const where = [sc.nd('i')];
  if (f.line !== undefined) {
    where.push(`EXISTS (SELECT 1 FROM ${sc.s}.plan_designs pd
      JOIN ${sc.s}.products p ON p.id = pd.loc_product_id
      WHERE pd.insurer_insurer_id = i.id AND ${sc.nd('pd')}
        AND lower(p.name) = lower(${params.add(f.line)}))`);
  }
  const whereParamCount = params.values.length;
  let incumbent = `ARRAY[]::text[]`;
  let credits = `0`;
  if (f.clientOneCode !== undefined) {
    const code = params.add(f.clientOneCode);
    incumbent = `COALESCE((SELECT array_agg(DISTINCT p.name ORDER BY p.name)
      FROM ${sc.s}.policy_coverages pc
      JOIN ${sc.s}.policies po ON po.id = pc.policy_info_policy_id
      JOIN ${sc.s}.clients c ON c.id = po.client_client_id
      JOIN ${sc.s}.products p ON p.id = pc.loc_product_id
      WHERE pc.insurer_insurer_id = i.id AND ${sc.nd('pc')} AND ${sc.nd('po')}
        AND lower(c.one_code) = lower(${code})), ARRAY[]::text[])`;
    credits = `(SELECT count(*)::int FROM ${sc.s}.carrier_credits cc
      JOIN ${sc.s}.clients c ON c.id = cc.client_client_id
      WHERE cc.carrier_info_insurer_id = i.id AND ${sc.nd('cc')} AND cc.is_final
        AND (cc.carrier_info_expiration_date IS NULL OR cc.carrier_info_expiration_date >= current_date)
        AND lower(c.one_code) = lower(${code}))`;
  }
  return pagedQueries({
    select: `i.id, i.name, i.code,
      COALESCE((SELECT array_agg(DISTINCT p.name ORDER BY p.name)
        FROM ${sc.s}.plan_designs pd JOIN ${sc.s}.products p ON p.id = pd.loc_product_id
        WHERE pd.insurer_insurer_id = i.id AND ${sc.nd('pd')}), ARRAY[]::text[]) AS lines,
      ${incumbent} AS "incumbentFor",
      ${credits} AS "finalCredits"`,
    from: `${sc.s}.insurers i`,
    where,
    params,
    order: 'i.name',
    whereParamCount,
    limit,
    offset,
  });
}

/** Shared SELECT of a plan design (I8, I15, I16). */
export const PLAN_SELECT = `pd.id AS "planDesignId", c.one_code AS "clientOneCode", c.name AS "clientName",
    p.id AS "productId", p.name AS line, p.loc_type AS "locType", p.display_order AS "lineOrder",
    pd.insurer_insurer_id AS "carrierId", i.name AS carrier, ft.name AS "fundingType",
    st.display_name AS state, pd.plan_creation_identifier_flag AS "creationFlag",
    cv.coverage_id AS "coverageId", cv.policy_number AS "policyNumber",
    cv.kick_off_id AS "kickOffId", cv.plan_financial AS "planFinancial"`;

export function planDesignsQuery(
  sc: Scope,
  f: { clientOneCode?: string; line?: string },
  limit: number,
  offset: number,
) {
  const params = new Params();
  const where = [sc.nd('pd'), sc.nd('c')];
  if (f.clientOneCode !== undefined) {
    where.push(`lower(c.one_code) = lower(${params.add(f.clientOneCode)})`);
  }
  if (f.line !== undefined) {
    where.push(`lower(p.name) = lower(${params.add(f.line)})`);
  }
  return pagedQueries({
    select: PLAN_SELECT,
    from: planDesignFrom(sc),
    where,
    params,
    order: 'c.one_code, p.display_order, p.name, pd.id',
    limit,
    offset,
  });
}

export function policiesQuery(
  sc: Scope,
  f: { clientOneCode?: string },
  limit: number,
  offset: number,
) {
  const params = new Params();
  const where = [sc.nd('po'), sc.nd('c')];
  if (f.clientOneCode !== undefined) {
    where.push(`lower(c.one_code) = lower(${params.add(f.clientOneCode)})`);
  }
  return pagedQueries({
    select: `po.id, c.one_code AS "clientOneCode", i.name AS carrier, po.number,
      k.name AS "kickOffTiming", k.days AS "kickOffDays",
      (SELECT count(*)::int FROM ${sc.s}.policy_coverages pc
         WHERE pc.policy_info_policy_id = po.id AND ${sc.nd('pc')}) AS coverages`,
    from: `${sc.s}.policies po
      JOIN ${sc.s}.clients c ON c.id = po.client_client_id
      LEFT JOIN ${sc.s}.insurers i ON i.id = po.insurer_insurer_id
      LEFT JOIN ${sc.s}.renewal_kick_off_timings k ON k.id = po.kick_off_timing_kick_off_timing_id`,
    where,
    params,
    order: 'c.one_code, po.number, po.id',
    limit,
    offset,
  });
}

export function financialsQuery(
  sc: Scope,
  f: { clientOneCode?: string; line?: string; planYear?: number },
  limit: number,
  offset: number,
) {
  const params = new Params();
  return pagedQueries({
    select: FINANCIAL_SELECT,
    from: financialFrom(sc),
    where: financialWhere(sc, params, f),
    params,
    order: FINANCIAL_ORDER,
    limit,
    offset,
  });
}

export const CENSUS_SELECT = `ca.document_id AS "documentId", ca.client_one_code AS "clientOneCode",
    ca.effective_year AS "effectiveYear", ca.answers, ca.context_data AS "contextData"`;

export function censusQuery(
  sc: Scope,
  f: { clientOneCode?: string; year?: string },
  limit: number,
  offset: number,
) {
  const params = new Params();
  const where = [sc.nd('ca')];
  if (f.clientOneCode !== undefined) {
    where.push(
      `lower(ca.client_one_code) = lower(${params.add(f.clientOneCode)})`,
    );
  }
  if (f.year !== undefined) {
    where.push(`ca.effective_year = ${params.add(f.year)}`);
  }
  return pagedQueries({
    select: CENSUS_SELECT,
    from: `${sc.s}.census_answers ca`,
    where,
    params,
    order: 'ca.client_one_code, ca.effective_year DESC, ca.document_id',
    limit,
    offset,
  });
}

// --- per-client reads --------------------------------------------------------------

export function clientByCodeQuery(sc: Scope, oneCode: string): Query {
  return {
    text: `SELECT c.id, c.one_code AS "oneCode", c.name, c.tenant_key AS "tenantKey", c.deleted
      FROM ${sc.s}.clients c
      WHERE lower(c.one_code) = lower($1) AND ${sc.nd('c')}
      ORDER BY c.deleted, c.id LIMIT 1`,
    values: [oneCode],
  };
}

export function contactsQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT ct.email, ct.contact_type AS "contactType", co.name AS country
      FROM ${sc.s}.contacts ct
      LEFT JOIN ${sc.s}.countries co ON co.id = ct.location_country_id
      WHERE ct.clients_client_id = $1 ORDER BY ct.contact_type, ct.email`,
    values: [clientId],
  };
}

export function locStatusesQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT ls.id, ls.loc_product_id AS "productId", ls.status,
        ${DATE('ls.start_date')} AS "startDate"
      FROM ${sc.s}.loc_statuses ls WHERE ls.client_client_id = $1`,
    values: [clientId],
  };
}

export function allProductsQuery(sc: Scope): Query {
  return {
    text: `SELECT p.id, p.name, p.loc_type AS "locType", p.display_order AS "displayOrder"
      FROM ${sc.s}.products p ORDER BY p.display_order, p.name`,
    values: [],
  };
}

/** Plan designs of a client (optionally one line, or one plan design). */
export function clientPlansQuery(
  sc: Scope,
  clientId: string,
  f: { line?: string; planDesignId?: string },
): Query {
  const params = new Params();
  const where = [`pd.client_client_id = ${params.add(clientId)}`, sc.nd('pd')];
  if (f.line !== undefined) {
    where.push(`lower(p.name) = lower(${params.add(f.line)})`);
  }
  if (f.planDesignId !== undefined) {
    where.push(`pd.id = ${params.add(f.planDesignId)}`);
  }
  return {
    text: `SELECT ${PLAN_SELECT},
        k.name AS "kickOffName", k.days AS "kickOffDays"
      FROM ${planDesignFrom(sc)}
      LEFT JOIN ${sc.s}.renewal_kick_off_timings k ON k.id = cv.kick_off_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.display_order, p.name, pd.id`,
    values: params.values,
  };
}

export function eligibilityQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT e.id, e.plan_design_plan_design_id AS "planDesignId",
        e.workflow_status AS "workflowStatus", e.is_current AS "isCurrent"
      FROM ${sc.s}.plan_eligibility_details e
      WHERE e.client_client_id = $1 ORDER BY e.id`,
    values: [clientId],
  };
}

/** Census plans of the client with the plan design each is mapped to (if any). */
export function censusPlansQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT cp.id AS "censusPlanId", cp.name, cp.document_id AS "documentId",
        p.name AS line, cp.loc_product_id AS "productId",
        m.intellify_plan_id AS "planDesignId", m.effective_year AS "effectiveYear"
      FROM ${sc.s}.census_plans cp
      JOIN ${sc.s}.products p ON p.id = cp.loc_product_id
      LEFT JOIN ${sc.s}.plan_design_census_plans m ON m.census_plan_id = cp.id
      WHERE cp.client_client_id = $1 AND ${sc.nd('cp')}
      ORDER BY p.display_order, cp.name, cp.id`,
    values: [clientId],
  };
}

export function remindersQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT r.plan_design_id AS "planDesignId", r.email_id AS "emailId",
        ${DATE('r.reminder_date')} AS "reminderDate"
      FROM ${sc.s}.renewal_reminder_notifications r
      JOIN ${sc.s}.plan_designs pd ON pd.id = r.plan_design_id
      WHERE pd.client_client_id = $1 ORDER BY r.reminder_date, r.id`,
    values: [clientId],
  };
}

export function alternatePlansQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT a.id, a.plan_design_id AS "planDesignId", a.name,
        ft.name AS "fundingType", p.name AS line
      FROM ${sc.s}.wizard_alternate_plans a
      JOIN ${sc.s}.plan_designs pd ON pd.id = a.plan_design_id
      LEFT JOIN ${sc.s}.funding_types ft ON ft.id = a.funding_type_id
      LEFT JOIN ${sc.s}.products p ON p.id = a.loc_product_id
      WHERE pd.client_client_id = $1 ORDER BY p.display_order, a.name, a.id`,
    values: [clientId],
  };
}

export function wizardsQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT w.id, p.name AS line, w.wizard_type AS type, w.status
      FROM ${sc.s}.wizards w LEFT JOIN ${sc.s}.products p ON p.id = w.loc_product_id
      WHERE w.client_client_id = $1 AND ${sc.nd('w')}
      ORDER BY p.display_order, w.wizard_type, w.id`,
    values: [clientId],
  };
}

export function clientFinancialsQuery(
  sc: Scope,
  oneCode: string,
  f: { line?: string; planYear?: number },
): Query {
  const params = new Params();
  const where = financialWhere(sc, params, { clientOneCode: oneCode, ...f });
  return {
    text: `SELECT ${FINANCIAL_SELECT} FROM ${financialFrom(sc)}
      WHERE ${where.join(' AND ')} ORDER BY ${FINANCIAL_ORDER}`,
    values: params.values,
  };
}

export function clientCensusQuery(sc: Scope, oneCode: string): Query {
  return {
    text: `SELECT ${CENSUS_SELECT} FROM ${sc.s}.census_answers ca
      WHERE lower(ca.client_one_code) = lower($1) AND ${sc.nd('ca')}
      ORDER BY ca.effective_year DESC, ca.document_id DESC`,
    values: [oneCode],
  };
}

export function aggregatedCensusQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT a.census FROM ${sc.s}.aggregated_census_answers a
      WHERE a.client_client_id = $1 AND ${sc.nd('a')}
      ORDER BY a.census->>'effectiveYear' DESC, a.id DESC`,
    values: [clientId],
  };
}

export function contributionsQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT p.name AS line, ${DATE('q.effective_period_start_date')} AS "periodStart",
        ${DATE('q.effective_period_end_date')} AS "periodEnd"
      FROM ${sc.s}.contribution_questions q
      LEFT JOIN ${sc.s}.products p ON p.id = q.loc_product_id
      WHERE q.client_client_id = $1 AND ${sc.nd('q')}
      ORDER BY p.display_order, q.effective_period_start_date, q.id`,
    values: [clientId],
  };
}

export function carrierCreditsQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT i.name AS carrier, ${DATE('cc.carrier_info_expiration_date')} AS "expirationDate",
        cc.is_final AS "isFinal",
        (SELECT count(*)::int FROM ${sc.s}.carrier_credit_notifications n
           WHERE n.carrier_credit_id = cc.id) AS notifications
      FROM ${sc.s}.carrier_credits cc
      LEFT JOIN ${sc.s}.insurers i ON i.id = cc.carrier_info_insurer_id
      WHERE cc.client_client_id = $1 AND ${sc.nd('cc')}
      ORDER BY i.name, cc.carrier_info_expiration_date, cc.id`,
    values: [clientId],
  };
}

export function feesQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT i.name AS carrier, ${DATE('f.effective_date')} AS "effectiveDate",
        ${DATE('f.expiration_date')} AS "expirationDate"
      FROM ${sc.s}.lad_ancillary_fees f
      LEFT JOIN ${sc.s}.insurers i ON i.id = f.lad_ancillary_fees_info_insurer_id
      WHERE f.client_client_id = $1 AND ${sc.nd('f')}
      ORDER BY i.name, f.effective_date, f.id`,
    values: [clientId],
  };
}

export function surveyQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT ${DATE('s.effective_period_start_date')} AS "periodStart",
        ${DATE('s.effective_period_end_date')} AS "periodEnd", s.answers
      FROM ${sc.s}.national_survey s
      WHERE s.client_client_id = $1 AND ${sc.nd('s')}
      ORDER BY s.effective_period_end_date DESC NULLS LAST, s.id DESC LIMIT 1`,
    values: [clientId],
  };
}

export function pointSolutionsQuery(sc: Scope, clientId: string): Query {
  return {
    text: `SELECT v.name AS vendor, mp.name AS product
      FROM ${sc.s}.point_solutions_products ps
      LEFT JOIN ${sc.s}.mercervip_vendors v ON v.id = ps.vendor_id
      LEFT JOIN ${sc.s}.mercervip_products mp ON mp.id = ps.product_id
      WHERE ps.client_client_id = $1 AND ${sc.nd('ps')}
      ORDER BY v.name, mp.name`,
    values: [clientId],
  };
}
