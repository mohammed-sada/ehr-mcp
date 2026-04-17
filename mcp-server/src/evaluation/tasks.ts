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
  P7: 10007795, // F 53,  5 admissions, multiple diabetes complications
  P8: 10009628  // M 58,  1 admission,  simpler case
} as const;

/** MIMIC-IV lab item IDs relevant to diabetes care. */
const GLUCOSE_ITEMID = 50931;
const HBA1C_ITEMID = 50852;
const CREATININE_ITEMID = 50912;
const POTASSIUM_ITEMID = 50971;

export const tasks: EvalTask[] = [
  // ──────────────────────────────────────────────────────────
  // SIMPLE  (7 tasks) – single MCP tool call expected
  // ──────────────────────────────────────────────────────────
  {
    id: 1,
    type: "simple",
    subject_id: S.P6,
    question:
      "What is this patient's gender and anchor age?"
  },
  {
    id: 2,
    type: "simple",
    subject_id: S.P1,
    question:
      "List all hospital admissions for this patient (hadm_id, admittime, dischtime) ordered by admittime."
  },
  {
    id: 3,
    type: "simple",
    subject_id: S.P8,
    question:
      "What is the most recent serum glucose (itemid=50931) value and when was it recorded?",
    params: { itemid: GLUCOSE_ITEMID }
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
    id: 5,
    type: "simple",
    subject_id: S.P3,
    question:
      "What is the latest serum creatinine (itemid=50912) for this patient?",
    params: { itemid: CREATININE_ITEMID }
  },
  {
    id: 6,
    type: "simple",
    subject_id: S.P7,
    question:
      "List all diabetes-related ICD diagnoses (ICD-9 250* or ICD-10 E08–E13) documented for this patient, with ICD code and long title."
  },
  {
    id: 7,
    type: "simple",
    subject_id: S.P5,
    question:
      "List all glycemic-control medications (insulin, metformin, sulfonylureas, DPP-4i, GLP-1 RA, SGLT2i, TZDs) prescribed for this patient, with drug name, route, and start/stop times.",
    params: { limit: 200 }
  },

  // ──────────────────────────────────────────────────────────
  // MULTI-STEP  (7 tasks) – 2+ tool calls expected
  // ──────────────────────────────────────────────────────────
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
    id: 10,
    type: "multi",
    subject_id: S.P3,
    question:
      "Does this patient have documented diagnoses for any of the following diabetes comorbidities: chronic kidney disease, hypertension, or cardiovascular/heart disease? List which ones are present."
  },
  {
    id: 11,
    type: "multi",
    subject_id: S.P1,
    question:
      "What distinct insulin formulations (drug names) and routes of administration have been used for this patient?"
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
    id: 13,
    type: "multi",
    subject_id: S.P7,
    question:
      "For the most recent admission, what is the length of stay in hours (from admittime to dischtime)?"
  },
  {
    id: 14,
    type: "multi",
    subject_id: S.P5,
    question:
      "How many total hospital admissions does this patient have, and how many of those admissions include at least one diabetes-related diagnosis (ICD-9 250* or ICD-10 E08–E13)?"
  },

  // ──────────────────────────────────────────────────────────
  // REASONING  (6 tasks) – multi-step + clinical logic
  // ──────────────────────────────────────────────────────────
  {
    id: 15,
    type: "reasoning",
    subject_id: S.P2,
    question:
      "Review the serum glucose history (itemid=50931) for this patient. How many readings fall below 70 mg/dL, indicating hypoglycemic episodes?",
    params: { itemid: GLUCOSE_ITEMID }
  },
  {
    id: 16,
    type: "reasoning",
    subject_id: S.P1,
    question:
      "What proportion of this patient's serum glucose readings (itemid=50931) exceed 200 mg/dL? Report the count above 200, the total count, and the percentage.",
    params: { itemid: GLUCOSE_ITEMID }
  },
  {
    id: 17,
    type: "reasoning",
    subject_id: S.P6,
    question:
      "Summarize this patient's serum glucose (itemid=50931) values: report the total number of readings, mean, minimum, and maximum.",
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
    id: 19,
    type: "reasoning",
    subject_id: S.P1,
    question:
      "How many distinct diabetes-related ICD codes (ICD-9 250* or ICD-10 E08–E13) are documented for this patient across all admissions?"
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
