import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  flush,
  tick,
} from '@angular/core/testing';
import { of } from 'rxjs';
import { ChatMessage, Project } from '../../models/project.model';
import { ProjectsApiService } from '../../services/projects-api.service';
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

  it('offers follow-up chips for a clicked data mark without sending', async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectChat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectChat);
    fixture.componentRef.setInput('project', projectWith(answer));
    fixture.componentRef.setInput('activeVisualizationId', 'visual-1');
    fixture.componentRef.setInput('dataPointSelection', {
      value: 'Cardiology',
      label: 'Cardiology (312 claims)',
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const chips = Array.from(
      el.querySelectorAll<HTMLButtonElement>(
        '[aria-label="Follow-up suggestions"] button',
      ),
    );

    expect(chips.length).toBe(3);
    expect(chips[0].textContent).toContain('Drill into "Cardiology (312 claims)"');
    expect(chips[1].textContent).toContain('Why "Cardiology (312 claims)"?');

    chips[0].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.draft()).toBe(
      'Drill into "Cardiology": break it down further.',
    );
    // Filling the composer must not start a turn.
    expect(fixture.componentInstance.sending()).toBeFalse();

    // Dismiss clears the row.
    chips[2].click();
    fixture.detectChanges();
    expect(
      el.querySelector('[aria-label="Follow-up suggestions"]'),
    ).toBeNull();
  });

  it('hides follow-up chips when no visual is open', async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectChat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(ProjectChat);
    fixture.componentRef.setInput('project', projectWith(answer));
    fixture.componentRef.setInput('dataPointSelection', { value: 'Cardiology' });
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[aria-label="Follow-up suggestions"]',
      ),
    ).toBeNull();
  });

  it('renders the cross-check verdict next to the Verified badge', async () => {
    const agreed = await render({
      ...answer,
      verified: true,
      crossCheck: {
        status: 'agree',
        note: 'independent re-derivation returned the same results',
      },
    });
    const chip = agreed.querySelector(
      '[title="independent re-derivation returned the same results"]',
    );
    expect(chip?.textContent?.trim()).toBe('Cross-checked');
    expect(chip?.className).toContain('text-emerald-400');
    expect(
      agreed.querySelector('[title="Matches an approved query"]'),
    ).toBeTruthy();

    TestBed.resetTestingModule();
    const differs = await render({
      ...answer,
      crossCheck: { status: 'disagree', note: 'results differ — treat with care' },
    });
    const amber = differs.querySelector(
      '[title="results differ — treat with care"]',
    );
    expect(amber?.textContent?.trim()).toBe('Cross-check differs');
    expect(amber?.className).toContain('text-amber-400');

    TestBed.resetTestingModule();
    const failed = await render({ ...answer, crossCheck: { status: 'error' } });
    const muted = failed.querySelector('[title="Cross-check failed"]');
    expect(muted?.textContent?.trim()).toBe('Cross-check failed');
    expect(muted?.className).toContain('text-zinc-500');
  });

  it('shows no cross-check chip on an ordinary answer', async () => {
    const el = await render(answer);
    expect(el.textContent).not.toContain('Cross-check');
  });

  it('sends careful mode only while the Careful chip is on', async () => {
    const el = await render(answer);
    const api = TestBed.inject(ProjectsApiService);
    const stream = spyOn(api, 'streamMessage').and.resolveTo();
    const chip = el.querySelector<HTMLButtonElement>(
      '[aria-label="Careful mode"]',
    )!;
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    fixture.componentInstance.draft.set('How many claims?');
    fixture.componentInstance.send();
    expect(stream.calls.mostRecent().args[5]).toBeFalse();

    chip.click();
    fixture.detectChanges();
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.className).toContain('text-emerald-400');

    fixture.componentInstance.stop();
    fixture.componentInstance.draft.set('And denied ones?');
    fixture.componentInstance.send();
    expect(stream.calls.mostRecent().args[5]).toBeTrue();
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

describe('ProjectChat deep analysis', () => {
  let fixture: ComponentFixture<ProjectChat>;

  const reportMessage: ChatMessage = {
    role: 'assistant',
    content: 'Denials rose to **12.4%**, driven by payer A.',
    at: '2026-01-01T00:00:02.000Z',
    report: {
      jobId: 'job-1',
      title: 'Denial drivers deep dive',
      path: 'reports/job-1.md',
      angles: 4,
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectChat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  /** Mount the chat over a transcript and return its root element. */
  function mount(messages: ChatMessage[] = []): HTMLElement {
    fixture = TestBed.createComponent(ProjectChat);
    fixture.componentRef.setInput('project', {
      id: 'project-1',
      name: 'Project 1',
      sandboxes: [],
      messages,
    } satisfies Project);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders a report message with its summary and a download button', () => {
    const el = mount([reportMessage]);

    expect(el.textContent).toContain('Denial drivers deep dive');
    expect(el.textContent).toContain('4 angles investigated');
    // Executive summary goes through the markdown pipe.
    expect(el.querySelector('.prose-dark')?.innerHTML).toContain(
      '<strong>12.4%</strong>',
    );
    expect(
      el.querySelector('[aria-label="Download report"]'),
    ).toBeTruthy();
  });

  it('downloads the report markdown', () => {
    const el = mount([reportMessage]);
    const api = TestBed.inject(ProjectsApiService);
    const download = spyOn(api, 'downloadDeepAnalysis').and.returnValue(
      of(new Blob(['# report'], { type: 'text/markdown' })),
    );

    el.querySelector<HTMLButtonElement>(
      '[aria-label="Download report"]',
    )!.click();

    expect(download).toHaveBeenCalledWith('project-1', 'job-1');
  });

  it('sends the draft as a job, polls it, and refreshes on completion', fakeAsync(() => {
    const el = mount();
    const api = TestBed.inject(ProjectsApiService);
    const start = spyOn(api, 'startDeepAnalysis').and.returnValue(
      of({ ok: true, message: 'Deep analysis started', jobId: 'job-1' }),
    );
    const stream = spyOn(api, 'streamMessage').and.resolveTo();
    const status = spyOn(api, 'deepAnalysisStatus').and.returnValues(
      of({
        ok: true,
        message: '',
        status: 'investigating' as const,
        progress: 'Investigating angle 2 of 4: By payer',
        step: 2,
        steps: 4,
      }),
      of({ ok: true, message: '', status: 'done' as const }),
    );
    const get = spyOn(api, 'get').and.returnValue(
      of({
        id: 'project-1',
        name: 'Project 1',
        sandboxes: [],
        messages: [reportMessage],
      } satisfies Project),
    );

    fixture.componentInstance.draft.set('Why are denials rising?');
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[aria-label="Deep analysis"]')!.click();
    fixture.detectChanges();

    // A job, not a chat turn — and the composer is free again.
    expect(start).toHaveBeenCalledWith('project-1', 'Why are denials rising?');
    expect(stream).not.toHaveBeenCalled();
    expect(fixture.componentInstance.draft()).toBe('');
    expect(fixture.componentInstance.sending()).toBeFalse();
    expect(el.textContent).toContain('Deep analysis running');

    tick(3000);
    fixture.detectChanges();
    expect(el.textContent).toContain('Investigating angle 2 of 4: By payer');

    tick(3000);
    fixture.detectChanges();
    expect(status).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith('project-1');
    // Card cleared, report message rendered from the refreshed project.
    expect(el.querySelector('[aria-label="Deep analysis status"]')).toBeNull();
    expect(el.textContent).toContain('Denial drivers deep dive');

    tick(6000);
    expect(status).toHaveBeenCalledTimes(2);
    flush();
  }));

  it('stops polling on a job error and shows the message', fakeAsync(() => {
    const el = mount();
    const api = TestBed.inject(ProjectsApiService);
    spyOn(api, 'startDeepAnalysis').and.returnValue(
      of({ ok: true, message: 'Deep analysis started', jobId: 'job-1' }),
    );
    const status = spyOn(api, 'deepAnalysisStatus').and.returnValue(
      of({
        ok: true,
        message: '',
        status: 'error' as const,
        error: 'warehouse unavailable',
      }),
    );

    fixture.componentInstance.draft.set('Why are denials rising?');
    fixture.componentInstance.runDeepAnalysis();
    tick(3000);
    fixture.detectChanges();

    expect(el.textContent).toContain('Deep analysis failed');
    expect(el.textContent).toContain('warehouse unavailable');

    tick(9000);
    expect(status).toHaveBeenCalledTimes(1);

    // Dismissing clears the card and frees the action again.
    el.querySelector<HTMLButtonElement>(
      '[aria-label="Dismiss deep analysis"]',
    )!.click();
    fixture.detectChanges();
    expect(el.querySelector('[aria-label="Deep analysis status"]')).toBeNull();
    flush();
  }));

  it('gives the question back when the job is refused', () => {
    mount();
    const api = TestBed.inject(ProjectsApiService);
    spyOn(api, 'startDeepAnalysis').and.returnValue(
      of({
        ok: false,
        message: 'A deep analysis is already running for this project',
      }),
    );

    fixture.componentInstance.draft.set('Why are denials rising?');
    fixture.componentInstance.runDeepAnalysis();

    expect(fixture.componentInstance.deepAnalysisJob()).toBeNull();
    expect(fixture.componentInstance.draft()).toBe('Why are denials rising?');
  });
});
