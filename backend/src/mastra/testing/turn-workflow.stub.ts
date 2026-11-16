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

/** A stand-in run (the workflows stub's), as `createRun` answers it. */
interface ResumableStubRun {
  stream(args: { inputData: unknown; requestContext: unknown }): unknown;
  resumeStream(args: {
    step: string[];
    resumeData: unknown;
    requestContext?: unknown;
  }): unknown;
}

/**
 * Stand-in for `MastraService.streamWorkflow` on a workflow built on the
 * workflows stub, with `resume` and `discard` as the service gives them
 * (ADR-0043): `discards` counts the discarded runs.
 */
export async function streamStubWorkflow(
  workflow: unknown,
  inputData: unknown,
  requestContext: unknown,
  discards: { count: number } = { count: 0 },
): Promise<WorkflowRunStream> {
  const run = await (
    workflow as { createRun(): Promise<ResumableStubRun> }
  ).createRun();
  const wrap = (output: unknown): WorkflowRunStream => ({
    ...(output as WorkflowRunStream),
    resume: (args) => wrap(run.resumeStream(args)),
    discard: () => {
      discards.count += 1;
      return Promise.resolve();
    },
  });
  return wrap(run.stream({ inputData, requestContext }));
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
