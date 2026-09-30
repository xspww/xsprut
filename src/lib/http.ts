import fetch from "node-fetch";

export interface FetchOptions {
  retries?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchJsonWithRetry<T = any>(
  url: string,
  options: FetchOptions = {},
): Promise<T | null> {
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 10000;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal, headers: options.headers });
      clearTimeout(id);
      if (!res.ok) {
        if (res.status >= 500 || res.status === 429) {
          const error = new Error(`HTTP ${res.status}`);
          (error as any).isHttpRetry = true;
          throw error;
        }
        // Don't throw for other non-200, just return null so callers can handle it
        return null;
      }

      const data = (await res.json()) as T;
      return data;
    } catch (err: any) {
      clearTimeout(id);
      const isLast = attempt === retries;

      // For aborts or connection resets/timeouts, retry
      const retriable =
        err?.isHttpRetry ||
        err?.name === "AbortError" ||
        err?.code === "ECONNRESET" ||
        err?.code === "ETIMEDOUT" ||
        err?.type === "system";

      if (!retriable || isLast) {
        // If not retriable or no attempts left, rethrow so callers can log or handle
        throw err;
      }

      // small backoff before next retry
      await delay(500 * attempt);
    }
  }

  return null;
}
