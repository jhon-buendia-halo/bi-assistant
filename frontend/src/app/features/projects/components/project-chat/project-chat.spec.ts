import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatMessage, Project } from '../../models/project.model';
import { ProjectChat } from './project-chat';

function projectWith(message: ChatMessage): Project {
  return {
    id: 'project-1',
    name: 'Project 1',
    sandboxes: [],
    messages: [{ role: 'user', content: 'Ask', at: '2026-01-01T00:00:00.000Z' }, message],
  };
}

describe('ProjectChat trust UX', () => {
  let fixture: ComponentFixture<ProjectChat>;

  async function render(message: ChatMessage): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [ProjectChat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectChat);
    fixture.componentRef.setInput('project', projectWith(message));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const answer: ChatMessage = {
    role: 'assistant',
    content: 'Answer',
    at: '2026-01-01T00:00:01.000Z',
    data: [
      {
        tool: 'run_readonly_sql',
        input: 'select 1',
        rowCount: 500,
      },
    ],
  };

  it('renders the server-built interpretation caption verbatim', async () => {
    const line = 'Computed from 1 query over main.health.claims — 500 rows analyzed.';
    const el = await render({ ...answer, interpretation: line });
    const caption = el.querySelector(`[title="${line}"]`);
    expect(caption?.textContent?.trim()).toBe(line);
  });

  it('shows the Verified chip only on verified answers', async () => {
    const plain = await render(answer);
    expect(plain.querySelector('[title="Matches an approved query"]')).toBeNull();

    TestBed.resetTestingModule();
    const verified = await render({ ...answer, verified: true });
    expect(
      verified
        .querySelector('[title="Matches an approved query"]')
        ?.textContent?.trim(),
    ).toBe('Verified');
  });

  it('marks truncated records and offers a copy-SQL button', async () => {
    const el = await render({
      ...answer,
      data: [{ ...answer.data![0], truncated: true }],
    });
    expect(
      el.querySelector('[title="Row cap reached — counts may be incomplete"]')
        ?.textContent?.trim(),
    ).toBe('(truncated)');
    expect(el.querySelector('[aria-label="Copy SQL"]')).toBeTruthy();
  });

  it('shows the work collected before a clarification', async () => {
    const el = await render({
      role: 'assistant',
      content: '',
      at: '2026-01-01T00:00:01.000Z',
      clarification: {
        question: 'Which plan year?',
        options: [{ label: '2025' }, { label: '2026' }],
      },
      entities: ['main.health.claims'],
      data: [{ ...answer.data![0], truncated: true }],
    });

    expect(el.textContent).toContain('Which plan year?');
    expect(el.textContent).toContain('Data entities');
    expect(el.textContent).toContain('main.health.claims');
    expect(el.textContent).toContain('Data used (1 query)');
    expect(
      el.querySelector('[title="Row cap reached — counts may be incomplete"]'),
    ).toBeTruthy();
    expect(el.querySelector('[aria-label="Copy SQL"]')).toBeTruthy();
  });
});
