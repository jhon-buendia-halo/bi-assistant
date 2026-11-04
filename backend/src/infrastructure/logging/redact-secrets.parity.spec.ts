/**
 * The desktop shell redacts its diagnostics with `redactDiagnosticText` in
 * frontend/electron/main.cjs (llm-settings R54). main.cjs needs Electron, so
 * the function's source is lifted out of the file and run on its own against
 * the backend helper, on the shared samples.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactSecrets } from './redact-secrets';
import { REDACTION_SAMPLES } from './redact-secrets.samples';

const MAIN_CJS = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'frontend',
  'electron',
  'main.cjs',
);

function liftRedactDiagnosticText(): (value: unknown) => string {
  const source = readFileSync(MAIN_CJS, 'utf8');
  const match =
    /^function redactDiagnosticText\(value\) \{\r?\n[\s\S]*?\r?\n\}\r?$/m.exec(
      source,
    );
  if (!match) throw new Error('redactDiagnosticText not found in main.cjs');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- running the lifted function is the point
  const factory = new Function(
    `${match[0]}\nreturn redactDiagnosticText;`,
  ) as () => (value: unknown) => string;
  return factory();
}

describe('redactDiagnosticText (main.cjs) parity with redactSecrets', () => {
  const redactDiagnosticText = liftRedactDiagnosticText();

  it.each(REDACTION_SAMPLES)('$name', ({ input, expected }) => {
    expect(redactDiagnosticText(input)).toBe(redactSecrets(input));
    expect(redactDiagnosticText(input)).toBe(expected);
  });

  it('agrees on JSON-stringified diagnostics details', () => {
    const details = JSON.stringify({
      headers: { Authorization: 'Bearer abc', 'x-api-key': 'k' },
      url: 'https://llm.example.test/v1/models',
      error: 'Incorrect API key provided: sk-proj-0123456789abcdefXYZ',
    });
    expect(redactDiagnosticText(details)).toBe(redactSecrets(details));
    expect(JSON.parse(redactDiagnosticText(details))).toEqual({
      headers: {
        Authorization: 'Bearer [REDACTED]',
        'x-api-key': '[REDACTED]',
      },
      url: 'https://llm.example.test/v1/models',
      error: 'Incorrect API key provided: [REDACTED]',
    });
  });
});
