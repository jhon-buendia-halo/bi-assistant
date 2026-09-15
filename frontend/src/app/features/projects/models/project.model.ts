export interface ClarificationOption {
  label: string;
  description?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
  /** Present when the assistant asked a clarifying question with options. */
  clarification?: {
    question: string;
    options: ClarificationOption[];
  };
}

export interface ProjectVisualization {
  id: string;
  title: string;
  description: string;
  path: string;
  sourceMessageAt: string;
  createdAt: string;
}

export interface InteractiveVisualization extends ProjectVisualization {
  document: string;
}

export interface Project {
  id: string;
  name: string;
  workspaceId?: string;
  sandboxes: string[];
  messages: ChatMessage[];
  visualizations?: ProjectVisualization[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectActionResult {
  ok: boolean;
  message: string;
  project?: Project;
  visualization?: InteractiveVisualization;
}
