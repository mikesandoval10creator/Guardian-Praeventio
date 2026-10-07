/**
 * Firestore may briefly return 409 while a prior transaction drains. Retry that
 * conflict twice; fail closed on every other or persistent error so the next test
 * never runs against silently contaminated emulator state.
 */
export async function clearFirestoreProject(
  url: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetcher(url, { method: 'DELETE' });
    if (response.ok) return;

    if (response.status === 409 && attempt < maxAttempts) {
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 50));
      continue;
    }
    const body = (await response.text()).slice(0, 300);
    const detail = `${response.status} ${response.statusText}${body ? `: ${body}` : ''}`;
    throw new Error(
      `firestore-emulator-setup: clear failed after ${attempt}/${maxAttempts} attempts (${detail})`,
    );
  }
}
