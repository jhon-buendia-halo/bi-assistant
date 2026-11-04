/**
 * Redacts secrets from every Nest log line (llm-settings R54): API keys and
 * the values of `Authorization` and `x-api-key` headers never reach the
 * console, the desktop system-logs panel that parses it, or the developer
 * OpenTelemetry log export.
 *
 * Like developer-nest-logger, it wraps the shared ConsoleLogger prototype
 * instead of installing a custom logger, so Nest's own per-context loggers
 * (and their `+Nms` timing) keep printing byte-identical lines when there is
 * nothing to redact. Install it after `installNestLogExport()`: the wrapper
 * installed last runs first, so the export then receives redacted messages.
 */
import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { redactLogValue, redactSecrets } from './redact-secrets';

type PrintMessages = (
  this: ConsoleLogger,
  messages: unknown[],
  context?: string,
  logLevel?: LogLevel,
  writeStreamType?: 'stdout' | 'stderr',
  errorStack?: unknown,
) => void;

type PrintStackTrace = (this: ConsoleLogger, stack: string) => void;

interface PrintingPrototype {
  printMessages: PrintMessages;
  printStackTrace: PrintStackTrace;
}

/** Nest calls a non-class function message and prints its result. */
function redactMessage(message: unknown): unknown {
  if (typeof message === 'function') {
    const produce = message as () => unknown;
    const source = Function.prototype.toString.call(produce) as string;
    if (!source.startsWith('class ')) {
      return () => redactLogValue(produce());
    }
  }
  return redactLogValue(message);
}

let installed = false;

export function installNestLogRedaction(): void {
  if (installed) return;
  installed = true;
  const prototype = ConsoleLogger.prototype as unknown as PrintingPrototype;

  const printMessages = prototype.printMessages;
  prototype.printMessages = function (
    messages,
    context,
    logLevel,
    writeStreamType,
    errorStack,
  ) {
    printMessages.call(
      this,
      messages.map(redactMessage),
      context === undefined ? undefined : redactSecrets(context),
      logLevel,
      writeStreamType,
      errorStack === undefined ? undefined : redactLogValue(errorStack),
    );
  };

  const printStackTrace = prototype.printStackTrace;
  prototype.printStackTrace = function (stack) {
    printStackTrace.call(this, stack ? redactSecrets(stack) : stack);
  };
}
