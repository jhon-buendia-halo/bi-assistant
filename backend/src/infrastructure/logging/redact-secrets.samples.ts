/**
 * Shared samples for the redaction specs: `redact-secrets.spec.ts` checks the
 * backend helper against `expected`, and `redact-secrets.parity.spec.ts`
 * checks the desktop shell's `redactDiagnosticText` gives the same output.
 */
export interface RedactionSample {
  name: string;
  input: string;
  expected: string;
}

export const REDACTION_SAMPLES: RedactionSample[] = [
  {
    name: 'Authorization header keeps the Bearer scheme',
    input: 'Authorization: Bearer abc.def-123',
    expected: 'Authorization: Bearer [REDACTED]',
  },
  {
    name: 'Authorization header keeps the Basic scheme',
    input: 'authorization=Basic dXNlcjpwYXNz',
    expected: 'authorization=Basic [REDACTED]',
  },
  {
    name: 'Authorization header with no known scheme is masked whole',
    input: 'Authorization: rawsecretvalue next',
    expected: 'Authorization: [REDACTED] next',
  },
  {
    name: 'quoted Authorization value in JSON keeps the scheme',
    input: '{"authorization":"Bearer sk-ant-api03-abcdefghijklmnop","x":1}',
    expected: '{"authorization":"Bearer [REDACTED]","x":1}',
  },
  {
    name: 'quoted Authorization value in an inspected object',
    input: "{ Authorization: 'Token s3cr3t', accept: 'json' }",
    expected: "{ Authorization: 'Token [REDACTED]', accept: 'json' }",
  },
  {
    name: 'quoted Authorization value without a scheme',
    input: '"Authorization": "s3cr3t"',
    expected: '"Authorization": "[REDACTED]"',
  },
  {
    name: 'x-api-key header',
    input: 'x-api-key: abc123secret',
    expected: 'x-api-key: [REDACTED]',
  },
  {
    name: 'quoted x-api-key header',
    input: "headers: { 'x-api-key': 'abc123secret' }",
    expected: "headers: { 'x-api-key': '[REDACTED]' }",
  },
  {
    name: 'bare Bearer credential',
    input: 'sent Bearer eyJhbGciOi.payload.sig= upstream',
    expected: 'sent Bearer [REDACTED] upstream',
  },
  {
    name: 'OpenAI key shape in free text',
    input: 'key sk-abcdefghijklmnop1234 rejected',
    expected: 'key [REDACTED] rejected',
  },
  {
    name: 'Anthropic key shape',
    input: 'Invalid key sk-ant-api03-AbCdEfGhIjKlMnOp_qr-st',
    expected: 'Invalid key [REDACTED]',
  },
  {
    name: 'OpenAI project key shape',
    input: '(sk-proj-0123456789abcdefXYZ)',
    expected: '([REDACTED])',
  },
  {
    name: 'CLIProxy key shape',
    input: 'using sk-cliproxy-0123456789abcdef',
    expected: 'using [REDACTED]',
  },
  {
    name: 'apiKey field',
    input: '{"apiKey":"sk-x","model":"gpt-5"}',
    expected: '{"apiKey":"[REDACTED]","model":"gpt-5"}',
  },
  {
    name: 'password, token and secret (existing rules)',
    input: 'password=hunter2 token: abc secret="s"',
    expected: 'password=[REDACTED] token: [REDACTED] secret="[REDACTED]"',
  },
  {
    name: 'postgres URL password (existing rule)',
    input: 'connect postgres://app:pa55@db:5432/x failed',
    expected: 'connect postgres://app:[REDACTED]@db:5432/x failed',
  },
  {
    name: 'masked key of R10 passes through',
    input: 'apiKeyMasked ••••••••abcd',
    expected: 'apiKeyMasked ••••••••abcd',
  },
  {
    name: 'ordinary text passes through',
    input: 'task-scheduler started; risk-assessment ok; sk-short',
    expected: 'task-scheduler started; risk-assessment ok; sk-short',
  },
  {
    name: 'Digest parameters are masked with the credentials',
    input:
      'Authorization: Digest username="bob", nonce="n1", response="abc"\nnext',
    expected: 'Authorization: Digest [REDACTED]\nnext',
  },
  {
    name: 'AWS4 signature parameters are masked',
    input:
      'Authorization: AWS4-HMAC-SHA256 Credential=AKIA/2025/x, SignedHeaders=host, Signature=deadbeef',
    expected: 'Authorization: AWS4-HMAC-SHA256 [REDACTED]',
  },
  {
    name: 'a scheme at the end of a line does not swallow the next line',
    input: 'Authorization: Bearer\n    at probe (x.ts:1:1)',
    expected: 'Authorization: [REDACTED]\n    at probe (x.ts:1:1)',
  },
  {
    name: 'unterminated quoted Authorization value',
    input: 'authorization: "rawsecret',
    expected: 'authorization: "[REDACTED]',
  },
  {
    name: 'escaped quotes inside a JSON string stay valid JSON',
    input: '{"msg":"header authorization: \\"Bearer x\\" password: \\"p\\""}',
    expected:
      '{"msg":"header authorization: \\"Bearer [REDACTED]\\" password: \\"[REDACTED]\\""}',
  },
  {
    name: 'inspected Map entries',
    input: "Map(2) { 'authorization' => 'Basic abc', 'x-api-key' => 'k1' }",
    expected:
      "Map(2) { 'authorization' => 'Basic [REDACTED]', 'x-api-key' => '[REDACTED]' }",
  },
  {
    name: 'stack trace line with a key in the message',
    input:
      'Error: 401 Incorrect API key provided: sk-proj-AAAAAAAAAAAAAAAAAAAA\n    at probe (probe.ts:10:5)',
    expected:
      'Error: 401 Incorrect API key provided: [REDACTED]\n    at probe (probe.ts:10:5)',
  },
  {
    name: 'an unclosed quote does not redact the following lines',
    input: "token: 'abc\nnext line kept\nit's fine",
    expected: "token: '[REDACTED]\nnext line kept\nit's fine",
  },
  {
    name: 'JSON literals of secret fields stay valid JSON',
    input: '{"token":null,"secret":true,"authorization":false,"x":1}',
    expected: '{"token":null,"secret":true,"authorization":false,"x":1}',
  },
];
