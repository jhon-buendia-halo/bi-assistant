import {
  AgentForm,
  agentFormChanged,
  agentFormFromConfig,
  agentSaveInput,
  canSaveAgent,
  datasetOptions,
  emptyAgentForm,
  hasExistingDataset,
  modelPlaceholder,
  showAgentPublish,
} from './agent-editor.util';

function form(patch: Partial<AgentForm> = {}): AgentForm {
  return { ...emptyAgentForm(), name: 'Cup historian', ...patch };
}

describe('agent editor: unsaved changes', () => {
  it('a fresh form for a new agent has none', () => {
    expect(agentFormChanged(emptyAgentForm(), emptyAgentForm())).toBeFalse();
  });

  it('counts a typed field as a change', () => {
    expect(agentFormChanged(form(), emptyAgentForm())).toBeTrue();
    expect(
      agentFormChanged(form({ instructions: 'Be brief.' }), form()),
    ).toBeTrue();
    expect(agentFormChanged(form({ model: 'gpt-4.1' }), form())).toBeTrue();
    expect(
      agentFormChanged(form({ reasoningEffort: 'low' }), form()),
    ).toBeTrue();
  });

  it('ignores surrounding spaces, blank starters and ticking order', () => {
    const saved = form({
      datasets: ['A', 'B'],
      starterQuestions: ['Who won?'],
    });
    expect(
      agentFormChanged(
        form({
          name: '  Cup historian ',
          datasets: ['B', 'A'],
          starterQuestions: ['Who won? ', ''],
        }),
        saved,
      ),
    ).toBeFalse();
  });

  it('counts unticking a dataset and reordering starters', () => {
    const saved = form({ datasets: ['A'], starterQuestions: ['1', '2'] });
    expect(agentFormChanged(form({ datasets: [] }), saved)).toBeTrue();
    expect(
      agentFormChanged(
        form({ datasets: ['A'], starterQuestions: ['2', '1'] }),
        saved,
      ),
    ).toBeTrue();
  });

  it('loads a stored draft so that it reads as unchanged', () => {
    const draft = {
      name: 'Cup historian',
      description: 'Knows every final.',
      instructions: 'Name the year.',
      datasets: ['World Cup Core'],
      starterQuestions: ['Who won in 2014?'],
      model: 'gpt-4.1',
      reasoningEffort: 'medium' as const,
    };
    const loaded = agentFormFromConfig(draft);
    expect(agentFormChanged(loaded, agentFormFromConfig(draft))).toBeFalse();
    expect(loaded.reasoningEffort).toBe('medium');
    expect(agentFormFromConfig({ ...draft, model: undefined }).model).toBe('');
  });
});

describe('agent editor: save', () => {
  it('needs a name and a change, and waits for the save in flight', () => {
    expect(
      canSaveAgent({ form: form(), changed: true, saving: false }),
    ).toBeTrue();
    expect(
      canSaveAgent({ form: form({ name: '  ' }), changed: true, saving: false }),
    ).toBeFalse();
    expect(
      canSaveAgent({ form: form(), changed: false, saving: false }),
    ).toBeFalse();
    expect(
      canSaveAgent({ form: form(), changed: true, saving: true }),
    ).toBeFalse();
  });

  it('sends the normalised form and leaves the defaults out', () => {
    expect(
      agentSaveInput(
        form({
          name: ' Cup historian ',
          datasets: ['A', 'A', ' '],
          starterQuestions: ['', ' Who won? '],
        }),
      ),
    ).toEqual({
      name: 'Cup historian',
      description: '',
      instructions: '',
      datasets: ['A'],
      starterQuestions: ['Who won?'],
    });
    expect(
      agentSaveInput(form({ model: ' gpt-4.1 ', reasoningEffort: 'high' })),
    ).toEqual(
      jasmine.objectContaining({ model: 'gpt-4.1', reasoningEffort: 'high' }),
    );
  });
});

describe('agent editor: Publish visibility (R57)', () => {
  const live = {
    saved: true,
    status: 'live' as const,
    hasUnpublishedChanges: false,
    changed: false,
  };

  it('hides Publish only for a saved Live agent with nothing to publish', () => {
    expect(showAgentPublish(live)).toBeFalse();
  });

  it('shows Publish for a new agent, a draft, unpublished changes or edits', () => {
    expect(
      showAgentPublish({ ...live, saved: false, status: null }),
    ).toBeTrue();
    expect(showAgentPublish({ ...live, status: 'draft' })).toBeTrue();
    expect(
      showAgentPublish({ ...live, hasUnpublishedChanges: true }),
    ).toBeTrue();
    expect(showAgentPublish({ ...live, changed: true })).toBeTrue();
  });
});

describe('agent editor: datasets', () => {
  it('lists existing datasets, then the saved ones that are missing', () => {
    expect(
      datasetOptions(['World Cup Core', 'Claims'], ['World Cup Core', 'Gone'], [
        'World Cup Core',
        'Gone',
      ]),
    ).toEqual([
      { name: 'World Cup Core', missing: false, checked: true },
      { name: 'Claims', missing: false, checked: false },
      { name: 'Gone', missing: true, checked: true },
    ]);
  });

  it('keeps an unticked missing dataset listed until a save drops it', () => {
    expect(datasetOptions([], ['Gone'], [])).toEqual([
      { name: 'Gone', missing: true, checked: false },
    ]);
    expect(datasetOptions([], [], [])).toEqual([]);
  });

  it('a preview needs one dataset that exists', () => {
    expect(hasExistingDataset(['Gone'], ['World Cup Core'])).toBeFalse();
    expect(
      hasExistingDataset(['Gone', 'World Cup Core'], ['World Cup Core']),
    ).toBeTrue();
    expect(hasExistingDataset([], ['World Cup Core'])).toBeFalse();
  });
});

describe('agent editor: Model placeholder (R55)', () => {
  it('names the configured model, or just Default', () => {
    expect(modelPlaceholder('gpt-4.1')).toBe('Default (gpt-4.1)');
    expect(modelPlaceholder(null)).toBe('Default');
  });
});
