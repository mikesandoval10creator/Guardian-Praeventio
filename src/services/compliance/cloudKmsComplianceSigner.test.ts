import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ComplianceKmsSigningError,
  signCompliancePayloadWithKms,
  type MinimalComplianceKmsClient,
} from './cloudKmsComplianceSigner.js';

const KEY_VERSION = 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/7';
const PAYLOAD = new Uint8Array(Buffer.from('regulated-pdf-bytes'));

const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCl+yOOF1CvxJPq
455xpsyjRknDcrsSYsiIlVYuRGx7dGXF8cxlmYY8LbAoP+8PeBYtpgFe/WIukJIF
YASMsud+th7Zb8c6FMZU6AiwymshzzXw9nfWitWTQ6AJ6llT+LL2SuJs7bJlCYsr
WcoFr9QitCXgLAS5xAVhGC38Iq8aPj1IWKkqh8iALMk7XUY5O8mGl0wkskWl23/G
aBdcdmgFW/AiOrgIqbFmhDFGlO5esVqI2LYTWpG0RiPsfQAE/Duj1jM81K0CFdZS
uFY3z2ou1BgR0uzxvjHVEtK8wQWiystTMwguC1mzL8rJ0AzsEV6a5nb3XYG7Fh9M
9rWkwqCvAgMBAAECggEAMMwmVlp1bs+A21BDH0+2HxSFkDAVXqDrKviYpy6XpC4C
09C0UnRx2hRmk1bEjkw0XQROp+IfsOfw/iKOA91/IKojZLKvpFxCOOkk0PEZ0Q1N
4wNbFRipFMwPa4rZ602VM8KtUfAKABlvsHWL5uMcH33OGttmIkVGfZaxwkxiJXkI
h4kiLgGt7KBMgTr82HCgVwKG8j2DxKwQsGLKBWN3VDKSyLRKhvD/Kzs9TipQIHnN
QJVffzizC1bWR7Mi9qSgGY1GU5j606YdRzPLnT40/miQ71iVh4NkiAdEulsN4Cdv
723eQ57AaCuWJWcGGchNWFb1Q2dcsD1jVnymNo40jQKBgQDY3xaM+1ZibaVLJkub
beylk8Nm30psQD518XavPfYiaf7LQCBPAcbgLREwS+mfTxJJhYOm73c3oo7nrkHC
IyA37Q/1Y96zMEugZhFcAGtCHDJcoeEL04lTxN7YEXyRlsFUtENstv0yxPa4ifo1
YWkkMERLZHb89kHzvvog4eiWEwKBgQDD7YLYpznnMA5KSmiDoEz7+VOe14GBbHi2
8aEM6tsrYH37cfg/TcbGPyMarvQrNbp0LC/ct1jZOnKOIMhgb+K24bfp4LPvimNr
bp1H1hh+IqXi5lQRtLSC7LywP73dB0vPFb9f0J7FG9zRbI/+gCYSHBQ1Ong9CihJ
Zeas6dsOdQKBgQDOouFtuxz389kG3Zo0omxU55HLNv5GXoAlCMk4+CTJbY0kRBmE
rgC8ILS7+9jBvimCfACQ0qIZFH5tKY/mVmmgX/RQr7PFsEKetiHcM1n/R7aEpIk1
J301n+NkpGS4o5faCVglAcYG1bzu4CjTK9lubb7kxvjI1irJADJ7mkRumQKBgCaw
6pv6OhcLiGbnVshXiZxg2kCN8kcqspP+F33Di1B/l6FmGk32AAD6SuZkElfOHmn+
p90AYA1V23Vxx+AzeCQBYx5Of3oYbBW1HF4pS2DtWrD6JzPv6Y3JTmHH1KinXjMg
6k/zlMb7/5ljxPPPPrVo0hzI1SHItbf45ZrT+6xZAoGAVH8m5MK/NKbvpZ7pv6Qw
bhWSPAkQACMZe4EXjz+XXCQEjSGK8u2eLfO1KxDjdMMJhJilmsVK6WPCAuIo0CM+
j2HHq7jyUAXhBjeJ8rRxzgS0wWNXLqh4KMqDc1sZZ/hlaka3eIS4ncwdx30qgdS+
cSv413HIwHPhXJr8MgTAoag=
-----END PRIVATE KEY-----`;

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApfsjjhdQr8ST6uOecabM
o0ZJw3K7EmLIiJVWLkRse3RlxfHMZZmGPC2wKD/vD3gWLaYBXv1iLpCSBWAEjLLn
frYe2W/HOhTGVOgIsMprIc818PZ31orVk0OgCepZU/iy9kribO2yZQmLK1nKBa/U
IrQl4CwEucQFYRgt/CKvGj49SFipKofIgCzJO11GOTvJhpdMJLJFpdt/xmgXXHZo
BVvwIjq4CKmxZoQxRpTuXrFaiNi2E1qRtEYj7H0ABPw7o9YzPNStAhXWUrhWN89q
LtQYEdLs8b4x1RLSvMEFosrLUzMILgtZsy/KydAM7BFemuZ2912BuxYfTPa1pMKg
rwIDAQAB
-----END PUBLIC KEY-----`;

