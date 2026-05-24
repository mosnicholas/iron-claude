/**
 * Async waiters — polling helpers for "eventually" assertions. Tests use
 * these to wait for the inbox worker / pg-boss to do their thing without
 * sleeping arbitrarily.
 */

export interface WaitOpts {
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Human label for the failure message. */
  label?: string;
}

/**
 * Resolve once `predicate()` returns truthy. Throws if the timeout elapses.
 * The returned value is whatever `predicate` returned on success — handy for
 * destructuring the row you were waiting for.
 */
export async function eventually<T>(
  predicate: () => Promise<T | undefined | null | false> | T | undefined | null | false,
  opts: WaitOpts = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;

  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value as T;
    } catch (err) {
      lastErr = err;
    }
    await sleep(pollIntervalMs);
  }

  const labelPart = opts.label ? ` (${opts.label})` : "";
  const errPart = lastErr ? `: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` : "";
  throw new Error(`eventually${labelPart} timed out after ${timeoutMs}ms${errPart}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
