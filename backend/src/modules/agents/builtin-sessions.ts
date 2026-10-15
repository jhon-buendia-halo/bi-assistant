/**
 * Built-in agents a session can be bound to (ADR-0028): each declares the
 * dataset its sessions run over, the text shown while that dataset is
 * missing, and the starter questions of its welcome block. Read by the hub
 * (`AgentsService`: datasets, missingDatasets, chatRequirement) and by
 * `SessionsService` (createFromAgent, the derived `agent` of a session).
 */
export interface BuiltinAgentSession {
  /** The dataset every session of the agent runs over. */
  datasetName: string;
  /** Why Start chat is refused while the dataset does not exist. */
  requirement: string;
  starterQuestions: string[];
}

export const BUILTIN_AGENT_SESSIONS: Readonly<
  Record<string, BuiltinAgentSession>
> = {
  rfp: {
    datasetName: 'Intellify RFP API',
    requirement:
      'Load the "Intellify RFP API" sample in Settings → Testing Data first',
    starterQuestions: [
      'Start an RFP for a client',
      'Which of my clients renew on 1 January 2027?',
      'Resume my draft RFPs',
    ],
  },
};

/** The session descriptor of a built-in agent, if it declares one. */
export function builtinAgentSession(
  key: string,
): BuiltinAgentSession | undefined {
  return Object.hasOwn(BUILTIN_AGENT_SESSIONS, key)
    ? BUILTIN_AGENT_SESSIONS[key]
    : undefined;
}
