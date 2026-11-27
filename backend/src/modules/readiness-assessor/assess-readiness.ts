// Stub owned by U1 (engine): replaced by the real engine. Signature is the contract.
import type {
  AssessReadinessOptions,
  ReadinessAssessment,
  ReadinessPort,
  ReadinessScope,
} from './readiness.types';

export function assessReadiness(
  _scope: ReadinessScope,
  _port: ReadinessPort,
  _options: AssessReadinessOptions,
): Promise<ReadinessAssessment> {
  return Promise.reject(new Error('assessReadiness is not implemented yet'));
}
