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
