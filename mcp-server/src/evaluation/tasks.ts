import type { EvalTask } from "./types.js";

/**
 * Diabetes cohort – 8 patients selected for diversity:
 *   gender balance, age range 29–78, 1–20 admissions,
 *   Type 1 & Type 2, with and without HbA1c data.
 */
const S = {
  P1: 10014354, // M 60, 20 admissions, 18 HbA1c (6.7–10.2), insulin+metformin, CKD
  P2: 10037928, // F 78, 10 admissions, 17 HbA1c (7.4–12.0), elderly, multi-comorbid
  P3: 10015860, // M 53, 13 admissions, HbA1c up to 13.9, glucose 39–523
  P4: 10019003, // F 65,  8 admissions, rich lab/med data
  P5: 10023239, // F 29,  3 admissions, Type 1 DM with DKA, HbA1c 8.3–10.9
  P6: 10035185, // M 70,  1 admission,  HbA1c 7.7
  P7: 10007795  // F 53,  5 admissions, multiple diabetes complications
} as const;

/** MIMIC-IV lab item IDs relevant to diabetes care. */
const GLUCOSE_ITEMID = 50931;
const HBA1C_ITEMID = 50852;
const CREATININE_ITEMID = 50912;
const POTASSIUM_ITEMID = 50971;

/**
 * 10-task benchmark (subset of an earlier 20-task draft).
 * Original task IDs are preserved so historical reports remain traceable.
 * Selection criteria:
 *   1) each task exercises a distinct skill / tool-composition pattern
 *   2) collectively covers 6 of 7 MCP tools
 *   3) spans simple retrieval, multi-step composition, and clinical reasoning
 */
export const tasks: EvalTask[] = [
  // ─── SIMPLE (3) — single-tool retrieval ──────────────────────────
  {
    id: 1,
    type: "simple",
    subject_id: S.P6,
    question:
      "What is this patient's gender and anchor age?"
  },
  {
    id: 4,
    type: "simple",
    subject_id: S.P2,
    question:
      "What is this patient's latest Hemoglobin A1c (HbA1c, itemid=50852) result?",
    params: { itemid: HBA1C_ITEMID }
  },
  {
    id: 7,
    type: "simple",
    subject_id: S.P5,
    question:
      "List all glycemic-control medications (insulin, metformin, sulfonylureas, DPP-4i, GLP-1 RA, SGLT2i, TZDs) prescribed for this patient, with drug name, route, and start/stop times.",
    params: { limit: 200 }
  },

  // ─── MULTI-STEP (4) — 2+ tool calls ──────────────────────────────
  {
    id: 8,
    type: "multi",
    subject_id: S.P1,
    question:
      "Retrieve the latest values for a diabetes lab panel: serum glucose (itemid=50931), HbA1c (itemid=50852), creatinine (itemid=50912), and potassium (itemid=50971).",
    params: {
      itemids: [GLUCOSE_ITEMID, HBA1C_ITEMID, CREATININE_ITEMID, POTASSIUM_ITEMID]
    }
  },
  {
    id: 9,
    type: "multi",
    subject_id: S.P2,
    question:
      "What are the highest and lowest serum glucose (itemid=50931) values ever recorded for this patient, and when did they occur?",
    params: { itemid: GLUCOSE_ITEMID }
  },
  {
    id: 12,
    type: "multi",
    subject_id: S.P4,
    question:
      "Compare this patient's first and most recent serum creatinine (itemid=50912) values in chronological order. Is the value higher at the end?",
    params: { itemid: CREATININE_ITEMID }
  },
  {
    id: 14,
    type: "multi",
    subject_id: S.P5,
    question:
      "How many total hospital admissions does this patient have, and how many of those admissions include at least one diabetes-related diagnosis (ICD-9 250* or ICD-10 E08–E13)?"
  },

  // ─── REASONING (3) — multi-step + clinical logic ─────────────────
  {
    id: 16,
    type: "reasoning",
    subject_id: S.P1,
    question:
      "What proportion of this patient's serum glucose readings (itemid=50931) exceed 200 mg/dL? Report the count above 200, the total count, and the percentage.",
    params: { itemid: GLUCOSE_ITEMID }
  },
  {
    id: 18,
    type: "reasoning",
    subject_id: S.P4,
    question:
      "Is this patient currently prescribed metformin? Given their gender and latest serum creatinine (itemid=50912), is metformin within safe prescribing limits? (Metformin is generally contraindicated when creatinine exceeds 1.5 mg/dL in males or 1.4 mg/dL in females.)",
    params: { itemid: CREATININE_ITEMID }
  },
  {
    id: 20,
    type: "reasoning",
    subject_id: S.P3,
    question:
      "Retrieve this patient's latest serum glucose (itemid=50931), HbA1c (itemid=50852), and creatinine (itemid=50912). Also list their glycemic-control medications. Then write a brief clinical note summarizing their current metabolic status and save it using the note tool.",
    params: {
      itemids: [GLUCOSE_ITEMID, HBA1C_ITEMID, CREATININE_ITEMID]
    }
  }
];
