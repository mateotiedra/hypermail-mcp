export const ACCOUNT_POLL_TIMEOUT_MS = 45_000;

const MISSING_RECEIVED_AT = "1970-01-01T00:00:00.000Z";

export function effectiveReceivedAt(receivedAt: string | undefined): string {
  return normalizeTimestamp(receivedAt) ?? MISSING_RECEIVED_AT;
}

export function normalizeTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function compareTimestamp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export async function withAccountPollTimeout<T>(
  account: string,
  operation: string,
  promise: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${operation} timed out after ${ACCOUNT_POLL_TIMEOUT_MS}ms for account ${account}`,
        ),
      );
    }, ACCOUNT_POLL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
