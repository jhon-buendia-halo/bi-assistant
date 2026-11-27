import { defineBuiltinAgent, servedPromptWithTools } from '../agent-factory';
import { catalogFrameworkSkills } from '../skill-sources';
import { askClarificationTool } from '../tools/clarification.tool';
import {
  describeEntityTool,
  listEntitiesTool,
  runReadOnlySqlTool,
  sampleRowsTool,
} from '../tools/dataset.tools';
import { exploreResultTool } from '../tools/explore-result.tool';
import { assessReadinessTool } from '../tools/readiness.tools';
import { DATA_READINESS_ASSESSOR_INSTRUCTIONS } from './data-readiness-assessor.prompts';
import {
  DATA_READINESS_ASSESSOR_AGENT_KEY,
  DATA_READINESS_ASSESSOR_DESCRIPTION,
  DATA_READINESS_ASSESSOR_NAME,
} from './data-readiness-assessor-catalog';

export {
  DATA_READINESS_ASSESSOR_AGENT_KEY,
  DATA_READINESS_ASSESSOR_MAX_STEPS,
} from './data-readiness-assessor-catalog';

/**
 * Her tools, in the order of `DATA_READINESS_ASSESSOR_TOOL_NAMES`: the data
 * kit (the same instances as Michael's and Elena's), `ask_clarification`
 * for the scoping questions, and `assess_readiness`, the readiness engine.
 * No deliverable tool: she builds no dashboard and exports nothing.
 */
export const dataReadinessAssessorTools = {
  list_entities: listEntitiesTool,
  describe_entity: describeEntityTool,
  run_readonly_sql: runReadOnlySqlTool,
  sample_rows: sampleRowsTool,
  explore_result: exploreResultTool,
  ask_clarification: askClarificationTool,
  assess_readiness: assessReadinessTool,
};

/** Her ten on-demand skills, built per call (agents.md 7.3, 7.4). */
export function dataReadinessAssessorSkills() {
  return catalogFrameworkSkills(DATA_READINESS_ASSESSOR_AGENT_KEY);
}

/**
 * Her prompt as served: the shipped text or its in-app override
 * (ADR-0026), links resolved to plain mentions, with the `## Tools` section
 * generated from her tools inserted before `## Working rules`, so the
 * cue-fired repair rule stays last.
 */
export function dataReadinessAssessorInstructions(): string {
  return servedPromptWithTools(
    DATA_READINESS_ASSESSOR_AGENT_KEY,
    DATA_READINESS_ASSESSOR_INSTRUCTIONS,
    dataReadinessAssessorTools,
  );
}

/**
 * Dana, the Data Readiness Assessor (plan data-readiness-assessor 2): tells
 * the requester whether the conversation's datasets are ready for one use,
 * in her own conversation (a run of `agent:data-readiness-assessor`). An
 * Official agent with no memory: the run host sends the conversation as a
 * transcript. Her model is the step model on the call's requestContext,
 * else the saved model (agents.md 1.3).
 */
export const dataReadinessAssessorAgent = defineBuiltinAgent({
  key: DATA_READINESS_ASSESSOR_AGENT_KEY,
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: DATA_READINESS_ASSESSOR_NAME,
  description: DATA_READINESS_ASSESSOR_DESCRIPTION,
  classes: ['person', 'data'],
  instructions: () => dataReadinessAssessorInstructions(),
  // Loaded on demand through Mastra's skill tools (ADR-0025).
  skills: () => dataReadinessAssessorSkills(),
  model: 'step-model',
  tools: dataReadinessAssessorTools,
});
