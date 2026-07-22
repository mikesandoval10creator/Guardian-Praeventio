export function isHealthVaultSharePath(pathname: string): boolean {
  return pathname.startsWith('/vault/share/');
}

export function shouldRequireCompanyOnboarding(input: {
  hasUser: boolean;
  onboarded: boolean | null;
  pathname: string;
}): boolean {
  return (
    input.hasUser &&
    input.onboarded === false &&
    !input.pathname.startsWith('/onboarding') &&
    !input.pathname.startsWith('/invite') &&
    !input.pathname.startsWith('/login') &&
    !isHealthVaultSharePath(input.pathname)
  );
}

export function safeVaultReturnTo(value: unknown): string {
  return typeof value === 'string' && isHealthVaultSharePath(value) && !value.startsWith('//')
    ? value
    : '/';
}
