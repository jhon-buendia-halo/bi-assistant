/**
 * Secret redaction for log text (llm-settings R54).
 *
 * The desktop shell applies the same rules to its diagnostics
 * (`redactDiagnosticText` in frontend/electron/main.cjs);
 * `redact-secrets.parity.spec.ts` runs both on shared samples, so a rule
 * changed here must be changed there too.
 *
 * Rules, in order:
 * - `Authorization` values: a known scheme (`Bearer`, `Basic`, …) is kept and
 *   the credentials after it (a token, or a `k=v, k="v"` parameter list) are
 *   masked; a value with no known scheme is masked whole.
 * - `password`, `token`, `api_key` / `api-key` / `apiKey` (so `x-api-key`) and
 *   `secret` values, quoted or not.
 * - `Bearer <value>` anywhere.
 * - Well-known API key shapes: `sk-…`, `sk-ant-…`, `sk-proj-…`, `sk-cliproxy-…`.
 * - The password of a `postgres://user:password@` URL.
 *
 * Keys may be separated from values by `:`, `=` or `=>` (as util.inspect
 * prints a Map). The masked key of llm-settings R10 (bullets plus the last
 * four characters) matches none of these rules and passes through.
 */
import { inspect, types, type InspectOptions } from 'node:util';

export const REDACTED = '[REDACTED]';

const SCHEMES =
  'Bearer|Basic|Digest|Token|ApiKey|Api-Key|Key|Negotiate|NTLM|DPoP|HOBA|Mutual|OAuth|AWS4-HMAC-SHA256';
const PARAM = `[\\w-]+=(?:"[^"]*"|[^"',\\s}\\\\]*)`;

const LEADING_SCHEME = new RegExp(`^(${SCHEMES})\\s+\\S`, 'i');
const QUOTED_AUTHORIZATION =
  /(["']?authorization["']?\s*(?:=>|[:=])\s*)(["'])((?:\\.|(?!\2)[^\\\r\n])*)\2/gi;
const UNQUOTED_AUTHORIZATION = new RegExp(
  `(["']?authorization\\\\?["']?[ \\t]*(?:=>|[:=])[ \\t]*\\\\?["']?)(?:(${SCHEMES})[ \\t]+)?(?!(?:null|true|false)(?:[,}\\]\\s]|$))(?:${PARAM}(?:[ \\t]*,[ \\t]*${PARAM})*|[^"',\\s}\\\\]+)`,
  'gi',
);
const QUOTED_SECRET =
  /((?:["']?(?:password|token|api[_-]?key|secret)["']?)\s*(?:=>|[:=])\s*)(["'])((?:\\.|(?!\2)[^\\\r\n])*)\2/gi;
const UNQUOTED_SECRET =
  /(["']?(?:password|token|api[_-]?key|secret)\\?["']?\s*(?:=>|[:=])\s*\\?["']?)(?!(?:null|true|false)(?:[,}\]\s]|$))[^"',\s}\\]+/gi;
const BEARER = /\b(bearer[ \t]+)[a-z0-9._~+/-]+=*/gi;
const KEY_SHAPE = /\bsk-[A-Za-z0-9_-]{16,}/g;
const POSTGRES_PASSWORD = /(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi;

/** Field names whose value is a secret (matched at the end of the name). */
const SECRET_FIELD = /(?:password|token|api[_-]?key|secret|authorization)$/i;

function maskAuthorization(value: string): string {
  const scheme = LEADING_SCHEME.exec(value);
  return scheme ? `${scheme[1]} ${REDACTED}` : REDACTED;
}

export function redactSecrets(value: unknown): string {
  return String(value)
    .replace(
      QUOTED_AUTHORIZATION,
      (_match: string, prefix: string, quote: string, inner: string) =>
        `${prefix}${quote}${maskAuthorization(inner)}${quote}`,
    )
    .replace(
      UNQUOTED_AUTHORIZATION,
      (_match: string, prefix: string, scheme: string | undefined) =>
        `${prefix}${scheme ? `${scheme} ` : ''}${REDACTED}`,
    )
    .replace(QUOTED_SECRET, `$1$2${REDACTED}$2`)
    .replace(UNQUOTED_SECRET, `$1${REDACTED}`)
    .replace(BEARER, `$1${REDACTED}`)
    .replace(KEY_SHAPE, REDACTED)
    .replace(POSTGRES_PASSWORD, `$1${REDACTED}@`);
}

/** The value of a secret-named field; an Authorization value keeps its scheme. */
function redactSecretField(key: string, value: unknown): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string' && /authorization$/i.test(key)) {
    return maskAuthorization(value);
  }
  return REDACTED;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Stands in for a class instance (Headers, Map, URL, an SDK object…) in a log
 * call: it prints as the original would, redacted, through util.inspect and
 * JSON.stringify.
 */
class RedactedView {
  constructor(private readonly original: object) {}

  [inspect.custom](depth: number, options: InspectOptions): string {
    const plain = inspect(this.original, { ...options, depth, colors: false });
    const redacted = redactSecrets(plain);
    // Nothing to hide: print exactly as before, colours included.
    return redacted === plain
      ? inspect(this.original, { ...options, depth })
      : redacted;
  }

  toJSON(): unknown {
    try {
      const json = JSON.stringify(this.original);
      // Redact the parsed plain data field by field, so a secret-named field
      // holding a number or null cannot leave invalid JSON behind.
      return json === undefined
        ? undefined
        : redactJsonData(JSON.parse(json) as unknown);
    } catch {
      return REDACTED;
    }
  }
}

/** Redacts parsed JSON (plain data, no cycles) field by field, unbounded. */
function redactJsonData(value: unknown, key?: string): unknown {
  if (key !== undefined && SECRET_FIELD.test(key)) {
    return redactSecretField(key, value);
  }
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map((item) => redactJsonData(item));
  if (value === null || typeof value !== 'object') return value;
  const copy: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(value)) {
    copy[name] = redactJsonData(field, name);
  }
  return copy;
}

