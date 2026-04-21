/**
 * Per-key rate limiter for LLM calls.
 *
 * Problem: free-tier OpenRouter keys are limited to a few requests per
 * minute. One evaluation "trial" fires 1 initial agent call + up to N
 * multi-step agent calls + 1 judge call, so a --repeats 5 run over 10
 * tasks can easily burst 200+ calls and trip 429s.
 *
 * Solution: a simple global map of `apiKey -> nextAllowedTime` that forces
 * at least `delayMs` of spacing between consecutive calls using the same
 * key. Calls using a *different* key are independent, so running the
 * judge on a separate OPENROUTER_API_KEY_JUDGE gives you two independent
 * rate budgets.
 *
 * Notes:
 *  - The "slot" is reserved synchronously before awaiting, so interleaved
 *    callers queue correctly without races.
 *  - Keyed by a short hash of the API key so we don't keep the raw secret
 *    in a module-level map longer than necessary (defence in depth).
 */

const nextAllowedAtByKey = new Map<string, number>();

function hashKey(apiKey: string): string {
  let h = 0;
  for (let i = 0; i < apiKey.length; i++) {
    h = (Math.imul(31, h) + apiKey.charCodeAt(i)) | 0;
  }
  return String(h);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reserve a slot for the given API key, waiting until at least `delayMs`
 * have elapsed since the previously reserved slot for this key.
 *
 * `delayMs <= 0` is a no-op (throttling disabled).
 */
export async function throttleLlmCall(apiKey: string, delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  const k = hashKey(apiKey);
  const now = Date.now();
  const prev = nextAllowedAtByKey.get(k) ?? 0;
  const scheduled = Math.max(now, prev);
  // Reserve the slot *before* sleeping so concurrent callers queue up.
  nextAllowedAtByKey.set(k, scheduled + delayMs);
  const wait = scheduled - now;
  if (wait > 0) await sleep(wait);
}

/** Reset throttle state — test-only. */
export function __resetThrottle(): void {
  nextAllowedAtByKey.clear();
}
