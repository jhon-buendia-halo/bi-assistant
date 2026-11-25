import { conversationTurnWorkflow } from './conversation-turn.workflow';
import {
  ORCHESTRATED_MICHAEL_STEPS,
  ORCHESTRATED_MICHAEL_WORKFLOW_ID,
} from './orchestrated-answer-michael.steps';

// Answer a Business Question (Avery + Michael) as a workflow defined in code
// (workflows R45; agents.md 5.23): one step, Orchestrate, where Avery, the
// Chief of Staff, calls the team as her tools. Built on the conversation
// engine (conversation-turn.workflow.ts): her question to the user suspends
// the run until the answer.

const [ORCHESTRATE] = ORCHESTRATED_MICHAEL_STEPS;

export const orchestratedMichaelWorkflow = conversationTurnWorkflow({
  id: ORCHESTRATED_MICHAEL_WORKFLOW_ID,
  step: ORCHESTRATE,
  description:
    'Answer a Business Question (Avery + Michael): Avery, the Chief of Staff, briefs Michael, who answers from the data, and is the only one who talks to the user.',
});
