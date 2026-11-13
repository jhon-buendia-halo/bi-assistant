import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { NodeInspection } from '../../models/workflow-node.model';
import { NodeChatAvailability } from '../../models/workflow.model';
import { WorkflowRunsApiService } from '../../services/workflow-runs-api.service';
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
      'Questions to Insights v2 · ≤ 15 steps',
    );
    expect(byId('workflow-ndv-input')).not.toBeNull();
    expect(byId('workflow-ndv-params')).not.toBeNull();
    expect(byId('workflow-ndv-output')).not.toBeNull();
  });

  it('shows an agent step: input, parameters, tool calls and output', () => {
    open(node('analyse'));
    expect(byId('workflow-ndv-input')?.textContent).toContain('Top 5 states?');
    expect(text('workflow-step-field-id')).toBe('analyse');
    expect(text('workflow-step-field-kind')).toBe('LLM (agent call)');
    expect(text('workflow-step-field-agent')).toContain(
      'Questions to Insights v2',
    );
    expect(text('workflow-step-field-model')).toBe(
      'anthropic/claude-sonnet-5-5',
    );
    expect(text('workflow-step-field-tools')).toBe(
      'list_entities, run_readonly_sql',
    );
    expect(text('workflow-step-field-max-steps')).toBe('15');
    expect(text('workflow-step-field-exits')).toBe(
      'Model error → fails · Stop → ends here',
    );
    // No declared schema (an older backend): the names, untyped.
    expect(fields('workflow-step-field-input')).toEqual(['question', 'catalog']);
    expect(fields('workflow-step-field-output')).toEqual(['calls', 'stopped']);
    expect(text('workflow-step-field-system-prompt')).toBe(
      'You are a data analyst.',
    );
    expect(el().textContent).toContain(
      "The agent's base prompt; each run adds its own context.",
    );
    expect(el().textContent).not.toContain('Shortened to 20 000 characters.');

    expect(text('workflow-ndv-output-status')).toBe('Done');
    const calls = el().querySelectorAll(
      '[data-testid="workflow-ndv-tool-call"]',
    );
    expect(calls.length).toBe(3);
    expect(calls[0].textContent).toContain('list_entities');
    expect(calls[0].textContent).toContain('200 ms');
    expect(calls[1].textContent).toContain('SELECT state FROM claims');
    expect(calls[1].textContent).toContain('1.1 s');
    expect(calls[1].textContent).toContain('5 rows');
    expect(calls[2].textContent).toContain('No such entity');
    expect(byId('workflow-ndv-output')?.textContent).toContain('"calls": 3');
  });

  it('says so when an agent step recorded no tool calls', () => {
    const analyse = node('analyse');
    open({ ...analyse, run: { ...analyse.run!, toolCalls: [] } });
    expect(byId('workflow-ndv-output')?.textContent).toContain(
      'No tool calls recorded.',
    );
  });

  it('notes a shortened system prompt', () => {
    const analyse = node('analyse');
    open({
      ...analyse,
      agent: { ...analyse.agent!, systemPromptTruncated: true },
    });
    expect(el().textContent).toContain('Shortened to 20 000 characters.');
  });

  it('opens the agent from its link', () => {
    open(node('analyse'));
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
        exits: [{ label: 'No catalog', outcome: 'fails' }],
      },
    });
    expect(text('workflow-step-field-exits')).toBe('No catalog → fails');
  });

  it('switches to Settings: status, duration and run id', () => {
    open(node('analyse'));
    byId('workflow-ndv-tab-settings')?.click();
    fixture.detectChanges();
    expect(
      byId('workflow-ndv-tab-settings')?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(text('workflow-ndv-setting-status')).toBe('Done');
    expect(text('workflow-ndv-setting-duration')).toBe('13.9 s');
    expect(text('workflow-ndv-setting-run-id')).toBe('run_8f21c4');
    expect(byId('workflow-step-field-id')).toBeNull();
  });

  describe('the Chat tab of an agent step (api.md 136, 137)', () => {
    let api: jasmine.SpyObj<WorkflowRunsApiService>;
    const tabs = () =>
      Array.from(el().querySelectorAll<HTMLElement>('[role="tab"]')).map(
        (tab) => tab.textContent?.trim(),
      );

    beforeEach(() => {
      api = jasmine.createSpyObj<WorkflowRunsApiService>('WorkflowRunsApiService', [
        'getNodeChat',
        'streamNodeChat',
      ]);
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

    it('comes after Settings, as a tab like the others', () => {
      openWithChat(node('analyse'), { state: 'ready', runId: 'run_8f21c4' });
      expect(tabs()).toEqual(['Parameters', 'Settings', 'Chat']);
      const chatTab = byId('workflow-ndv-tab-chat')!;
      expect(chatTab.getAttribute('role')).toBe('tab');
      expect(chatTab.getAttribute('aria-selected')).toBe('false');
      // Not read until the tab first shows.
      expect(byId('workflow-node-chat')).toBeNull();
      expect(api.getNodeChat).not.toHaveBeenCalled();

      chatTab.click();
      fixture.detectChanges();
      expect(chatTab.getAttribute('aria-selected')).toBe('true');
      expect(byId('workflow-node-chat')).not.toBeNull();
      expect(api.getNodeChat).toHaveBeenCalledOnceWith('run_8f21c4', 'analyse');
      expect(byId('workflow-step-field-id')).toBeNull();
    });

    it('stays mounted while another tab shows, so the conversation is kept', () => {
      openWithChat(node('analyse'), { state: 'ready', runId: 'run_8f21c4' });
      byId('workflow-ndv-tab-chat')!.click();
      fixture.detectChanges();
      const panel = byId('workflow-node-chat')!;
      byId('workflow-ndv-tab-settings')!.click();
      fixture.detectChanges();
      expect(panel.isConnected).toBe(true);
      expect(panel.closest('[hidden]')).not.toBeNull();
      expect(text('workflow-ndv-setting-status')).toBe('Done');
      byId('workflow-ndv-tab-chat')!.click();
      fixture.detectChanges();
      expect(byId('workflow-node-chat')).toBe(panel);
      expect(panel.closest('[hidden]')).toBeNull();
      expect(api.getNodeChat).toHaveBeenCalledTimes(1);
    });

    it('explains why it cannot chat yet before a run', () => {
      openWithChat(node('analyse'), { state: 'no-run' });
      byId('workflow-ndv-tab-chat')!.click();
      fixture.detectChanges();
      expect(text('workflow-node-chat-unavailable')).toBe(
        "Execute the workflow, then chat with this agent about this step's data.",
      );
    });

    it('is hidden for a run of a removed workflow, and on any node but an agent step', () => {
      openWithChat(node('analyse'), { state: 'hidden' });
      expect(byId('workflow-ndv-tab-chat')).toBeNull();
      for (const id of ['start', 'receive', 'end']) {
        openWithChat(node(id), { state: 'ready', runId: 'run_8f21c4' });
        expect(byId('workflow-ndv-tab-chat')).withContext(id).toBeNull();
      }
      openWithChat(FIXTURE_TOOL, { state: 'ready', runId: 'run_8f21c4' });
      expect(byId('workflow-ndv-tab-chat')).toBeNull();
    });
  });

  it('shows the not-run states', () => {
    open(FIXTURE_NODES_NOT_RUN[2], null);
    expect(byId('workflow-ndv-input')?.textContent).toContain(
      'This node has not run yet. Execute the workflow to see its data.',
    );
    expect(byId('workflow-ndv-output-status')).toBeNull();
    byId('workflow-ndv-tab-settings')?.click();
    fixture.detectChanges();
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
      Array.from(list.querySelectorAll('li')).map((li) => li.textContent?.trim()),
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
    const settings = () => {
      byId('workflow-ndv-tab-settings')?.click();
      fixture.detectChanges();
    };

    it('lists Receives and Returns with their types and required markers', () => {
      openContract(FIXTURE_CONTRACT_ANALYSE);
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
        output.querySelector('[data-testid="workflow-data-schema"]')?.textContent,
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
      expect(text('workflow-ndv-contract-violation-path')).toBe('calls');
      expect(text('workflow-ndv-output-error')).toBe(
        'Contract violation in Analyse: calls Expected number, received string',
      );
    });

    it('shows any other step error as plain text', () => {
      openContract({
        ...FIXTURE_CONTRACT_ANALYSE,
        run: { ...FIXTURE_CONTRACT_ANALYSE.run!, status: 'failed', error: 'Boom' },
      });
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
        'Tool of Questions to Insights v2 · Analyse',
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
        'Questions to Insights v2',
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
      expect(byId('workflow-ndv-tool-call')).toBeNull();
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
        'This tool has not run yet. Execute the workflow to see its calls.';
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
          calls: [{ tool: 'run_readonly_sql', input: 'SELECT 1', finished: false }],
        },
      });
      expect(all('workflow-ndv-tool-result').map(squash)).toEqual([
        'Running…',
      ]);
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

  it('focuses Close first and keeps Tab inside the dialog', async () => {
    open(node('analyse'));
    await fixture.whenStable();
    const close = byId('workflow-ndv-close') as HTMLButtonElement;
    expect(document.activeElement).toBe(close);

    const focusable = Array.from(
      byId('workflow-ndv')!.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const last = focusable[focusable.length - 1];
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
