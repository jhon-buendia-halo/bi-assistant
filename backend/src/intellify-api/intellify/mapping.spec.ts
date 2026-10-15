import {
  censusDetail,
  currentStatuses,
  financialTotals,
  flattenFinancial,
  kickOffDate,
  mapAggregated,
  mapCensusRow,
  renewalEffectiveDate,
  sortYearsDesc,
} from './mapping';

const ctx = {
  coverageId: 'cov1',
  clientOneCode: 'IC1',
  line: 'Medical',
  planDesignId: 'pd1',
  carrier: 'Cigna',
  fundingType: null,
};

describe('flattenFinancial', () => {
  it('flattens a medical plan_financial (rates, enrollment, contributions, fees)', () => {
    const f = flattenFinancial(
      {
        planType: 'PPO',
        planYear: 2026,
        fundingType: 'Self-Funded',
        ratingBasis: '4-tier',
        annualPremium: 1200,
        monthlyPremium: 100,
        priorYearAnnualPremium: 1000,
        renewalIncreasePct: 0.2,
        enrolledEmployees: 50,
        rates: {
          employeeOnly: 1,
          employeeSpouse: 2,
          employeeChildren: 3,
          family: 4,
        },
        enrollment: {
          employeeOnly: 10,
          employeeSpouse: 11,
          employeeChildren: 12,
          family: 13,
        },
        contributions: { employerPct: 0.8, employeeMonthlyEmployeeOnly: 120 },
        fees: { adminFeePepm: 5, stopLossPepm: 9 },
      },
      ctx,
    );
    expect(f).toMatchObject({
      coverageId: 'cov1',
      planType: 'PPO',
      fundingType: 'Self-Funded',
      planYear: 2026,
      rateEmployeeSpouse: 2,
      rateFamily: 4,
      enrollEmployeeChildren: 12,
      employerPct: 0.8,
      employeeMonthlyEmployeeOnly: 120,
      adminFeePepm: 5,
      stopLossPepm: 9,
      ratePer1000: null,
      pepm: null,
      coveredLives: null,
    });
  });

  it('leaves tier keys null for a per-$1,000 line and prefers the plan design funding type', () => {
    const f = flattenFinancial(
      {
        planType: 'Flat Amount',
        planYear: 2026,
        fundingType: 'Fully Insured',
        ratePer1000: 0.167,
        coveredLives: 22224,
        volume: 5,
      },
      { ...ctx, fundingType: 'Level-Funded' },
    );
    expect(f.fundingType).toBe('Level-Funded');
    expect(f.ratePer1000).toBe(0.167);
    expect(f.coveredLives).toBe(22224);
    expect(f.rateFamily).toBeNull();
    expect(f.adminFeePepm).toBeNull();
  });

  it('survives a missing or malformed plan_financial', () => {
    expect(flattenFinancial(null, ctx).annualPremium).toBeNull();
    expect(
      flattenFinancial({ annualPremium: 'x', rates: [] }, ctx).annualPremium,
    ).toBeNull();
    expect(flattenFinancial({ annualPremium: '12.5' }, ctx).annualPremium).toBe(
      12.5,
    );
  });
});

describe('financialTotals', () => {
  it('sums and derives the increase from the sums', () => {
    expect(
      financialTotals([
        {
          annualPremium: 110,
          priorYearAnnualPremium: 100,
          enrolledEmployees: 5,
        },
        {
          annualPremium: 330,
          priorYearAnnualPremium: 300,
          enrolledEmployees: null,
        },
      ]),
    ).toEqual({
      annualPremium: 440,
      priorYearAnnualPremium: 400,
      renewalIncreasePct: 0.1,
      enrolledEmployees: 5,
    });
  });
  it('has no increase without a prior year', () => {
    expect(financialTotals([]).renewalIncreasePct).toBeNull();
  });
});

describe('renewal dates', () => {
  it('takes effect on 1 January after the plan year', () => {
    expect(renewalEffectiveDate(2026)).toBe('2027-01-01');
    expect(renewalEffectiveDate(null)).toBeNull();
  });
  it('subtracts the kick-off days from the effective date', () => {
    expect(kickOffDate('2027-01-01', 60)).toBe('2026-11-02');
    expect(kickOffDate('2027-01-01', 180)).toBe('2026-07-05');
    expect(kickOffDate('2027-01-01', null)).toBeNull();
    expect(kickOffDate(null, 60)).toBeNull();
  });
});

