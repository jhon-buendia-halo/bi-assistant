import { defineBuiltinAgent } from '../agent-factory';
import {
  describeEntityTool,
  listEntitiesTool,
  runReadOnlySqlTool,
  sampleRowsTool,
} from '../tools/dataset.tools';
import { submitDashboardTool } from '../tools/dashboard.tools';
import { BI_ANALYST_INSTRUCTIONS } from '../workflows/bi-analyst.prompts';
import {
  BI_ANALYST_AGENT_KEY,
  BI_ANALYST_DESCRIPTION,
  BI_ANALYST_NAME,
} from './bi-analyst-catalog';

/**
 * Her tools (agents.md, her section in 2), in the order of
 * `BI_ANALYST_TOOL_NAMES`: the dataset tools (the same instances, scoped to
 * the run's datasets through the requestContext) and submit_dashboard.
 */
export const biAnalystTools = {
  list_entities: listEntitiesTool,
  describe_entity: describeEntityTool,
  sample_rows: sampleRowsTool,
  run_readonly_sql: runReadOnlySqlTool,
  submit_dashboard: submitDashboardTool,
};

/**
 * Clara, Business Intelligence Analyst (plan bi-dashboard): the teammate
 * Avery calls with build_dashboard. She explores the run's datasets, writes
 * one data query at the widgets' grain and submits the dashboard bound to
 * its columns; the run executes the query and saves the dashboard. A
 * System agent with no memory: the run streams her once per build; her job
 * description is the shipped instructions or their in-app override
 * (ADR-0026). Her model is the workflow's step model on the call's
 * requestContext, else the saved model.
 */
export const biAnalystAgent = defineBuiltinAgent({
  key: BI_ANALYST_AGENT_KEY,
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: BI_ANALYST_NAME,
  description: BI_ANALYST_DESCRIPTION,
  // She answers to Avery, not to a person.
  classes: ['data'],
  instructions: BI_ANALYST_INSTRUCTIONS,
  model: 'step-model',
  tools: biAnalystTools,
});
