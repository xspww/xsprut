import fetch from "node-fetch";
import { errorCode } from "./errorMessage";

export interface FetchOptions {
  retries?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** An error that marks a response as worth another attempt. */
class RetryableHttpError extends Error {
  readonly isHttpRetry = true;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Is this failure worth another attempt? */
function isRetriable(error: unknown): boolean {
  if (error instanceof RetryableHttpError) return true;
  if (typeof error !== "object" || error === null) return false;

  if ("name" in error && error.name === "AbortError") return true;
  const code = errorCode(error);
  if (code === "ECONNRESET" || code === "ETIMEDOUT") return true;
  if ("type" in error && error.type === "system") return true;
  return false;
}

export async function fetchJsonWithRetry<T = unknown>(
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
          throw new RetryableHttpError(`HTTP ${res.status}`);
        }
        // Don't throw for other non-200, just return null so callers can handle it
        return null;
      }

      const data = (await res.json()) as T;
      return data;
    } catch (err) {
      clearTimeout(id);
      const isLast = attempt === retries;

      // For aborts or connection resets/timeouts, retry
      const retriable = isRetriable(err);

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
