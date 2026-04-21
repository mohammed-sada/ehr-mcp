/**
 * LLM-as-Judge
 * ============
 * Scores an agent's free-text answer against the SQL ground truth using an LLM.
 *
 * Why: regex/substring scoring produces frequent false negatives (e.g. scored
 * "The patient is male and his anchor age is 70" as 0% because the expected
 * object has a nested `patient` key the structural scorer couldn't unwrap).
 *
 * Design:
 *  - The judge receives: question, SQL ground truth (as JSON), LLM answer.
 *  - It returns a strict JSON object { score, correct, rationale }.
 *  - Temperature is fixed to 0 for reproducibility.
 *  - Same model family as the agent is used by default (configurable via
 *    OPENROUTER_JUDGE_MODEL). For publication-grade work, use a stronger
 *    / different-family judge to avoid self-preference bias.
 */
import { generateText } from "ai";
import type { LanguageModel } from "ai";

import { logger } from "../utils/logger.js";
import { throttleLlmCall } from "./throttle.js";

export interface JudgeVerdict {
  score: number;      // 0.0 – 1.0, partial credit for lists
  correct: boolean;   // true iff score >= threshold
  rationale: string;  // 1–2 sentences
}

export interface JudgeInput {
  question: string;
  expectedAnswer: unknown;
  llmAnswer: string;
  model: LanguageModel;
  /** Pass threshold for `correct` flag (default 0.8). */
  threshold?: number;
  /** API key used by the judge model — for rate-limit throttling (no-op if delayMs=0). */
  apiKey?: string;
  /** Minimum ms between consecutive judge calls on this key. Default 0 = no throttling. */
  delayMs?: number;
}

const SYSTEM_PROMPT = `You are an expert clinical data evaluator grading an LLM's answer against a known ground truth.

Your job is to judge FACTUAL CORRECTNESS only — ignore formatting, prose style, markdown tables, extra commentary, or units unless they change the meaning.

Scoring rules:
- 1.0 = every expected fact is present AND correct.
- Partial credit for lists/sets: score = (# correct items) / (# expected items).
- Treat equivalent phrasings as matches: "M" = "male", "F" = "female", ISO date "2194-11-19T07:15:00" = "2194-11-19 at 07:15".
- Numeric values match if within ±1% or ±0.1 absolute, whichever is larger.
- If the ground truth is an empty list and the LLM says "no results / none / empty", that is 1.0.
- Do NOT penalise the LLM for providing extra correct information beyond what was asked.
- Do NOT reward confidently wrong numbers; hallucinated values score 0 for that item.

Output format:
Respond with ONLY a single JSON object, no markdown fences, no prose before or after:
{"score": <0.0-1.0>, "correct": <boolean>, "rationale": "<1-2 sentence explanation>"}`;

function buildUserPrompt(
  question: string,
  expectedAnswer: unknown,
  llmAnswer: string,
  threshold: number,
): string {
  const expectedJson = JSON.stringify(expectedAnswer, null, 2);
  return `QUESTION:
${question}

GROUND TRUTH (from SQL query against the MIMIC-IV database):
${expectedJson}

LLM ANSWER:
${llmAnswer}

Pass threshold for "correct": score >= ${threshold}

Evaluate the LLM answer against the ground truth now. Return only the JSON object.`;
}

/** Extract the first balanced JSON object from a string (tolerant to ```json fences etc.). */
function extractJsonObject(text: string): string | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) return fenceMatch[1].trim();

  const start = text.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseVerdict(text: string, threshold: number): JudgeVerdict | null {
  const jsonStr = extractJsonObject(text);
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr) as Partial<JudgeVerdict>;
    const rawScore = typeof parsed.score === "number" ? parsed.score : Number(parsed.score);
    if (!Number.isFinite(rawScore)) return null;
    const score = Math.max(0, Math.min(1, rawScore));
    const correct = typeof parsed.correct === "boolean" ? parsed.correct : score >= threshold;
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale : "";
    return { score, correct, rationale };
  } catch {
    return null;
  }
}

export async function judgeAnswer(input: JudgeInput): Promise<JudgeVerdict> {
  const threshold = input.threshold ?? 0.8;
  const userPrompt = buildUserPrompt(
    input.question,
    input.expectedAnswer,
    input.llmAnswer,
    threshold,
  );

  const attempt = async (extraInstruction?: string): Promise<string> => {
    if (input.apiKey && input.delayMs) {
      await throttleLlmCall(input.apiKey, input.delayMs);
    }
    const result = await generateText({
      model: input.model,
      system: SYSTEM_PROMPT + (extraInstruction ? `\n\n${extraInstruction}` : ""),
      prompt: userPrompt,
      temperature: 0,
      maxTokens: 400,
    });
    return result.text;
  };

  try {
    const text1 = await attempt();
    const v1 = parseVerdict(text1, threshold);
    if (v1) return v1;

    logger.warn("Judge returned unparseable output, retrying with stricter instruction");
    const text2 = await attempt(
      "CRITICAL: your previous response could not be parsed as JSON. " +
      "Respond with ONLY the JSON object on a single line, no markdown, no prose.",
    );
    const v2 = parseVerdict(text2, threshold);
    if (v2) return v2;

    logger.error(`Judge failed to return valid JSON after 2 attempts. Raw: ${text2.slice(0, 200)}`);
    return {
      score: 0,
      correct: false,
      rationale: "Judge failed to return valid JSON after 2 attempts.",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Judge call threw: ${msg}`);
    return {
      score: 0,
      correct: false,
      rationale: `Judge call failed: ${msg}`,
    };
  }
}
