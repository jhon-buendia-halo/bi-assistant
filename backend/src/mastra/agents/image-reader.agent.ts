import { Agent } from '@mastra/core/agent';
import { agentInstructions } from '../agent-prompt-overrides';
import { IMAGE_READER_AGENT_KEY } from '../agent-constants';
import { resolveAgentModel } from '../model-resolver';
import { READ_IMAGES_INSTRUCTIONS } from '../workflows/read-images.prompts';

/**
 * Zoe, Image Analyst (agents.md 1.1, 2.15; workflows R35): the agent of
 * the Read images step of Answer a Business Question, Assess Data
 * Readiness and Map a Dashboard to Data. She looks at the reference images
 * a user attached to a run and describes what each shows, in one model
 * call that carries them all, with no tools and no memory. A System agent:
 * the workflows call her through `readImagesWithModel`; her job
 * description is the shipped Read images instructions or their in-app
 * override (ADR-0026). The app's model must accept images.
 */
export const imageReaderAgent = new Agent({
  id: IMAGE_READER_AGENT_KEY,
  // The technical name traces and Monitoring show; the hub shows the persona.
  name: 'Image Reader',
  description:
    'Reads the reference images attached to a run and describes what each shows for the analysts. No tools.',
  instructions: () =>
    agentInstructions(IMAGE_READER_AGENT_KEY, READ_IMAGES_INSTRUCTIONS),
  model: async () => resolveAgentModel(),
});