/**
 * Redacts a value about to be logged, keeping its shape so the logger
 * formats it as before: strings are redacted; plain objects, arrays and
 * errors are copied with their strings (and every secret-named field)
 * redacted, an error keeping its class and own properties; other objects
 * are wrapped so they print redacted. Primitives, dates, regular expressions
 * and functions pass through.
 */
export function redactLogValue(value: unknown): unknown {
  return redactValue(value, new WeakMap(), 0);
}

/**
 * Beyond these bounds a value is wrapped instead of copied: the logger prints
 * only so deep and so many items anyway, and the view redacts what it prints.
 */
const MAX_COPY_DEPTH = 6;
const MAX_COPY_ITEMS = 200;

function redactEntry(
  key: string | symbol,
  value: unknown,
  seen: WeakMap<object, unknown>,
  depth: number,
): unknown {
  return typeof key === 'string' && SECRET_FIELD.test(key)
    ? redactSecretField(key, value)
    : redactValue(value, seen, depth);
}

/**
 * An error whose message lives in an internal slot (DOMException, such as the
 * AbortError or TimeoutError of fetch) cannot be copied property by property:
 * its prototype getters would throw on the copy. It becomes a plain Error
 * with the same name and redacted message and stack.
 */
function redactSlotError(value: Error, seen: WeakMap<object, unknown>): Error {
  const copy = new Error(redactSecrets(value.message));
  seen.set(value, copy);
  copy.name = value.name;
  copy.stack =
    value.stack === undefined ? undefined : redactSecrets(value.stack);
  return copy;
}

function holdsMessageInSlot(value: Error): boolean {
  if (Object.prototype.hasOwnProperty.call(value, 'message')) return false;
  try {
    // An ordinary Error without an own message reads Error.prototype's ''.
    void (Object.create(Object.getPrototypeOf(value) as object) as Error)
      .message;
    return false;
  } catch {
    return true;
  }
}

function redactError(value: Error, seen: WeakMap<object, unknown>): Error {
  if (holdsMessageInSlot(value)) return redactSlotError(value, seen);
  const copy = Object.create(Object.getPrototypeOf(value) as object) as Error;
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if ('value' in descriptor) {
      descriptor.value = redactEntry(key, descriptor.value, seen, 1);
    } else if (key === 'stack') {
      // An accessor stack (some runtimes): store its redacted text instead.
      Object.defineProperty(copy, key, {
        value: redactSecrets(value.stack),
        writable: true,
        configurable: true,
        enumerable: false,
      });
      continue;
    }
    Object.defineProperty(copy, key, descriptor);
  }
  return copy;
}

function redactValue(
  value: unknown,
  seen: WeakMap<object, unknown>,
  depth: number,
): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date || value instanceof RegExp) return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached;

  if (value instanceof Error || types.isNativeError(value)) {
    return redactError(value, seen);
  }
  const tooBig =
    depth >= MAX_COPY_DEPTH ||
    (Array.isArray(value) && value.length > MAX_COPY_ITEMS);
  if (Array.isArray(value) && !tooBig) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(redactValue(item, seen, depth + 1));
    return copy;
  }
  if (tooBig || !isPlainObject(value)) {
    const view = new RedactedView(value);
    seen.set(value, view);
    return view;
  }

  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, field] of Object.entries(value)) {
    copy[key] = redactEntry(key, field, seen, depth + 1);
  }
  return copy;
}
