/**
 * The deterministic checks (agents-evals R112 to R124), by the `type` a
 * question bank file names. Pure: the loader (`eval-set-files.ts`) reads the arg
 * keys and default criteria from here, and `eval-check-scorers.ts` wraps
 * each in a Mastra scorer through `check-scorer.ts`.
 */
import type { DeterministicCheck } from './check';
import { dialect } from './dialect';
import { namesNotIds } from './names-not-ids';
import type { NamesNotIdsArgs } from './names-not-ids';
import { noHtml } from './no-html';
import { noRepairs } from './no-repairs';
import { notMatches } from './not-matches';
import type { NotMatchesArgs } from './not-matches';
import { numbersGrounded } from './numbers-grounded';
import type { NumbersGroundedArgs } from './numbers-grounded';
import { optionCount } from './option-count';
import { qualifiedNames } from './qualified-names';
import { rationaleOk } from './rationale-ok';
import { sqlMatches } from './sql-matches';
import { usesEntities } from './uses-entities';
import type { UsesEntitiesArgs } from './uses-entities';
import { visualKeywords } from './visual-keywords';
import type { VisualKeywordsArgs } from './visual-keywords';

export const DETERMINISTIC_CHECK_TYPES = [
  'noRepairs',
  'namesNotIds',
  'numbersGrounded',
  'rationaleOk',
  'noHtml',
  'dialect',
  'qualifiedNames',
  'optionCount',
  'visualKeywords',
  'sqlMatches',
  'notMatches',
  'usesEntities',
] as const;
export type DeterministicCheckType = (typeof DETERMINISTIC_CHECK_TYPES)[number];

type NoArgs = Record<string, never>;

/** A deterministic check as a set file writes it (criterion added there). */
export type DeterministicCheckSpec =
  | { type: 'noRepairs'; args?: NoArgs }
  | { type: 'namesNotIds'; args?: NamesNotIdsArgs }
  | { type: 'numbersGrounded'; args?: NumbersGroundedArgs }
  | { type: 'rationaleOk'; args?: NoArgs }
  | { type: 'noHtml'; args?: NoArgs }
  | { type: 'dialect'; args?: NoArgs }
  | { type: 'qualifiedNames'; args?: NoArgs }
  | { type: 'optionCount'; args?: NoArgs }
  | { type: 'visualKeywords'; args: VisualKeywordsArgs }
  | { type: 'sqlMatches'; args: { pattern: string; flags?: string } }
  | { type: 'notMatches'; args: NotMatchesArgs }
  | { type: 'usesEntities'; args?: UsesEntitiesArgs };

export const DETERMINISTIC_CHECKS: Readonly<
  Record<DeterministicCheckType, DeterministicCheck<any>>
> = {
  noRepairs,
  namesNotIds,
  numbersGrounded,
  rationaleOk,
  noHtml,
  dialect,
  qualifiedNames,
  optionCount,
  visualKeywords,
  sqlMatches,
  notMatches,
  usesEntities,
};

export function isDeterministicCheckType(
  type: unknown,
): type is DeterministicCheckType {
  return DETERMINISTIC_CHECK_TYPES.includes(type as DeterministicCheckType);
}

export type { CheckContext, CheckVerdict, DeterministicCheck } from './check';
export type { CheckTurn, CheckToolCall } from './turn';
export { turnFromCaseResult, turnFromScorerRun } from './turn';
