jest.mock('./synthetic-data.service', () => ({
  SyntheticDataService: class {},
}));

import { EventEmitter } from 'events';
import { SyntheticDataController } from './synthetic-data.controller';

function fakeRes() {
  const res = new EventEmitter() as EventEmitter & {
    writableFinished: boolean;
  };
  res.writableFinished = false;
  return res;
}

describe('SyntheticDataController #111', () => {
  it('aborts the sampling when the client closes before the answer', async () => {
    let signal: AbortSignal | undefined;
    const service = {
      profile: jest.fn((_b: unknown, o: { signal: AbortSignal }) => {
        signal = o.signal;
        return Promise.resolve({ profileId: 'x' });
      }),
    };
    const res = fakeRes();
    const c = new SyntheticDataController(service as never);
    await c.profile({ datasetName: 'D' }, res as never);
    expect(signal?.aborted).toBe(false);
    res.emit('close');
    expect(signal?.aborted).toBe(true);
  });

  it('does not abort when the response finished normally', async () => {
    let signal: AbortSignal | undefined;
    const service = {
      profile: jest.fn((_b: unknown, o: { signal: AbortSignal }) => {
        signal = o.signal;
        return Promise.resolve({ profileId: 'x' });
      }),
    };
    const res = fakeRes();
    await new SyntheticDataController(service as never).profile(
      {},
      res as never,
    );
    res.writableFinished = true;
    res.emit('close');
    expect(signal?.aborted).toBe(false);
  });
});
