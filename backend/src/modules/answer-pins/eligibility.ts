/**
 * Whether a turn's answer may be saved as (or replayed from) a pin. Pure and
 * deterministic — no partial credit: a turn either gets the full set of
 * guarantees pinning implies (the exact SQL, the exact rows, a clean answer)
 * or it is never pinned at all.
 */
import { STORED_ROWS_CAP } from '../sessions/turn-data';
import type { ToolDataRecord } from '../sessions/entities/session.entity';

export interface PinEligibilityInput {
  /** The query behind the answer (`pickAnswerRecord`'s result), if any. */
  record: ToolDataRecord | undefined;
  /** Present when this turn asked (or is answering) a clarifying question. */
  clarification?: unknown;
  /** Present when this turn created/updated/reverted a visual. */
  visualEvent?: unknown;
  /** The visual panel open on the client, if any. */
  activeVisualId?: string;
  /** The answer's prose. */
  text: string;
  datasourceId?: string;
}

/**
 * `record` must exist, have run cleanly (no error, not truncated) and
 * returned between 1 and `STORED_ROWS_CAP` rows with no result-guard
 * warnings; the turn must carry no clarification or visual involvement; the
 * answer text must be non-empty; and the session must be bound to a single
 * datasource.
 */
export function pinEligible(input: PinEligibilityInput): boolean {
  const { record } = input;
  if (!record) return false;
  if (record.error) return false;
  if (record.truncated) return false;
  const rowCount = record.rowCount ?? 0;
  if (rowCount < 1 || rowCount > STORED_ROWS_CAP) return false;
  if (record.warnings?.length) return false;
  if (input.clarification) return false;
  if (input.visualEvent) return false;
  if (input.activeVisualId) return false;
  if (!input.text.trim()) return false;
  if (!input.datasourceId) return false;
  return true;
}
