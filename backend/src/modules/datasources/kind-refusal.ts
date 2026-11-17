/**
 * The refusal a PostgreSQL / Databricks-only feature gives a datasource of
 * another kind (M1-31 story 1.31.6). Features gate on an allow-list and use
 * this text; a new kind is refused until a feature opts in.
 */
const KIND_PHRASE: Record<string, string> = {
  file: 'an Excel / CSV datasource',
  rest: 'a REST API datasource',
};

export function unsupportedKindMessage(
  feature: string,
  name: string,
  kind: string | null | undefined,
): string {
  const phrase =
    KIND_PHRASE[kind ?? ''] ?? `a "${kind ?? 'unknown'}" datasource`;
  return `${feature} supports PostgreSQL and Databricks datasources; "${name}" is ${phrase}.`;
}