describe('currentStatuses', () => {
  it('picks the latest start_date per line', () => {
    const m = currentStatuses([
      { productId: 'a', status: 'Not Started', startDate: '2024-01-01' },
      { productId: 'a', status: 'Complete', startDate: '2025-06-01' },
      { productId: 'a', status: 'In Progress', startDate: '2025-01-01' },
      { productId: 'b', status: 'Under Review', startDate: '2025-02-02' },
    ]);
    expect(m.get('a')).toEqual({ status: 'Complete', since: '2025-06-01' });
    expect(m.get('b')).toEqual({ status: 'Under Review', since: '2025-02-02' });
    expect(m.get('c')).toBeUndefined();
  });
  it('breaks a date tie on the higher id, deterministically', () => {
    const rows = [
      { id: '1', productId: 'a', status: 'X', startDate: '2025-01-01' },
      { id: '2', productId: 'a', status: 'Y', startDate: '2025-01-01' },
    ];
    expect(currentStatuses(rows).get('a')?.status).toBe('Y');
    expect(currentStatuses([...rows].reverse()).get('a')?.status).toBe('Y');
  });
});

describe('census', () => {
  const raw = {
    documentId: 'doc',
    clientOneCode: 'IC1',
    effectiveYear: '2026',
    answers: {
      totalEmployees: 100,
      eligibleEmployees: 80,
      enrolledEmployees: 60,
      averageAge: 40.5,
      averageSalary: 70000,
      gender: { female: 0.6, male: 0.4 },
      byState: { WA: 10, CA: 70, NY: 20 },
      medicalTier: {
        family: 10,
        employeeOnly: 30,
        employeeSpouse: 10,
        employeeChildren: 10,
      },
      employeeClass: { fullTime: 90, partTime: 10 },
    },
    contextData: { source: 'upload', uploadedAt: '2025-10-23T15:00:00Z' },
  };

  it('maps the summary row', () => {
    expect(mapCensusRow(raw)).toMatchObject({
      totalEmployees: 100,
      femalePct: 0.6,
      malePct: 0.4,
      fullTime: 90,
      tierFamily: 10,
      statesCount: 3,
      participationRate: 0.75,
      source: 'upload',
      uploadedAt: '2025-10-23T15:00:00Z',
    });
  });

  it('breaks the selected census down by state (largest first) and tier', () => {
    const d = censusDetail(raw);
    expect(d.byState.map((s) => s.state)).toEqual(['CA', 'NY', 'WA']);
    expect(d.tiers.map((t) => t.tier)).toEqual([
      'employeeOnly',
      'employeeSpouse',
      'employeeChildren',
      'family',
    ]);
    expect(d.tiers[0]).toEqual({
      tier: 'employeeOnly',
      employees: 30,
      share: 0.5,
    });
    expect(d.gender).toEqual({ female: 0.6, male: 0.4 });
    expect(d.employeeClass).toEqual({ fullTime: 90, partTime: 10 });
  });

  it('handles a census with no answers', () => {
    const d = censusDetail({ ...raw, answers: null, contextData: null });
    expect(d.totalEmployees).toBeNull();
    expect(d.participationRate).toBeNull();
    expect(d.byState).toEqual([]);
    expect(d.tiers).toEqual([]);
    expect(d.statesCount).toBe(0);
  });

  it('maps the aggregate and returns null when there is none', () => {
    expect(
      mapAggregated({
        headcount: 9,
        enrolled: 7,
        participationRate: 0.78,
        averageAge: 41,
        femalePct: 0.5,
        statesCount: 2,
        tierMix: { family: 0.2 },
      }),
    ).toEqual({
      headcount: 9,
      enrolled: 7,
      participationRate: 0.78,
      averageAge: 41,
      femalePct: 0.5,
      tierMix: { family: 0.2 },
      statesCount: 2,
    });
    expect(mapAggregated(null)).toBeNull();
  });

  it('orders years latest first without duplicates', () => {
    expect(sortYearsDesc(['2024', '2026', '2025', '2026'])).toEqual([
      '2026',
      '2025',
      '2024',
    ]);
  });
});
