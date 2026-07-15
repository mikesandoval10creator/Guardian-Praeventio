import type { RequestHandler } from 'express';
import { OAuth2Client } from 'google-auth-library';

export interface MinimalOidcClient {
  verifyIdToken(input: {
    idToken: string;
    audience: string;
  }): Promise<{ getPayload(): Record<string, unknown> | null | undefined }>;
}

const defaultOidcClient = new OAuth2Client() as unknown as MinimalOidcClient;

export function createPinnedServiceAccountMiddleware(options: {
  oidcClient?: MinimalOidcClient;
  env?: Record<string, string | undefined>;
} = {}): RequestHandler {
  const oidcClient = options.oidcClient ?? defaultOidcClient;
  const env = options.env ?? process.env;

  return async (req, res, next) => {
    if (env.COMPLIANCE_KMS_SIGNING_ENABLED !== 'true') {
      res.status(503).json({ error: 'compliance_kms_oidc_not_configured' });
      return;
    }
    const serviceAccount = env.COMPLIANCE_KMS_CALLER_SERVICE_ACCOUNT?.trim().toLowerCase() ?? '';
    const audience = (
      env.COMPLIANCE_KMS_OIDC_AUDIENCE ?? env.APP_BASE_URL ?? ''
    ).trim();
    if (!serviceAccount || !audience) {
      res.status(503).json({ error: 'compliance_kms_oidc_not_configured' });
      return;
    }

    const authorization = req.header('authorization') ?? '';
    const token = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (!token || token.split('.').length !== 3) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    try {
      const ticket = await oidcClient.verifyIdToken({ idToken: token, audience });
      const payload = ticket.getPayload();
      const email = typeof payload?.email === 'string' ? payload.email.toLowerCase() : '';
      if (payload?.email_verified !== true || email !== serviceAccount) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      next();
    } catch {
      res.status(401).json({ error: 'unauthorized' });
    }
  };
}

export const verifyPinnedComplianceKmsServiceAccount =
  createPinnedServiceAccountMiddleware();
