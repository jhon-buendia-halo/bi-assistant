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
  /** Workspace-relative directory containing the visualization bundle. */
  path: string;
  sourceMessageAt: string;
  createdAt: string;
}

export interface InteractiveVisualization extends ProjectVisualization {
  /** Sandboxed, self-contained document assembled from the stored bundle. */
  document: string;
}

export interface ProjectDoc {
  id: string;
  name: string;
  /** Mastra workspace associated one-to-one with this project. */
  workspaceId?: string;
  /** Names of the sandboxes this project works over. */
  sandboxes: string[];
  messages: ChatMessage[];
  visualizations?: ProjectVisualization[];
  createdAt?: string;
  updatedAt?: string;
}
