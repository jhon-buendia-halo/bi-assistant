/**
 * Exports every Nest log line as an OpenTelemetry log record as well
 * (developer-settings R24 to R26). Only required by app-bootstrap when
 * developer observability is on.
 *
 * It wraps ConsoleLogger.prototype.printMessages instead of installing a
 * custom logger: Nest prints its `+Nms` timing only through its own
 * per-context ConsoleLogger instances, so a replacement logger would change
 * the console output that the desktop system-logs panel parses. Wrapping the
 * shared prototype keeps every printed line byte-identical.
 */
import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';

const SEVERITY: Record<LogLevel, [SeverityNumber, string]> = {
  verbose: [SeverityNumber.TRACE, 'TRACE'],
  debug: [SeverityNumber.DEBUG, 'DEBUG'],
  log: [SeverityNumber.INFO, 'INFO'],
  warn: [SeverityNumber.WARN, 'WARN'],
  error: [SeverityNumber.ERROR, 'ERROR'],
  fatal: [SeverityNumber.FATAL, 'FATAL'],
};

type PrintMessages = (
  this: ConsoleLogger,
  messages: unknown[],
  context?: string,
  logLevel?: LogLevel,
  writeStreamType?: 'stdout' | 'stderr',
  errorStack?: unknown,
) => void;

function bodyOf(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

let installed = false;

export function installNestLogExport(): void {
  if (installed) return;
  installed = true;
  const otel = logs.getLogger('nest');
  const prototype = ConsoleLogger.prototype as unknown as {
    printMessages: PrintMessages;
  };
  const print = prototype.printMessages;
  prototype.printMessages = function (
    messages,
    context = '',
    logLevel = 'log',
    writeStreamType,
    errorStack,
  ) {
    print.call(this, messages, context, logLevel, writeStreamType, errorStack);
    const [severityNumber, severityText] = SEVERITY[logLevel] ?? SEVERITY.log;
    for (const message of messages) {
      // emit() picks up the active context, so a line logged while a
      // request or agent run is traced carries its trace and span ids.
      otel.emit({
        severityNumber,
        severityText,
        body: bodyOf(message),
        attributes: {
          'log.context': context,
          ...(errorStack ? { 'exception.stacktrace': bodyOf(errorStack) } : {}),
        },
      });
    }
  };
}
