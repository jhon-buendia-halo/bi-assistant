/**
 * Jest stand-in for `MastraService.streamWorkflow` on `agent-turn`, the
 * engine of every one-step workflow (agents.md 5.1, 5.12): it runs the real
 * workflow definition, so a session spec exercises the same `answer` step
 * the app runs. A spec that uses it must also run the engine stand-in:
 * `jest.mock('@mastra/core/workflows', () => jest.requireActual(<workflows.stub>))`.
 */
import { agentTurnWorkflow } from '../workflows/agent-turn.workflow';
import { AGENT_TURN_WORKFLOW_ID } from '../workflows/agent-turn.steps';
import type { WorkflowRunStream } from '../mastra.service';

interface StubWorkflow {
  createRun(): Promise<{
    stream(args: {
      inputData: unknown;
      requestContext: unknown;
    }): WorkflowRunStream;
  }>;
}

export async function streamTurnWorkflow(
  key: string,
  inputData: unknown,
  requestContext: unknown,
): Promise<WorkflowRunStream> {
  if (key !== AGENT_TURN_WORKFLOW_ID) {
    throw new Error(`No stand-in for the workflow "${key}"`);
  }
  const workflow = agentTurnWorkflow as unknown as StubWorkflow;
  return (await workflow.createRun()).stream({ inputData, requestContext });
}
