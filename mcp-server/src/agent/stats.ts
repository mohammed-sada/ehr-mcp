/**
 * Lightweight summary statistics used by the evaluation runner.
 *
 * All functions are deterministic given the same RNG seed. We use a small
 * seeded PRNG (mulberry32) so bootstrap intervals are reproducible between
 * runs of `npm run eval` without depending on platform RNG.
 */

export interface SummaryStats {
  n: number;
  mean: number;
  /** Sample standard deviation (Bessel-corrected, N-1). 0 when n < 2. */
  std: number;
  /** Bootstrap 95% CI of the mean, [low, high]. */
  ci95: [number, number];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function sampleStd(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const m = mean(values);
  let sq = 0;
  for (const v of values) {
    const d = v - m;
    sq += d * d;
  }
  return Math.sqrt(sq / (n - 1));
}

/**
 * Percentile bootstrap 95% CI of the mean.
 * B resamples with replacement; takes the 2.5th and 97.5th percentiles of
 * the resampled means. For n<2 we degenerate to a zero-width CI at the value.
 */
export function bootstrapMeanCI(
  values: number[],
  B = 1000,
  seed = 0xC0FFEE,
): [number, number] {
  const n = values.length;
  if (n === 0) return [0, 0];
  if (n === 1) return [values[0], values[0]];

  const rng = mulberry32(seed);
  const means = new Array<number>(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += values[Math.floor(rng() * n)];
    }
    means[b] = s / n;
  }
  means.sort((a, b) => a - b);
  const loIdx = Math.floor(0.025 * B);
  const hiIdx = Math.min(B - 1, Math.floor(0.975 * B));
  return [means[loIdx], means[hiIdx]];
}

export function summarize(values: number[]): SummaryStats {
  return {
    n: values.length,
    mean: mean(values),
    std: sampleStd(values),
    ci95: bootstrapMeanCI(values),
  };
}
