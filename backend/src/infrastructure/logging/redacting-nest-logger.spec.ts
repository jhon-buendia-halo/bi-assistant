import { ConsoleLogger } from '@nestjs/common';
import { installNestLogRedaction } from './redacting-nest-logger';

describe('installNestLogRedaction', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  const written = (spy: jest.SpyInstance): string =>
    spy.mock.calls.map(([chunk]) => String(chunk)).join('');

  beforeAll(() => {
    installNestLogRedaction();
    installNestLogRedaction(); // idempotent: wraps once
  });

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it('prints a line with nothing to redact unchanged', () => {
    new ConsoleLogger('LlmService', { colors: false }).log('Model listed');
    expect(written(stdout)).toContain('[LlmService] Model listed');
  });

  it('redacts string messages', () => {
    new ConsoleLogger('LlmService', { colors: false }).warn(
      'probe failed: Authorization: Bearer sk-ant-api03-abcdefghijklmnop',
    );
    const out = written(stdout);
    expect(out).toContain('probe failed: Authorization: Bearer [REDACTED]');
    expect(out).not.toContain('sk-ant-');
  });

  it('redacts logged objects and keeps their formatting', () => {
    new ConsoleLogger('Http', { colors: false }).log({
      headers: { authorization: 'Basic dXNlcjpwYXNz', 'x-api-key': 'k-1' },
    });
    const out = written(stdout);
    expect(out).toContain('Object(1)');
    expect(out).toContain("authorization: 'Basic [REDACTED]'");
    expect(out).toContain("'x-api-key': '[REDACTED]'");
    expect(out).not.toContain('dXNlcjpwYXNz');
    expect(out).not.toContain('k-1');
  });

  it('redacts errors, their stacks and the context', () => {
    const error = new Error('401 for key sk-proj-0123456789abcdefXYZ');
    new ConsoleLogger('Probe', { colors: false }).error(
      error.message,
      error.stack,
    );
    new ConsoleLogger('token=ctxsecret', { colors: false }).log('hello');
    const out = written(stdout) + written(stderr);
    expect(out).toContain('401 for key [REDACTED]');
    expect(out).not.toContain('sk-proj-');
    expect(out).toContain('[token=[REDACTED]]');
    expect(out).not.toContain('ctxsecret');
  });

  it('redacts the result of a function message', () => {
    new ConsoleLogger('Lazy', { colors: false }).log(
      () => 'x-api-key: lazysecret',
    );
    const out = written(stdout);
    expect(out).toContain('x-api-key: [REDACTED]');
    expect(out).not.toContain('lazysecret');
  });

  it('redacts JSON log output', () => {
    new ConsoleLogger('Json', { json: true, colors: false }).log(
      'Authorization: Bearer abc',
    );
    const out = written(stdout);
    expect(out).toContain('Authorization: Bearer [REDACTED]');
    expect(out).not.toContain('Bearer abc');
  });
});
