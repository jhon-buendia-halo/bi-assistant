/**
 * The DI token of `QueryEvidenceService` for modules outside sessions (the
 * workflow runs, api.md 139-143). A token keeps their import of the service
 * type-only, so loading them never pulls in the connectors' drivers.
 */
export const QUERY_EVIDENCE_SERVICE = Symbol('QUERY_EVIDENCE_SERVICE');
