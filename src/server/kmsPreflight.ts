export interface KmsBootConfigResult {
  ok: boolean;
  adapter: string;
  errors: string[];
  warnings: string[];
}

type KmsBootEnv = {
  NODE_ENV?: string;
  KMS_ADAPTER?: string;
  KMS_KEY_RESOURCE_NAME?: string;
  COMPLIANCE_KMS_SIGNING_ENABLED?: string;
  COMPLIANCE_KMS_SIGNING_KEY_VERSION?: string;
  COMPLIANCE_KMS_CALLER_SERVICE_ACCOUNT?: string;
  COMPLIANCE_KMS_SIGNER_UID?: string;
  COMPLIANCE_KMS_SIGNER_RUT?: string;
  COMPLIANCE_KMS_OIDC_AUDIENCE?: string;
  APP_BASE_URL?: string;
};

const VALID_KMS_ADAPTERS = new Set(['cloud-kms', 'in-memory-dev']);

export function validateKmsBootConfig(env: KmsBootEnv): KmsBootConfigResult {
  const adapter = env.KMS_ADAPTER ?? 'in-memory-dev';
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!VALID_KMS_ADAPTERS.has(adapter)) {
    errors.push(
      `Unknown KMS_ADAPTER="${adapter}". Must be 'cloud-kms' or 'in-memory-dev'.`,
    );
  }

  if (env.NODE_ENV === 'production') {
    if (adapter !== 'cloud-kms') {
      errors.push(
        "Production requires KMS_ADAPTER='cloud-kms'; in-memory-dev is only allowed outside production.",
      );
    }
    if (adapter === 'cloud-kms' && !env.KMS_KEY_RESOURCE_NAME) {
      errors.push(
        'Production with cloud-kms requires KMS_KEY_RESOURCE_NAME to point at the key encryption key.',
      );
    }
  }

  if (env.COMPLIANCE_KMS_SIGNING_ENABLED === 'true') {
    const required = [
      'COMPLIANCE_KMS_SIGNING_KEY_VERSION',
      'COMPLIANCE_KMS_CALLER_SERVICE_ACCOUNT',
      'COMPLIANCE_KMS_SIGNER_UID',
      'COMPLIANCE_KMS_SIGNER_RUT',
    ] as const;
    for (const key of required) {
      if (!env[key]?.trim()) errors.push(`Compliance KMS signing requires ${key}.`);
    }
    if (!env.COMPLIANCE_KMS_OIDC_AUDIENCE?.trim() && !env.APP_BASE_URL?.trim()) {
      errors.push(
        'Compliance KMS signing requires COMPLIANCE_KMS_OIDC_AUDIENCE or APP_BASE_URL.',
      );
    }
  }

  return {
    ok: errors.length === 0,
    adapter,
    errors,
    warnings,
  };
}
