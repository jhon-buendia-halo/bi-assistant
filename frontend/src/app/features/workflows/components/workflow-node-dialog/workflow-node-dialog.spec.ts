import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NodeInspection } from '../../models/workflow-node.model';
import { NodeChatAvailability } from '../../models/workflow.model';
import { WorkflowRunsApiService } from '../../services/workflow-runs-api.service';
import { buildNodeInspections } from '../../services/workflow-node-inspection';
import {
  GRAPH_PLAN,
  GRAPH_RETRY_RUN,
  GRAPH_WORKFLOW,
} from '../../services/workflow-graph.testing';
import { WorkflowNodeDialog } from './workflow-node-dialog';
import {
  FIXTURE_CONTRACT_ANALYSE,
  FIXTURE_CONTRACT_WORKFLOW,
  FIXTURE_INPUT_VIOLATION,
  FIXTURE_NODES,
  FIXTURE_NODES_NOT_RUN,
  FIXTURE_OUTPUT_VIOLATION,
  FIXTURE_TOOL,
  FIXTURE_TOOL_NOT_RUN,
  FIXTURE_WORKFLOW,
} from './workflow-node.testing';

describe('WorkflowNodeDialog', () => {
  let fixture: ComponentFixture<WorkflowNodeDialog>;
  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (id: string) =>
    byId(id)?.textContent?.replace(/\s+/g, ' ').trim();
  const node = (id: string) => FIXTURE_NODES.find((n) => n.nodeId === id)!;
  /** The declared fields listed under a test id, as their text reads. */
  const fields = (id: string) =>
    Array.from(
      byId(id)?.querySelectorAll<HTMLElement>(
        '[data-testid="workflow-contract-field"]',
      ) ?? [],
    ).map((li) => li.textContent?.replace(/\s+/g, ' ').trim());

  function open(n: NodeInspection, runId: string | null = 'run_8f21c4') {
    fixture = TestBed.createComponent(WorkflowNodeDialog);
    fixture.componentRef.setInput('node', n);
    fixture.componentRef.setInput('workflow', FIXTURE_WORKFLOW);
    fixture.componentRef.setInput('runId', runId);
    fixture.detectChanges();
  }
  /** An agent step's cards: open What it received and returned, or How it's set up. */
  function expandCards(cards: 'data' | 'config') {
    const toggles =
      cards === 'data'
        ? ['workflow-ndv-input-toggle', 'workflow-ndv-output-toggle']
        : ['workflow-ndv-params-toggle'];
    for (const id of toggles) {
      if (byId(id)!.getAttribute('aria-expanded') !== 'true') byId(id)!.click();
    }
    fixture.detectChanges();
  }
  /** The evidence rows' texts, one line each. */
  const evidenceRows = () =>
    Array.from(
      el().querySelectorAll<HTMLElement>(
        '[data-testid^="workflow-step-evidence-row-"]',
      ),
    ).map((row) => row.textContent?.replace(/\s+/g, ' ').trim());

  beforeEach(() =>
    TestBed.configureTestingModule({ imports: [WorkflowNodeDialog] }),
  );

  it('is a modal dialog with the node title, a badge and the agent line', () => {
    open(node('analyse'));
    const dialog = byId('workflow-ndv');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(text('workflow-ndv-title')).toBe('Analyse');
    expect(dialog?.textContent).toContain('LLM');
    expect(dialog?.textContent).toContain(
      'Insights Analyst · ≤ 15 steps',
    );
    expect(byId('workflow-ndv-column')).not.toBeNull();
    expect(text('workflow-ndv-output-status')).toBe('Done');
  });

  it('reads an agent step as one column: Story, evidence, three collapsed cards', () => {
    open(node('analyse'));
    const column = byId('workflow-ndv-column')!;
    const order = Array.from(column.children)
      .map((c) => c.getAttribute('data-testid') ?? c.tagName.toLowerCase())
      .filter((id) => id !== null);
    expect(order).toEqual([
      'workflow-ndv-story',
      'app-workflow-step-evidence',
      'workflow-ndv-input',
      'workflow-ndv-output',
      'workflow-ndv-params',
    ]);
    // The Story is told by the persona.
    expect(text('workflow-ndv-story-persona')).toBe('Insights Analyst');
    expect(byId('workflow-ndv-story-body')).not.toBeNull();
    // The cards are headed and collapsed.
    const toggles = [
      'workflow-ndv-input-toggle',
      'workflow-ndv-output-toggle',
      'workflow-ndv-params-toggle',
    ].map((id) => byId(id)!);
    expect(toggles.map((t) => t.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'What it received question',
      'What it returned calls, stopped',
      "How it's set up anthropic/claude-sonnet-5-5 · ≤ 15 steps",
    ]);
    expect(toggles.every((t) => t.getAttribute('aria-expanded') === 'false')).toBeTrue();
    expect(toggles.every((t) => t.closest('h3') !== null)).toBeTrue();
    expect(byId('workflow-step-field-id')!.closest('[hidden]')).not.toBeNull();

    expandCards('config');
    expect(toggles[2].getAttribute('aria-expanded')).toBe('true');
    expect(byId('workflow-step-field-id')!.closest('[hidden]')).toBeNull();
    expect(text('workflow-step-field-id')).toBe('analyse');
    expect(text('workflow-ndv-setting-status')).toBe('Done');
    // No tabs, no chat pane, no Story/Data/Config switch.
    expect(byId('workflow-ndv-tab-parameters')).toBeNull();
    expect(byId('workflow-ndv-view-story')).toBeNull();
    expect(el().querySelector('[role="tablist"]')).toBeNull();
  });

  it("shows what the step used as evidence rows, a row opening the call's detail", () => {
    open(node('analyse'));
    expect(
      byId('workflow-step-evidence')!.querySelector('h3')?.textContent?.trim(),
    ).toBe('What Insights Analyst used');
    expect(evidenceRows()).toEqual([
      '1 · Listed the entities of the datasets 200 ms Done',
      '2 · Ran a query 5 rows · 1.1 s Done',
      '3 · Read the columns of an entity Failed · No such entity',
    ]);
    byId('workflow-step-evidence-row-1')!.click();
    fixture.detectChanges();
    expect(text('workflow-step-evidence-input')).toBe(
      'SELECT state FROM claims',
    );
  });

  it('shows the one row of what a step with no tool calls read', () => {
    const analyse = node('analyse');
    open({
      ...analyse,
      run: {
        ...analyse.run!,
        toolCalls: [],
        input: {
          question: 'Top 5 states?',
          queries: [
            { sql: 'SELECT 1', rows: [], rowCount: 5, truncated: false },
            { sql: 'SELECT 2', rows: [], rowCount: 2, truncated: false },
          ],
        },
      },
    });
    expect(text('workflow-step-evidence-summary')).toContain(
      'Based on 7 rows from 2 queries',
    );
  });

  it('copies the Story as Markdown and the input as JSON', async () => {
    const writes: string[] = [];
    spyOn(navigator.clipboard, 'writeText').and.callFake(async (t: string) => {
      writes.push(t);
    });
    const analyse = node('analyse');
    open({
      ...analyse,
      run: {
        ...analyse.run!,
        story: { headline: 'Ran 1 query.', source: 'step' },
      },
    });
    byId('workflow-ndv-copy')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    expect(writes[0]).toBe('## How Analyse ran\n\nRan 1 query.');
    expect(text('workflow-ndv-copy')).toBe('Copied');
    expect(text('workflow-ndv-copy-input')).toBe('Copy');

    byId('workflow-ndv-copy-input')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(JSON.parse(writes[1])).toEqual(analyse.run!.input!);
  });

  it("tells the agent step's run in its Story, each query the answer kept opening in the inspector", () => {
    const analyse = node('analyse');
    open({
      ...analyse,
      run: {
        ...analyse.run!,
        story: {
          headline: 'Ran 2 queries on the data (1 failed).',
          facts: [
            {
              label: 'Query 1',
              values: ['States by claims — 5 rows'],
              sql: 'SELECT  state FROM claims;',
            },
            {
              label: 'Query 2',
              values: ['Ran a query — failed: No such entity'],
              verdict: 'failed',
              sql: 'SELECT * FROM nope',
            },
          ],
          source: 'step',
        },
      },
    });
    expect(text('workflow-step-story-headline')).toBe(
      'Ran 2 queries on the data (1 failed).',
    );
    // Without the answer's records, no query can be opened.
    expect(byId('workflow-step-story-query-0')).toBeNull();

    fixture.componentRef.setInput('answerData', [
      { tool: 'list_entities' },
      { tool: 'run_readonly_sql', input: 'SELECT state FROM claims' },
    ]);
    fixture.detectChanges();
    // Matched by its statement (whitespace and a final `;` aside); the
    // failed one is not among the answer's records.
    const link = byId('workflow-step-story-query-0')!;
    expect(link.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Open query : Query 1',
    );
    expect(byId('workflow-step-story-query-1')).toBeNull();
    const opened: number[] = [];
    fixture.componentInstance.openQuery.subscribe((o) => opened.push(o.index));
    link.click();
    expect(opened).toEqual([1]);
  });

  it('opens a code step with its Story above Input, the tabs and Output', () => {
    const receive = node('receive');
    open({
      ...receive,
      run: {
        ...receive.run!,
        story: { headline: 'Got the question “Top 5 states?”.', source: 'step' },
      },
    });
    const order = Array.from(
      byId('workflow-ndv')!.querySelectorAll<HTMLElement>(
        '[data-testid="workflow-ndv-story"], [data-testid="workflow-ndv-input"], [data-testid="workflow-ndv-output"]',
      ),
    ).map((s) => s.dataset['testid']);
    expect(order).toEqual([
      'workflow-ndv-story',
      'workflow-ndv-input',
      'workflow-ndv-output',
    ]);
    expect(text('workflow-step-story-headline')).toBe(
      'Got the question “Top 5 states?”.',
    );
  });

  it('has no Story for Start and End', () => {
    open(node('start'));
    expect(byId('workflow-ndv-story')).toBeNull();
  });

  it('stacks Input, the tabs and Output, with Input and Output collapsed until toggled', () => {
    open(node('receive'));
    const sections = Array.from(
      byId('workflow-ndv')!.querySelectorAll<HTMLElement>(
        '[data-testid="workflow-ndv-input"], [data-testid="workflow-ndv-params"], [data-testid="workflow-ndv-output"]',
      ),
    ).map((s) => s.dataset['testid']);
    expect(sections).toEqual([
      'workflow-ndv-input',
      'workflow-ndv-params',
      'workflow-ndv-output',
    ]);
    for (const k of ['input', 'output']) {
      const toggle = byId(`workflow-ndv-${k}-toggle`)!;
      const body = el().querySelector<HTMLElement>(`#workflow-ndv-${k}-body`)!;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe(body.id);
      expect(body.hidden).toBe(true);
      toggle.click();
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(body.hidden).toBe(false);
      toggle.click();
      fixture.detectChanges();
      expect(body.hidden).toBe(true);
    }
    // The run's status stays in Output's header while it is collapsed.
    expect(byId('workflow-ndv-output-status')?.closest('[hidden]')).toBeNull();
  });

  it('shows an agent step: input, parameters, tool calls and output', () => {
    open(node('analyse'));
    expandCards('data');
    expect(byId('workflow-ndv-input')?.textContent).toContain('Top 5 states?');
    expect(text('workflow-ndv-output-status')).toBe('Done');
    expect(evidenceRows().length).toBe(3);
    // The calls are evidence rows only, not repeated in the output.
    expect(byId('workflow-ndv-output')?.textContent).not.toContain('list_entities');
    expect(byId('workflow-ndv-output')?.textContent).toContain('"calls": 3');

    expandCards('config');
    expect(text('workflow-step-field-id')).toBe('analyse');
    expect(text('workflow-step-field-kind')).toBe('LLM (agent persona call)');
    expect(text('workflow-step-field-agent')).toContain(
      'Insights Analyst',
    );
    expect(text('workflow-step-field-model')).toBe(
      'anthropic/claude-sonnet-5-5',
    );
    expect(text('workflow-step-field-tools')).toBe(
      'list_entities, run_readonly_sql',
    );
    expect(text('workflow-step-field-max-steps')).toBe('15');
    expect(text('workflow-step-field-exits')).toBe(
      'Fails if the model returns an error · Ends if you stop it',
    );
    // No declared schema (an older backend): the names, untyped.
    expect(fields('workflow-step-field-input')).toEqual([
      'question',
      'catalog',
    ]);
    expect(fields('workflow-step-field-output')).toEqual(['calls', 'stopped']);
    expect(text('workflow-step-field-system-prompt')).toBe(
      'You are a data analyst.',
    );
    expect(el().textContent).toContain(
      "The agent persona's job description; each run adds its own context.",
    );
    expect(el().textContent).not.toContain('Shortened to 20 000 characters.');
  });

  it('says so when an agent step recorded no tool calls', () => {
    const analyse = node('analyse');
    open({ ...analyse, run: { ...analyse.run!, toolCalls: [] } });
    expect(text('workflow-step-evidence-empty')).toBe(
      'No tool calls recorded.',
    );
  });

  it("names a one-call step's agent without a step limit in its header", () => {
    const analyse = node('analyse');
    open({
      ...analyse,
      step: {
        ...analyse.step!,
        agent: {
          ...analyse.step!.agent!,
          name: 'Olivia',
          tools: [],
          maxSteps: 1,
        },
      },
    });
    expect(el().textContent).toContain('Olivia');
    expect(el().textContent).not.toContain('≤ 1 steps');
  });

  it('notes a shortened system prompt', () => {
    const analyse = node('analyse');
    open({
      ...analyse,
      agent: { ...analyse.agent!, systemPromptTruncated: true },
    });
    expandCards('config');
    expect(el().textContent).toContain('Shortened to 20 000 characters.');
  });

  it('opens the agent from its link', () => {
    open(node('analyse'));
    expandCards('config');
    const keys: string[] = [];
    fixture.componentInstance.openAgent.subscribe((k) => keys.push(k));
    byId('workflow-step-field-agent')?.querySelector('button')?.click();
    expect(keys).toEqual(['qti']);
  });

  it('shows a code step without agent fields', () => {
    open(node('receive'));
    expect(text('workflow-step-field-kind')).toBe('Code');
    expect(byId('workflow-step-field-agent')).toBeNull();
    expect(byId('workflow-step-field-system-prompt')).toBeNull();
    expect(text('workflow-step-field-exits')).toBe('None');
    expect(el().textContent).toContain('CODE');
    expect(el().textContent).not.toContain('Tool calls');
  });

  it("lists a code step's exits", () => {
    const receive = node('receive');
    open({
      ...receive,
      step: {
        ...receive.step!,
        exits: [{ label: 'there is no catalog', outcome: 'fails' }],
      },
    });
    expect(text('workflow-step-field-exits')).toBe('Fails if there is no catalog');
  });

  it("lists an agent step's settings under its Config: status, duration and run id", () => {
    open(node('analyse'));
    expandCards('config');
    expect(text('workflow-ndv-setting-status')).toBe('Done');
    expect(text('workflow-ndv-setting-duration')).toBe('13.9 s');
    expect(text('workflow-ndv-setting-run-id')).toBe('run_8f21c4');
  });

  it("switches a code step's tabs to Settings: status, duration and run id", () => {
    open(node('receive'));
    expect(
      byId('workflow-ndv-tab-parameters')?.getAttribute('aria-selected'),
    ).toBe('true');
    byId('workflow-ndv-tab-settings')?.click();
    fixture.detectChanges();
    expect(
      byId('workflow-ndv-tab-settings')?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(text('workflow-ndv-setting-status')).toBe('Done');
    expect(text('workflow-ndv-setting-run-id')).toBe('run_8f21c4');
    expect(byId('workflow-step-field-id')).toBeNull();
  });

  describe('the chat with an agent step (api.md 136, 137)', () => {
    let api: jasmine.SpyObj<WorkflowRunsApiService>;

    beforeEach(() => {
      api = jasmine.createSpyObj<WorkflowRunsApiService>(
        'WorkflowRunsApiService',
        ['getNodeChat', 'streamNodeChat'],
      );
      api.getNodeChat.and.returnValue(of({ messages: [] }));
      TestBed.overrideProvider(WorkflowRunsApiService, { useValue: api });
    });

    function openWithChat(n: NodeInspection, chat: NodeChatAvailability) {
      fixture = TestBed.createComponent(WorkflowNodeDialog);
      fixture.componentRef.setInput('node', n);
      fixture.componentRef.setInput('workflow', FIXTURE_WORKFLOW);
      fixture.componentRef.setInput('runId', 'run_8f21c4');
      fixture.componentRef.setInput('chat', chat);
      fixture.detectChanges();
    }

    it('ends the column, headed, and reads the conversation at once', () => {
      openWithChat(node('analyse'), { state: 'ready', runId: 'run_8f21c4' });
      const section = byId('workflow-ndv-chat')!;
      const column = byId('workflow-ndv-column')!;
      expect(column.lastElementChild).toBe(section);
      const heading = section.querySelector('h3')!;
      expect(heading.textContent?.trim()).toBe('Chat with Insights Analyst');
      expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
      expect(
        section.querySelector('[data-testid="workflow-node-chat"]'),
      ).not.toBeNull();
      expect(api.getNodeChat).toHaveBeenCalledOnceWith('run_8f21c4', 'analyse');
      // No chat pane, resizer, intro or report card of the dialog's own.
      for (const id of [
        'workflow-ndv-chat-pane',
        'workflow-ndv-chat-resize',
        'workflow-ndv-chat-intro',
        'workflow-ndv-artifact-card',
      ]) {
        expect(byId(id)).withContext(id).toBeNull();
      }
    });

    it('stays mounted while the cards open, so the conversation is kept', () => {
      openWithChat(node('analyse'), { state: 'ready', runId: 'run_8f21c4' });
      const panel = byId('workflow-node-chat')!;
      expandCards('data');
      expandCards('config');
      expect(byId('workflow-node-chat')).toBe(panel);
      expect(api.getNodeChat).toHaveBeenCalledTimes(1);
    });

    it("hands the chat questions from what the step did; one fills the chat's box", () => {
      openWithChat(node('analyse'), { state: 'ready', runId: 'run_8f21c4' });
      const suggestions = Array.from(
        el().querySelectorAll<HTMLElement>(
          '[data-testid="workflow-ndv-suggestion"]',
        ),
      );
      expect(suggestions.map((b) => b.textContent?.trim())).toEqual([
        'Why did tool call 3 fail?',
        'What did this step do, step by step?',
      ]);
      expect(
        byId('workflow-ndv-chat')!.contains(suggestions[0]),
      ).toBeTrue();

      suggestions[0].click();
      fixture.detectChanges();
      const box = byId('workflow-node-chat-input') as HTMLTextAreaElement;
      expect(box.value).toBe('Why did tool call 3 fail?');
      expect(api.streamNodeChat).not.toHaveBeenCalled();
    });

    it('explains why it cannot chat yet before a run', () => {
      openWithChat(node('analyse'), { state: 'no-run' });
      expect(text('workflow-node-chat-unavailable')).toBe(
        "Execute the user journey, then chat with this agent persona about this step's data.",
      );
      expect(byId('workflow-ndv-suggestion')).toBeNull();
    });

    it('is hidden for a run of a removed workflow, and on any node but an agent step', () => {
      openWithChat(node('analyse'), { state: 'hidden' });
      expect(byId('workflow-ndv-chat')).toBeNull();
      expect(byId('workflow-ndv-column')).not.toBeNull();
      for (const id of ['start', 'receive', 'end']) {
        openWithChat(node(id), { state: 'ready', runId: 'run_8f21c4' });
        expect(byId('workflow-ndv-chat')).withContext(id).toBeNull();
        expect(byId('workflow-ndv-column')).withContext(id).toBeNull();
      }
      openWithChat(FIXTURE_TOOL, { state: 'ready', runId: 'run_8f21c4' });
      expect(byId('workflow-ndv-chat')).toBeNull();
      expect(byId('workflow-ndv-column')).toBeNull();
    });
  });

  it('shows the not-run states', () => {
    open(FIXTURE_NODES_NOT_RUN[2], null);
    expect(text('workflow-ndv-story-empty')).toBe(
      'This node has not run yet. Execute the user journey to see its data.',
    );
    expandCards('data');
    expect(byId('workflow-ndv-input')?.textContent).toContain(
      'This node has not run yet. Execute the user journey to see its data.',
    );
    expect(byId('workflow-ndv-output-status')).toBeNull();
    expandCards('config');
    expect(text('workflow-ndv-setting-status')).toBe('Not run yet');
    expect(text('workflow-ndv-setting-run-id')).toBe('Not run yet');
  });

  it('says no input was recorded when the node ran without one', () => {
    const receive = node('receive');
    open({ ...receive, run: { ...receive.run!, input: undefined } });
    expect(byId('workflow-ndv-input')?.textContent).toContain(
      'No input recorded for this run.',
    );
  });

  it('shows a dropped input as truncated', () => {
    const receive = node('receive');
    open({
      ...receive,
      run: { ...receive.run!, input: undefined, inputTruncated: true },
    });
    expect(byId('workflow-ndv-input')?.textContent).toContain(
      'Larger than 20 000 characters, not kept.',
    );
  });

  it('shows a step error', () => {
    const receive = node('receive');
    open({
      ...receive,
      run: {
        ...receive.run!,
        status: 'failed',
        output: undefined,
        error: 'No catalog',
      },
    });
    expect(text('workflow-ndv-output-error')).toBe('No catalog');
    expect(text('workflow-ndv-output-status')).toBe('Failed');
  });

  it('shows the Start node: description, trigger, inputs, outputs, agents', () => {
    open(node('start'));
    expect(text('workflow-panel-description')).toBe(
      'Answers a question over the datasets.',
    );
    expect(text('workflow-panel-trigger')).toBe('Runs on an input');
    expect(text('workflow-param-question')).toContain('Question');
    expect(text('workflow-param-question')).toContain('Required');
    expect(text('workflow-param-datasets')).not.toContain('Required');
    expect(text('workflow-panel-output')).toBe('calls, stopped');
    expect(byId('workflow-ndv-output')?.textContent).toContain('Top 5 states?');
    expect(byId('workflow-ndv-input-errors')).toBeNull();
    const keys: string[] = [];
    fixture.componentInstance.openAgent.subscribe((k) => keys.push(k));
    byId('workflow-agent-qti')?.click();
    expect(keys).toEqual(['qti']);
  });

  it("lists each input field's type, rules and the steps that use it", () => {
    open(node('start'));
    expect(text('workflow-param-question')).toContain('text');
    expect(text('workflow-param-rules-question')).toBe(
      'Rules: Max 4000 characters',
    );
    expect(text('workflow-param-usedby-question')).toBe(
      'Used by: Receive question',
    );
    expect(text('workflow-param-rules-datasets')).toBe(
      'Rules: PostgreSQL datasets',
    );
    expect(text('workflow-param-usedby-datasets')).toBe('Used by: None');
  });

  it('lists the errors that refused the last Execute in the Start Output', () => {
    open({
      ...node('start'),
      run: null,
      inputErrors: [
        { field: 'question', message: 'Question is required' },
        { field: 'datasets', message: 'Select at least one dataset' },
      ],
    });
    const list = byId('workflow-ndv-input-errors')!;
    expect(
      Array.from(list.querySelectorAll('li')).map((li) =>
        li.textContent?.trim(),
      ),
    ).toEqual(['Question is required', 'Select at least one dataset']);
    expect(text('workflow-ndv-output-status')).toBe('Invalid input');
    expect(byId('workflow-ndv-output')?.textContent).not.toContain(
      'This node has not run yet',
    );
  });

  it('shows the End node: the last output as input, the run line and output', () => {
    open(node('end'));
    expect(byId('workflow-ndv-input')?.textContent).toContain(
      '"stopped": false',
    );
    expect(text('workflow-ndv-output-line')).toBe('Run succeeded');
    expect(byId('workflow-ndv-output')?.textContent).toContain(
      'California leads.',
    );
  });

  describe('declared contracts (ui.md 4.4b)', () => {
    function openContract(
      n: NodeInspection,
      runContractHash: string | null = '3f9a1c0b7d2e',
    ) {
      fixture = TestBed.createComponent(WorkflowNodeDialog);
      fixture.componentRef.setInput('node', n);
      fixture.componentRef.setInput('workflow', FIXTURE_CONTRACT_WORKFLOW);
      fixture.componentRef.setInput('runId', 'run_8f21c4');
      fixture.componentRef.setInput('runContractHash', runContractHash);
      fixture.detectChanges();
    }
    /** Settings: an agent step's Config view, any other node's Settings tab. */
    const settings = () => {
      const config = byId('workflow-ndv-view-config');
      (config ?? byId('workflow-ndv-tab-settings'))?.click();
      fixture.detectChanges();
    };
    const data = () => {
      byId('workflow-ndv-view-data')?.click();
      fixture.detectChanges();
    };

    it('lists Receives and Returns with their types and required markers', () => {
      openContract(FIXTURE_CONTRACT_ANALYSE);
      settings();
      expect(fields('workflow-step-field-input')).toEqual([
        'question* (required): string',
        'catalog* (required): object[]',
      ]);
      expect(fields('workflow-step-field-output')).toEqual([
        'calls* (required): number',
        'stopped: boolean',
      ]);
      const receives = byId('workflow-step-field-input')!.querySelectorAll(
        '[data-testid="workflow-contract-field"]',
      );
      expect(receives[0].getAttribute('data-required')).toBe('true');
      expect(receives[0].getAttribute('title')).toBe('What the user asked.');
      expect(receives[1].getAttribute('title')).toBeNull();
      const returns = byId('workflow-step-field-output')!.querySelectorAll(
        '[data-testid="workflow-contract-field"]',
      );
      expect(returns[1].getAttribute('data-required')).toBe('false');
      // The marker is read as "required", not as an asterisk.
      expect(
        receives[0].querySelector('[aria-hidden="true"]')?.textContent,
      ).toBe('*');
    });

    it("types the End node's Receives from the last step's declared output", () => {
      openContract({ ...node('end') });
      expect(fields('workflow-end-field-input')).toEqual([
        'calls* (required): number',
        'stopped: boolean',
      ]);
    });

    it("shows the declared contract in the Output's Schema mode", () => {
      openContract(FIXTURE_CONTRACT_ANALYSE);
      data();
      const output = byId('workflow-ndv-output')!;
      output
        .querySelector<HTMLElement>('[data-testid="workflow-data-mode-schema"]')
        ?.click();
      fixture.detectChanges();
      expect(
        output
          .querySelector('[data-testid="workflow-data-schema-declared"]')
          ?.textContent?.trim(),
      ).toBe('Declared contract');
      expect(
        output.querySelector('[data-testid="workflow-data-schema"]')
          ?.textContent,
      ).toContain('How many tool calls ran.');
    });

    it('Settings shows the contract hash, with no note when the run used it', () => {
      openContract(FIXTURE_CONTRACT_ANALYSE);
      settings();
      expect(text('workflow-ndv-setting-contract')).toBe('3f9a1c0b7d2e');
      expect(byId('workflow-ndv-params')?.textContent).toContain('Contract');
      expect(byId('workflow-ndv-contract-older')).toBeNull();
    });

    it('Settings says when the stored run used an earlier contract', () => {
      openContract(FIXTURE_CONTRACT_ANALYSE, '0a1b2c3d4e5f');
      settings();
      expect(text('workflow-ndv-setting-contract')).toBe('3f9a1c0b7d2e');
      expect(text('workflow-ndv-contract-older')).toBe(
        'This run used an earlier contract (0a1b2c3d4e5f).',
      );
    });

    it('Settings has no note for an old run without a hash, nor a hash row without a contract', () => {
      openContract(FIXTURE_CONTRACT_ANALYSE, null);
      settings();
      expect(byId('workflow-ndv-contract-older')).toBeNull();

      open(node('analyse'));
      settings();
      expect(byId('workflow-ndv-setting-contract')).toBeNull();
    });

    it("a tool's Settings shows the contract hash too", () => {
      fixture = TestBed.createComponent(WorkflowNodeDialog);
      fixture.componentRef.setInput('node', FIXTURE_TOOL);
      fixture.componentRef.setInput('workflow', FIXTURE_CONTRACT_WORKFLOW);
      fixture.componentRef.setInput('runContractHash', '0a1b2c3d4e5f');
      fixture.detectChanges();
      settings();
      expect(text('workflow-ndv-setting-calls')).toBe('1');
      expect(text('workflow-ndv-setting-contract')).toBe('3f9a1c0b7d2e');
      expect(text('workflow-ndv-contract-older')).toBe(
        'This run used an earlier contract (0a1b2c3d4e5f).',
      );
    });

    it('shows an input contract violation with its field path highlighted', () => {
      openContract(FIXTURE_INPUT_VIOLATION);
      expect(text('workflow-ndv-output-status')).toBe('Failed');
      // A failed step without a story: its Story shows the error.
      expect(text('workflow-ndv-story-error')).toBe(
        'Contract violation in Analyse (input): question Required',
      );
      data();
      expect(text('workflow-ndv-output-error')).toBe(
        'Contract violation in Analyse (input): question Required',
      );
      expect(text('workflow-ndv-contract-violation')).toBe(
        'Contract violation in Analyse (input): question Required',
      );
      const path = byId('workflow-ndv-contract-violation-path')!;
      expect(path.tagName).toBe('CODE');
      expect(path.textContent).toBe('question');
    });

    it('shows an output contract violation with its field path highlighted', () => {
      openContract(FIXTURE_OUTPUT_VIOLATION);
      data();
      expect(text('workflow-ndv-contract-violation-path')).toBe('calls');
      expect(text('workflow-ndv-output-error')).toBe(
        'Contract violation in Analyse: calls Expected number, received string',
      );
    });

    it('shows any other step error as plain text', () => {
      openContract({
        ...FIXTURE_CONTRACT_ANALYSE,
        run: {
          ...FIXTURE_CONTRACT_ANALYSE.run!,
          status: 'failed',
          error: 'Boom',
        },
      });
      data();
      expect(text('workflow-ndv-output-error')).toBe('Boom');
      expect(byId('workflow-ndv-contract-violation')).toBeNull();
    });
  });

  it('shows the End node of a failed run with its error', () => {
    const end = node('end');
    open({
      ...end,
      run: { ...end.run!, status: 'skipped', output: undefined, error: 'Boom' },
    });
    expect(text('workflow-ndv-output-line')).toBe('Run failed');
    expect(text('workflow-ndv-output-error')).toBe('Boom');
  });

  describe('a tool (opened from its sub-node)', () => {
    const all = (id: string) =>
      Array.from(el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
    const squash = (e: HTMLElement) =>
      e.textContent?.replace(/\s+/g, ' ').trim();
    const FAILED_CALL = {
      tool: 'run_readonly_sql',
      input: 'SELECT x FROM claims',
      error: 'column "x" does not exist',
      durationMs: 30,
      finished: true,
    };
    const withFailedCall: NodeInspection = {
      ...FIXTURE_TOOL,
      tool: {
        ...FIXTURE_TOOL.tool!,
        calls: [...FIXTURE_TOOL.tool!.calls, FAILED_CALL],
        totalDurationMs: 1130,
      },
    };

    it("shows the tool's header, not the agent's: wrench, name, TOOL badge, owner line", () => {
      open(FIXTURE_TOOL);
      expect(text('workflow-ndv-title')).toBe('run_readonly_sql');
      const header = el().querySelector('header')!;
      expect(header.textContent).toContain('TOOL');
      expect(header.textContent).not.toContain('LLM');
      expect(header.textContent).toContain(
        'Tool of Insights Analyst · Analyse',
      );
      expect(byId('workflow-step-field-system-prompt')).toBeNull();
      expect(byId('workflow-step-field-id')).toBeNull();
    });

    it('lists its name, description, inputs, agent and step', () => {
      open(FIXTURE_TOOL);
      expect(text('workflow-tool-field-name')).toBe('run_readonly_sql');
      expect(text('workflow-tool-field-description')).toBe(
        'Runs one read-only SQL query.',
      );
      expect(text('workflow-tool-field-inputs')).toBe('sql, reason');
      expect(text('workflow-tool-field-agent')).toBe(
        'Insights Analyst',
      );
      expect(text('workflow-tool-field-step')).toBe('Analyse');
      open({ ...FIXTURE_TOOL, tool: { ...FIXTURE_TOOL.tool!, inputs: [] } });
      expect(text('workflow-tool-field-inputs')).toBe('None');
    });

    it('opens its agent and its step from their links', () => {
      open(FIXTURE_TOOL);
      const agents: string[] = [];
      const steps: string[] = [];
      fixture.componentInstance.openAgent.subscribe((k) => agents.push(k));
      fixture.componentInstance.openStep.subscribe((s) => steps.push(s));
      byId('workflow-tool-field-agent')?.querySelector('button')?.click();
      byId('workflow-tool-field-step')?.querySelector('button')?.click();
      expect(agents).toEqual(['qti']);
      expect(steps).toEqual(['analyse']);
    });

    it("shows each call's input, and a result row per call", () => {
      open(withFailedCall);
      expect(all('workflow-ndv-tool-input').map(squash)).toEqual([
        'SELECT state FROM claims',
        'SELECT x FROM claims',
      ]);
      expect(all('workflow-ndv-tool-result').map(squash)).toEqual([
        'Done · 5 rows · 1.1 s',
        'Failed · 30 ms · column "x" does not exist',
      ]);
      // The step's own data is not shown.
      expect(byId('workflow-ndv-input')?.textContent).not.toContain(
        'Top 5 states?',
      );
      expect(byId('workflow-step-evidence')).toBeNull();
    });

    it('Settings: calls, total duration and run id', () => {
      open(withFailedCall);
      byId('workflow-ndv-tab-settings')?.click();
      fixture.detectChanges();
      expect(text('workflow-ndv-setting-calls')).toBe('2');
      expect(text('workflow-ndv-setting-duration')).toBe('1.1 s');
      expect(text('workflow-ndv-setting-run-id')).toBe('run_8f21c4');
      expect(byId('workflow-ndv-setting-status')).toBeNull();
    });

    it('says the tool has not run yet before any run', () => {
      open(FIXTURE_TOOL_NOT_RUN, null);
      const notRun =
        'This tool has not run yet. Execute the user journey to see its calls.';
      expect(byId('workflow-ndv-input')?.textContent).toContain(notRun);
      expect(byId('workflow-ndv-output')?.textContent).toContain(notRun);
      expect(byId('workflow-ndv-tool-input')).toBeNull();
      byId('workflow-ndv-tab-settings')?.click();
      fixture.detectChanges();
      expect(text('workflow-ndv-setting-calls')).toBe('0');
      expect(text('workflow-ndv-setting-duration')).toBe('—');
      expect(text('workflow-ndv-setting-run-id')).toBe('Not run yet');
    });

    it('shows a running call as Running…', () => {
      open({
        ...FIXTURE_TOOL,
        tool: {
          ...FIXTURE_TOOL.tool!,
          calls: [
            { tool: 'run_readonly_sql', input: 'SELECT 1', finished: false },
          ],
        },
      });
      expect(all('workflow-ndv-tool-result').map(squash)).toEqual(['Running…']);
    });
  });

  it('closes on Escape and on Close', () => {
    open(node('analyse'));
    let closed = 0;
    fixture.componentInstance.close.subscribe(() => closed++);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(closed).toBe(1);
    byId('workflow-ndv-close')?.click();
    expect(closed).toBe(2);
  });

  it('skips the controls of a collapsed section when Tab wraps', () => {
    open(node('receive'));
    const focusable = Array.from(
      byId('workflow-ndv')!.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((e) => e.closest('[hidden]') === null);
    // Output starts collapsed: its toggle is the last control Tab reaches.
    expect(focusable[focusable.length - 1]).toBe(
      byId('workflow-ndv-output-toggle')!,
    );
  });

  it('focuses Close first and keeps Tab inside the dialog', async () => {
    open(node('analyse'));
    await fixture.whenStable();
    const close = byId('workflow-ndv-close') as HTMLButtonElement;
    expect(document.activeElement).toBe(close);

    const focusable = Array.from(
      byId('workflow-ndv')!.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((e) => e.closest('[hidden]') === null);
    const last = focusable[focusable.length - 1];
    // The column's last control is the last that Tab reaches.
    expect(byId('workflow-ndv-column')!.contains(last)).toBeTrue();
    last.focus();
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
  });
});

describe('WorkflowNodeDialog on a graph with a retry loop', () => {
  let fixture: ComponentFixture<WorkflowNodeDialog>;
  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const all = (id: string) =>
    Array.from(el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const text = (id: string) =>
    byId(id)?.textContent?.replace(/\s+/g, ' ').trim();
  const nodes = (run = GRAPH_RETRY_RUN) =>
    buildNodeInspections({
      workflow: GRAPH_WORKFLOW,
      run,
      liveToolCalls: [],
      running: false,
    });

  function expandCards(cards: 'data' | 'config') {
    const toggles =
      cards === 'data'
        ? ['workflow-ndv-input-toggle', 'workflow-ndv-output-toggle']
        : ['workflow-ndv-params-toggle'];
    for (const id of toggles) {
      if (byId(id)!.getAttribute('aria-expanded') !== 'true') byId(id)!.click();
    }
    fixture.detectChanges();
  }
  /** Opens evidence row `i` and gives its detail's text. */
  function evidenceDetail(i: number): string | undefined {
    byId(`workflow-step-evidence-row-${i}`)!.click();
    fixture.detectChanges();
    return text(`workflow-step-evidence-detail-${i}`);
  }

  function open(
    id: string,
    run = GRAPH_RETRY_RUN,
    chat: NodeChatAvailability = { state: 'hidden' },
  ) {
    fixture = TestBed.createComponent(WorkflowNodeDialog);
    fixture.componentRef.setInput(
      'node',
      nodes(run).find((n) => n.nodeId === id)!,
    );
    fixture.componentRef.setInput('workflow', GRAPH_WORKFLOW);
    fixture.componentRef.setInput('runId', 'run-retry');
    fixture.componentRef.setInput('chat', chat);
    fixture.detectChanges();
  }

  beforeEach(() => {
    const api = jasmine.createSpyObj<WorkflowRunsApiService>(
      'WorkflowRunsApiService',
      ['getNodeChat', 'streamNodeChat'],
    );
    api.getNodeChat.and.returnValue(of({ messages: [] }));
    TestBed.configureTestingModule({
      imports: [WorkflowNodeDialog],
      providers: [{ provide: WorkflowRunsApiService, useValue: api }],
    });
  });

  it('switches between the attempts of a repeated step, the last one first', () => {
    open('analyse');
    const one = byId('workflow-attempt-1')!;
    const two = byId('workflow-attempt-2')!;
    const header = () => el().querySelector('header')!.textContent;
    expect(one.textContent?.trim()).toBe('Attempt 1');
    expect(two.getAttribute('aria-pressed')).toBe('true');
    expect(one.getAttribute('aria-pressed')).toBe('false');
    // A run stored without stories says so in the Story.
    expect(text('workflow-ndv-story-empty')).toContain('No story was kept');
    expandCards('data');
    expect(byId('workflow-ndv-input')?.textContent).toContain('second');
    expect(evidenceDetail(0)).toContain('select 2');
    expect(header()).toContain('9.0 s');

    one.click();
    fixture.detectChanges();
    expect(one.getAttribute('aria-pressed')).toBe('true');
    expect(byId('workflow-ndv-input')?.textContent).toContain('first');
    // Another attempt: its own calls, none of them open.
    expect(text('workflow-step-evidence-detail-0')).toBe('');
    expect(evidenceDetail(0)).toContain('select 1');
    expect(text('workflow-step-evidence-detail-0')).toContain('boom');
    expect(header()).toContain('6.0 s');
  });

  it("shows the Story of the attempt picked", () => {
    const told = (attempt: number) => ({
      headline: `Attempt ${attempt} ran.`,
      source: 'step' as const,
    });
    open('analyse', {
      ...GRAPH_RETRY_RUN,
      steps: GRAPH_RETRY_RUN.steps.map((s) =>
        s.id === 'analyse' ? { ...s, story: told(s.attempt ?? 1) } : s,
      ),
    });
    expect(text('workflow-step-story-headline')).toBe('Attempt 2 ran.');
    byId('workflow-attempt-1')!.click();
    fixture.detectChanges();
    expect(text('workflow-step-story-headline')).toBe('Attempt 1 ran.');
  });

  it('shows no attempt switcher for a step that ran once', () => {
    open('plan');
    expect(byId('workflow-attempts')).toBeNull();
  });

  it("shows Plan's output as a plan above the data", () => {
    open('plan');
    expandCards('data');
    const view = byId('workflow-plan-view')!;
    expect(view).not.toBeNull();
    expect(text('workflow-plan-question')).toBe('How many matches per stage?');
    const items = (id: string) =>
      Array.from(byId(id)!.querySelectorAll('li')).map((li) =>
        li.textContent?.trim(),
      );
    expect(items('workflow-plan-measures')).toEqual(['match count']);
    expect(items('workflow-plan-entities')).toEqual(['matches', 'stages']);
    expect(items('workflow-plan-assumptions')).toEqual([
      'A replayed match counts once',
    ]);
    expect(text('workflow-plan-scope')).toBe('All tournaments');
    expect(byId('workflow-plan-clarification')).toBeNull();
    // The raw data still follows it.
    expect(
      view.compareDocumentPosition(
        byId('workflow-ndv-output')!.querySelector('app-workflow-data-view')!,
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("shows a plan's clarification with its options", () => {
    const run = {
      ...GRAPH_RETRY_RUN,
      steps: GRAPH_RETRY_RUN.steps.map((s) =>
        s.id === 'plan'
          ? {
              ...s,
              output: {
                ...GRAPH_PLAN,
                needsClarification: true,
                clarification: {
                  question: 'Which tournament?',
                  options: ['2018', '2022'],
                },
              },
            }
          : s,
      ),
    };
    open('plan', run);
    expandCards('data');
    expect(text('workflow-plan-clarification-question')).toBe(
      'Which tournament?',
    );
    expect(
      all('workflow-plan-clarification-option').map((o) =>
        o.textContent?.trim(),
      ),
    ).toEqual(['2018', '2022']);
  });

  it('shows no plan for a step that only passes the plan on', () => {
    open('analyse');
    expect(byId('workflow-plan-view')).toBeNull();
    expect(byId('workflow-validate-view')).toBeNull();
  });

  it("shows Validate's findings as a checklist, per attempt", () => {
    open('validate');
    expect(text('workflow-validate-ok')).toBe('Valid');
    expect(text('workflow-validate-attempt')).toContain('Attempt 2');
    expect(
      all('workflow-validate-finding').map((f) =>
        f.getAttribute('data-passed'),
      ),
    ).toEqual(['true', 'true']);

    byId('workflow-attempt-1')!.click();
    fixture.detectChanges();
    expect(text('workflow-validate-ok')).toBe('Not valid');
    const findings = all('workflow-validate-finding');
    expect(findings.map((f) => f.getAttribute('data-passed'))).toEqual([
      'false',
      'true',
    ]);
    expect(findings[0].textContent).toContain('Failed:');
    expect(findings[0].textContent).toContain('No query returned rows.');
  });

  it('offers Chat on every agent step (Plan, Analyse, Write answer), not on code steps', () => {
    const ready: NodeChatAvailability = { state: 'ready', runId: 'run-retry' };
    for (const id of ['plan', 'analyse', 'write-answer']) {
      open(id, GRAPH_RETRY_RUN, ready);
      expect(byId('workflow-ndv-chat')).withContext(id).not.toBeNull();
    }
    for (const id of ['clarify', 'validate']) {
      open(id, GRAPH_RETRY_RUN, ready);
      expect(byId('workflow-ndv-chat')).withContext(id).toBeNull();
    }
  });
});
