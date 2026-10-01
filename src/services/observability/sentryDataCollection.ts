type SentryV10PrivacyDataCollection = {
  userInfo: false;
  cookies: false;
  httpHeaders: {
    request: { deny: string[] };
    response: { deny: string[] };
  };
  httpBodies: [];
  urlQueryParams: { deny: string[] };
  genAI: { inputs: false; outputs: false };
  databaseQueryData: false;
  queues: false;
  graphQL: { document: false; variables: false };
};

/**
 * Sentry v11's documented equivalent of the SDK v10 restrictive defaults.
 * Keep this profile shared by browser and server initialization so a major
 * SDK upgrade cannot silently widen collection on either surface.
 */
export function createSentryV10PrivacyDataCollection(): SentryV10PrivacyDataCollection {
  const denySensitiveNames = (): string[] => ['forwarded', '-ip', 'remote-', 'via', '-user'];
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: {
      request: { deny: denySensitiveNames() },
      response: { deny: denySensitiveNames() },
    },
    httpBodies: [],
    urlQueryParams: { deny: denySensitiveNames() },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    graphQL: { document: false, variables: false },
  };
}
