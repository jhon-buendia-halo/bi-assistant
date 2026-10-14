import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { ToastService } from '../../../core/toast/toast.service';
import { AgentEditorService } from './agent-editor.service';

const DRAFT = {
  name: 'Cup historian',
  description: '',
  instructions: 'Answer in one sentence.',
  datasets: ['World Cup Core'],
  starterQuestions: [],
  tools: [],
};

const skill = (id: string) => ({
  id,
  name: id,
  description: `Use when ${id}`,
  fileCount: 0,
  agents: [],
  tools: [],
  updatedAt: '',
});
const SKILLS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
].map(skill);

describe('AgentEditorService', () => {
  let editor: AgentEditorService;
  let http: HttpTestingController;
  let toast: jasmine.SpyObj<ToastService>;

  beforeEach(() => {
    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
    ]);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ToastService, useValue: toast },
      ],
    });
    editor = TestBed.inject(AgentEditorService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Answers the requests `open` makes. */
  async function open(
    agentId: string | null,
    status = 'draft',
    draft: Record<string, unknown> = DRAFT,
  ) {
    editor.open(agentId);
    http
      .expectOne(`${API_BASE_URL}/llm/settings`)
      .flush({ configured: true, model: 'gpt-4.1' });
    http
      .expectOne(`${API_BASE_URL}/datasets`)
      .flush({ datasets: [{ name: 'World Cup Core', tables: [] }] });
    http.expectOne(`${API_BASE_URL}/skills`).flush({ skills: SKILLS });
    http.expectOne(`${API_BASE_URL}/skills/built-in`).flush({ skills: [] });
    if (agentId) {
      http.expectOne(`${API_BASE_URL}/agents/${agentId}`).flush({
        key: agentId,
        id: agentId,
        kind: 'user',
        status,
        hasUnpublishedChanges: false,
        draft,
      });
    }
    await new Promise((resolve) => setTimeout(resolve));
  }

  it('opens a new agent empty, with Save disabled and Publish shown', async () => {
    await open(null);
    expect(editor.title()).toBe('New agent');
    expect(editor.changed()).toBeFalse();
    expect(editor.canSave()).toBeFalse();
    expect(editor.showPublish()).toBeTrue();
    expect(editor.configuredModel()).toBe('gpt-4.1');
  });

  it('the first save creates the agent and clears the changes', async () => {
    await open(null);
    editor.update({ name: 'Cup historian' });
    expect(editor.canSave()).toBeTrue();

    const saved = editor.save();
    const req = http.expectOne(`${API_BASE_URL}/agents`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.name).toBe('Cup historian');
    req.flush({
      ok: true,
      message: 'Agent "Cup historian" saved as draft',
      agent: { key: 'cup-historian', id: 'cup-historian', status: 'draft' },
    });
    expect(await saved).toBeTrue();
    expect(toast.success).toHaveBeenCalledWith(
      'Agent "Cup historian" saved as draft',
    );
    expect(editor.agentId()).toBe('cup-historian');
    expect(editor.title()).toBe('Edit Cup historian');
    expect(editor.changed()).toBeFalse();
    expect(editor.status()).toBe('draft');
  });

  it('saves the instructions with their links and no tools or skills', async () => {
    await open(null);
    editor.update({
      name: 'Cup historian',
      instructions: 'Use [[skill:alpha]] and [[tool:sample_rows]].',
    });
    expect(editor.changed()).toBeTrue();

    const saved = editor.save();
    const req = http.expectOne(`${API_BASE_URL}/agents`);
    expect(req.request.body.instructions).toBe(
      'Use [[skill:alpha]] and [[tool:sample_rows]].',
    );
    expect('tools' in req.request.body).toBeFalse();
    expect('skills' in req.request.body).toBeFalse();
    req.flush({
      ok: true,
      message: 'saved',
      agent: { key: 'cup-historian', id: 'cup-historian', status: 'draft' },
    });
    await saved;
    expect(editor.changed()).toBeFalse();
    expect(editor.librarySkills().length).toBe(11);
  });

  it('a draft saved with the checkboxes opens with links appended, dirty, with the notice', async () => {
    await open('cup-historian', 'draft', {
      ...DRAFT,
      tools: undefined,
      skills: ['alpha', 'deleted-id'],
    });
    expect(editor.form().instructions).toBe(
      'Answer in one sentence.\nTools and skills: [[skill:alpha]] [[tool:sample_rows]] [[tool:ask_clarification]] [[tool:create_visual]]',
    );
    expect(editor.legacyNotice()).toBeTrue();
    expect(editor.changed()).toBeTrue();
    expect(editor.saved().instructions).toBe('Answer in one sentence.');
  });

  it('a draft whose links already match opens clean, and saving clears the notice', async () => {
    await open('cup-historian', 'draft', {
      ...DRAFT,
      instructions: 'Use [[tool:sample_rows]].',
      tools: ['sample_rows'],
    });
    expect(editor.legacyNotice()).toBeFalse();
    expect(editor.changed()).toBeFalse();

    await open('cup-historian', 'draft', { ...DRAFT, tools: undefined });
    expect(editor.legacyNotice()).toBeTrue();
    const saved = editor.save();
    http.expectOne(`${API_BASE_URL}/agents/cup-historian/draft`).flush({
      ok: true,
      message: 'saved',
      agent: { key: 'cup-historian', id: 'cup-historian', status: 'draft' },
    });
    await saved;
    expect(editor.legacyNotice()).toBeFalse();
  });

  it('a refused save changes nothing', async () => {
    await open(null);
    editor.update({ name: 'Health plan analyst' });
    const saved = editor.save();
    http.expectOne(`${API_BASE_URL}/agents`).flush({
      ok: false,
      message: 'An agent named "Health plan analyst" already exists',
    });
    expect(await saved).toBeFalse();
    expect(toast.error).toHaveBeenCalledWith(
      'An agent named "Health plan analyst" already exists',
    );
    expect(editor.agentId()).toBeNull();
    expect(editor.changed()).toBeTrue();
  });

  it('Publish saves the changes first, then shows the agent as Live', async () => {
    await open('cup-historian', 'live');
    expect(editor.showPublish()).toBeFalse();
    editor.update({ instructions: 'Talk like a pirate.' });
    expect(editor.showPublish()).toBeTrue();

    const published = editor.publish();
    const save = http.expectOne(`${API_BASE_URL}/agents/cup-historian/draft`);
    expect(save.request.body.instructions).toBe('Talk like a pirate.');
    save.flush({
      ok: true,
      message: 'Draft saved',
      agent: {
        key: 'cup-historian',
        id: 'cup-historian',
        status: 'live',
        hasUnpublishedChanges: true,
      },
    });
    await new Promise((resolve) => setTimeout(resolve));
    http.expectOne(`${API_BASE_URL}/agents/cup-historian/publish`).flush({
      ok: true,
      message: 'Agent "Cup historian" is Live',
      agent: {
        key: 'cup-historian',
        id: 'cup-historian',
        status: 'live',
        hasUnpublishedChanges: false,
      },
    });
    await published;
    expect(editor.status()).toBe('live');
    expect(editor.hasUnpublishedChanges()).toBeFalse();
    expect(editor.showPublish()).toBeFalse();
  });

  it('a new agent without datasets previews nothing and saves nothing', async () => {
    await open(null);
    editor.update({ name: 'Cup historian' });
    await editor.startPreview();
    expect(editor.preview()).toEqual({
      kind: 'no-dataset',
      message: 'Select at least one dataset to preview',
    });
  });

  it('starts a preview of the saved draft and discards it', async () => {
    await open('cup-historian');
    const started = editor.startPreview();
    expect(editor.preview().kind).toBe('starting');
    await new Promise((resolve) => setTimeout(resolve));
    const create = http.expectOne(`${API_BASE_URL}/sessions`);
    expect(create.request.body).toEqual({
      agentId: 'cup-historian',
      preview: true,
    });
    create.flush({
      ok: true,
      message: 'Preview started',
      session: {
        id: 'preview-1',
        name: 'Preview: Cup historian',
        datasets: ['World Cup Core'],
        messages: [],
        preview: true,
      },
    });
    await started;
    expect(editor.preview().kind).toBe('ready');

    editor.close();
    const discard = http.expectOne(`${API_BASE_URL}/sessions/preview-1`);
    expect(discard.request.method).toBe('DELETE');
    discard.flush({ ok: true, message: 'Preview discarded' });
    expect(editor.preview().kind).toBe('idle');
  });

  it('sending in the preview saves the changes first', async () => {
    await open('cup-historian');
    expect(await editor.beforePreviewSend()).toBeTrue();

    editor.update({ instructions: 'Talk like a pirate.' });
    const proceed = editor.beforePreviewSend();
    http
      .expectOne(`${API_BASE_URL}/agents/cup-historian/draft`)
      .flush({ ok: false, message: 'Agent name is required' });
    expect(await proceed).toBeFalse();
  });
});
