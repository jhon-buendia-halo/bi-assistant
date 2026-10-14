import { appSkillDocument, appSkillFile } from '../../mastra/app-skills';
import {
  DEEP_ANALYSIS_PHASES,
  fillPlaceholders,
  phasePrompt,
} from './deep-analysis.phases';

describe('fillPlaceholders', () => {
  it('replaces every {{name}} token with its value', () => {
    expect(
      fillPlaceholders('a {{x}} b {{y}} c {{x}}', { x: '1', y: '2' }, 'test'),
    ).toBe('a 1 b 2 c 1');
  });

  it('inserts values verbatim: no $ patterns, no re-scanning of filled text', () => {
    expect(
      fillPlaceholders(
        '<q>{{question}}</q> <t>{{title}}</t>',
        { question: "$& $' $1 {{title}}", title: '{{question}}' },
        'test',
      ),
    ).toBe("<q>$& $' $1 {{title}}</q> <t>{{question}}</t>");
  });

  it('throws on a placeholder the caller does not fill', () => {
    expect(() =>
      fillPlaceholders('{{question}} {{audience}}', { question: 'q' }, 'test'),
    ).toThrow('test has an unfilled placeholder {{audience}}');
  });

  it('throws when a required placeholder is missing from the template', () => {
    expect(() =>
      fillPlaceholders('no tokens here', { question: 'q' }, 'test'),
    ).toThrow('test has no {{question}} placeholder');
  });
});

describe('the deep-analysis skill', () => {
  it('maps the three phases in order in SKILL.md', () => {
    const document = appSkillDocument('deep-analysis');
    expect(document).toMatch(
      /^---\nname: deep-analysis\ndescription: Use when running a deep analysis/,
    );
    const positions = Object.values(DEEP_ANALYSIS_PHASES).map((path) =>
      document.indexOf(path),
    );
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('holds exactly the placeholders the service fills in each phase file', () => {
    const tokens = (path: string) =>
      [
        ...new Set(
          [
            ...appSkillFile('deep-analysis', path).matchAll(/\{\{(\w+)\}\}/g),
          ].map((match) => match[1]),
        ),
      ].sort();
    expect(tokens(DEEP_ANALYSIS_PHASES.plan)).toEqual(['question']);
    expect(tokens(DEEP_ANALYSIS_PHASES.investigate)).toEqual([
      'angleIndex',
      'angleQuestion',
      'angleTitle',
      'angleTotal',
      'question',
    ]);
    expect(tokens(DEEP_ANALYSIS_PHASES.report)).toEqual([
      'findings',
      'question',
    ]);
  });

  it('builds a phase prompt from its file', () => {
    expect(phasePrompt('plan', { question: 'Q?' })).toMatch(
      /^Plan a deep analysis of the question below\.\n[\s\S]*<question>\nQ\?\n<\/question>$/,
    );
  });
});
