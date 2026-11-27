import { RequestContext } from '@mastra/core/request-context';
import {
  AGENT_TOOLS_CONTEXT_KEY,
  isFullSelection,
  normalizeAgentTools,
  OPTIONAL_AGENT_TOOLS,
  RETIRED_AGENT_TOOLS,
  toolSelectionFrom,
} from './agent-tools';

function contextWith(value?: unknown): RequestContext {
  const requestContext = new RequestContext();
  if (value !== undefined) requestContext.set(AGENT_TOOLS_CONTEXT_KEY, value);
  return requestContext;
}

describe("a user agent's optional tools are Elena's (ADR-0059)", () => {
  it('are sample_rows and ask_clarification; visuals is retired', () => {
    expect([...OPTIONAL_AGENT_TOOLS]).toEqual([
      'sample_rows',
      'ask_clarification',
    ]);
    expect([...RETIRED_AGENT_TOOLS]).toEqual(['visuals']);
  });
});

describe('normalizeAgentTools (agents-evals R43, data-model 3.10)', () => {
  it('de-duplicates and puts the tools in canonical order', () => {
    expect(
      normalizeAgentTools([
        'ask_clarification',
        'sample_rows',
        'ask_clarification',
      ]),
    ).toEqual(['sample_rows', 'ask_clarification']);
  });

  it('drops a stored visuals without a message', () => {
    expect(normalizeAgentTools(['visuals', 'sample_rows', 'visuals'])).toEqual([
      'sample_rows',
    ]);
    expect(normalizeAgentTools(['visuals'])).toEqual([]);
  });

  it('keeps an empty list empty', () => {
    expect(normalizeAgentTools([])).toEqual([]);
  });

  it('refuses any other entry with Unknown tool "<name>"', () => {
    expect(() => normalizeAgentTools(['sample_rows', 'create_visual'])).toThrow(
      'Unknown tool "create_visual"',
    );
    expect(() => normalizeAgentTools(['run_readonly_sql'])).toThrow(
      'Unknown tool "run_readonly_sql"',
    );
  });
});

describe('isFullSelection', () => {
  it('is true for no list or both tools, false otherwise', () => {
    expect(isFullSelection(undefined)).toBe(true);
    expect(isFullSelection(['ask_clarification', 'sample_rows'])).toBe(true);
    expect(isFullSelection(['sample_rows', 'visuals'])).toBe(false);
    expect(isFullSelection([])).toBe(false);
  });
});

describe('toolSelectionFrom (agents.md 4.2)', () => {
  it('reads no selection from a missing context, key or non-list value', () => {
    expect(toolSelectionFrom(undefined)).toBeUndefined();
    expect(toolSelectionFrom(contextWith())).toBeUndefined();
    expect(toolSelectionFrom(contextWith('sample_rows'))).toBeUndefined();
  });

  it('reads both tools as no selection, a stored visuals ignored', () => {
    expect(
      toolSelectionFrom(
        contextWith(['visuals', 'ask_clarification', 'sample_rows']),
      ),
    ).toBeUndefined();
  });

  it('returns a partial selection in canonical order', () => {
    expect(toolSelectionFrom(contextWith(['visuals', 'sample_rows']))).toEqual([
      'sample_rows',
    ]);
    expect(toolSelectionFrom(contextWith([]))).toEqual([]);
  });
});
