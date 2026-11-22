import {
  isPlaybooksSkill,
  playbookSet,
  readPlaybook,
  readRouter,
} from './agent-playbooks';

const ROUTER = `---
name: avery-playbooks
description: Use when a question arrives.
---

# Avery's playbooks

Pick the playbook, read it, and follow its steps.

## Before anything
- The run has reference images → call read_reference_images first.

## Pick one playbook
- Score 0–1, and none of the cases below → no playbook: plan_analysis, analyse_data, write_answer.
- Top, bottom, best, worst, most, least, "rank" → read reference/ranking.md
- Why something went up or down → read reference/period-change.md

## When something happens during the run
- Michael's checks failed → read reference/failed-check.md

## Briefs
- Never routed: reference/briefs.md
`;

const RANKING = `# Ranking

1. Call plan_analysis with a brief.
2. Brief Michael.
   - With the top 5.
3. Call write_answer.

**Reply:** the winner with its figure, and whether there is a tie.
`;

describe('agent playbooks (ui.md 4.5, Playbooks)', () => {
  it('knows a playbooks skill by its name', () => {
    expect(isPlaybooksSkill('avery-playbooks')).toBeTrue();
    expect(isPlaybooksSkill('sql-analysis')).toBeFalse();
  });

  it("reads what sends the agent to each playbook, and when; the router's other choices are notes", () => {
    const { routes, notes } = readRouter(ROUTER);
    expect(routes).toEqual([
      {
        path: 'reference/ranking.md',
        trigger: 'Top, bottom, best, worst, most, least, "rank"',
        phase: 'first',
      },
      {
        path: 'reference/period-change.md',
        trigger: 'Why something went up or down',
        phase: 'first',
      },
      {
        path: 'reference/failed-check.md',
        trigger: "Michael's checks failed",
        phase: 'during',
      },
    ]);
    expect(notes).toEqual([
      'Score 0–1, and none of the cases below → no playbook: plan_analysis, analyse_data, write_answer.',
    ]);
  });

  it('reads a playbook: its heading, its top-level steps and its Reply apart from its body', () => {
    const p = readPlaybook('reference/ranking.md', RANKING);
    expect(p.title).toBe('Ranking');
    expect(p.steps).toBe(3);
    expect(p.reply).toBe(
      'the winner with its figure, and whether there is a tie.',
    );
    expect(p.body).toContain('2. Brief Michael.');
    expect(p.body).not.toContain('Reply');
  });

  it('orders the playbooks as the router does, the ones it does not name last', () => {
    const set = playbookSet('avery-playbooks', ROUTER, [
      {
        path: 'reference/failed-check.md',
        content: '# Failed check\n\n1. Fix it.',
      },
      { path: 'reference/extra.md', content: 'No heading' },
      { path: 'reference/ranking.md', content: RANKING },
    ]);
    expect(set.playbooks.map((p) => [p.title, p.phase])).toEqual([
      ['Ranking', 'first'],
      ['Failed check', 'during'],
      ['extra', null],
    ]);
    expect(set.skill).toBe('avery-playbooks');
  });
});
