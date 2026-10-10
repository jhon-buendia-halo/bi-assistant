import type { ReasoningEffort } from '../../llm/llm.types';

/**
 * Create / save-draft payload for a user agent (`POST /agents`,
 * `PUT /agents/:id/draft`). Untyped JSON: the controller coerces it and the
 * service normalises it (R43).
 */
export class SaveAgentDto {
  name: string;
  description?: string;
  instructions?: string;
  datasets?: string[];
  starterQuestions?: string[];
  model?: string;
  reasoningEffort?: ReasoningEffort;
}
