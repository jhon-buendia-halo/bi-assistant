import type { EvalCustomCheck } from './assistant.evals';
import {
  findingsInRange,
  noChatReply,
  picksExactly,
  replyIsIssues,
} from './data-quality-check-eval-checks';

const run = (check: EvalCustomCheck, answer: string) =>
  check.run({ answer, toolCalls: [], datasets: [], vars: {} });

const reply = (issues: { finding: number; impact: string }[]) =>
  JSON.stringify({ issues }, null, 2);

const good = reply([
  {
    finding: 1,
    impact: 'Twenty order lines have no order, so their revenue is missing.',
  },
  {
    finding: 3,
    impact: 'Invalid emails mean some customers cannot be contacted.',
  },
]);

describe('data-quality-check eval checks (agents.md 8.1, 5.11)', () => {
  it('reply-is-issues passes on issues and fails on prose or a bad issue', async () => {
    expect(await run(replyIsIssues(), good)).toBeUndefined();
    expect(await run(replyIsIssues(), reply([]))).toBeUndefined();
    expect(
      await run(replyIsIssues(), 'I can only help with readiness'),
    ).toMatch(/not JSON/);
    expect(await run(replyIsIssues(), '{"issues":"none"}')).toMatch(
      /no "issues" list/,
    );
    expect(
      await run(replyIsIssues(), reply([{ finding: 2, impact: ' ' }])),
    ).toMatch(/no impact/);
  });

  it('findings-in-range fails on a number outside the list or a repeat', async () => {
    expect(await run(findingsInRange(5), good)).toBeUndefined();
    expect(
      await run(findingsInRange(2), reply([{ finding: 3, impact: 'x' }])),
    ).toMatch(/3 are not in the listed 1 to 2/);
    expect(
      await run(findingsInRange(2), reply([{ finding: 0, impact: 'x' }])),
    ).toMatch(/0 are not/);
    expect(
      await run(
        findingsInRange(5),
        reply([
          { finding: 2, impact: 'x' },
          { finding: 2, impact: 'y' },
        ]),
      ),
    ).toMatch(/repeated/);
  });

  it('picks-exact-findings fails on a missed or an extra number', async () => {
    expect(await run(picksExactly([3, 1]), good)).toBeUndefined();
    expect(await run(picksExactly([]), reply([]))).toBeUndefined();
    expect(await run(picksExactly([1, 3, 4]), good)).toMatch(/missed 4/);
    expect(await run(picksExactly([1]), good)).toMatch(/also picked 3/);
    expect(await run(picksExactly([]), good)).toMatch(/also picked 1, 3/);
  });

  it('no-chat-reply fails on a refusal, a tool offer or a score lead', async () => {
    expect(await run(noChatReply(), good)).toBeUndefined();
    for (const impact of [
      'I can only help with data readiness questions.',
      'Let me run the assessment first.',
      'The overall score is 71 out of 100.',
    ]) {
      expect(await run(noChatReply(), reply([{ finding: 1, impact }]))).toMatch(
        /chat reply/,
      );
    }
  });
});