function successfulClient(): MinimalComplianceKmsClient {
  const signature = crypto.sign('sha256', PAYLOAD, {
    key: PRIVATE_KEY,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  });
  return {
    asymmetricSign: vi.fn(async () => [{ signature }]),
    getPublicKey: vi.fn(async () => [{ pem: PUBLIC_KEY }]),
  };
}

describe('signCompliancePayloadWithKms', () => {
  it('sends only the SHA-256 digest to KMS and verifies RSA-PSS locally', async () => {
    const client = successfulClient();
    const result = await signCompliancePayloadWithKms(PAYLOAD, {
      keyVersionName: KEY_VERSION,
      client,
    });

    expect(result.keyVersion).toBe(KEY_VERSION);
    expect(result.signatureB64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(result.publicKeyPem).toBe(PUBLIC_KEY);
    expect(client.asymmetricSign).toHaveBeenCalledWith({
      name: KEY_VERSION,
      digest: { sha256: crypto.createHash('sha256').update(PAYLOAD).digest() },
    });
    expect(client.getPublicKey).toHaveBeenCalledWith({ name: KEY_VERSION });
  });

  it('fails closed when key configuration is absent', async () => {
    await expect(signCompliancePayloadWithKms(PAYLOAD, {
      keyVersionName: '', client: successfulClient(),
    })).rejects.toMatchObject({ code: 'kms_not_configured' });
  });

  it('rejects an empty KMS signature response', async () => {
    const client: MinimalComplianceKmsClient = {
      asymmetricSign: async () => [{}],
      getPublicKey: async () => [{ pem: 'unused' }],
    };
    await expect(signCompliancePayloadWithKms(PAYLOAD, {
      keyVersionName: KEY_VERSION, client,
    })).rejects.toMatchObject({ code: 'kms_invalid_response' });
  });

  it('rejects a signature that does not verify against the returned public key', async () => {
    const client: MinimalComplianceKmsClient = {
      asymmetricSign: async () => [{ signature: Buffer.from('fabricated') }],
      getPublicKey: async () => [{ pem: PUBLIC_KEY }],
    };
    await expect(signCompliancePayloadWithKms(PAYLOAD, {
      keyVersionName: KEY_VERSION, client,
    })).rejects.toMatchObject({ code: 'kms_local_verification_failed' });
  });

  it('maps provider failures without leaking their response into the domain', async () => {
    const client: MinimalComplianceKmsClient = {
      asymmetricSign: async () => { throw new Error('provider secret detail'); },
      getPublicKey: async () => [{ pem: 'unused' }],
    };
    const error = await signCompliancePayloadWithKms(PAYLOAD, {
      keyVersionName: KEY_VERSION, client,
    }).catch((value) => value);
    expect(error).toBeInstanceOf(ComplianceKmsSigningError);
    expect(error.code).toBe('kms_unavailable');
    expect(error.message).not.toContain('provider secret detail');
  });
});
