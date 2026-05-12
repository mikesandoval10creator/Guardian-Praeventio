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

  return {
    ok: errors.length === 0,
    adapter,
    errors,
    warnings,
  };
}
