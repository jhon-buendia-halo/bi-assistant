jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({
    getDatasets: () =>
      Promise.resolve([
        {
          name: 'Intellify RFP API',
          datasourceId: 'rest-1',
          datasourceKind: 'rest',
          tables: [],
        },
      ]),
    restTarget: () =>
      Promise.resolve({ baseUrl: 'http://api', headers: { 'X-API-Key': 'k' } }),
  }),
}));

import type { EvalCustomCheckInput, EvalRawToolCall } from './assistant.evals';
import {
  answerExcludes,
  answerMatches,
  calledWith,
  carrierKeys,
  firstDataCall,
  inOrder,
  lastCallSucceeded,
  neverCalledWith,
  notCalled,
  savedRfp,
  skillStep,
  skillsLoaded,
  succeeded,
} from './rfp-eval-checks';

const call = (
  name: string,
  input: unknown = {},
  failed = false,
  output: unknown = {},
): EvalRawToolCall => ({ name, input, output, failed });

function run(
  toolCalls: EvalRawToolCall[],
  answer = '',
  vars: Record<string, string> = {},
): EvalCustomCheckInput {
  return { answer, toolCalls, datasets: ['Intellify RFP API'], vars };
}

describe('the rfp custom checks (agents.md 8.1)', () => {
  const calls = [
    call('skill', { name: 'rfp-carriers' }),
    call('update_workflow', { current: 4 }),
    call('get_rfp', '{"rfpId":"r-1"}'),
    call('set_rfp_carriers', { rfpId: 'r-1' }, true, {
      error: 'Unknown carrier "BCBS"',
    }),
    call('set_rfp_carriers', { rfpId: 'r-1' }),
  ];

  it('reads calls, their JSON inputs and their order', async () => {
    expect(await succeeded('set_rfp_carriers').run(run(calls))).toBeUndefined();
    expect(await succeeded('create_rfp').run(run(calls))).toMatch(
      'no successful "create_rfp" call',
    );
    expect(await notCalled('create_rfp').run(run(calls))).toBeUndefined();
    expect(await notCalled('get_rfp').run(run(calls))).toBe(
      '"get_rfp" was called 1×',
    );
    expect(
      await lastCallSucceeded('set_rfp_carriers').run(run(calls)),
    ).toBeUndefined();
    expect(
      await calledWith(
        'get_rfp',
        'the setup id',
        (input, _call, vars) => input['rfpId'] === vars['rfpId'],
      ).run(run(calls, '', { rfpId: 'r-1' })),
    ).toBeUndefined();
    expect(
      await neverCalledWith(
        'set_rfp_carriers',
        'another RFP',
        (input) => input['rfpId'] !== 'r-1',
      ).run(run(calls)),
    ).toBeUndefined();
    expect(await firstDataCall('get_rfp').run(run(calls))).toBeUndefined();
    expect(
      await inOrder([skillStep('rfp-carriers'), 'get_rfp']).run(run(calls)),
    ).toBeUndefined();
    expect(
      await inOrder(['get_rfp', skillStep('rfp-carriers')]).run(run(calls)),
    ).toMatch('expected get_rfp → skill(rfp-carriers)');
    expect(skillsLoaded(calls)).toEqual(['rfp-carriers']);
  });

  it('gives each check an id of its own', () => {
    const ids = [
      succeeded('a'),
      succeeded('b'),
      notCalled('a'),
      answerMatches(/x/, 'has x'),
      answerExcludes(/y/, 'has no y'),
    ].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('checks the answer text', async () => {
    expect(
      await answerMatches(/9\.9\d?%/, 'has the increase').run(
        run([], 'Medical rose 9.94% in 2026'),
      ),
    ).toBeUndefined();
    expect(
      await answerExcludes(/Sun Life/, 'no deleted carrier').run(
        run([], 'Dental is with Sun Life'),
      ),
    ).toBe('the answer contains "Sun Life"');
  });

  it('reads the setup record back from the API', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'r-1',
          status: 'draft',
          stage: 4,
          carriers: [
            {
              insurerName: 'Cigna',
              lines: ['Medical', 'Dental'],
              incumbent: true,
            },
            { insurerName: 'Aetna', lines: ['Dental'], incumbent: false },
          ],
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock;
    const check = savedRfp('two carriers', (rfp) =>
      carrierKeys(rfp).join(' ') === 'Aetna[Dental] Cigna[Dental,Medical]*'
        ? undefined
        : carrierKeys(rfp).join(' '),
    );
    expect(await check.run(run([], '', { rfpId: 'r-1' }))).toBeUndefined();
    const [url] = (fetchMock.mock.calls as [string][])[0];
    expect(url).toBe('http://api/v1/rfps/r-1');
    expect(await check.run(run([]))).toBe(
      'the case has no setup draft to read back',
    );
  });
});
