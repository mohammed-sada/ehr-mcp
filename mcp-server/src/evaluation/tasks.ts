import type { EvalTask } from "./types.js";

// Note: These subject_ids are placeholders for evaluation. If a subject_id does not
// exist in your demo DB, the expected_answer will be null/empty for that task.
const SUBJECTS = [10000032, 10000048, 10000068] as const;

export const tasks: EvalTask[] = [
  // -----------------------
  // Simple (demographics)
  // -----------------------
  {
    id: 1,
    type: "simple",
    subject_id: SUBJECTS[0],
    question: "What is the patient's gender and anchor age?"
  },
  {
    id: 2,
    type: "simple",
    subject_id: SUBJECTS[1],
    question: "List all admissions for this patient (hadm_id, admittime, dischtime) ordered by admittime."
  },
  {
    id: 3,
    type: "simple",
    subject_id: SUBJECTS[2],
    question: "How many admissions does this patient have?"
  },

  // -----------------------
  // Simple (labs)
  // -----------------------
  {
    id: 4,
    type: "simple",
    subject_id: SUBJECTS[0],
    question: "What is the latest Lactate (itemid=50813) value for this patient?",
    params: { itemid: 50813 }
  },
  {
    id: 5,
    type: "simple",
    subject_id: SUBJECTS[1],
    question: "What is the latest Creatinine (itemid=50912) value for this patient?",
    params: { itemid: 50912 }
  },
  {
    id: 6,
    type: "simple",
    subject_id: SUBJECTS[2],
    question: "Return the full lab history for Lactate (itemid=50813) for this patient (limit 200).",
    params: { itemid: 50813, limit: 200 }
  },

  // -----------------------
  // Simple (diagnoses / meds)
  // -----------------------
  {
    id: 7,
    type: "simple",
    subject_id: SUBJECTS[0],
    question: "List all diagnoses (icd_code + title) for this patient."
  },
  {
    id: 8,
    type: "simple",
    subject_id: SUBJECTS[1],
    question: "List this patient's medication history (drug, starttime, stoptime, route) ordered by starttime (limit 200).",
    params: { limit: 200 }
  },

  // -----------------------
  // Multi-step (counts, filtering)
  // -----------------------
  {
    id: 9,
    type: "multi",
    subject_id: SUBJECTS[0],
    question: "For this patient, how many distinct lab itemids are present in labevents?"
  },
  {
    id: 10,
    type: "multi",
    subject_id: SUBJECTS[1],
    question: "For this patient, count the number of lab results (valuenum not null) per itemid. Return top 10 by count."
  },
  {
    id: 11,
    type: "multi",
    subject_id: SUBJECTS[2],
    question: "For this patient, find the maximum Creatinine value (itemid=50912) and when it occurred.",
    params: { itemid: 50912 }
  },
  {
    id: 12,
    type: "multi",
    subject_id: SUBJECTS[0],
    question: "For this patient, list the top 5 most common medications (by drug name count)."
  },
  {
    id: 13,
    type: "multi",
    subject_id: SUBJECTS[1],
    question: "For this patient, list admissions and the number of diagnoses per admission."
  },

  // -----------------------
  // Reasoning-ish (trends/averages; still computed via SQL)
  // -----------------------
  {
    id: 14,
    type: "reasoning",
    subject_id: SUBJECTS[0],
    question: "For this patient, compute the average Lactate (itemid=50813) over time and return (n, avg, min, max).",
    params: { itemid: 50813 }
  },
  {
    id: 15,
    type: "reasoning",
    subject_id: SUBJECTS[1],
    question: "For this patient, determine if Creatinine (itemid=50912) is overall increasing (compare first vs last recorded).",
    params: { itemid: 50912 }
  },
  {
    id: 16,
    type: "reasoning",
    subject_id: SUBJECTS[2],
    question: "For this patient, compute the longest gap (in days) between consecutive admissions."
  },
  {
    id: 17,
    type: "reasoning",
    subject_id: SUBJECTS[0],
    question: "For this patient, compute the trend slope of Lactate (itemid=50813) over time using a simple linear regression on (epoch seconds, valuenum).",
    params: { itemid: 50813 }
  },

  // -----------------------
  // Additional mixed tasks to reach ~20
  // -----------------------
  {
    id: 18,
    type: "multi",
    subject_id: SUBJECTS[1],
    question: "For this patient, return the most recent admission (hadm_id) and its length of stay in hours."
  },
  {
    id: 19,
    type: "simple",
    subject_id: SUBJECTS[2],
    question: "For this patient, return the latest 10 lab events (itemid, charttime, valuenum, valueuom) ordered by charttime desc."
  },
  {
    id: 20,
    type: "reasoning",
    subject_id: SUBJECTS[0],
    question: "For this patient, compute how many unique diagnosis codes (icd_code+icd_version) they have across all admissions."
  }
];

