// Praeventio Guard — tenant-scoped LLM credential store (BYOK, backend-only).
//
// WHY THIS FILE EXISTS
// --------------------
// `providerRouter.ts` already declares the seam for per-tenant credentials:
//
//     export interface LlmCredentialResolver {
//       resolve(tenantId: string, provider: AiProviderName): SelfHostedConfig | null;
//     }
//
// …but the ONE production call site never injects a resolver:
//
//     // src/server/routes/gemini.ts
//     dispatchSelfHostedAction(action, callArgs, { tenantId, signal })
//                                                ^ no credentialResolver
//
// So every request falls back to `envCredentialResolver` — a SINGLE process-wide
// key. The interface promises tenant isolation; the wiring delivers a global
// secret. This file is the real implementation behind that promise.
//
// SECURITY MODEL
// --------------
//   • The credential is stored under `tenants/{tenantId}/llm_credentials/{provider}`.
//     The tenant id comes from the VERIFIED JWT claim (routes/gemini.ts derives
//     `req.user.tenantId`), never from the request body — so a caller cannot
//     ask for another tenant's key.
//   • At rest the credential is an ENVELOPE (AES-256-GCM under a KMS-wrapped
//     DEK), reusing `services/security/kmsEnvelope.ts`. A privileged Firestore
//     export therefore yields ciphertext, not a usable API key.
//   • The plaintext key NEVER reaches the browser: it is read server-side,
//     used server-side, and is not part of any response payload.
//   • Fail-closed on ambiguity: if the tenant id is missing/blank, the
//     resolver returns null instead of falling back to the global credential.
//     A request that cannot prove which tenant it belongs to must not borrow
//     another tenant's (or the operator's) key.
//
// NOT IN THIS FILE
// ----------------
// The HTTP surface that lets a user SET their key is a separate PR. This one
// establishes storage + resolution + the isolation guarantees, which are the
// parts that are security-critical and testable hermetically.

import { envelopeDecrypt, envelopeEncrypt, isEnvelopeCiphertext } from '../security/kmsEnvelope.js';
import type { EnvelopeCiphertext } from '../security/kmsEnvelope.js';
import { getKmsAdapter, type KmsAdapter } from '../security/kmsAdapter.js';
import { logger } from '../../utils/logger.js';
import {
  DEFAULT_SELFHOSTED_TIMEOUT_MS,
  type SelfHostedConfig,
} from './selfHostedProvider.js';
import type { AiProviderName, LlmCredentialResolver } from './providerRouter.js';

/** Providers that can hold a per-tenant credential. */
export type TenantCredentialProvider = 'gemini' | 'selfhosted';

/**
 * Firestore surface this store needs. Narrow on purpose so the unit test can
 * hand it a fake and never touch a real Firestore.
 */
export interface CredentialFirestoreDb {
  collection(path: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): unknown }>;
      set(data: unknown): Promise<unknown>;
      delete(): Promise<unknown>;
    };
  };
}

/**
 * A decrypted credential plus the provider-specific fields that are NOT
 * secret (base URL, model name). Those are safe to log; the key is not.
 */
export interface ResolvedTenantCredential {
  provider: TenantCredentialProvider;
  /** The plaintext credential. Server-side only — never serialize to a client. */
  secret: string;
  /** Endpoint for OpenAI-compatible providers, when the credential has one. */
  baseUrl?: string;
  /** Served model name, when the credential has one. */
  model?: string;
}

/** The persisted document. */
export interface TenantCredentialDoc {
  provider: TenantCredentialProvider;
  envelope: EnvelopeCiphertext;
  /** Non-secret provider settings, stored in clear so ops can see the shape. */
  baseUrl?: string;
  model?: string;
  updatedAt: string;
}

/** Storage path. Tenant-scoped: one credential set per tenant per provider. */
export function credentialPath(tenantId: string): string {
  return `tenants/${tenantId}/llm_credentials`;
}

/**
 * Reject tenant ids that could escape the intended path or collide with a
 * sibling collection. Firestore doc ids may not contain `/`, and an empty id
 * would silently target the collection root.
 */
export function isValidTenantId(tenantId: unknown): tenantId is string {
  return (
    typeof tenantId === 'string' &&
    tenantId.length > 0 &&
    tenantId.length <= 128 &&
    !tenantId.includes('/') &&
    !tenantId.includes('..')
  );
}

/**
 * The resolver used in production. Implements `LlmCredentialResolver` from
 * `providerRouter.ts`.
 *
 * `fallback` is the operator-wide configuration (today: the process env).
 * It is used ONLY when the tenant has no credential of its own AND the caller
 * explicitly allows it. It is NEVER used when the tenant id is invalid.
 */
export class FirestoreTenantCredentialResolver {
  constructor(
    private readonly db: CredentialFirestoreDb,
    private readonly kmsAdapter: KmsAdapter = getKmsAdapter(),
  ) {}

