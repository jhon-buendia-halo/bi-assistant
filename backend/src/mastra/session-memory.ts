import { Memory } from '@mastra/memory';

/**
 * The conversation memory of an agent a session talks to (agents.md 1.1,
 * 4.3): one thread per session, the last 40 messages, no semantic recall and
 * no generated title. A new instance per agent.
 */
export function sessionMemory(): Memory {
  return new Memory({
    options: {
      lastMessages: 40,
      semanticRecall: false,
      generateTitle: false,
    },
  });
}
