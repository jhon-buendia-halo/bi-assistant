/**
 * DI token of `SyntheticDataService` for modules that must not load it at
 * import time (the sessions orchestrator, whose specs never sample a
 * datasource): `SyntheticDataModule` provides it as an alias of the service.
 */
export const SYNTHETIC_DATA_SERVICE = 'SYNTHETIC_DATA_SERVICE';
