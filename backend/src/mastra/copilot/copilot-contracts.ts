// Shared contracts of the GitHub Copilot provider (BA-159, story 1.10.3,
// ADR-0037). The user-facing texts are those of llm-settings R57–R64 and
// api.md 2.5; keep them identical.

/** R57: signed in. */
export function copilotSignedInMessage(login: string): string {
  return `Signed in to GitHub as ${login}`;
}

/** R57: no GitHub login on the machine. */
export const COPILOT_NOT_SIGNED_IN =
  'Not signed in to GitHub — run "gh auth login" (or sign in to the GitHub Copilot CLI or app) on this machine, then test again';

/** R57: the local Copilot runtime failed to start. */
export function copilotRuntimeFailedMessage(detail: string): string {
  return `The GitHub Copilot runtime could not start — ${detail}`;
}

/** R58, R64: a Copilot session or request error. */
export function copilotRequestFailedMessage(detail: string): string {
  return `GitHub Copilot request failed — ${detail}`;
}

/**
 * R66: sent once, in the same session, when the model wrote a tool's
 * arguments as its message instead of calling the tool.
 */
export function copilotToolAsTextNudge(toolName: string): string {
  return `You wrote the arguments of the ${toolName} tool as your message instead of calling it. Call the ${toolName} tool now with those arguments. Never write tool arguments as text.`;
}

/** R56: the model that lets Copilot choose from the seat's plan. */
export const COPILOT_AUTO_MODEL = 'auto';

/** R60: the reasoning-effort levels the Copilot runtime accepts. */
export const COPILOT_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export type CopilotEffort = (typeof COPILOT_EFFORT_LEVELS)[number];

/** R63: a session waiting this long for tool results is closed. */
export const COPILOT_PENDING_TOOL_TIMEOUT_MS = 10 * 60 * 1000;

/** `GET /llm/copilot/status` (api.md 32c). */
export interface CopilotStatusView {
  signedIn: boolean;
  login: string | null;
  /** How the runtime signed in (e.g. `gh-cli`), null when not signed in. */
  method: string | null;
  message: string;
}

/**
 * The process-wide Copilot runtime (copilot-runtime.ts). One CopilotClient
 * per backend process, started on first use, stopped on shutdown.
 */
export interface CopilotRuntimeApi {
  /** Never throws: a start failure answers signedIn false with R57's text. */
  status(): Promise<CopilotStatusView>;
  /** Throws Error(COPILOT_NOT_SIGNED_IN | runtime-failed text) when unusable. */
  ensureSignedIn(): Promise<void>;
  /** Model ids of the signed-in seat, in order, duplicates removed. */
  listModels(): Promise<string[]>;
  /** Starts the runtime if needed and returns the SDK client. */
  client(): Promise<import('@github/copilot-sdk').CopilotClient>;
  stop(): Promise<void>;
}

/** Options of the Copilot model (copilot-model.ts). */
export interface CopilotModelOptions {
  /** `auto` or a model name passed through to Copilot. */
  model: string;
  /** Defaults to the process-wide runtime. Tests inject a fake. */
  runtime?: CopilotRuntimeApi;
}
