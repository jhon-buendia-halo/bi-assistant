/**
 * Connection the Testing Data panel hands us to seed. Everything arrives from
 * JSON, so nothing is trusted: the service validates and coerces before a
 * single byte reaches `pg`.
 */
export interface LoadTestingDataDto {
  host?: unknown;
  port?: unknown;
  database?: unknown;
  user?: unknown;
  password?: unknown;
  ssl?: unknown;
}
