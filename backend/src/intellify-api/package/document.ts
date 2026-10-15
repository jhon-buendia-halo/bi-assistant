import type { Rfp } from '../rfp/rfp.types';
import type { PackageData, PlanDesignRow } from './exhibits.queries';
import { EXHIBIT_NAMES, EXHIBIT_TITLES } from './exhibits';

/**
 * The RFP document in Markdown (api.md 2.16.5, rfp R8). Pure and
 * deterministic: the same record, data and `generatedAt` give the same text.
 * Outline: title and facts line, sections 1-9, then the exhibits.
 */

export const TO_BE_WRITTEN = '_To be written._';

const DASH = '—';

/** Thousands separators without locale data, so output never varies. */
function grouped(n: number, decimals = 0): string {
  const [whole, fraction] = Math.abs(n).toFixed(decimals).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${withCommas}${fraction ? `.${fraction}` : ''}`;
}

export const formatInt = (n: number | null | undefined): string =>
  n === null || n === undefined ? DASH : grouped(n);

export const formatMoney = (n: number | null | undefined): string =>
  n === null || n === undefined
    ? DASH
    : `${n < 0 ? '-' : ''}$${grouped(Math.abs(n))}`;

/** A ratio (0.113) as a percentage (`11.3%`). */
export const formatPct = (n: number | null | undefined): string =>
  n === null || n === undefined ? DASH : `${(n * 100).toFixed(1)}%`;

/** One table cell: no line breaks, `|` escaped. */
function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim() || ' ';
}

function table(
  header: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const line = (cells: (string | number | null | undefined)[]) =>
    `| ${cells.map(cell).join(' | ')} |`;
  return [
    line(header),
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map(line),
  ].join('\n');
}

const text = (value: string | undefined): string =>
  value?.trim() ? value.trim() : TO_BE_WRITTEN;

/** A plan as consultants name it: `PPO (Aetna)`. */
function planName(plan: PlanDesignRow): string {
  const type = plan.planType ?? plan.line;
  return plan.carrier ? `${type} (${plan.carrier})` : type;
}

/**
 * The plans a line has in scope: the ones it names, or (an empty
 * `planDesignIds`) every plan the client has on that line, as `All: …`.
 */
function plansInScope(
  line: Rfp['lines'][number],
  planDesigns: PlanDesignRow[],
  plansById: Map<string, PlanDesignRow>,
): string {
  if (line.planDesignIds.length) {
    return line.planDesignIds
      .map((id) => {
        const plan = plansById.get(id);
        return plan ? planName(plan) : id;
      })
      .join(', ');
  }
  const all = planDesigns.filter((p) => p.line === line.line).map(planName);
  return all.length ? `All: ${all.join(', ')}` : 'All';
}

export function renderRfpMarkdown(
  rfp: Rfp,
  data: PackageData,
  generatedAt: string,
  options: { draft?: boolean } = {},
): string {
  const out: string[] = [];
  const push = (...blocks: string[]) => out.push(...blocks);

  // Title and facts line.
  const clientLabel = `${rfp.clientName} (${rfp.clientOneCode})${
    rfp.clientMissing ? ' — client no longer in Intellify' : ''
  }`;
  push(
    `# ${options.draft ? 'DRAFT — ' : ''}${rfp.title}`,
    ...(options.draft
      ? [
          `Draft exported ${generatedAt.slice(0, 10)} at stage ${rfp.stage} of 7 — not for release to carriers.`,
        ]
      : []),
    [
      `**Client:** ${clientLabel}`,
      `**Plan year:** ${rfp.planYear}`,
      `**Effective date:** ${rfp.effectiveDate}`,
      `**Status:** ${rfp.status}`,
      `**Generated:** ${generatedAt}`,
    ].join(' · '),
  );

  // 1. Executive summary
  push('## 1. Executive summary', text(rfp.sections.executiveSummary));

  // 2. Client background
  push('## 2. Client background', text(rfp.sections.clientBackground));
  const census = data.census?.row;
  push(
    [
      `- **Client:** ${rfp.clientName}`,
      `- **Client code:** ${rfp.clientOneCode}`,
      ...(data.client?.tenantKey
        ? [`- **Tenant:** ${data.client.tenantKey}`]
        : []),
      `- **Headcount:** ${formatInt(census?.totalEmployees)}`,
      `- **Lines in scope:** ${rfp.lines.length ? rfp.lines.map((l) => l.line).join(', ') : DASH}`,
    ].join('\n'),
  );
  if (census) {
    const states = data
      .census!.byState.map((s) => `${s.state} ${formatInt(s.employees)}`)
      .join(', ');
    push(
      `**Latest census (${census.effectiveYear})**`,
      table(
        ['Measure', 'Value'],
        [
          ['Total employees', formatInt(census.totalEmployees)],
          ['Eligible employees', formatInt(census.eligibleEmployees)],
          ['Enrolled employees', formatInt(census.enrolledEmployees)],
          ['Participation rate', formatPct(census.participationRate)],
          ['Average age', census.averageAge ?? DASH],
          ['Average salary', formatMoney(census.averageSalary)],
          [
            'Female / male',
            `${formatPct(census.femalePct)} / ${formatPct(census.malePct)}`,
          ],
          [
            'Full time / part time',
            `${formatInt(census.fullTime)} / ${formatInt(census.partTime)}`,
          ],
          ['Employee only', formatInt(census.tierEmployeeOnly)],
          ['Employee + spouse', formatInt(census.tierEmployeeSpouse)],
          ['Employee + children', formatInt(census.tierEmployeeChildren)],
          ['Family', formatInt(census.tierFamily)],
          ['States', states || DASH],
        ],
      ),
    );
  } else {
    push('_No census on file._');
  }

  // 3. Scope of this RFP
  const plansById = new Map(data.planDesigns.map((p) => [p.id, p]));
  push(
    '## 3. Scope of this RFP',
    text(rfp.sections.scopeStatement),
    table(
      [
        '#',
        'Line',
        'Market basis',
        'Plans in scope',
        'Alternate funding',
        'Alternate plan type',
      ],
      rfp.lines.map((line) => [
        line.position,
        line.line,
        line.marketBasis,
        plansInScope(line, data.planDesigns, plansById),
        line.alternateFunding ?? DASH,
        line.alternatePlanType ?? DASH,
      ]),
    ),
  );

  // 4. Current program
  push('## 4. Current program');
  if (!rfp.lines.length) push('_No lines in scope yet._');
  for (const line of rfp.lines) {
    const plans = data.planDesigns.filter((p) => p.line === line.line);
    push(
      `### ${line.line}`,
      table(
        [
          'Plan',
          'Carrier',
          'Funding',
          'Enrolled',
          'Annual premium',
          'Plan year',
          'Renewal increase',
        ],
        plans.map((plan) => {
          const financial = data.financials.find(
            (f) => f.planDesignId === plan.id,
          );
          return [
            plan.planType ?? plan.line,
            plan.carrier ?? DASH,
            plan.fundingType ?? financial?.fundingType ?? DASH,
            formatInt(plan.enrolledEmployees ?? financial?.coveredLives),
            formatMoney(plan.annualPremium ?? financial?.annualPremium),
            plan.planYear ?? financial?.planYear ?? DASH,
            formatPct(financial?.renewalIncreasePct),
          ];
        }),
      ),
    );
  }

  // 5. Carriers invited
  push(
    '## 5. Carriers invited',
    table(
      ['#', 'Carrier', 'Lines', 'Incumbent', 'Contact', 'Notes'],
      rfp.carriers.map((c) => [
        c.position,
        c.insurerName,
        c.lines.join(', '),
        c.incumbent ? 'Yes' : 'No',
        c.contactEmail ?? DASH,
        c.notes ?? DASH,
      ]),
    ),
  );

  // 6. Requirements and questionnaire
  push('## 6. Requirements and questionnaire');
  const sections: string[] = [];
  for (const r of rfp.requirements) {
    if (!sections.includes(r.section)) sections.push(r.section);
  }
  if (!sections.length) push('_No requirements yet._');
  sections.forEach((section, index) => {
    const questions = rfp.requirements.filter((r) => r.section === section);
    push(
      `### 6.${index + 1} ${section}`,
      questions
        .map(
          (q, n) =>
            `${n + 1}. ${q.question.replace(/\r?\n/g, ' ')} _(${q.required ? 'required' : 'optional'}; answer: ${q.answerType})_`,
        )
        .join('\n'),
    );
  });

  // 7. Timeline
  push(
    '## 7. Timeline',
    table(
      ['#', 'Milestone', 'Due date', 'Owner', 'Notes'],
      rfp.timeline.map((m) => [
        m.position,
        m.milestone,
        m.dueDate,
        m.owner ?? DASH,
        m.notes ?? DASH,
      ]),
    ),
  );

  // 8-9. Narrative sections
  push(
    '## 8. Instructions to bidders',
    text(rfp.sections.instructionsToBidders),
    '## 9. Evaluation criteria',
    text(rfp.sections.evaluationCriteria),
  );

  // Exhibits
  push(
    '## Exhibits',
    EXHIBIT_NAMES.map(
      (name) => `- ${EXHIBIT_TITLES[name]} (\`exhibits/${name}.csv\`)`,
    ).join('\n'),
  );

  return out.join('\n\n') + '\n';
}
