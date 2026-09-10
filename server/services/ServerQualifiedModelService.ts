import type { LmapiServerStatus } from '../../src/types/lmapi';
import type { EvaluationRecoveryCheck, ServerQualifiedModelRef } from '../../src/types/eval';

export class ModelReferenceError extends Error {
  constructor(public readonly code: 'MODEL_ID_INVALID' | 'MODEL_ROUTE_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'ModelReferenceError';
  }
}

export function parseServerQualifiedModel(canonicalId: string): ServerQualifiedModelRef {
  const separator = canonicalId.indexOf('::');
  const serverName = separator < 0 ? '' : canonicalId.slice(0, separator).trim();
  const modelName = separator < 0 ? '' : canonicalId.slice(separator + 2).trim();
  if (!serverName || !modelName) {
    throw new ModelReferenceError('MODEL_ID_INVALID', `Model ID must use a non-empty server::model value: ${canonicalId}`);
  }
  return { canonicalId, serverName, modelName };
}

export function routeAvailabilityCheck(
  model: ServerQualifiedModelRef,
  servers: LmapiServerStatus[]
): EvaluationRecoveryCheck {
  const server = servers.find(item => item.config.name === model.serverName && item.isOnline);
  const compatible = !!server?.models.includes(model.modelName);
  return {
    code: 'MODEL_ROUTE_UNAVAILABLE',
    compatible,
    message: compatible
      ? `${model.canonicalId} resolves to ${model.serverName}/${model.modelName}`
      : `No online LMApi route currently exposes ${model.canonicalId}`,
  };
}

// LMApi does not currently expose a stable per-model artifact digest, so this can only ever
// report the informational limitation from resolved design decision #6 — never fabricate a
// digest from the model name, and never claim a match/mismatch without one on both sides.
export function artifactIdentityCheck(model: ServerQualifiedModelRef): EvaluationRecoveryCheck {
  if (!model.artifactDigest) {
    return {
      code: 'MODEL_ARTIFACT_IDENTITY_UNAVAILABLE', compatible: true, informational: true,
      message: `No artifact digest was captured for ${model.canonicalId}; identical model weights cannot be guaranteed`,
    };
  }
  return {
    code: 'MODEL_ARTIFACT_IDENTITY_UNAVAILABLE', compatible: true, informational: true,
    message: `Resume cannot re-verify the ${model.canonicalId} artifact digest against the current server catalog`,
  };
}

export const ServerQualifiedModelService = { parse: parseServerQualifiedModel, routeAvailabilityCheck, artifactIdentityCheck };
