import type { EvalTask } from "./types.js";

export interface TaskSql {
  text: string;
  values: unknown[];
}

function getNumParam(task: EvalTask, key: string): number | null {
  const v = task.params?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function getLimit(task: EvalTask, fallback: number): number {
  const v = task.params?.limit;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  return fallback;
}

/** Shared SQL fragment: diabetes-related ICD filter. */
const DIABETES_ICD_FILTER = `
  (
    (di.icd_version = 9 AND di.icd_code LIKE '250%')
    OR (
      di.icd_version = 10
      AND (
        di.icd_code LIKE 'E11%' OR di.icd_code LIKE 'E10%' OR di.icd_code LIKE 'E13%'
        OR di.icd_code LIKE 'E08%' OR di.icd_code LIKE 'E09%'
      )
    )
  )
`;

/** Shared SQL fragment: glycemic-control drug filter. */
const GLYCEMIC_DRUG_FILTER = `
  drug IS NOT NULL
  AND (
    drug ILIKE '%insulin%' OR drug ILIKE '%metformin%' OR drug ILIKE '%glipizide%'
    OR drug ILIKE '%glimepiride%' OR drug ILIKE '%glyburide%' OR drug ILIKE '%sitagliptin%'
    OR drug ILIKE '%saxagliptin%' OR drug ILIKE '%linagliptin%' OR drug ILIKE '%liraglutide%'
    OR drug ILIKE '%semaglutide%' OR drug ILIKE '%dulaglutide%' OR drug ILIKE '%exenatide%'
    OR drug ILIKE '%empagliflozin%' OR drug ILIKE '%canagliflozin%' OR drug ILIKE '%dapagliflozin%'
    OR drug ILIKE '%pioglitazone%' OR drug ILIKE '%rosiglitazone%' OR drug ILIKE '%acarbose%'
    OR drug ILIKE '%repaglinide%' OR drug ILIKE '%nateglinide%'
  )
`;

/**
 * Map evaluation task -> SQL query returning a single JSON-friendly row.
 * Convention: queries return ONE row with ONE column named `expected_answer`
 * containing a JSON object/array/value.
 */
export function taskToSql(task: EvalTask): TaskSql {
  const sid = task.subject_id;

  switch (task.id) {
    // ── SIMPLE ────────────────────────────────────────────

    // 1: Patient demographics
    case 1:
      return {
        text: `
          SELECT jsonb_build_object(
            'patient', (
              SELECT jsonb_build_object(
                'subject_id', subject_id,
                'gender', gender,
                'anchor_age', anchor_age
              )
              FROM hosp.patients
              WHERE subject_id = $1
            )
          ) AS expected_answer
        `,
        values: [sid]
      };

    // 4: Latest HbA1c
    case 4: {
      const itemid = getNumParam(task, "itemid");
      return {
        text: `
          SELECT jsonb_build_object(
            'latest_lab', (
              SELECT jsonb_build_object(
                'subject_id', le.subject_id,
                'hadm_id', le.hadm_id,
                'itemid', le.itemid,
                'label', dli.label,
                'charttime', le.charttime,
                'valuenum', le.valuenum,
                'valueuom', le.valueuom
              )
              FROM hosp.labevents le
              LEFT JOIN hosp.d_labitems dli ON dli.itemid = le.itemid
              WHERE le.subject_id = $1
                AND le.itemid = $2
                AND le.valuenum IS NOT NULL
              ORDER BY le.charttime DESC NULLS LAST
              LIMIT 1
            )
          ) AS expected_answer
        `,
        values: [sid, itemid ?? -1]
      };
    }

    // 7: Glycemic-control medications
    case 7: {
      const limit = getLimit(task, 200);
      return {
        text: `
          SELECT COALESCE(
            (
              SELECT jsonb_agg(jsonb_build_object(
                'hadm_id', hadm_id,
                'starttime', starttime,
                'stoptime', stoptime,
                'drug', drug,
                'route', route
              ) ORDER BY starttime ASC NULLS LAST)
              FROM (
                SELECT hadm_id, starttime, stoptime, drug, route
                FROM hosp.prescriptions
                WHERE subject_id = $1
                  AND ${GLYCEMIC_DRUG_FILTER}
                ORDER BY starttime ASC NULLS LAST
                LIMIT $2
              ) t
            ),
            '[]'::jsonb
          ) AS expected_answer
        `,
        values: [sid, limit]
      };
    }

    // ── MULTI-STEP ────────────────────────────────────────

    // 8: Diabetes lab panel (latest glucose, HbA1c, creatinine, potassium)
    case 8:
      return {
        text: `
          SELECT jsonb_build_object(
            'glucose', (
              SELECT jsonb_build_object('valuenum', le.valuenum, 'charttime', le.charttime, 'valueuom', le.valueuom)
              FROM hosp.labevents le
              WHERE le.subject_id = $1 AND le.itemid = 50931 AND le.valuenum IS NOT NULL
              ORDER BY le.charttime DESC NULLS LAST LIMIT 1
            ),
            'hba1c', (
              SELECT jsonb_build_object('valuenum', le.valuenum, 'charttime', le.charttime, 'valueuom', le.valueuom)
              FROM hosp.labevents le
              WHERE le.subject_id = $1 AND le.itemid = 50852 AND le.valuenum IS NOT NULL
              ORDER BY le.charttime DESC NULLS LAST LIMIT 1
            ),
            'creatinine', (
              SELECT jsonb_build_object('valuenum', le.valuenum, 'charttime', le.charttime, 'valueuom', le.valueuom)
              FROM hosp.labevents le
              WHERE le.subject_id = $1 AND le.itemid = 50912 AND le.valuenum IS NOT NULL
              ORDER BY le.charttime DESC NULLS LAST LIMIT 1
            ),
            'potassium', (
              SELECT jsonb_build_object('valuenum', le.valuenum, 'charttime', le.charttime, 'valueuom', le.valueuom)
              FROM hosp.labevents le
              WHERE le.subject_id = $1 AND le.itemid = 50971 AND le.valuenum IS NOT NULL
              ORDER BY le.charttime DESC NULLS LAST LIMIT 1
            )
          ) AS expected_answer
        `,
        values: [sid]
      };

    // 9: Highest and lowest glucose values
    case 9: {
      const itemid = getNumParam(task, "itemid");
      return {
        text: `
          SELECT jsonb_build_object(
            'max_glucose', (
              SELECT jsonb_build_object('valuenum', valuenum, 'charttime', charttime)
              FROM hosp.labevents
              WHERE subject_id = $1 AND itemid = $2 AND valuenum IS NOT NULL
              ORDER BY valuenum DESC NULLS LAST, charttime DESC NULLS LAST
              LIMIT 1
            ),
            'min_glucose', (
              SELECT jsonb_build_object('valuenum', valuenum, 'charttime', charttime)
              FROM hosp.labevents
              WHERE subject_id = $1 AND itemid = $2 AND valuenum IS NOT NULL
              ORDER BY valuenum ASC NULLS LAST, charttime ASC NULLS LAST
              LIMIT 1
            )
          ) AS expected_answer
        `,
        values: [sid, itemid ?? -1]
      };
    }

    // 12: First vs last creatinine
    case 12: {
      const itemid = getNumParam(task, "itemid");
      return {
        text: `
          WITH vals AS (
            SELECT charttime, valuenum
            FROM hosp.labevents
            WHERE subject_id = $1 AND itemid = $2
              AND valuenum IS NOT NULL AND charttime IS NOT NULL
            ORDER BY charttime ASC
          ),
          first_last AS (
            SELECT
              (SELECT valuenum FROM vals ORDER BY charttime ASC  LIMIT 1) AS first_value,
              (SELECT charttime FROM vals ORDER BY charttime ASC  LIMIT 1) AS first_time,
              (SELECT valuenum FROM vals ORDER BY charttime DESC LIMIT 1) AS last_value,
              (SELECT charttime FROM vals ORDER BY charttime DESC LIMIT 1) AS last_time
          )
          SELECT jsonb_build_object(
            'first_value', first_value,
            'first_time', first_time,
            'last_value', last_value,
            'last_time', last_time,
            'increasing', CASE
              WHEN first_value IS NULL OR last_value IS NULL THEN NULL
              ELSE (last_value > first_value)
            END
          ) AS expected_answer
          FROM first_last
        `,
        values: [sid, itemid ?? -1]
      };
    }

    // 14: Total admissions vs admissions with a diabetes diagnosis
    case 14:
      return {
        text: `
          SELECT jsonb_build_object(
            'total_admissions', (
              SELECT COUNT(*)::int FROM hosp.admissions WHERE subject_id = $1
            ),
            'admissions_with_diabetes_dx', (
              SELECT COUNT(DISTINCT di.hadm_id)::int
              FROM hosp.diagnoses_icd di
              WHERE di.subject_id = $1
                AND ${DIABETES_ICD_FILTER}
            )
          ) AS expected_answer
        `,
        values: [sid]
      };

    // ── REASONING ─────────────────────────────────────────

    // 16: Hyperglycemia proportion (glucose > 200)
    case 16: {
      const itemid = getNumParam(task, "itemid");
      return {
        text: `
          WITH stats AS (
            SELECT
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE valuenum > 200)::int AS above_200
            FROM hosp.labevents
            WHERE subject_id = $1 AND itemid = $2 AND valuenum IS NOT NULL
          )
          SELECT jsonb_build_object(
            'total_readings', total,
            'above_200_count', above_200,
            'percentage', CASE WHEN total = 0 THEN 0
              ELSE ROUND((above_200::numeric / total) * 100, 1)
            END
          ) AS expected_answer
          FROM stats
        `,
        values: [sid, itemid ?? -1]
      };
    }

    // 18: Metformin safety check (creatinine + gender threshold)
    case 18: {
      const itemid = getNumParam(task, "itemid");
      return {
        text: `
          WITH patient AS (
            SELECT gender FROM hosp.patients WHERE subject_id = $1
          ),
          latest_cr AS (
            SELECT valuenum
            FROM hosp.labevents
            WHERE subject_id = $1 AND itemid = $2 AND valuenum IS NOT NULL
            ORDER BY charttime DESC NULLS LAST
            LIMIT 1
          ),
          on_metformin AS (
            SELECT EXISTS (
              SELECT 1 FROM hosp.prescriptions
              WHERE subject_id = $1 AND drug ILIKE '%metformin%'
            ) AS prescribed
          )
          SELECT jsonb_build_object(
            'gender', (SELECT gender FROM patient),
            'latest_creatinine', (SELECT valuenum FROM latest_cr),
            'metformin_prescribed', (SELECT prescribed FROM on_metformin),
            'metformin_safe', CASE
              WHEN (SELECT valuenum FROM latest_cr) IS NULL THEN NULL
              WHEN (SELECT gender FROM patient) = 'M'
                THEN (SELECT valuenum FROM latest_cr) <= 1.5
              WHEN (SELECT gender FROM patient) = 'F'
                THEN (SELECT valuenum FROM latest_cr) <= 1.4
              ELSE NULL
            END
          ) AS expected_answer
        `,
        values: [sid, itemid ?? -1]
      };
    }

    // 20: Metabolic status summary (labs + meds; note is free-text, ground truth = structured data)
    case 20:
      return {
        text: `
          SELECT jsonb_build_object(
            'latest_glucose', (
              SELECT jsonb_build_object('valuenum', le.valuenum, 'charttime', le.charttime)
              FROM hosp.labevents le
              WHERE le.subject_id = $1 AND le.itemid = 50931 AND le.valuenum IS NOT NULL
              ORDER BY le.charttime DESC NULLS LAST LIMIT 1
            ),
            'latest_hba1c', (
              SELECT jsonb_build_object('valuenum', le.valuenum, 'charttime', le.charttime)
              FROM hosp.labevents le
              WHERE le.subject_id = $1 AND le.itemid = 50852 AND le.valuenum IS NOT NULL
              ORDER BY le.charttime DESC NULLS LAST LIMIT 1
            ),
            'latest_creatinine', (
              SELECT jsonb_build_object('valuenum', le.valuenum, 'charttime', le.charttime)
              FROM hosp.labevents le
              WHERE le.subject_id = $1 AND le.itemid = 50912 AND le.valuenum IS NOT NULL
              ORDER BY le.charttime DESC NULLS LAST LIMIT 1
            ),
            'glycemic_medications', COALESCE(
              (
                SELECT jsonb_agg(DISTINCT drug ORDER BY drug)
                FROM hosp.prescriptions
                WHERE subject_id = $1 AND ${GLYCEMIC_DRUG_FILTER}
              ),
              '[]'::jsonb
            )
          ) AS expected_answer
        `,
        values: [sid]
      };

    default:
      return {
        text: `SELECT jsonb_build_object('error', 'No SQL mapped for task id') AS expected_answer`,
        values: []
      };
  }
}
