/**
 * Side-effect import: give this script its own observability file before the
 * Nest graph (and `src/mastra/storage.ts`) loads. It must be the script's
 * FIRST import — imports run in order, and storage opens its DuckDB path the
 * moment it is loaded. See `isolated-observability.ts` for why.
 */
import { basename } from 'path';
import { isolateObservability } from './isolated-observability';

isolateObservability(basename(process.argv[1] ?? 'script').replace(/\.[jt]s$/, ''));
