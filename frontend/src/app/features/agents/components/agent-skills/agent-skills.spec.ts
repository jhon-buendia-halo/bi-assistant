import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  AgentSkillsView,
  AgentsApiService,
} from '../../services/agents-api.service';
import { AgentSkills } from './agent-skills';

const view: AgentSkillsView = {
  skills: [
    {
      name: 'sql-style',
      description: 'Use when writing SQL for the World Cup data.',
      level: 'built-in',
      loading: 'on-demand',
      files: [
        { path: 'SKILL.md', size: 120 },
        { path: 'reference/style.md', size: 40 },
        { path: 'reference/logo.png', size: 9000 },
      ],
    },
    {
      name: 'curated-knowledge',
      description: 'Use when the turn carries a curated knowledge block.',
      level: 'built-in',
      loading: 'harness',
      files: [{ path: 'SKILL.md', size: 80 }],
    },
  ],
};

describe('AgentSkills', () => {
  let fixture: ComponentFixture<AgentSkills>;
  let http: HttpTestingController;

  async function render(
    skillsView: AgentSkillsView = view,
    userAgent = false,
  ): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [AgentSkills],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AgentSkills);
    fixture.componentRef.setInput('agentKey', 'assistant');
    fixture.componentRef.setInput('view', skillsView);
    fixture.componentRef.setInput('userAgent', userAgent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => http.verify());

  const byTestId = (el: HTMLElement, id: string) =>
    el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (node: Element | null) =>
    node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  function openRow(el: HTMLElement, name: string): HTMLButtonElement {
    const button = byTestId(el, `agent-skill-${name}`)!.querySelector(
      'button',
    )!;
    button.click();
    fixture.detectChanges();
    return button;
  }

  function fileRequest(name: string, path: string) {
    return http.expectOne(
      `/agents/assistant/skills/${name}/file?path=${encodeURIComponent(path)}`,
    );
  }

  it('shows no intro line, levels or Skipped section for a built-in agent', async () => {
    const el = await render();
    expect(text(el)).not.toContain('This agent runs on the assistant');
    expect(text(el)).not.toContain('Restart the app');
    expect(text(el)).not.toContain('Where skills come from');
    expect(text(el)).not.toContain('Skipped');
    expect(el.querySelectorAll('h3').length).toBe(0);
    expect(el.querySelector('[data-testid^="skill-level-"]')).toBeNull();
  });

  it("says a user agent uses the assistant's skills", async () => {
    const el = await render(view, true);
    expect(text(el)).toContain(
      "This agent runs on the assistant, so it uses the assistant's skills.",
    );
  });

  it('lists the skills by name with loading mode and description (R63)', async () => {
    const el = await render();
    const rows = Array.from(
      el.querySelectorAll<HTMLElement>('[data-testid^="agent-skill-"]'),
    );
    expect(rows.map((row) => row.dataset['testid'])).toEqual([
      'agent-skill-curated-knowledge',
      'agent-skill-sql-style',
    ]);

    // Name, the loading and level badges and the description.
    const parts = (row: HTMLElement) =>
      Array.from(
        row.querySelectorAll<HTMLElement>(
          'button > span > span, button > span',
        ),
      )
        .filter((span) => span.children.length === 0)
        .map((span) => text(span));
    expect(parts(rows[0])).toEqual([
      'curated-knowledge',
      'Loaded by the app',
      'Built-in',
      'Use when the turn carries a curated knowledge block.',
    ]);
    expect(parts(rows[1])).toEqual([
      'sql-style',
      'On demand',
      'Built-in',
      'Use when writing SQL for the World Cup data.',
    ]);
    expect(rows[0].querySelector('lucide-angular')).toBeNull();
    expect(rows[1].querySelector('button')!.getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('says so when the agent has no skills', async () => {
    const el = await render({ ...view, skills: [] });
    expect(text(el)).toContain('This agent has no skills.');
    expect(el.querySelector('[data-testid^="agent-skill-"]')).toBeNull();
  });

  it('opens a skill on SKILL.md and shows its content (R64)', async () => {
    const el = await render();
    const header = openRow(el, 'sql-style');
    expect(header.getAttribute('aria-expanded')).toBe('true');

    for (const path of [
      'SKILL.md',
      'reference/style.md',
      'reference/logo.png',
    ]) {
      expect(byTestId(el, `skill-file-${path}`)).not.toBeNull();
    }
    expect(byTestId(el, 'skill-file-SKILL.md')!.style.paddingLeft).toBe('8px');
    expect(
      byTestId(el, 'skill-file-reference/style.md')!.style.paddingLeft,
    ).toBe('20px');
    expect(
      byTestId(el, 'skill-file-SKILL.md')!.classList.contains('text-fg-strong'),
    ).toBeTrue();

    fileRequest('sql-style', 'SKILL.md').flush({
      path: 'SKILL.md',
      size: 120,
      content: '---\nname: sql-style\n---\n\nPrefer CTEs.',
    });
    fixture.detectChanges();
    const pre = byTestId(el, 'agent-skill-sql-style')!.querySelector('pre');
    expect(pre?.textContent).toBe('---\nname: sql-style\n---\n\nPrefer CTEs.');
  });

  it('shows another file when it is selected, and collapses on a second click', async () => {
    const el = await render();
    const header = openRow(el, 'sql-style');
    fileRequest('sql-style', 'SKILL.md').flush({
      path: 'SKILL.md',
      size: 120,
      content: 'name: sql-style',
    });
    fixture.detectChanges();

    byTestId(el, 'skill-file-reference/style.md')!.click();
    fixture.detectChanges();
    fileRequest('sql-style', 'reference/style.md').flush({
      path: 'reference/style.md',
      size: 40,
      content: '# Style\n\nOne clause per line.\n',
    });
    fixture.detectChanges();

    const row = byTestId(el, 'agent-skill-sql-style')!;
    expect(row.querySelector('pre')?.textContent).toContain('# Style');
    expect(row.querySelector('pre')?.textContent).not.toContain(
      'name: sql-style',
    );
    expect(
      byTestId(el, 'skill-file-reference/style.md')!.classList.contains(
        'text-fg-strong',
      ),
    ).toBeTrue();
    expect(
      byTestId(el, 'skill-file-SKILL.md')!.classList.contains('text-fg-strong'),
    ).toBeFalse();

    header.click();
    fixture.detectChanges();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(byTestId(el, 'skill-file-SKILL.md')).toBeNull();
  });

  it("says a file isn't shown when it has no content", async () => {
    const el = await render();
    openRow(el, 'sql-style');
    fileRequest('sql-style', 'SKILL.md').flush({
      path: 'SKILL.md',
      size: 120,
      content: 'name: sql-style',
    });
    fixture.detectChanges();
    byTestId(el, 'skill-file-reference/logo.png')!.click();
    fixture.detectChanges();
    fileRequest('sql-style', 'reference/logo.png').flush({
      path: 'reference/logo.png',
      size: 9000,
      content: null,
    });
    fixture.detectChanges();

    const row = byTestId(el, 'agent-skill-sql-style')!;
    expect(row.querySelector('pre')).toBeNull();
    expect(text(row)).toContain(
      "This file isn't shown: it is larger than 256 KB or isn't text.",
    );
  });

  it('shows the error when a file cannot be read', async () => {
    const el = await render();
    openRow(el, 'curated-knowledge');
    fileRequest('curated-knowledge', 'SKILL.md').flush(
      { message: 'Skill "curated-knowledge" has no file "SKILL.md"' },
      { status: 404, statusText: 'Not Found' },
    );
    fixture.detectChanges();
    const error = byTestId(el, 'agent-skill-curated-knowledge')!.querySelector(
      '.text-on-danger-soft',
    );
    expect(text(error)).toBe(
      'Skill "curated-knowledge" has no file "SKILL.md"',
    );
  });
});

describe('AgentsApiService skills', () => {
  let api: AgentsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(AgentsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the skills view of an agent', () => {
    let result: AgentSkillsView | undefined;
    api.skills('u 1').subscribe((res) => (result = res));
    const req = http.expectOne('/agents/u%201/skills');
    expect(req.request.method).toBe('GET');
    req.flush(view);
    expect(result).toEqual(view);
  });

  it('reads one file, the path as an encoded query parameter', () => {
    api.skillFile('assistant', 'sql style', 'reference/a b.md').subscribe();
    const req = http.expectOne(
      '/agents/assistant/skills/sql%20style/file?path=reference%2Fa%20b.md',
    );
    expect(req.request.method).toBe('GET');
    req.flush({ path: 'reference/a b.md', size: 1, content: 'x' });
  });
});