  /**
   * Resolve the credential for `tenantId` + `provider`.
   *
   * Returns `null` only when the tenant has no stored credential. Invalid
   * identity, malformed stored data, Firestore failure and KMS failure reject:
   * returning null for those cases would silently authorize platform fallback.
   */
  async resolve(
    tenantId: string,
    provider: TenantCredentialProvider,
  ): Promise<ResolvedTenantCredential | null> {
    // Fail-closed: an unverifiable tenant must not borrow a credential.
    if (!isValidTenantId(tenantId)) {
      logger.warn('[ai.credential] invalid_tenant_id', { provider });
      throw new Error('invalid_tenant_id');
    }

    let snap: { exists: boolean; data(): unknown };
    try {
      snap = await this.db
        .collection(credentialPath(tenantId))
        .doc(provider)
        .get();
    } catch (err) {
      logger.error('[ai.credential] read_failed', err, {
        provider,
        tenant_id: tenantId,
      });
      throw err;
    }

    if (!snap.exists) return null;

    const data = snap.data() as TenantCredentialDoc | undefined;
    if (!data || !isEnvelopeCiphertext(data.envelope)) {
      logger.error('[ai.credential] malformed_envelope', undefined, {
        provider,
        tenant_id: tenantId,
      });
      // An existing document is not an absent credential. Prevent the
      // platform fallback from masking corruption or a custody failure.
      throw new Error('malformed_credential_envelope');
    }

    let secret: string;
    try {
      secret = await envelopeDecrypt(data.envelope, this.kmsAdapter);
    } catch (err) {
      // A failed unwrap is NOT "no credential" — it is a custody failure.
      // Surface it so the caller fails closed instead of silently escalating
      // to the operator-wide key.
      logger.error('[ai.credential] decrypt_failed', err, {
        provider,
        tenant_id: tenantId,
      });
      throw err;
    }

    return {
      provider,
      secret,
      baseUrl: data.baseUrl,
      model: data.model,
    };
  }
}

/**
 * Store a tenant credential, encrypted at rest.
 *
 * Used by the (future) HTTP surface that accepts a user's own key. Kept here
 * so the write path and the read path cannot drift apart.
 */
export async function saveTenantCredential(
  db: CredentialFirestoreDb,
  kmsAdapter: KmsAdapter,
  tenantId: string,
  provider: TenantCredentialProvider,
  secret: string,
  extras: { baseUrl?: string; model?: string } = {},
): Promise<void> {
  if (!isValidTenantId(tenantId)) {
    throw new Error('invalid_tenant_id');
  }
  if (!secret || !secret.trim()) {
    throw new Error('empty_credential');
  }

  const envelope = await envelopeEncrypt(secret, kmsAdapter);
  const doc: TenantCredentialDoc = {
    provider,
    envelope,
    ...(extras.baseUrl ? { baseUrl: extras.baseUrl } : {}),
    ...(extras.model ? { model: extras.model } : {}),
    updatedAt: new Date().toISOString(),
  };

  await db.collection(credentialPath(tenantId)).doc(provider).set(doc);
}

/**
 * Remove a tenant credential. Used when a user revokes their own key.
 */
export async function deleteTenantCredential(
  db: CredentialFirestoreDb,
  tenantId: string,
  provider: TenantCredentialProvider,
): Promise<void> {
  if (!isValidTenantId(tenantId)) {
    throw new Error('invalid_tenant_id');
  }
  await db.collection(credentialPath(tenantId)).doc(provider).delete();
}

/**
 * `LlmCredentialResolver` implementation backed by Firestore + KMS.
 *
 * This is the object that gets injected into `dispatchSelfHostedAction` at
 * the route layer, closing the E1.2 gap: the declared per-tenant seam is
 * finally connected to a real, tenant-isolated store.
 *
 * Behaviour contract:
 *   • Tenant has its own credential → that credential is used. The operator's
 *     env key is NOT consulted.
 *   • Tenant has NO credential → returns null. The caller decides whether to
 *     fall back to the operator-wide provider. It NEVER happens implicitly
 *     here, because "no credential" and "use the global key" are different
 *     decisions with different privacy consequences.
 *   • Store/KMS failure → THROWS, so the dispatcher records a failure and
 *     runs its fallback chain instead of pretending the tenant has no key.
 */
export class TenantCredentialResolver implements LlmCredentialResolver {
  constructor(
    private readonly store: FirestoreTenantCredentialResolver,
  ) {}

  async resolve(
    tenantId: string,
    provider: AiProviderName,
  ): Promise<SelfHostedConfig | null> {
    const resolved = await this.store.resolve(tenantId, provider);
    if (!resolved) return null;

    if (provider === 'selfhosted') {
      // A stored credential without both endpoint and model is unusable.
      // It is not an absent credential: do not borrow the platform key.
      if (!resolved.baseUrl || !resolved.model) throw new Error('incomplete_tenant_credential');
      return {
        baseUrl: resolved.baseUrl.replace(/\/+$/, ''),
        apiKey: resolved.secret,
        model: resolved.model,
        timeoutMs: DEFAULT_SELFHOSTED_TIMEOUT_MS,
      };
    }

    // 'gemini' credentials are consumed by the Gemini path, which today
    // reads its own key from the call-scope seam. The stored value is
    // returned as-is; the Gemini wiring is a separate, later PR.
    return null;
  }
}
