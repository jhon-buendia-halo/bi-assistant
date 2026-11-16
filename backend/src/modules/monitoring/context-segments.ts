import type {
  ContextSegment,
  ContextSegmentItem,
  ContextSegmentKey,
} from './entities/llm-call.entity';

/**
 * The context-window boxes of one LLM call, built from the trace store
 * (Mastra's `span_events`): the generation's input, its last model step's
 * input and the run's tool calls. Pure functions, no I/O.
 */

/** One prompt message as Mastra records it: string or an array of parts. */
export interface PromptMessage {
  role: string;
  content: unknown;
}

/** One tool definition sent with the request (`attributes.tools`). */
export interface ToolDefinition {
  name?: string;
  description?: string;
  parameters?: unknown;
}

/** One `tool_call` span of the run. */
export interface ToolCallRecord {
  name: string;
  input: unknown;
  output: unknown;
}

export interface SegmentSources {
  /** The `model_generation` span's `input.messages`. */
  generationMessages: PromptMessage[];
  /** The last `model_step` span's input (the exact request), when known. */
  lastStepMessages: PromptMessage[] | null;
  tools: ToolDefinition[];
  toolCalls: ToolCallRecord[];
  /** The real context size; the estimates are scaled to it when known. */
  contextTokens: number | null;
}

const SEGMENTS: {
  key: ContextSegmentKey;
  label: string;
  owner: ContextSegment['owner'];
}[] = [
  { key: 'system-prompt', label: 'System prompt', owner: 'US Health' },
  { key: 'skills', label: 'Skill injection', owner: 'US Health' },
  { key: 'tools', label: 'Tools injection', owner: 'US Health' },
  { key: 'chat-history', label: 'Chat history', owner: 'Custom' },
  { key: 'dataset', label: 'Dataset', owner: 'Custom' },
  { key: 'user-prompt', label: 'User prompt', owner: 'Custom' },
  { key: 'tool-results', label: 'Tool calls and results', owner: 'Custom' },
];

/** Tools that load a skill on demand: their calls count as Skill injection. */
export const SKILL_TOOLS: ReadonlySet<string> = new Set([
  'skill',
  'skill_read',
]);

const SKILL_PREFIXES = [
  '<available_skills>',
  'IMPORTANT: Skills are NOT tools',
];

const CHARS_PER_TOKEN = 4;

export function isSkillMessage(text: string): boolean {
  const trimmed = text.trimStart();
  return SKILL_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** Pretty JSON of a value; strings are kept as they are. */
export function jsonText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    // A circular or BigInt value: Mastra serialises spans, so not expected.
    return '';
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function partText(part: unknown): string {
  if (typeof part === 'string') return part;
  const p = record(part);
  switch (p.type) {
    case 'text':
      return typeof p.text === 'string' ? p.text : '';
    case 'reasoning':
      // The text only: the provider's signature is not prompt content.
      return typeof p.text === 'string' ? p.text : '';
    case 'tool-call':
      return `[tool call: ${String(p.toolName)}] ${jsonText(p.input ?? p.args)}`;
    case 'tool-result':
      return `[tool result: ${String(p.toolName)}] ${jsonText(p.output ?? p.result)}`;
    default:
      return typeof p.text === 'string' ? p.text : '';
  }
}

/** The text of one message: every part, tool calls and results included. */
export function messageText(message: PromptMessage): string {
  const { content } = message;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(partText)
      .filter((text) => text !== '')
      .join('\n');
  }
  return jsonText(content);
}

const ROLE_TITLES: Record<string, string> = {
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool results',
  system: 'System',
};

function roleTitle(role: string): string {
  return ROLE_TITLES[role] ?? role;
}

function toolCallText(call: ToolCallRecord): string {
  return [jsonText(call.input), jsonText(call.output)]
    .filter((text) => text !== '')
    .join('\n\n');
}

