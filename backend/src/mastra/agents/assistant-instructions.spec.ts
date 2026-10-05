import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ASSISTANT_RULE_GROUPS,
  buildAssistantInstructions,
  readEngineAblation,
  unknownRuleGroups,
} from './assistant-instructions';

/**
 * `assistant.agent.ts` now imports `@mastra/core/agent` and wires its
 * dynamic `instructions` to `buildAssistantInstructions` (U1-F), so this
 * spec no longer reads that file — the source of truth for "today's
 * prompt" is the golden fixture, captured once before the split
 * (`__fixtures__/assistant-instructions.golden.txt`, no trailing newline;
 * 7 382 bytes at the split, 8 957 after the 2026-09-28 rule additions —
 * regenerate it only for a deliberate prompt change).
 */
const GOLDEN = readFileSync(
  join(__dirname, '__fixtures__/assistant-instructions.golden.txt'),
  'utf8',
);
const GOLDEN_LINES = GOLDEN.split('\n');

const NON_ABLATABLE_IDS = ['role', 'procedure', 'grounding'];
const ABLATABLE_IDS = ASSISTANT_RULE_GROUPS.filter((g) => g.ablatable).map(
  (g) => g.id,
);

function hasDoubledBlankLine(text: string): boolean {
  return text.includes('\n\n\n');
}

describe('ASSISTANT_RULE_GROUPS', () => {
  it('every golden line appears in exactly one group, in order, unmodified', () => {
    const actual = ASSISTANT_RULE_GROUPS.flatMap((group) => group.lines);
    expect(actual).toEqual(GOLDEN_LINES);
  });

  it('marks exactly role, procedure and grounding non-ablatable', () => {
    const nonAblatable = ASSISTANT_RULE_GROUPS.filter((g) => !g.ablatable).map(
      (g) => g.id,
    );
    expect(nonAblatable.sort()).toEqual([...NON_ABLATABLE_IDS].sort());
  });

  it('has no duplicate group ids', () => {
    const ids = ASSISTANT_RULE_GROUPS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every group at least one line', () => {
    for (const group of ASSISTANT_RULE_GROUPS) {
      expect(group.lines.length).toBeGreaterThan(0);
    }
  });
});

describe('buildAssistantInstructions', () => {
  it('with no ablation, is byte-identical to the golden prompt', () => {
    expect(buildAssistantInstructions()).toBe(GOLDEN);
    expect(buildAssistantInstructions([])).toBe(GOLDEN);
  });

  it('ablating each ablatable group removes exactly that group\'s lines', () => {
    for (const group of ASSISTANT_RULE_GROUPS.filter((g) => g.ablatable)) {
      const result = buildAssistantInstructions([group.id]);
      const resultLines = result.split('\n');
      const expectedLines = ASSISTANT_RULE_GROUPS.filter(
        (g) => g.id !== group.id,
      ).flatMap((g) => g.lines);
      // Normalising runs of blank lines must be a no-op here: removing one
      // group can never leave two blank lines adjacent (see the comment on
      // ASSISTANT_RULE_GROUPS), so the un-normalised expectation must match
      // exactly.
      expect(resultLines).toEqual(expectedLines);
    }
  });

  it("'*' keeps only role, procedure and grounding", () => {
    const result = buildAssistantInstructions(['*']);
    const expected = ASSISTANT_RULE_GROUPS.filter((g) => !g.ablatable)
      .flatMap((g) => g.lines)
      .join('\n');
    expect(result).toBe(expected);
  });

  it('ablating a non-ablatable group id is a no-op', () => {
    const baseline = buildAssistantInstructions();
    for (const id of NON_ABLATABLE_IDS) {
      expect(buildAssistantInstructions([id])).toBe(baseline);
    }
    expect(buildAssistantInstructions(['role', 'grounding'])).toBe(baseline);
  });

  it('never leaves a doubled blank line after ablating any single group', () => {
    for (const id of ABLATABLE_IDS) {
      expect(hasDoubledBlankLine(buildAssistantInstructions([id]))).toBe(
        false,
      );
    }
  });

  it('never leaves a doubled blank line ablating adjacent groups together, or "*"', () => {
    expect(
      hasDoubledBlankLine(
        buildAssistantInstructions(['curated-knowledge', 'rationale', 'visuals']),
      ),
    ).toBe(false);
    expect(
      hasDoubledBlankLine(buildAssistantInstructions(['clarification'])),
    ).toBe(false);
    expect(hasDoubledBlankLine(buildAssistantInstructions(['*']))).toBe(false);
  });

  it('ignores unknown ids', () => {
    const baseline = buildAssistantInstructions();
    expect(buildAssistantInstructions(['not-a-real-group'])).toBe(baseline);
  });
});

describe('unknownRuleGroups', () => {
  it('returns ids that name no group', () => {
    expect(unknownRuleGroups(['role', 'nope', 'also-nope'])).toEqual([
      'nope',
      'also-nope',
    ]);
  });

  it('treats every real group id as known', () => {
    const ids = ASSISTANT_RULE_GROUPS.map((g) => g.id);
    expect(unknownRuleGroups(ids)).toEqual([]);
  });

  it('treats "*" as known, not an unknown id', () => {
    expect(unknownRuleGroups(['*'])).toEqual([]);
  });

  it('is empty for an empty list', () => {
    expect(unknownRuleGroups([])).toEqual([]);
  });
});

describe('readEngineAblation', () => {
  it('is empty with no requestContext (a tool call outside a turn)', () => {
    expect(readEngineAblation(undefined)).toEqual([]);
  });

  it('reads promptAblation off the stored engine options', () => {
    const requestContext = {
      get: (key: string) =>
        key === 'engine-options' ? { promptAblation: ['visuals'] } : undefined,
    };
    expect(readEngineAblation(requestContext)).toEqual(['visuals']);
  });
});
