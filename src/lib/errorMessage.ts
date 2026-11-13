/**
 * The message of a thrown value, or undefined when it carries none.
 *
 * `catch (e)` binds `unknown` under `strict`, so reading `e.message` needs a
 * narrowing step. This keeps the log lines and the user-facing replies
 * readable without casting the error back to `any`.
 */
export function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string") return message;
  }
  return undefined;
}

/**
 * The `code` of a thrown value — a Discord error code, a Node errno or a
 * custom marker — or undefined when it has none.
 */
export function errorCode(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "code" in error) {
    return error.code;
  }
  return undefined;
}

/**
 * The `name` of a thrown value — `AbortError`, `TypeError`, … — or undefined
 * when it has none.
 */
export function errorName(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "name" in error) {
    return error.name;
  }
  return undefined;
}

/**
 * Did our own fetch timeout fire?
 *
 * `AbortError` here means "the request did not answer in time", not "the code
 * broke" — it is an expected condition on a slow or unreachable API and must
 * not be reported with a stack trace.
 */
export function isTimeoutError(error: unknown): boolean {
  return errorName(error) === "AbortError";
}
