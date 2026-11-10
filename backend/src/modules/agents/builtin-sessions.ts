import type { DatasourceKind } from '../datasources/entities/datasource.entity';
import { ASSISTANT_V2_AGENT_KEY } from '../../mastra/agents/assistant-v2-catalog';

/**
 * Built-in agents a session can be bound to (ADR-0028): each declares the
 * datasets its sessions run over, the text shown while there is none, and the
 * starter questions of its welcome block. Read by the hub (`AgentsService`:
 * datasets, missingDatasets, chatRequirement) and by `SessionsService`
 * (createFromAgent, the derived `agent` of a session).
 *
 * An agent declares either one dataset by name (the RFP Builder) or a dataset
 * *kind*: every dataset bound to a datasource of one of `datasourceKinds`
 * (the Data Readiness Agent, agents.md 2.10).
 */
export type BuiltinAgentSession = {
  /** Why Start chat is refused while no dataset qualifies. */
  requirement: string;
  starterQuestions: string[];
  /** The default session name; the agent's name when absent. */
  sessionName?: string;
} & (
  | {
      /** The dataset every session of the agent runs over. */
      datasetName: string;
    }
  | {
      /** Every dataset bound to a datasource of these kinds, by name. */
      datasourceKinds: readonly DatasourceKind[];
    }
);

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
  'data-readiness': {
    datasourceKinds: ['postgres', 'databricks'],
    sessionName: 'Data Readiness',
    requirement: 'Add a PostgreSQL or Databricks dataset first',
    starterQuestions: [
      'Assess the readiness of this dataset',
      'What are the worst data-quality problems?',
      'Show my past assessments',
    ],
  },
};

/**
 * Built-in agents whose sessions run over the datasets the user picks, as a
 * plain session's do (BA-320): Questions to Insights v2. They declare no
 * dataset, so the hub shows no datasets and no requirement for them, and
 * `POST /sessions` with their key validates the name and datasets of the
 * request as for a session without an agent, then binds the session to the
 * agent by its registry key (ADR-0028).
 */
export const PICKED_DATASETS_AGENT_KEYS: readonly string[] = [
  ASSISTANT_V2_AGENT_KEY,
];

/** Whether a session bound to built-in `key` runs over picked datasets. */
export function runsOnPickedDatasets(key: string): boolean {
  return PICKED_DATASETS_AGENT_KEYS.includes(key);
}

/** The session descriptor of a built-in agent, if it declares one. */
export function builtinAgentSession(
  key: string,
): BuiltinAgentSession | undefined {
  return Object.hasOwn(BUILTIN_AGENT_SESSIONS, key)
    ? BUILTIN_AGENT_SESSIONS[key]
    : undefined;
}

/** What the dataset store says about one dataset. */
export interface ExistingDataset {
  name: string;
  datasourceKind?: DatasourceKind;
}

/** The datasets the agent's catalogue entry names, and those of them missing. */
export interface BuiltinSessionDatasets {
  /** The datasets a new session would take, in session order. */
  datasets: string[];
  /** Named datasets that do not exist; always empty for a kind. */
  missing: string[];
}

/**
 * The datasets a built-in agent's sessions run over, given the datasets that
 * exist: its named dataset (listed, and missing while absent), or every
 * dataset of its datasource kinds ordered by name (never missing).
 */
export function builtinSessionDatasets(
  session: BuiltinAgentSession,
  existing: readonly ExistingDataset[],
): BuiltinSessionDatasets {
  if ('datasetName' in session) {
    const found = existing.some((d) => d.name === session.datasetName);
    return {
      datasets: [session.datasetName],
      missing: found ? [] : [session.datasetName],
    };
  }
  const datasets = existing
    .filter(
      (d) =>
        d.datasourceKind !== undefined &&
        session.datasourceKinds.includes(d.datasourceKind),
    )
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
  return { datasets, missing: [] };
}

/** The dataset store reads a declaration is checked against. */
export interface DatasetCatalog {
  datasetNames(): Promise<Set<string>>;
  datasetKinds(): Promise<ExistingDataset[]>;
}

/**
 * The existing datasets a built-in agent's declaration is checked against:
 * names for a named dataset, names and datasource kinds for a kind.
 */
export async function existingDatasetsFor(
  session: BuiltinAgentSession,
  catalog: DatasetCatalog,
): Promise<ExistingDataset[]> {
  if ('datasourceKinds' in session) return catalog.datasetKinds();
  return [...(await catalog.datasetNames())].map((name) => ({ name }));
}

/** Whether Start chat can create a session now (sessions-chat R52). */
export function canStartBuiltinSession({
  datasets,
  missing,
}: BuiltinSessionDatasets): boolean {
  return datasets.length > 0 && missing.length === 0;
}
