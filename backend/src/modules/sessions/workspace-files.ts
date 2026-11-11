import { lstat, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, posix } from 'path';
import { sessionWorkspacePath } from '../../mastra/session-workspaces';

/** Largest text file the panel shows or downloads (api.md #106). */
export const PANEL_FILE_MAX_BYTES = 256 * 1024;

/** The extensions the panel treats as text, with the content type each serves. */
const TEXT_CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.sql': 'text/plain',
  '.yaml': 'text/plain',
  '.yml': 'text/plain',
  '.log': 'text/plain',
};

/** Why a workspace file could not be read. */
export class WorkspaceFileError extends Error {
  constructor(
    readonly reason: 'invalid' | 'missing' | 'not-text' | 'too-large',
    message: string,
  ) {
    super(message);
  }
}

/**
 * A workspace-relative path in `/` form, or undefined for an absolute path, a
 * `..` segment or an empty name.
 */
export function safeRelativePath(name: string): string | undefined {
  const normalized = name.replace(/\\/g, '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    return undefined;
  }
  const segments = normalized.split('/');
  if (segments.some((s) => s === '..' || s === '.' || s === '')) {
    return undefined;
  }
  return segments.join('/');
}

/** The content type a text file of the allow-list is served with. */
export function textContentType(path: string): string | undefined {
  return TEXT_CONTENT_TYPES[posix.extname(path).toLowerCase()];
}

/**
 * Write a text file into the session workspace (agents.md 3.14: the
 * synthetic-data script), creating its folders; an existing file of the same
 * name is overwritten. The path must be a safe relative path.
 */
export async function writeWorkspaceFile(
  sessionId: string,
  path: string,
  text: string,
): Promise<void> {
  const safe = safeRelativePath(path ?? '');
  if (!safe) {
    throw new WorkspaceFileError('invalid', `Invalid file path "${path}"`);
  }
  const target = join(sessionWorkspacePath(sessionId), ...safe.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

/**
 * A text file of the session workspace, read with the panel's guards: a safe
 * relative path with no symlink on the way, an allow-listed extension and at
 * most 256 KB. The error messages are the ones `show_in_panel` returns.
 */
export async function readWorkspaceFile(
  sessionId: string,
  path: string,
): Promise<{
  path: string;
  bytes: number;
  body: Buffer;
  text: string;
  contentType: string;
}> {
  const safe = safeRelativePath(path ?? '');
  if (!safe) {
    throw new WorkspaceFileError('invalid', `Invalid file path "${path}"`);
  }
  const missing = () =>
    new WorkspaceFileError(
      'missing',
      `File "${safe}" not found in the session workspace`,
    );
  let current = sessionWorkspacePath(sessionId);
  let info: Awaited<ReturnType<typeof lstat>> | undefined;
  for (const segment of safe.split('/')) {
    current = join(current, segment);
    try {
      info = await lstat(current);
    } catch {
      throw missing();
    }
    if (info.isSymbolicLink()) {
      throw new WorkspaceFileError('invalid', `Invalid file path "${path}"`);
    }
  }
  if (!info?.isFile()) throw missing();
  const contentType = textContentType(safe);
  if (!contentType) {
    throw new WorkspaceFileError(
      'not-text',
      `File "${safe}" is not a text file: show .md, .txt, .csv, .json, .sql, .yaml, .yml or .log files`,
    );
  }
  if (info.size > PANEL_FILE_MAX_BYTES) {
    throw new WorkspaceFileError(
      'too-large',
      `File "${safe}" is larger than 256 KB`,
    );
  }
  const body = await readFile(current);
  return {
    path: safe,
    bytes: body.length,
    body,
    text: body.toString('utf8'),
    contentType,
  };
}
