/**
 * The bare Databricks server hostname: trimmed, without a leading
 * `http://` / `https://` and without trailing slashes (datasources R4).
 * Users often paste the workspace URL; the SQL driver and the REST calls add
 * the scheme themselves, so a raw `https://…/` host becomes
 * `https://https//…` (BA-322). Every Databricks connection goes through this.
 */
export function normalizeDatabricksHost(host: string | undefined): string {
  return (host ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}
