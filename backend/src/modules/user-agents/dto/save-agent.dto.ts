import type { ReasoningEffort } from '../../llm/llm.types';

/**
 * Create / save-draft payload for a user agent (`POST /agents`,
 * `PUT /agents/:id/draft`). Untyped JSON: the controller coerces it and the
 * service normalises it (R43).
 */
export class SaveAgentDto {
  name: string;
  /** Optional job title, at most 64 characters. */
  role?: string;
  /** A domain id (agents.md 1.2); omitted or `general` = General. */
  domain?: string;
  description?: string;
  instructions?: string;
  datasets?: string[];
  starterQuestions?: string[];
  model?: string;
  reasoningEffort?: ReasoningEffort;
  /** Any of `sample_rows`, `ask_clarification`, `visuals`; omitted = all. */
  tools?: string[];
  /** Ids of the caller's in-app skills, at most 10; omitted = none. */
  skills?: string[];
}
