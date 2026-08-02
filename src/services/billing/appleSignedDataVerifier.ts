// Praeventio Guard — trusted Apple signed-data verification boundary.
//
// Apple App Store Server Notifications and App Store Server API responses
// carry an x5c chain in each JWS. Trusting x5c[0] by itself lets an attacker
// mint a certificate and authenticate their own payload. This module pins the
// official Apple roots shipped under ./certs and delegates chain, certificate,
// app-identity, environment, and JWS verification to Apple's maintained Node
// library.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  Environment,
  SignedDataVerifier,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';

const APPLE_ROOT_CERTIFICATES = [
  new URL('./certs/AppleIncRootCertificate.cer', import.meta.url),
  new URL('./certs/AppleRootCA-G2.cer', import.meta.url),
  new URL('./certs/AppleRootCA-G3.cer', import.meta.url),
] as const;

export interface AppleSignedDataVerifierLike {
  verifyAndDecodeNotification(
    signedPayload: string,
  ): Promise<ResponseBodyV2DecodedPayload>;
  verifyAndDecodeTransaction(
    signedTransactionInfo: string,
  ): Promise<JWSTransactionDecodedPayload>;
  verifyAndDecodeRenewalInfo(
    signedRenewalInfo: string,
  ): Promise<JWSRenewalInfoDecodedPayload>;
}

export interface VerifiedAppleNotification {
  notification: ResponseBodyV2DecodedPayload;
  transactionInfo?: JWSTransactionDecodedPayload;
  renewalInfo?: JWSRenewalInfoDecodedPayload;
}

export class AppleSignedDataVerificationError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`Apple signed-data verification failed: ${reason}`, options);
    this.name = 'AppleSignedDataVerificationError';
  }
}

let injectedVerifier: AppleSignedDataVerifierLike | null = null;
const verifierCache = new Map<string, AppleSignedDataVerifierLike>();

/** Test-only seam. Production callers can never replace Apple's trust roots. */
export function __setAppleSignedDataVerifierForTests(
  verifier: AppleSignedDataVerifierLike | null,
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Apple signed-data verifier injection is test-only');
  }
  injectedVerifier = verifier;
}

function parseEnvironment(raw: string | undefined): Environment {
  if (raw === Environment.PRODUCTION || raw?.toLowerCase() === 'production') {
    return Environment.PRODUCTION;
  }
  if (raw === Environment.SANDBOX || raw?.toLowerCase() === 'sandbox') {
    return Environment.SANDBOX;
  }
  throw new AppleSignedDataVerificationError(
    'APPLE_IAP_ENVIRONMENT must be Production or Sandbox',
  );
}

function parseProductionAppAppleId(raw: string | undefined): number {
  const appAppleId = Number(raw);
  if (!Number.isSafeInteger(appAppleId) || appAppleId <= 0) {
    throw new AppleSignedDataVerificationError(
      'APPLE_APP_ID must be a positive integer in Production',
    );
  }
  return appAppleId;
}

function loadOfficialAppleRoots(): Buffer[] {
  try {
    return APPLE_ROOT_CERTIFICATES.map((certificateUrl) =>
      fs.readFileSync(fileURLToPath(certificateUrl)),
    );
  } catch (error) {
    throw new AppleSignedDataVerificationError(
      'official Apple root certificate could not be loaded',
      { cause: error },
    );
  }
}

function getProductionVerifier(
  environmentOverride?: Environment,
): AppleSignedDataVerifierLike {
  const bundleId = process.env.APPLE_BUNDLE_ID?.trim();
  if (!bundleId) {
    throw new AppleSignedDataVerificationError('APPLE_BUNDLE_ID is not configured');
  }

  const environment =
    environmentOverride ?? parseEnvironment(process.env.APPLE_IAP_ENVIRONMENT);
  const appAppleId =
    environment === Environment.PRODUCTION
      ? parseProductionAppAppleId(process.env.APPLE_APP_ID)
      : undefined;
  const enableOnlineChecks =
    process.env.APPLE_SSN_ONLINE_CHECKS?.toLowerCase() !== 'false';
  const cacheKey = [bundleId, environment, appAppleId ?? '', enableOnlineChecks].join('|');
  const cached = verifierCache.get(cacheKey);
  if (cached) return cached;

  const verifier = new SignedDataVerifier(
    loadOfficialAppleRoots(),
    enableOnlineChecks,
    environment,
    bundleId,
    appAppleId,
  );
  verifierCache.set(cacheKey, verifier);
  return verifier;
}

function getVerifier(environmentOverride?: Environment): AppleSignedDataVerifierLike {
  return injectedVerifier ?? getProductionVerifier(environmentOverride);
}

/** Verify the outer notification and every nested signed object before use. */
export async function verifyAppleNotification(
  signedPayload: string,
): Promise<VerifiedAppleNotification> {
  const verifier = getVerifier();
  try {
    const notification = await verifier.verifyAndDecodeNotification(signedPayload);
    const signedTransactionInfo = notification.data?.signedTransactionInfo;
    const signedRenewalInfo = notification.data?.signedRenewalInfo;
    const transactionInfo = signedTransactionInfo
      ? await verifier.verifyAndDecodeTransaction(signedTransactionInfo)
      : undefined;
    const renewalInfo = signedRenewalInfo
      ? await verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo)
      : undefined;

    return { notification, transactionInfo, renewalInfo };
  } catch (error) {
    throw new AppleSignedDataVerificationError('JWS rejected', { cause: error });
  }
}

/**
 * Verify a transaction returned by Apple's Server API. The API base URL used
 * for the response is server-selected, so it is authoritative for choosing
 * the expected environment.
 */
export async function verifyAppleTransaction(
  signedTransactionInfo: string,
  environment: 'production' | 'sandbox',
): Promise<JWSTransactionDecodedPayload> {
  const expectedEnvironment =
    environment === 'production' ? Environment.PRODUCTION : Environment.SANDBOX;
  try {
    return await getVerifier(expectedEnvironment).verifyAndDecodeTransaction(
      signedTransactionInfo,
    );
  } catch (error) {
    throw new AppleSignedDataVerificationError('transaction JWS rejected', {
      cause: error,
    });
  }
}
