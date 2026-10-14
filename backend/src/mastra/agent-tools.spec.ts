import { RequestContext } from '@mastra/core/request-context';
import {
  AGENT_TOOLS_CONTEXT_KEY,
  isFullSelection,
  normalizeAgentTools,
  selectionKey,
  toolSelectionFrom,
} from './agent-tools';

function contextWith(value?: unknown): RequestContext {
  const requestContext = new RequestContext();
  if (value !== undefined) requestContext.set(AGENT_TOOLS_CONTEXT_KEY, value);
  return requestContext;
}

describe('normalizeAgentTools (agents-evals R43, data-model 3.10)', () => {
  it('de-duplicates and puts the tools in canonical order', () => {
    expect(
      normalizeAgentTools(['visuals', 'sample_rows', 'visuals', 'sample_rows']),
    ).toEqual(['sample_rows', 'visuals']);
    expect(
      normalizeAgentTools(['visuals', 'ask_clarification', 'sample_rows']),
    ).toEqual(['sample_rows', 'ask_clarification', 'visuals']);
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
  it('is true for no list or all three tools, false otherwise', () => {
    expect(isFullSelection(undefined)).toBe(true);
    expect(
      isFullSelection(['visuals', 'sample_rows', 'ask_clarification']),
    ).toBe(true);
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

  it('reads all three tools as no selection', () => {
    expect(
      toolSelectionFrom(
        contextWith(['visuals', 'ask_clarification', 'sample_rows']),
      ),
    ).toBeUndefined();
  });

  it('returns a partial selection in canonical order', () => {
    expect(toolSelectionFrom(contextWith(['visuals', 'sample_rows']))).toEqual([
      'sample_rows',
      'visuals',
    ]);
    expect(toolSelectionFrom(contextWith([]))).toEqual([]);
  });

  it('keys every selection apart from the full one', () => {
    expect(selectionKey(undefined)).toBe('full');
    expect(selectionKey([])).toBe('');
    expect(selectionKey(['sample_rows', 'visuals'])).toBe(
      'sample_rows,visuals',
    );
  });
});
