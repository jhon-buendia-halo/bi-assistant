/**
 * Every question bank case by its set case id (`dbx-champion-2022`), with the
 * set it belongs to, its split, its category and its question (agents-evals
 * R215). A run saved before results carried a split is read with its split
 * and category from here (data-model 3.8, read-time defaults), and the loop
 * tools use it to place a stored result on the dev or held-out side.
 *
 * The index holds the question bank sets only (`loadEvalSets`): the RFP
 * Builder's `rfp` set is defined in code and has no split, so its cases read
 * as `dev`.
 *
 * Pure module: no Nest, no Mastra, no model.
 */
import { loadEvalSets } from './eval-set-files';
import type {
  EvalCategory,
  EvalSetDefinition,
  EvalSplit,
} from './eval-set-files';

export interface EvalCaseIndexEntry {
  /** The set (variant) the case id belongs to. */
  setId: string;
  split: EvalSplit;
  category: EvalCategory;
  question: string;
}

/** Index the cases of `sets` by case id; case ids are unique (R108). */
export function buildEvalCaseIndex(
  sets: readonly EvalSetDefinition[],
): ReadonlyMap<string, EvalCaseIndexEntry> {
  const index = new Map<string, EvalCaseIndexEntry>();
  for (const set of sets) {
    for (const evalCase of set.cases) {
      index.set(evalCase.id, {
        setId: set.id,
        split: evalCase.split,
        category: evalCase.category,
        question: evalCase.question,
      });
    }
  }
  return index;
}

let cached: ReadonlyMap<string, EvalCaseIndexEntry> | undefined;

/** The index of the bundled question bank files, built once. */
export function evalCaseIndex(): ReadonlyMap<string, EvalCaseIndexEntry> {
  cached ??= buildEvalCaseIndex(loadEvalSets());
  return cached;
}
