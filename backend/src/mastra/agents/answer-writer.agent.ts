import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { ANSWER_WRITER_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { WRITE_ANSWER_INSTRUCTIONS } from '../workflows/qti-v2-turn.prompts';

/**
 * Jessica, Insights Writer (agents.md 1.1, 5.11): the agent of the Write
 * answer step of `qti-v2-turn`. She writes a run's answer from its
 * queries' rows and the validation findings in one model call, with no
 * tools and no memory. A System agent: the workflow calls her through
 * `writeAnswerWithModel`; her job description is the shipped Write answer
 * instructions or their in-app override (ADR-0026).
 */
export const answerWriterAgent = new Agent({
  id: 'questions-to-insights-v2-write-answer',
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Questions to Insights v2: Write answer',
  description:
    "Writes a run's answer from its queries' rows and the findings. No tools.",
  instructions: () =>
    agentInstructions(ANSWER_WRITER_AGENT_KEY, WRITE_ANSWER_INSTRUCTIONS),
  model: async () => resolveAgentModel(),
});
