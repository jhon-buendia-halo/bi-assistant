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
