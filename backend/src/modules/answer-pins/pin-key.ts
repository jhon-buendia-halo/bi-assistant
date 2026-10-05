/**
 * Pure hashing for answer pinning — no DI, no I/O, so unit tests (and the
 * eval harness, if it ever wants to reason about pins) never need a store.
 *
 * Two independent hashes:
 *
 * - `lineageKeyFor` identifies *what was asked* — the normalized question,
 *   the (order-independent) datasets, the normalized chain of prior user
 *   messages in the thread, and the mode (plain/careful/expert). Two turns
 *   with the same lineage key are "the same question" for replay purposes.
 * - `fingerprintFor` identifies *the state the answer was derived under* —
 *   everything that legitimately changes the answer without changing the
 *   question: the knowledge the turn would receive, the metrics/verified
 *   blocks, the schema, the model. The four `*Part` helpers below compute
 *   one hashed piece each; callers (this module's service, and the sessions
 *   integration that assembles a turn) build the full `FingerprintParts` and
 *   pass it to `fingerprintFor` to get the final hash.
 */
import { createHash } from 'crypto';
import type { KnowledgeUse } from '../knowledge/entities/knowledge-snippet.entity';
import type { DatasetEntitySnapshot } from '../datasets/repositories/datasets.repository';
import type { LlmSettingsView } from '../llm/llm.types';
import type { FingerprintParts, PinMode } from './entities/answer-pin.entity';

const LINEAGE_VERSION = 1;
/** Fallback when the LLM has never been configured — mirrors `LlmService.getView()`'s own default. */
const FALLBACK_MODEL = 'openai/gpt-4o-mini';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Lowercase, collapse whitespace, trim, and drop trailing `?`/`.`/`!` — so
 * rephrasing punctuation, case or spacing never forks a lineage. */
export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[?.!]+$/, '');
}

export interface LineageInput {
  question: string;
  /** Dataset names the turn is bound to; order does not matter. */
  datasets: string[];
  /** Normalized prior user messages in the thread, oldest first. */
  chain: string[];
  mode: PinMode;
}

/** Identity of a lineage: same question + datasets + chain + mode → same key. */
export function lineageKeyFor(input: LineageInput): string {
  const normalizedQuestion = normalizeQuestion(input.question);
  const datasets = [...input.datasets].sort();
  const chain = input.chain.map(normalizeQuestion);
  return sha256(
    JSON.stringify([
      LINEAGE_VERSION,
      normalizedQuestion,
      datasets,
      chain,
      input.mode,
    ]),
  );
}

/** One hashed piece of a fingerprint: the knowledge the turn would receive,
 * in block order (id, kind, title, body — sample values / synonyms /
 * entities do not move the answer and are deliberately left out). */
export function knowledgePart(used: KnowledgeUse[]): string {
  return sha256(
    JSON.stringify(used.map((k) => [k.id, k.kind, k.title, k.body])),
  );
}

/** One hashed piece of a fingerprint: an arbitrary context block's rendered
 * text (the metrics block, the verified-reference block). `undefined`
 * hashes the same as an empty block, so "no block this turn" is stable. */
export function textPart(block: string | undefined): string {
  return sha256(block ?? '');
}

/** The minimal dataset shape `schemaPart` needs — a structural subset of
 * `DatasetDoc` so callers can pass `DatasetsRepository.getByNames(...)`
 * results directly. */
export interface SchemaDataset {
  name: string;
  tables: string[];
  entities?: DatasetEntitySnapshot[];
}

/** One hashed piece of a fingerprint: the bound datasets' schema — entity
 * keys and column names/types only, never sample values (a column growing a
 * new observed value should not force every pinned lineage to re-derive). */
export function schemaPart(datasets: SchemaDataset[]): string {
  const sorted = [...datasets].sort((a, b) => a.name.localeCompare(b.name));
  const shape = sorted.map((dataset) => [
    dataset.name,
    dataset.tables,
    (dataset.entities ?? []).map((entity) => [
      entity.key,
      entity.columns.map((column) => [column.name, column.type]),
    ]),
  ]);
  return sha256(JSON.stringify(shape));
}

/** Fields of `LlmSettingsView` that affect what the model can produce. */
export type ModelPartView = Pick<
  LlmSettingsView,
  'provider' | 'model' | 'reasoningEffort'
>;

/** One hashed piece of a fingerprint: model id + reasoning effort. Falls
 * back to the same default `LlmService` uses when nothing is configured, so
 * an unconfigured install still gets a stable fingerprint. */
export function modelPart(view: ModelPartView): string {
  const modelId =
    view.provider && view.model
      ? `${view.provider}/${view.model}`
      : FALLBACK_MODEL;
  return `${modelId}|effort=${view.reasoningEffort}`;
}

/** The final fingerprint hash from its already-hashed parts. */
export function fingerprintFor(parts: FingerprintParts): string {
  return sha256(JSON.stringify(parts));
}
