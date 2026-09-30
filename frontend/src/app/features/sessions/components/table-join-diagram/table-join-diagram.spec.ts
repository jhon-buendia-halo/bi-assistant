import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  JoinEdge,
  RejectedEntity,
  TableChoice,
} from '../../models/expert-trace.model';
import {
  TableJoinDiagram,
  layoutTableJoinDiagram,
  sameEntity,
  shortEntityName,
} from './table-join-diagram';

// A handcrafted HR selection: one fact, two dimensions, a lookup, a join the
// schema does not declare, and one table considered and rejected.
const tables: TableChoice[] = [
  {
    entity: 'world_cup.hr.salary_history',
    role: 'fact',
    reason: 'Annual base pay per employee over time.',
    columnsUsed: [
      'employee_id',
      'annual_base_amount',
      'currency',
      'effective_from',
      'effective_to',
    ],
  },
  {
    entity: 'world_cup.hr.employees',
    role: 'dimension',
    reason: 'Employment type and department of each person.',
    columnsUsed: ['id', 'department_id', 'employment_type'],
  },
  {
    entity: 'world_cup.hr.departments',
    role: 'dimension',
    reason: 'The division that defines "tech".',
    columnsUsed: ['id', 'division'],
  },
  {
    entity: 'world_cup.hr.exchange_rates',
    role: 'lookup',
    reason: 'Converts local currency to USD for the same year.',
    columnsUsed: ['currency', 'year', 'rate_to_usd'],
  },
];

const joins: JoinEdge[] = [
  {
    from: 'world_cup.hr.salary_history',
    fromColumn: 'employee_id',
    to: 'world_cup.hr.employees',
    toColumn: 'id',
    basis: 'schema',
  },
  {
    // Less qualified on purpose: joins resolve by suffix.
    from: 'hr.employees',
    fromColumn: 'department_id',
    to: 'hr.departments',
    toColumn: 'id',
    basis: 'schema',
  },
  {
    from: 'world_cup.hr.salary_history',
    fromColumn: 'currency',
    to: 'world_cup.hr.exchange_rates',
    toColumn: 'currency',
    basis: 'convention',
  },
  {
    // Not among the chosen tables — cannot be drawn.
    from: 'world_cup.hr.employees',
    fromColumn: 'job_title_id',
    to: 'world_cup.hr.job_titles',
    toColumn: 'id',
    basis: 'schema',
  },
];

const rejected: RejectedEntity[] = [
  {
    entity: 'world_cup.hr.job_titles',
    reason: 'Job family does not define "tech" — the division does.',
  },
  {
    entity: 'world_cup.hr.bonus_payments',
    reason: 'Salary excludes bonuses.',
  },
];

