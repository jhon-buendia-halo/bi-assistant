/**
 * The model calls of Consumption Gap Analysis (agents.md 2.18 to 2.20,
 * 5.20): one call each, no tools, no memory, structured output read
 * leniently and checked in code. The run records each exchange as text in
 * the agent's thread (`options.onExchange`).
 *
 * CONTRACT STUB: the signatures below are the contract; the bodies are
 * written by the agents unit.
 */
import type { StepModelOptions } from './answer-business-question.agents';
import type {
  FieldMapping,
  GapFix,
  LayerTable,
  Lineage,
  ReferenceDashboard,
  Requirement,
  RequirementAssessment,
} from './consumption-gap-analysis.schemas';

/**
 * Derive requirements: the Requirements Analyst over the questions (the
 * dashboards are context only: their requirements are built in code). One
 * requirement per question, ids `Q1`… in question order, kind `question`,
 * `dashboardId` ''. A question the reply misses gets a requirement with no
 * fields and its title.
 */
export function deriveRequirementsWithModel(
  input: { questions: string[]; dashboards: ReferenceDashboard[] },
  options: StepModelOptions,
): Promise<{ requirements: Requirement[]; stopped: boolean }> {
  void input;
  void options;
  return Promise.reject(new Error('not implemented'));
}

/**
 * Confirm requirements: the Requirements Analyst applies the user's
 * feedback to the whole list (questions, widgets and filters); it may
 * drop, edit or add requirements. Ids are kept for kept requirements; an
 * added one gets the next free id of its kind.
 */
export function reviseRequirementsWithModel(
  input: { questions: string[]; requirements: Requirement[]; feedback: string },
  options: StepModelOptions,
): Promise<{ requirements: Requirement[]; stopped: boolean }> {
  void input;
  void options;
  return Promise.reject(new Error('not implemented'));
}

/** Map requirements: the Layer Mapper's reply through `checkedMappings`. */
export function mapRequirementsWithModel(
  input: { requirements: Requirement[]; tables: LayerTable[] },
  options: StepModelOptions,
): Promise<{ mappings: FieldMapping[]; stopped: boolean }> {
  void input;
  void options;
  return Promise.reject(new Error('not implemented'));
}

/** Recommend fixes: the Gap Advisor's reply through `checkedFixes`. */
export function recommendFixesWithModel(
  input: {
    requirements: Requirement[];
    assessments: RequirementAssessment[];
    tables: LayerTable[];
    lineage: Lineage;
  },
  options: StepModelOptions,
): Promise<{ fixes: GapFix[]; stopped: boolean }> {
  void input;
  void options;
  return Promise.reject(new Error('not implemented'));
}
