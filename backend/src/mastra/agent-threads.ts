/**
 * The memory threads of one workflow run (agents.md 5.14, data-model 5).
 * Framework-free, so services and tests read it without loading Mastra.
 *
 * Every thread of a run host has the host id as its resource. The agent
 * that runs on the host itself (a workflow's `primaryFor`, e.g. Analyse's
 * Insights Analyst) uses the host id as its thread; each step agent that
 * runs an agent of its own (Plan, Check data quality, Write answer) has
 * the thread `<host id>:<agent key>`, where its exchanges are recorded.
 */

/**
 * The thread (and resource) of a stored run's own host, `run-<run id>`, as
 * `RUN_HOST_ID_PREFIX` builds it.
 */
export function runHostThreadId(runId: string): string {
  return `run-${runId}`;
}

/** The thread of a step agent of its own on one host. */
export function agentThreadId(hostId: string, agentKey: string): string {
  return `${hostId}:${agentKey}`;
}

/**
 * The id a thread of host `from` gets when it is copied to host `to` (a
 * follow-up run): the same suffix, so `run-a:insights-analyst` becomes
 * `run-b:insights-analyst`. Undefined for a thread that is not `from`'s.
 */
export function copiedThreadId(
  threadId: string,
  from: string,
  to: string,
): string | undefined {
  if (threadId === from) return to;
  if (threadId.startsWith(`${from}:`))
    return `${to}${threadId.slice(from.length)}`;
  return undefined;
}

/** One recorded exchange: the request the agent got and its reply. */
export interface AgentExchange {
  request: string;
  reply: string;
}

/** A stored text message as Mastra's memory saves it (format 2). */
export interface StoredTextMessage {
  id: string;
  role: 'user' | 'assistant';
  createdAt: Date;
  threadId: string;
  resourceId: string;
  type: 'v2';
  content: { format: 2; parts: { type: 'text'; text: string }[] };
}

/**
 * The two messages that record an exchange in a thread: the request as the
 * user's, then the reply as the assistant's, one millisecond apart so the
 * thread keeps their order.
 */
export function exchangeMessages(
  exchange: AgentExchange,
  thread: { threadId: string; resourceId: string },
  ids: [string, string],
  at: Date,
): StoredTextMessage[] {
  const message = (
    id: string,
    role: 'user' | 'assistant',
    text: string,
    offset: number,
  ): StoredTextMessage => ({
    id,
    role,
    createdAt: new Date(at.getTime() + offset),
    ...thread,
    type: 'v2',
    content: { format: 2, parts: [{ type: 'text', text }] },
  });
  return [
    message(ids[0], 'user', exchange.request, 0),
    message(ids[1], 'assistant', exchange.reply, 1),
  ];
}
