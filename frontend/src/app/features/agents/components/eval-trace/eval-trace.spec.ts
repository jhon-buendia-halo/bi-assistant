import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AgentEvalCase,
  AgentEvalCaseResult,
} from '../../services/agents-api.service';
import { EvalSelectionService } from '../../services/eval-selection.service';
import { EvalTrace } from './eval-trace';

const OUT_OF_SCOPE: AgentEvalCase = {
  id: 'out-of-scope',
  question: 'How many goals did Pelé score in the 1970 World Cup?',
  intent: 'The fixture only covers 2018 and 2022.',
  category: 'out-of-scope',
  checks: [],
};

function result(over: Partial<AgentEvalCaseResult> = {}): AgentEvalCaseResult {
  return {
    id: 'out-of-scope',
    question: OUT_OF_SCOPE.question,
    scores: {},
    checkResults: [
      {
        id: 'check-matches',
        description: 'Checks if output matches /2018|2022/',
        score: 0,
        passed: false,
        status: 'failed',
        criterion: 'G2',
        reason: 'no match',
      },
      {
        id: 'llm-judge',
        description: 'LLM judge: says it cannot answer for 1970',
        score: 0,
        passed: false,
        status: 'not-scored',
        reason: 'Judge off for this run',
      },
    ],
    answer: 'The stub model answered this question.',
    toolCalls: [],
    passed: false,
    status: 'failed',
    durationMs: 120,
    ...over,
  };
}

describe('EvalTrace with the judge off', () => {
  let fixture: ComponentFixture<EvalTrace>;

  async function render(r: AgentEvalCaseResult): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [EvalTrace],
    }).compileComponents();
    TestBed.inject(EvalSelectionService).select({
      evalCase: OUT_OF_SCOPE,
      result: r,
    });
    fixture = TestBed.createComponent(EvalTrace);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows a not-scored check as "Not scored" with its reason, not a score', async () => {
    const el = await render(result());
    const judge = el.querySelector(
      '[data-testid="eval-trace-check-llm-judge"]',
    );
    expect(judge?.textContent).toContain('Not scored');
    expect(judge?.textContent).toContain('Judge off for this run');
    // The score is the row's monospace figure; a not-scored row has none.
    expect(judge?.querySelector('.font-mono')).toBeNull();

    const scored = el.querySelector(
      '[data-testid="eval-trace-check-check-matches"]',
    );
    expect(scored?.textContent).not.toContain('Not scored');
    expect(scored?.querySelector('.font-mono')?.textContent?.trim()).toBe('0');
  });

  it('does not list a not-scored check among the reasons it failed', async () => {
    const el = await render(result());
    const failed = el.querySelector('[data-testid="eval-trace-failed-checks"]');
    expect(failed?.textContent).toContain('/2018|2022/');
    expect(failed?.textContent).not.toContain('LLM judge');
  });

  it('gives a not-scored question the "Not scored" verdict', async () => {
    const el = await render(
      result({
        status: 'not-scored',
        checkResults: [result().checkResults[1]],
      }),
    );
    expect(el.textContent).toContain('Not scored');
    expect(el.textContent).not.toContain('Failed');
    expect(el.textContent).not.toContain('Passed');
    expect(
      el.querySelector('[data-testid="eval-trace-failed-checks"]'),
    ).toBeNull();
  });

  it('reads an older result with no status from passed', async () => {
    const el = await render(
      result({
        status: undefined,
        passed: true,
        checkResults: [
          {
            id: 'check-includes',
            description: 'Checks if output includes "Argentina"',
            score: 1,
            passed: true,
          },
        ],
      }),
    );
    expect(el.textContent).toContain('Passed');
    expect(el.textContent).not.toContain('Not scored');
  });
});