/** Groups the call's prompt into the seven boxes, with their exact text. */
export function groupContextItems(
  sources: SegmentSources,
): Record<ContextSegmentKey, ContextSegmentItem[]> {
  const items: Record<ContextSegmentKey, ContextSegmentItem[]> = {
    'system-prompt': [],
    skills: [],
    tools: [],
    'chat-history': [],
    dataset: [],
    'user-prompt': [],
    'tool-results': [],
  };
  const seenSystem = new Set<string>();

  // The generation's system messages: index 0 is the agent's system prompt,
  // the rest are the per-turn context blocks.
  let systemIndex = 0;
  for (const message of sources.generationMessages) {
    if (message.role !== 'system') continue;
    const text = messageText(message);
    seenSystem.add(text);
    if (isSkillMessage(text)) {
      items.skills.push({ title: 'Available skills', text });
    } else if (systemIndex === 0) {
      items['system-prompt'].push({ title: 'Agent instructions', text });
    } else {
      items.dataset.push({ title: `Context block ${systemIndex}`, text });
    }
    systemIndex++;
  }

  // System messages only the real request carries (workspace, skills).
  for (const message of sources.lastStepMessages ?? []) {
    if (message.role !== 'system') continue;
    const text = messageText(message);
    if (seenSystem.has(text)) continue;
    seenSystem.add(text);
    if (isSkillMessage(text)) {
      items.skills.push({ title: 'Available skills', text });
    } else {
      items['system-prompt'].push({ title: 'System message', text });
    }
  }

  for (const tool of sources.tools) {
    const name = tool.name ?? 'tool';
    const text = [tool.description ?? '', jsonText(tool.parameters)]
      .filter((part) => part !== '')
      .join('\n\n');
    items.tools.push({ title: name, text });
  }

  const conversation = sources.generationMessages.filter(
    (message) => message.role !== 'system',
  );
  let lastUser = -1;
  conversation.forEach((message, index) => {
    if (message.role === 'user') lastUser = index;
  });
  conversation.forEach((message, index) => {
    if (lastUser !== -1 && index > lastUser) return;
    const text = messageText(message);
    if (index === lastUser) {
      items['user-prompt'].push({ title: 'User', text });
    } else {
      items['chat-history'].push({ title: roleTitle(message.role), text });
    }
  });

  for (const call of sources.toolCalls) {
    const target = SKILL_TOOLS.has(call.name)
      ? items.skills
      : items['tool-results'];
    target.push({ title: call.name, text: toolCallText(call) });
  }

  return items;
}

/**
 * Token estimates per box: chars / 4, then scaled so they add up to
 * `contextTokens` when it is known. Each is rounded; the rounding remainder
 * goes to the largest box.
 */
export function estimateTokens(
  chars: number[],
  contextTokens: number | null,
): number[] {
  const raw = chars.map((c) => c / CHARS_PER_TOKEN);
  const rawTotal = raw.reduce((sum, t) => sum + t, 0);
  if (contextTokens === null || rawTotal === 0) return raw.map(Math.round);
  const scaled = raw.map((t) => Math.round((t * contextTokens) / rawTotal));
  const remainder = contextTokens - scaled.reduce((sum, t) => sum + t, 0);
  if (remainder !== 0) {
    let largest = 0;
    scaled.forEach((t, i) => {
      if (t > scaled[largest]) largest = i;
    });
    scaled[largest] += remainder;
  }
  return scaled;
}

/** The seven context-window boxes, in order, with sizes and shares. */
export function buildContextSegments(
  sources: SegmentSources,
): ContextSegment[] {
  const grouped = groupContextItems(sources);
  const chars = SEGMENTS.map(({ key }) =>
    grouped[key].reduce((sum, item) => sum + item.text.length, 0),
  );
  const tokens = estimateTokens(chars, sources.contextTokens);
  const total = tokens.reduce((sum, t) => sum + t, 0);
  return SEGMENTS.map(({ key, label, owner }, i) => ({
    key,
    label,
    owner,
    chars: chars[i],
    tokens: tokens[i],
    share: total > 0 ? tokens[i] / total : 0,
    items: grouped[key],
  }));
}
