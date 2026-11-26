import { ANSWER_WRITER_AGENT_KEY } from '../agent-constants';
import { defineBuiltinAgent } from '../agent-factory';
import { WRITE_ANSWER_INSTRUCTIONS } from '../workflows/analysis.prompts';

/**
 * Jessica, Insights Writer (agents.md 1.1, 5.11): a writer of the library.
 * She writes a run's answer from its
 * queries' rows and the validation findings in one model call, with no
 * tools and no memory. A System agent: the workflow calls her through
 * `writeAnswerWithModel`; her job description is the shipped Write answer
 * instructions or their in-app override (ADR-0026).
 */
export const answerWriterAgent = defineBuiltinAgent({
  key: ANSWER_WRITER_AGENT_KEY,
  name: 'Answer Writer',
  description:
    "Writes a run's answer from its queries' rows and the findings. No tools.",
  classes: ['single-step'],
  instructions: WRITE_ANSWER_INSTRUCTIONS,
  // A workflow may run its step agents on its own model (agents.md 1.3).
  model: 'step-model',
});