describe('EvalTrace with repeats, split and cost', () => {
  const attempt = (n: number, passed: boolean, ms = 100) => ({
    attempt: n,
    status: passed ? ('passed' as const) : ('failed' as const),
    passed,
    scores: {},
    checkResults: [],
    answer: '',
    toolCalls: [],
    durationMs: ms,
    usage: [],
    costUsd: null,
  });

  async function render(r: AgentEvalCaseResult): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [EvalTrace],
    }).compileComponents();
    TestBed.inject(EvalSelectionService).select({
      evalCase: OUT_OF_SCOPE,
      result: r,
    });
    const fixture = TestBed.createComponent(EvalTrace);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const byTestId = (el: HTMLElement, id: string) =>
    el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it('names the split after the verdict, Dev when a record has none', async () => {
    let el = await render(result({ split: 'held-out' }));
    expect(byTestId(el, 'eval-trace-split')?.textContent?.trim()).toBe(
      '· Held-out',
    );
    TestBed.resetTestingModule();
    el = await render(result());
    expect(byTestId(el, 'eval-trace-split')?.textContent?.trim()).toBe('· Dev');
  });

  it('shows no attempts on a single-attempt result', async () => {
    const el = await render(result());
    expect(byTestId(el, 'eval-trace-attempts')).toBeNull();
    expect(byTestId(el, 'eval-trace-tokens-assistant')).toBeNull();
    expect(byTestId(el, 'eval-trace-cost')).toBeNull();
  });

  it('lists every attempt and says which one the panel shows', async () => {
    const el = await render(
      result({
        passes: 1,
        runs: 3,
        flaky: true,
        attempts: [
          attempt(1, true),
          attempt(2, false, 1500),
          attempt(3, false),
        ],
      }),
    );
    const block = byTestId(el, 'eval-trace-attempts')!;
    expect(block.textContent).toContain('1 of 3 attempts passed');
    expect(block.textContent).toContain('Attempt 2');
    expect(block.textContent).toContain('1.5s');
    expect(block.textContent).toContain(
      'Checks, steps and answer below are from attempt 2.',
    );
  });

  it('uses the first attempt as the representative when all passed', async () => {
    const el = await render(
      result({
        passed: true,
        status: 'passed',
        passes: 2,
        runs: 2,
        attempts: [attempt(1, true), attempt(2, true)],
      }),
    );
    expect(byTestId(el, 'eval-trace-attempts')?.textContent).toContain(
      'from attempt 1.',
    );
  });

  it('shows tokens per agent and the cost', async () => {
    const el = await render(
      result({
        costUsd: 0.0123,
        usage: [
          {
            agent: 'assistant',
            model: 'gpt-4o-mini',
            inputTokens: 12345,
            cachedInputTokens: 1000,
            outputTokens: 678,
            reasoningTokens: 0,
            calls: 3,
            unreportedCalls: 0,
          },
          {
            agent: 'sql-fixer',
            model: 'gpt-4o-mini',
            inputTokens: 10,
            cachedInputTokens: 0,
            outputTokens: 5,
            reasoningTokens: 0,
            calls: 1,
            unreportedCalls: 1,
          },
        ],
      }),
    );
    const assistant = byTestId(el, 'eval-trace-tokens-assistant')!;
    expect(assistant.textContent).toContain('Assistant');
    expect(assistant.textContent).toContain('gpt-4o-mini');
    expect(assistant.textContent).toContain(
      '12,345 in · 1,000 cached · 678 out',
    );
    const fixer = byTestId(el, 'eval-trace-tokens-sql-fixer')!;
    expect(fixer.textContent).toContain('SQL fixer');
    expect(fixer.textContent).toContain('1 call reported no usage');
    expect(byTestId(el, 'eval-trace-cost')?.textContent?.trim()).toBe(
      '$0.0123',
    );
  });

  it('says Not priced when the result has no price', async () => {
    const el = await render(result({ costUsd: null, usage: [] }));
    expect(byTestId(el, 'eval-trace-cost')?.textContent?.trim()).toBe(
      'Not priced',
    );
  });
});
