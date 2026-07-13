export type TrustProxyEnvironment = Readonly<Record<string, string | undefined>>;
export type TrustProxySetting = false | number;

const TRUST_PROXY_ERROR = 'TRUST_PROXY_HOPS must be 0 or a positive safe integer';

export function resolveTrustProxySetting(
  env: TrustProxyEnvironment = process.env,
): TrustProxySetting {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined) return env.K_SERVICE ? 1 : false;
  if (!/^\d+$/.test(raw)) throw new Error(TRUST_PROXY_ERROR);

  const hops = Number(raw);
  if (!Number.isSafeInteger(hops)) throw new Error(TRUST_PROXY_ERROR);
  return hops === 0 ? false : hops;
}
