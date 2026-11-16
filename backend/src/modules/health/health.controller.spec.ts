import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('answers { ok: true } with no store read (the desktop readiness probe)', () => {
    expect(new HealthController().health()).toEqual({ ok: true });
  });
});
