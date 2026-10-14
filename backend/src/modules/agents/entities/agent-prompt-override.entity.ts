/** One document in the `agent_prompt_overrides` collection (data-model 3.10.3). */
export interface AgentPromptOverrideDoc {
  /** The built-in agent's registry key. */
  key: string;
  prompt: string;
  /** SHA-256 hex of the shipped editable text it was saved against. */
  baseHash: string;
  /** The id of the user who saved it. */
  updatedBy: string;
  createdAt?: string;
  updatedAt?: string;
}

/** The `prompt` field of `GET /agents/:key` for a built-in agent (api.md 34). */
export interface AgentPromptView {
  /** As served: the override, else the shipped text. */
  editable: string;
  /** As shipped. */
  shipped: string;
  modified: boolean;
  /** Modified, and the shipped text's hash differs from `baseHash`. */
  builtInChanged: boolean;
  /** True for the assistant: its prompt may link tools. */
  linksAllowed: boolean;
  /** The override's, or null. */
  updatedAt: string | null;
}