describe('layoutTableJoinDiagram', () => {
  it('puts facts left and dimensions/lookups right, compacting empty columns', () => {
    const layout = layoutTableJoinDiagram(tables, joins, rejected);
    const x = (entity: string) =>
      layout.nodes.find((n) => n.entity === entity)!.x;

    expect(layout.nodes.length).toBe(4);
    expect(x('world_cup.hr.salary_history')).toBeLessThan(
      x('world_cup.hr.employees'),
    );
    // No bridge: the dimensions sit in the second column, not the third.
    expect(new Set(layout.nodes.map((n) => n.column))).toEqual(new Set([0, 1]));
    expect(x('world_cup.hr.employees')).toBe(x('world_cup.hr.exchange_rates'));
  });

  it('stacks a column with 16px gaps and caps the column lines at four', () => {
    const layout = layoutTableJoinDiagram(tables, joins, rejected);
    const right = layout.nodes.filter((n) => n.column === 1);
    for (let i = 1; i < right.length; i++) {
      expect(right[i].y - (right[i - 1].y + right[i - 1].height)).toBeCloseTo(
        16,
        5,
      );
    }
    const fact = layout.nodes.find((n) => n.role === 'fact')!;
    expect(fact.lines).toEqual([
      'employee_id',
      'annual_base_amount',
      'currency',
      'effective_from',
      '+1 more',
    ]);
    expect(fact.label).toBe('hr.salary_history');
  });

  it('draws only the joins whose both tables are on the diagram', () => {
    const layout = layoutTableJoinDiagram(tables, joins, rejected);
    expect(layout.edges.length).toBe(3);
    expect(layout.edges.map((e) => e.label)).toEqual([
      'employee_id = id',
      'department_id = id',
      'currency = currency',
    ]);
    // Only the join the schema does not declare is dashed.
    expect(layout.edges.map((e) => e.dashed)).toEqual([false, false, true]);
    for (const edge of layout.edges) {
      expect(edge.path).toMatch(/^M [\d.]+ [\d.]+ C /);
    }
  });

  it('loops a join inside one column out to the right', () => {
    const layout = layoutTableJoinDiagram(tables, joins, rejected);
    const loop = layout.edges[1];
    const employees = layout.nodes.find(
      (n) => n.entity === 'world_cup.hr.employees',
    )!;
    expect(loop.start.x).toBe(employees.x + employees.width);
    expect(loop.end.x).toBe(employees.x + employees.width);
    expect(loop.labelX).toBeGreaterThan(employees.x + employees.width);
  });

  it('sizes the viewBox to everything drawn, rejected row included', () => {
    const layout = layoutTableJoinDiagram(tables, joins, rejected);
    const right = Math.max(
      ...layout.nodes.map((n) => n.x + n.width),
      ...layout.edges.map((e) => e.labelX + e.labelWidth / 2),
      ...layout.rejected.map((r) => r.x + r.width),
    );
    const bottom = Math.max(...layout.rejected.map((r) => r.y + r.height));
    expect(layout.width).toBeGreaterThanOrEqual(right);
    expect(layout.height).toBeGreaterThanOrEqual(bottom);
    const lowestNode = Math.max(...layout.nodes.map((n) => n.y + n.height));
    for (const item of layout.rejected) {
      expect(item.y).toBeGreaterThan(lowestNode);
    }
  });

  it('never throws on an empty or half-empty selection', () => {
    expect(layoutTableJoinDiagram([], [], []).nodes).toEqual([]);
    const onlyRejected = layoutTableJoinDiagram([], joins, rejected);
    expect(onlyRejected.edges).toEqual([]);
    expect(onlyRejected.rejected.length).toBe(2);
  });

  it('shortens and matches entity keys by suffix', () => {
    expect(shortEntityName('world_cup.hr.employees')).toBe('hr.employees');
    expect(shortEntityName('employees')).toBe('employees');
    expect(sameEntity('world_cup.hr.employees', 'HR.Employees')).toBeTrue();
    expect(sameEntity('world_cup.hr.employees', 'hr.departments')).toBeFalse();
  });
});

describe('TableJoinDiagram', () => {
  let fixture: ComponentFixture<TableJoinDiagram>;

  function render(
    t: TableChoice[],
    j: JoinEdge[] = [],
    r: RejectedEntity[] = [],
  ): HTMLElement {
    TestBed.configureTestingModule({ imports: [TableJoinDiagram] });
    fixture = TestBed.createComponent(TableJoinDiagram);
    fixture.componentRef.setInput('tables', t);
    fixture.componentRef.setInput('joins', j);
    fixture.componentRef.setInput('rejected', r);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders one node per table, one edge per drawable join and the rejected row', () => {
    const el = render(tables, joins, rejected);
    const svg = el.querySelector('svg')!;

    expect(svg).toBeTruthy();
    expect(el.querySelectorAll('g[data-node]').length).toBe(4);
    expect(el.querySelectorAll('g[data-edge]').length).toBe(3);
    expect(el.querySelectorAll('g[data-edge-label]').length).toBe(3);
    expect(el.querySelectorAll('g[data-rejected]').length).toBe(2);
    // Declared joins solid, the convention one dashed.
    const dashes = Array.from(el.querySelectorAll('g[data-edge] path')).map(
      (p) => p.getAttribute('stroke-dasharray'),
    );
    expect(dashes).toEqual([null, null, '5 4']);
    expect(el.textContent).toContain('employee_id = id');
    expect(el.textContent).toContain('hr.salary_history');
    // The rejection reason is the rejected box's tooltip.
    expect(
      el.querySelector('g[data-rejected] title')?.textContent,
    ).toContain('Job family does not define "tech"');
  });

  it('computes the viewBox from the layout and scales to the container', () => {
    const el = render(tables, joins, rejected);
    const svg = el.querySelector('svg')!;
    const layout = fixture.componentInstance.layout();
    expect(svg.getAttribute('viewBox')).toBe(
      `0 0 ${layout.width} ${layout.height}`,
    );
    expect(svg.getAttribute('width')).toBe('100%');
    expect(svg.style.maxHeight).toBe('420px');
    expect(svg.getAttribute('aria-label')).toContain('hr.employees (dimension)');
  });

  it('renders nothing when there is nothing to draw', () => {
    const el = render([]);
    expect(el.querySelector('svg')).toBeNull();
  });
});
