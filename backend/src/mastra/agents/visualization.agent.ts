import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import {
  isCopilotConfig,
  isCustomAnthropicConfig,
  resolveAgentModelConfig,
  type AgentModelConfig,
} from '../model-resolver';
import { buildModel } from '../model-factory';
import { agentInstructions } from '../agent-prompt-overrides';
import { VISUALIZATION_PROMPT } from './system-prompts';
import { SESSION_WORKSPACE_CONTEXT_KEY } from '../session-workspaces';
import { visualSpecSchema } from '../../modules/sessions/visual-spec';

/**
 * Visual design is a bounded transformation task, but not a trivial one: a
 * spec is ~40 JSON fields that must all validate. Reasoning-heavy models add
 * hidden-token latency without better output, while nano-class models cannot
 * hold the schema together at all (a VDI report showed 59 straight validation
 * failures on a LenAI gpt-4.1-nano deployment). `VISUAL_MODEL` forces a model;
 * otherwise a public gpt-5 family router id is swapped for gpt-4.1-mini, any
 * nano model — LenAI deployments and custom endpoints included — is upgraded
 * to its mini sibling, and everything else is kept (agents.md 1.5).
 */
const REASONING_FAMILY = /^openai\/(gpt-5|o\d)/;
const VISUAL_FALLBACK = 'openai/gpt-4.1-mini' as const;
/** `nano` as a delimited token, so a deployment named `…nanotech…` is kept. */
const NANO_TOKEN = /(^|[^a-z0-9])nano([^a-z0-9]|$)/i;

/** `VISUAL_MODEL`, read at call time so a changed env applies without a restart. */
function visualModelOverride(): `${string}/${string}` | undefined {
  const value = process.env.VISUAL_MODEL?.trim();
  return value ? (value as `${string}/${string}`) : undefined;
}

/**
 * The mini sibling of a nano model id, or `undefined` when it is not a nano
 * one. Swapping the single token covers both naming schemes:
 * `lenai/mmc-tech-gpt-41-nano-1m-2025-04-14` → `…-gpt-41-mini-1m-…`,
 * `openai/gpt-4.1-nano` → `openai/gpt-4.1-mini`.
 */
function miniSibling<T extends `${string}/${string}`>(id: T): T | undefined {
  if (!NANO_TOKEN.test(id)) return undefined;
  // Only the model part moves, so `anthropic/…` stays `anthropic/…`.
  const upgraded = id.replace(
    NANO_TOKEN,
    (_match, before: string, after: string) => `${before}mini${after}`,
  ) as T;
  // Warned rather than silent: the substitution has to be visible in a
  // diagnostics report, since the model answering is not the configured one.
  console.warn(
    `[visual-model] ${id} is too weak for a visual spec; using ${upgraded}`,
  );
  return upgraded;
}

/**
 * The visual designer's model as plain data, derived from the resolved one
 * (agents.md 1.5). Every substitution moves the id only: a gateway or custom
 * endpoint keeps its url (or base URL), key, headers and kind, and is never
 * routed to the public OpenAI fallback. The agent builds the result last.
 */
export async function resolveVisualizationModel(): Promise<AgentModelConfig> {
  const configured = await resolveAgentModelConfig();
  const override = visualModelOverride();
  if (isCopilotConfig(configured)) {
    // Never swapped for a mini sibling or the public fallback: the seat's
    // plan decides the models. VISUAL_MODEL moves only the model name.
    if (!override) return configured;
    const name = override.slice(override.indexOf('/') + 1);
    return { ...configured, id: `copilot/${name}` };
  }
  if (isCustomAnthropicConfig(configured)) {
    if (override) {
      // The provider segment stays `anthropic`; only the model name moves.
      const name = override.slice(override.indexOf('/') + 1);
      return { ...configured, id: `anthropic/${name}` };
    }
    // Its id starts with `anthropic/`, so the reasoning-family rule never applies.
    const mini = miniSibling(configured.id);
    return mini ? { ...configured, id: mini } : configured;
  }
  if (typeof configured === 'string') {
    if (override) return override;
    if (REASONING_FAMILY.test(configured)) return VISUAL_FALLBACK;
    return miniSibling(configured) ?? configured;
  }
  if (override) return { ...configured, id: override };
  // A config with a url (LenAI gateway, OpenAI-style custom endpoint) is
  // never swapped to the public fallback.
  if (REASONING_FAMILY.test(configured.id) && !configured.url) {
    return { ...configured, id: VISUAL_FALLBACK };
  }
  // A gateway deployment keeps its url, apiKey and headers — only the id moves.
  const mini = miniSibling(configured.id);
  return mini ? { ...configured, id: mini } : configured;
}

/**
 * Preferred output: a small JSON spec the fixed chart runtime renders. No
 * HTML, CSS or JavaScript is generated, so a visual can no longer break on a
 * fumbled line of model-written code.
 */
export const specVisualOutputSchema = z.object({
  title: z.string().describe('Short title for the visual'),
  description: z
    .string()
    .describe('Plain-language explanation and main takeaway'),
  spec: visualSpecSchema.describe(
    'Chart spec (version 1) rendered by the fixed runtime',
  ),
});

/** Fallback output: the legacy freeform bundle, used when a spec cannot be produced. */
export const interactiveVisualOutputSchema = z.object({
  title: z.string().describe('Short title for the visual'),
  description: z
    .string()
    .describe('Plain-language explanation and main takeaway'),
  html: z
    .string()
    .describe('Accessible body HTML fragment without scripts or styles'),
  css: z
    .string()
    .describe(
      "Responsive CSS that takes its colours from the frame's tokens, without imports",
    ),
  javascript: z
    .string()
    .describe('Browser-native JavaScript that adds the interaction'),
});

/** Converts a completed analysis answer into a renderable artifact bundle. */
export const visualizationAgent = new Agent({
  id: 'interactive-visual-designer',
  name: 'Interactive Visual Designer',
  description:
    'Turns a completed analysis answer into an interactive visual, and tailors it on request.',
  // The shipped prompt, or the in-app override (ADR-0026).
  instructions: () => agentInstructions('visualization', VISUALIZATION_PROMPT),
  // Keep analysis on the configured model while using the smaller sibling for
  // the bounded code-transformation step.
  model: async () => buildModel(await resolveVisualizationModel()),
  workspace: ({ requestContext, mastra }) => {
    const workspaceId = requestContext.get(SESSION_WORKSPACE_CONTEXT_KEY);
    if (typeof workspaceId !== 'string' || !mastra) return undefined;
    return mastra.listWorkspaces()[workspaceId]?.workspace;
  },
});
