/**
 * Answer Scorer
 * =============
 * Compares the LLM's text answer to the ground truth expected_answer.
 *
 * Scoring strategy mirrors the paper:
 *  - Exact/numeric tasks:  binary correct/incorrect (score 0 or 1)
 *  - List tasks:           Dice coefficient (partial credit, 0–1)
 *  - Reasoning tasks:      numeric tolerance check (±5% or ±0.01)
 *
 * The LLM returns free text, so we extract numbers/values from the text
 * before comparing. This is robust to different phrasings.
 */

export interface ScoreResult {
  correct: boolean;
  score: number; // 0.0 – 1.0
}

export function scoreAnswer(
  llmText: string,
  expected: unknown,
  taskType: string
): ScoreResult {
  if (expected === null || expected === undefined) {
    // If expected is null, check if LLM indicated no data
    const noData = /no (data|result|record|lab|admission|value)|not found|null|none|empty/i.test(llmText);
    return { correct: noData, score: noData ? 1 : 0 };
  }

  // Array expected → Dice coefficient
  if (Array.isArray(expected)) {
    if (expected.length === 0) {
      const isEmpty = /no (record|result|data|admission|lab|medication)|empty|none|0/i.test(llmText);
      return { correct: isEmpty, score: isEmpty ? 1 : 0 };
    }
    return scoreList(llmText, expected);
  }

  // Object expected → check key values
  if (typeof expected === "object") {
    return scoreObject(llmText, expected as Record<string, unknown>, taskType);
  }

  // Primitive
  return scorePrimitive(llmText, expected);
}

// ─── List scoring (Dice coefficient) ─────────────────────────────────────────

function scoreList(llmText: string, expected: unknown[]): ScoreResult {
  // Extract all meaningful tokens from LLM response
  const llmTokens = extractTokens(llmText);
  const expectedTokens = extractTokens(JSON.stringify(expected));

  if (expectedTokens.size === 0) return { correct: true, score: 1 };

  // Dice = 2 * |intersection| / (|A| + |B|)
  const intersection = new Set([...llmTokens].filter((t) => expectedTokens.has(t)));
  const dice = (2 * intersection.size) / (llmTokens.size + expectedTokens.size);

  return { correct: dice >= 0.8, score: dice };
}

// ─── Object scoring ────────────────────────────────────────────────────────────

function scoreObject(
  llmText: string,
  expected: Record<string, unknown>,
  taskType: string
): ScoreResult {
  const keys = Object.keys(expected);
  let matched = 0;

  for (const key of keys) {
    const val = expected[key];

    if (val === null || val === undefined) {
      // Check LLM acknowledged null/missing
      if (/null|no (data|value|result)|not found|none/i.test(llmText)) matched++;
      continue;
    }

    if (typeof val === "number") {
      if (checkNumberInText(llmText, val)) matched++;
    } else if (typeof val === "boolean") {
      const trueMatch = val === true && /\btrue\b|increasing|yes|higher/i.test(llmText);
      const falseMatch = val === false && /\bfalse\b|not increasing|no|lower|stable/i.test(llmText);
      if (trueMatch || falseMatch) matched++;
    } else if (typeof val === "string") {
      if (llmText.toLowerCase().includes(val.toLowerCase())) matched++;
    } else if (Array.isArray(val)) {
      const { score } = scoreList(llmText, val);
      matched += score;
    }
  }

  const score = keys.length > 0 ? matched / keys.length : 1;
  return { correct: score >= 0.8, score };
}

// ─── Primitive scoring ─────────────────────────────────────────────────────────

function scorePrimitive(llmText: string, expected: unknown): ScoreResult {
  if (typeof expected === "number") {
    const ok = checkNumberInText(llmText, expected);
    return { correct: ok, score: ok ? 1 : 0 };
  }
  if (typeof expected === "boolean") {
    const ok = expected
      ? /true|yes|correct|increasing/i.test(llmText)
      : /false|no|not|decreasing/i.test(llmText);
    return { correct: ok, score: ok ? 1 : 0 };
  }
  const ok = llmText.toLowerCase().includes(String(expected).toLowerCase());
  return { correct: ok, score: ok ? 1 : 0 };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if a number appears in the LLM's text within a ±5% or ±0.01 tolerance.
 */
function checkNumberInText(text: string, expected: number): boolean {
  // Extract all numbers from the text
  const numPattern = /-?\d+(\.\d+)?(e[+-]?\d+)?/gi;
  const found = [...text.matchAll(numPattern)].map((m) => parseFloat(m[0]));

  const tolerance = Math.max(Math.abs(expected) * 0.05, 0.01);

  return found.some((n) => Math.abs(n - expected) <= tolerance);
}

/**
 * Extract meaningful tokens from a string (numbers + significant words).
 * Used for Dice coefficient on list comparisons.
 */
function extractTokens(text: string): Set<string> {
  const tokens = new Set<string>();

  // Numbers (important for lab values, counts, hadm_ids)
  const nums = text.match(/-?\d+(\.\d+)?/g) ?? [];
  for (const n of nums) tokens.add(n);

  // Medical terms and drug names (3+ char words, lowercased)
  const words = text.match(/[a-zA-Z]{3,}/g) ?? [];
  for (const w of words) {
    const lower = w.toLowerCase();
    // Skip common filler words
    if (!STOP_WORDS.has(lower)) tokens.add(lower);
  }

  return tokens;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "this", "that", "with", "from", "are", "was",
  "has", "have", "been", "will", "not", "null", "none", "true", "false",
  "patient", "value", "result", "data", "time", "date", "lab", "item"
]);
