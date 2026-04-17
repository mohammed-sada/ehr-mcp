/**
 * Compare model outputs to oracle JSON with normalization (floats, dates, key order).
 */

const DEFAULT_FLOAT_EPS = 1e-5;

function roundFloat(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 1e8) / 1e8;
}

/** Normalize ISO-like timestamps for string comparison. */
function normalizeDateString(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}/.test(t)) {
    return t.replace(" ", "T").slice(0, 19);
  }
  return t;
}

/**
 * Canonicalize for comparison: sort object keys, round numbers, normalize date strings.
 */
export function normalizeForCompare(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return roundFloat(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}/.test(value.trim())) {
      return normalizeDateString(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((x) => normalizeForCompare(x));
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = normalizeForCompare(o[k]);
    }
    return out;
  }
  return value;
}

function numbersClose(a: number, b: number, eps: number): boolean {
  if (a === b) return true;
  const d = Math.abs(a - b);
  if (d <= eps) return true;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return d / scale <= eps;
}

function deepEqualNormalized(e: unknown, a: unknown, eps: number): boolean {
  if (e === null || e === undefined) return e === a;
  if (a === null || a === undefined) return false;

  if (typeof e === "number" && typeof a === "number") {
    return numbersClose(e, a, eps);
  }
  if (typeof e !== typeof a) return false;

  if (Array.isArray(e) && Array.isArray(a)) {
    if (e.length !== a.length) return false;
    for (let i = 0; i < e.length; i++) {
      if (!deepEqualNormalized(e[i], a[i], eps)) return false;
    }
    return true;
  }

  if (typeof e === "object" && typeof a === "object" && !Array.isArray(e) && !Array.isArray(a)) {
    const eo = e as Record<string, unknown>;
    const ao = a as Record<string, unknown>;
    const ek = Object.keys(eo).sort();
    const ak = Object.keys(ao).sort();
    if (ek.length !== ak.length) return false;
    for (let i = 0; i < ek.length; i++) {
      if (ek[i] !== ak[i]) return false;
    }
    for (const k of ek) {
      if (!deepEqualNormalized(eo[k], ao[k], eps)) return false;
    }
    return true;
  }

  return e === a;
}

/** True if normalized expected matches normalized actual. */
export function valuesEqual(expected: unknown, actual: unknown, eps = DEFAULT_FLOAT_EPS): boolean {
  return deepEqualNormalized(normalizeForCompare(expected), normalizeForCompare(actual), eps);
}

export interface TaskScore {
  task_id: number;
  pass: boolean;
  path?: string;
  detail?: string;
}

export interface EvaluationSummary {
  total: number;
  passed: number;
  failed: number;
  tasks: TaskScore[];
}

export function scoreAgainstExpected(taskId: number, expected: unknown, actual: unknown, eps = DEFAULT_FLOAT_EPS): TaskScore {
  const pass = valuesEqual(expected, actual, eps);
  if (pass) return { task_id: taskId, pass: true };
  return {
    task_id: taskId,
    pass: false,
    detail: "Mismatch after normalization"
  };
}

export function summarizeScores(scores: TaskScore[]): EvaluationSummary {
  const passed = scores.filter((s) => s.pass).length;
  return {
    total: scores.length,
    passed,
    failed: scores.length - passed,
    tasks: scores
  };
}
