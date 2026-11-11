/** Limits and defaults shared by the controller, the agent tools and the frontend mirror. */
export const SAMPLE_SIZE_MAX = 1000;
/** Databricks tables at or above this size (DESCRIBE DETAIL sizeInBytes) are read with LIMIT, not TABLESAMPLE: 52 s cold on 160 GB. */
export const DATABRICKS_TABLESAMPLE_MAX_BYTES = 50 * 1024 ** 3;
/** Chat (agent) limit: 20. */
export const PROFILE_TABLES_MAX = 50;
export const ROWS_PER_TABLE_DEFAULT = 100;
/** Chat (agent) limit: 1000. */
export const ROWS_PER_TABLE_MAX = 10000;
export const SCRIPT_ROWS_MAX = 200000;
export const INSERT_BATCH_ROWS = 500;
export const PROFILE_TTL_MS = 3_600_000;
export const PROFILE_CACHE_MAX = 20;
/** Chat (agent) limits (agents.md 3.14): tables per call, rows per table, script bytes. */
export const CHAT_TABLES_MAX = 20;
export const CHAT_ROWS_PER_TABLE_MAX = 1000;
export const CHAT_SCRIPT_BYTES_MAX = 262144;
export const DEFAULT_SEED = 1;
export const DEFAULT_TARGET_SCHEMA = 'synthetic';
/** Databricks also accepts `catalog.schema`, where both parts match. */
export const TARGET_SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
