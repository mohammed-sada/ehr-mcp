import type { EvalTask } from "./types.js";

// Subject IDs must exist in the loaded DB (diabetes cohort from init/load_data.sql).
const SUBJECTS = [10035185, 10009628, 10016810] as const;

/** MIMIC-IV Chemistry: Glucose (serum). */
const GLUCOSE_ITEMID = 50931;
/** MIMIC-IV Chemistry: Creatinine (renal monitoring in diabetes). */
const CREATININE_ITEMID = 50912;

export const tasks: EvalTask[] = [
  // --- General (not disease-specific; any inpatient record) ---
  {
    id: 1,
    type: "simple",
    subject_id: SUBJECTS[0],
    question:
      "What is this patient's gender and anchor age? (General demographics for chart review.)"
  },
  {
    id: 2,
    type: "simple",
    subject_id: SUBJECTS[1],
    question:
      "List all hospital admissions for this patient (hadm_id, admittime, dischtime) ordered by admittime."
  },
  {
    id: 3,
    type: "simple",
    subject_id: SUBJECTS[2],
    question: "How many inpatient admissions does this patient have in the database?"
  },

  // --- Diabetes-focused: labs (glucose / renal) ---
  {
    id: 4,
    type: "simple",
    subject_id: SUBJECTS[0],
    question:
      "For diabetes monitoring: what is the latest serum glucose (Chemistry Glucose, itemid=50931) measurement and its chart time?",
    params: { itemid: GLUCOSE_ITEMID }
  },
  {
    id: 5,
    type: "simple",
    subject_id: SUBJECTS[1],
    question:
      "What is the latest serum creatinine (itemid=50912)? (Useful for diabetic kidney disease risk.)",
    params: { itemid: CREATININE_ITEMID }
  },
  {
    id: 6,
    type: "simple",
    subject_id: SUBJECTS[2],
    question:
      "Return the serum glucose lab history (itemid=50931) for this patient, ordered by time, limit 200 values.",
    params: { itemid: GLUCOSE_ITEMID, limit: 200 }
  },

  // --- Diabetes-focused: diagnoses & medications ---
  {
    id: 7,
    type: "simple",
    subject_id: SUBJECTS[0],
    question:
      "List all documented diagnoses that indicate diabetes mellitus (ICD-9 codes starting with 250, or ICD-10 E08–E13), with ICD code and long title."
  },
  {
    id: 8,
    type: "simple",
    subject_id: SUBJECTS[1],
    question:
      "List prescription orders that are commonly used for glycemic control (insulin, metformin, sulfonylureas, DPP-4 inhibitors, GLP-1 agonists, SGLT2 inhibitors, TZDs, etc.), with start/stop time and route. Limit 200 rows.",
    params: { limit: 200 }
  },

  // --- General: exploratory labs ---
  {
    id: 9,
    type: "multi",
    subject_id: SUBJECTS[0],
    question:
      "How many distinct lab itemids does this patient have at least one numeric result for? (General lab breadth.)"
  },
  {
    id: 10,
    type: "multi",
    subject_id: SUBJECTS[1],
    question:
      "Count lab results per itemid and return the top 10 itemids by number of measurements."
  },

  // --- Diabetes-focused: glucose extremes & antidiabetic drug usage patterns ---
  {
    id: 11,
    type: "multi",
    subject_id: SUBJECTS[2],
    question:
      "Find the highest serum glucose value (itemid=50931) for this patient and the time it occurred.",
    params: { itemid: GLUCOSE_ITEMID }
  },
  {
    id: 12,
    type: "multi",
    subject_id: SUBJECTS[0],
    question:
      "Among diabetes-related medications (same drug classes as glycemic-control prescriptions), what are the five most frequently ordered distinct drug names?"
  },
  {
    id: 13,
    type: "multi",
    subject_id: SUBJECTS[1],
    question:
      "For each admission, how many diagnosis rows are recorded? (General: admission-level diagnosis density.)"
  },

  // --- Diabetes-focused: glucose trends & renal trajectory ---
  {
    id: 14,
    type: "reasoning",
    subject_id: SUBJECTS[0],
    question:
      "Summarize serum glucose (itemid=50931): sample count, mean, min, and max across all available measurements.",
    params: { itemid: GLUCOSE_ITEMID }
  },
  {
    id: 15,
    type: "reasoning",
    subject_id: SUBJECTS[1],
    question:
      "Compare first vs last serum creatinine (itemid=50912) in time order; is the value higher at the end than at the start?",
    params: { itemid: CREATININE_ITEMID }
  },
  {
    id: 16,
    type: "reasoning",
    subject_id: SUBJECTS[2],
    question:
      "What is the longest gap in days between consecutive admissions? (General care continuity.)"
  },
  {
    id: 17,
    type: "reasoning",
    subject_id: SUBJECTS[0],
    question:
      "Fit a simple linear regression of serum glucose (itemid=50931) vs time (epoch seconds); report slope and sample size.",
    params: { itemid: GLUCOSE_ITEMID }
  },

  // --- Mixed ---
  {
    id: 18,
    type: "multi",
    subject_id: SUBJECTS[1],
    question:
      "For the most recent admission only, return hadm_id, admit/discharge times, and length of stay in hours."
  },
  {
    id: 19,
    type: "simple",
    subject_id: SUBJECTS[2],
    question:
      "Return the 10 most recent lab events of any type (itemid, charttime, valuenum, valueuom), newest first."
  },
  {
    id: 20,
    type: "reasoning",
    subject_id: SUBJECTS[0],
    question:
      "How many distinct diabetes mellitus ICD codes (ICD-9 250* or ICD-10 E08–E13) are documented for this patient across all admissions?"
  }
];
