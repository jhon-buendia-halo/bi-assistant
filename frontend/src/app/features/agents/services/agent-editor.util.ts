import { AgentConfig, AgentStatus, SaveAgentInput } from './agents-api.service';

/** The R43 limits the editor's fields enforce as the user types (R55). */
export const AGENT_FIELD_LIMITS = {
  name: 64,
  description: 280,
  instructions: 4000,
  starterQuestion: 200,
  starterQuestions: 5,
} as const;

export type ReasoningEffortChoice = '' | 'low' | 'medium' | 'high';

export const REASONING_EFFORT_CHOICES: {
  value: ReasoningEffortChoice;
  label: string;
}[] = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/** The agent editor's form, as typed. `''` model or effort = the default. */
export interface AgentForm {
  name: string;
  description: string;
  instructions: string;
  datasets: string[];
  starterQuestions: string[];
  model: string;
  reasoningEffort: ReasoningEffortChoice;
}

export function emptyAgentForm(): AgentForm {
  return {
    name: '',
    description: '',
    instructions: '',
    datasets: [],
    starterQuestions: [],
    model: '',
    reasoningEffort: '',
  };
}

/** The form for a stored draft (R54). */
export function agentFormFromConfig(config: AgentConfig): AgentForm {
  return {
    name: config.name ?? '',
    description: config.description ?? '',
    instructions: config.instructions ?? '',
    datasets: [...(config.datasets ?? [])],
    starterQuestions: [...(config.starterQuestions ?? [])],
    model: config.model ?? '',
    reasoningEffort: config.reasoningEffort ?? '',
  };
}

/**
 * The form as the backend stores it: trimmed text, and lists without blanks
 * or repeats. Comparing normalised forms means a stray space or an empty
 * starter field is not an unsaved change.
 */
export function normalizeAgentForm(form: AgentForm): AgentForm {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    instructions: form.instructions.trim(),
    datasets: uniqueNonBlank(form.datasets),
    starterQuestions: uniqueNonBlank(form.starterQuestions),
    model: form.model.trim(),
    reasoningEffort: form.reasoningEffort,
  };
}

/** True when the form differs from what was last saved. */
export function agentFormChanged(form: AgentForm, saved: AgentForm): boolean {
  const a = normalizeAgentForm(form);
  const b = normalizeAgentForm(saved);
  return (
    a.name !== b.name ||
    a.description !== b.description ||
    a.instructions !== b.instructions ||
    // Ticking order carries no meaning.
    !sameList([...a.datasets].sort(), [...b.datasets].sort()) ||
    !sameList(a.starterQuestions, b.starterQuestions) ||
    a.model !== b.model ||
    a.reasoningEffort !== b.reasoningEffort
  );
}

/** The body of `POST /agents` and `PUT /agents/:id/draft`. */
export function agentSaveInput(form: AgentForm): SaveAgentInput {
  const normalized = normalizeAgentForm(form);
  return {
    name: normalized.name,
    description: normalized.description,
    instructions: normalized.instructions,
    datasets: normalized.datasets,
    starterQuestions: normalized.starterQuestions,
    ...(normalized.model ? { model: normalized.model } : {}),
    ...(normalized.reasoningEffort
      ? { reasoningEffort: normalized.reasoningEffort }
      : {}),
  };
}

/** Save needs a name and a change, and waits for the save in flight (R56). */
export function canSaveAgent(state: {
  form: AgentForm;
  changed: boolean;
  saving: boolean;
}): boolean {
  return state.form.name.trim() !== '' && state.changed && !state.saving;
}

/**
 * Publish shows while the agent is new, has no Live version, has unpublished
 * changes, or the form has changes (R57).
 */
export function showAgentPublish(state: {
  saved: boolean;
  status: AgentStatus | null;
  hasUnpublishedChanges: boolean;
  changed: boolean;
}): boolean {
  return (
    !state.saved ||
    state.status !== 'live' ||
    state.hasUnpublishedChanges ||
    state.changed
  );
}

export interface DatasetOption {
  name: string;
  /** Kept in the saved draft but no longer among the datasets (R55). */
  missing: boolean;
  checked: boolean;
}

/**
 * One checkbox per existing dataset, then the saved draft's datasets that no
 * longer exist, so the user can untick them. A missing one stays listed until
 * a save drops it, so unticking it can be undone.
 */
export function datasetOptions(
  existing: string[],
  saved: string[],
  selected: string[],
): DatasetOption[] {
  const known = new Set(existing);
  const ticked = new Set(selected);
  return [
    ...existing.map((name) => ({
      name,
      missing: false,
      checked: ticked.has(name),
    })),
    ...uniqueNonBlank(saved)
      .filter((name) => !known.has(name))
      .map((name) => ({ name, missing: true, checked: ticked.has(name) })),
  ];
}

/** True when any of `datasets` still exists; a preview needs one (R60). */
export function hasExistingDataset(
  datasets: string[],
  existing: string[],
): boolean {
  const known = new Set(existing);
  return datasets.some((name) => known.has(name.trim()));
}

/** The Model field's placeholder (R55). */
export function modelPlaceholder(configuredModel: string | null): string {
  return configuredModel ? `Default (${configuredModel})` : 'Default';
}

function uniqueNonBlank(values: string[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const text = value.trim();
    if (text) seen.add(text);
  }
  return [...seen];
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
