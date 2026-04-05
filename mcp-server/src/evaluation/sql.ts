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

/**
 * Map evaluation task -> SQL query returning a single JSON-friendly row.
 * Convention: queries should return ONE row with ONE column named `expected_answer`
 * containing a JSON object/array/value.
 */
export function taskToSql(task: EvalTask): TaskSql {
  const sid = task.subject_id;

  switch (task.id) {
    case 1:
      return {
        text: `
          SELECT jsonb_build_object(
            'patient', (
              SELECT jsonb_build_object('subject_id', subject_id, 'gender', gender, 'anchor_age', anchor_age)
              FROM hosp.patients
              WHERE subject_id = $1
            )
          ) AS expected_answer
        `,
        values: [sid]
      };

    case 2:
      return {
        text: `
          SELECT COALESCE(
            (
              SELECT jsonb_agg(jsonb_build_object(
                'hadm_id', hadm_id,
                'admittime', admittime,
                'dischtime', dischtime
              ) ORDER BY admittime NULLS LAST)
              FROM hosp.admissions
              WHERE subject_id = $1
            ),
            '[]'::jsonb
          ) AS expected_answer
        `,
        values: [sid]
      };

    case 3:
      return {
        text: `
          SELECT jsonb_build_object(
            'admissions_count', COALESCE((SELECT COUNT(*) FROM hosp.admissions WHERE subject_id = $1), 0)
          ) AS expected_answer
        `,
        values: [sid]
      };

    case 4:
    case 5: {
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

    case 6: {
      const itemid = getNumParam(task, "itemid");
      const limit = getLimit(task, 200);
      return {
        text: `
          SELECT COALESCE(
            (
              SELECT jsonb_agg(jsonb_build_object(
                'charttime', charttime,
                'valuenum', valuenum,
                'valueuom', valueuom,
                'hadm_id', hadm_id
              ) ORDER BY charttime ASC NULLS LAST)
              FROM (
                SELECT charttime, valuenum, valueuom, hadm_id
                FROM hosp.labevents
                WHERE subject_id = $1 AND itemid = $2 AND valuenum IS NOT NULL
                ORDER BY charttime ASC NULLS LAST
                LIMIT $3
              ) t
            ),
            '[]'::jsonb
          ) AS expected_answer
        `,
        values: [sid, itemid ?? -1, limit]
      };
    }

    case 7:
      // Diabetes mellitus diagnoses only (ICD-9 250*; ICD-10 E08–E13).
      return {
        text: `
          SELECT COALESCE(
            (
              SELECT jsonb_agg(jsonb_build_object(
                'hadm_id', di.hadm_id,
                'icd_code', di.icd_code,
                'icd_version', di.icd_version,
                'long_title', did.long_title
              ) ORDER BY di.hadm_id NULLS LAST, di.seq_num NULLS LAST)
              FROM hosp.diagnoses_icd di
              LEFT JOIN hosp.d_icd_diagnoses did
                ON did.icd_code = di.icd_code
               AND did.icd_version = di.icd_version
              WHERE di.subject_id = $1
                AND (
                  (di.icd_version = 9 AND di.icd_code LIKE '250%')
                  OR (
                    di.icd_version = 10
                    AND (
                      di.icd_code LIKE 'E11%' OR di.icd_code LIKE 'E10%' OR di.icd_code LIKE 'E13%'
                      OR di.icd_code LIKE 'E08%' OR di.icd_code LIKE 'E09%'
                    )
                  )
                )
            ),
            '[]'::jsonb
          ) AS expected_answer
        `,
        values: [sid]
      };

    case 8: {
      const limit = getLimit(task, 200);
      // Diabetes-related medications (common oral agents, insulin, incretins, SGLT2, etc.).
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
                  AND drug IS NOT NULL
                  AND (
                    drug ILIKE '%insulin%' OR drug ILIKE '%metformin%' OR drug ILIKE '%glipizide%'
                    OR drug ILIKE '%glimepiride%' OR drug ILIKE '%glyburide%' OR drug ILIKE '%sitagliptin%'
                    OR drug ILIKE '%saxagliptin%' OR drug ILIKE '%linagliptin%' OR drug ILIKE '%liraglutide%'
                    OR drug ILIKE '%semaglutide%' OR drug ILIKE '%dulaglutide%' OR drug ILIKE '%exenatide%'
                    OR drug ILIKE '%empagliflozin%' OR drug ILIKE '%canagliflozin%' OR drug ILIKE '%dapagliflozin%'
                    OR drug ILIKE '%pioglitazone%' OR drug ILIKE '%rosiglitazone%' OR drug ILIKE '%acarbose%'
                    OR drug ILIKE '%repaglinide%' OR drug ILIKE '%nateglinide%'
                  )
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

    case 9:
      return {
        text: `
          SELECT jsonb_build_object(
            'distinct_itemids', COALESCE(
              (SELECT COUNT(DISTINCT itemid) FROM hosp.labevents WHERE subject_id = $1),
              0
            )
          ) AS expected_answer
        `,
        values: [sid]
      };

    case 10:
      return {
        text: `
          SELECT COALESCE(
            (
              SELECT jsonb_agg(jsonb_build_object(
                'itemid', itemid,
                'count', n
              ) ORDER BY n DESC, itemid)
              FROM (
                SELECT itemid, COUNT(*)::int AS n
                FROM hosp.labevents
                WHERE subject_id = $1 AND valuenum IS NOT NULL
                GROUP BY itemid
                ORDER BY n DESC
                LIMIT 10
              ) t
            ),
            '[]'::jsonb
          ) AS expected_answer
        `,
        values: [sid]
      };

    case 11: {
      const itemid = getNumParam(task, "itemid");
      return {
        text: `
          SELECT jsonb_build_object(
            'max_lab', (
              SELECT jsonb_build_object(
                'itemid', itemid,
                'max_valuenum', valuenum,
                'charttime', charttime
              )
              FROM hosp.labevents
              WHERE subject_id = $1 AND itemid = $2 AND valuenum IS NOT NULL
              ORDER BY valuenum DESC NULLS LAST, charttime DESC NULLS LAST
              LIMIT 1
            )
          ) AS expected_answer
        `,
        values: [sid, itemid ?? -1]
      };
    }

    case 12:
      // Top 5 diabetes-related drugs by frequency (same drug filter as task 8).
      return {
        text: `
          SELECT COALESCE(
            (
              SELECT jsonb_agg(jsonb_build_object('drug', drug, 'count', n) ORDER BY n DESC, drug)
              FROM (
                SELECT COALESCE(drug, '') AS drug, COUNT(*)::int AS n
                FROM hosp.prescriptions
                WHERE subject_id = $1
                  AND drug IS NOT NULL
                  AND (
                    drug ILIKE '%insulin%' OR drug ILIKE '%metformin%' OR drug ILIKE '%glipizide%'
                    OR drug ILIKE '%glimepiride%' OR drug ILIKE '%glyburide%' OR drug ILIKE '%sitagliptin%'
                    OR drug ILIKE '%saxagliptin%' OR drug ILIKE '%linagliptin%' OR drug ILIKE '%liraglutide%'
                    OR drug ILIKE '%semaglutide%' OR drug ILIKE '%dulaglutide%' OR drug ILIKE '%exenatide%'
                    OR drug ILIKE '%empagliflozin%' OR drug ILIKE '%canagliflozin%' OR drug ILIKE '%dapagliflozin%'
                    OR drug ILIKE '%pioglitazone%' OR drug ILIKE '%rosiglitazone%' OR drug ILIKE '%acarbose%'
                    OR drug ILIKE '%repaglinide%' OR drug ILIKE '%nateglinide%'
                  )
                GROUP BY COALESCE(drug, '')
                ORDER BY n DESC
                LIMIT 5
              ) t
            ),
            '[]'::jsonb
          ) AS expected_answer
        `,
        values: [sid]
      };

    case 13:
      return {
        text: `
          SELECT COALESCE(
            (
              SELECT jsonb_agg(jsonb_build_object(
                'hadm_id', a.hadm_id,
                'admittime', a.admittime,
                'diagnoses_count', COALESCE(d.cnt, 0)
              ) ORDER BY a.admittime NULLS LAST)
              FROM hosp.admissions a
              LEFT JOIN (
                SELECT hadm_id, COUNT(*)::int AS cnt
                FROM hosp.diagnoses_icd
                WHERE subject_id = $1
                GROUP BY hadm_id
              ) d ON d.hadm_id = a.hadm_id
              WHERE a.subject_id = $1
            ),
            '[]'::jsonb
          ) AS expected_answer
        `,
        values: [sid]
      };

    case 14: {
      const itemid = getNumParam(task, "itemid");
      return {
        text: `
          SELECT jsonb_build_object(
            'n', COALESCE((SELECT COUNT(*) FROM hosp.labevents WHERE subject_id=$1 AND itemid=$2 AND valuenum IS NOT NULL), 0),
            'avg', (SELECT AVG(valuenum) FROM hosp.labevents WHERE subject_id=$1 AND itemid=$2 AND valuenum IS NOT NULL),
            'min', (SELECT MIN(valuenum) FROM hosp.labevents WHERE subject_id=$1 AND itemid=$2 AND valuenum IS NOT NULL),
            'max', (SELECT MAX(valuenum) FROM hosp.labevents WHERE subject_id=$1 AND itemid=$2 AND valuenum IS NOT NULL)
          ) AS expected_answer
        `,
        values: [sid, itemid ?? -1]
      };
    }

    case 15: {
      const itemid = getNumParam(task, "itemid");
      return {
        text: `
          WITH vals AS (
            SELECT charttime, valuenum
            FROM hosp.labevents
            WHERE subject_id=$1 AND itemid=$2 AND valuenum IS NOT NULL AND charttime IS NOT NULL
            ORDER BY charttime ASC
          ),
          first_last AS (
            SELECT
              (SELECT valuenum FROM vals ORDER BY charttime ASC LIMIT 1) AS first_value,
              (SELECT valuenum FROM vals ORDER BY charttime DESC LIMIT 1) AS last_value
          )
          SELECT jsonb_build_object(
            'first_value', first_value,
            'last_value', last_value,
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

    case 16:
      return {
        text: `
          WITH admits AS (
            SELECT admittime
            FROM hosp.admissions
            WHERE subject_id = $1 AND admittime IS NOT NULL
            ORDER BY admittime ASC
          ),
          gaps AS (
            SELECT
              EXTRACT(EPOCH FROM (admittime - LAG(admittime) OVER (ORDER BY admittime))) / 86400.0 AS gap_days
            FROM admits
          )
          SELECT jsonb_build_object(
            'max_gap_days', (SELECT MAX(gap_days) FROM gaps)
          ) AS expected_answer
        `,
        values: [sid]
      };

    case 17: {
      const itemid = getNumParam(task, "itemid");
      return {
        text: `
          WITH pts AS (
            SELECT
              EXTRACT(EPOCH FROM charttime) AS x,
              valuenum AS y
            FROM hosp.labevents
            WHERE subject_id=$1 AND itemid=$2 AND valuenum IS NOT NULL AND charttime IS NOT NULL
          ),
          agg AS (
            SELECT
              COUNT(*)::float AS n,
              SUM(x) AS sum_x,
              SUM(y) AS sum_y,
              SUM(x*y) AS sum_xy,
              SUM(x*x) AS sum_xx
            FROM pts
          )
          SELECT jsonb_build_object(
            'n', n::int,
            'slope', CASE
              WHEN n < 2 THEN NULL
              WHEN (n*sum_xx - sum_x*sum_x) = 0 THEN NULL
              ELSE (n*sum_xy - sum_x*sum_y) / (n*sum_xx - sum_x*sum_x)
            END
          ) AS expected_answer
          FROM agg
        `,
        values: [sid, itemid ?? -1]
      };
    }

    case 18:
      return {
        text: `
          WITH last_adm AS (
            SELECT hadm_id, admittime, dischtime
            FROM hosp.admissions
            WHERE subject_id = $1
            ORDER BY admittime DESC NULLS LAST
            LIMIT 1
          )
          SELECT jsonb_build_object(
            'hadm_id', hadm_id,
            'admittime', admittime,
            'dischtime', dischtime,
            'los_hours', CASE
              WHEN admittime IS NULL OR dischtime IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (dischtime - admittime)) / 3600.0
            END
          ) AS expected_answer
          FROM last_adm
        `,
        values: [sid]
      };

    case 19:
      return {
        text: `
          SELECT COALESCE(
            (
              SELECT jsonb_agg(jsonb_build_object(
                'itemid', itemid,
                'charttime', charttime,
                'valuenum', valuenum,
                'valueuom', valueuom,
                'hadm_id', hadm_id
              ) ORDER BY charttime DESC NULLS LAST)
              FROM (
                SELECT itemid, charttime, valuenum, valueuom, hadm_id
                FROM hosp.labevents
                WHERE subject_id = $1
                ORDER BY charttime DESC NULLS LAST
                LIMIT 10
              ) t
            ),
            '[]'::jsonb
          ) AS expected_answer
        `,
        values: [sid]
      };

    case 20:
      // Distinct diabetes-related ICD codes documented for this patient.
      return {
        text: `
          SELECT jsonb_build_object(
            'unique_diagnosis_codes',
            COALESCE(
              (
                SELECT COUNT(DISTINCT (icd_code, icd_version))
                FROM hosp.diagnoses_icd di
                WHERE di.subject_id = $1
                  AND (
                    (di.icd_version = 9 AND di.icd_code LIKE '250%')
                    OR (
                      di.icd_version = 10
                      AND (
                        di.icd_code LIKE 'E11%' OR di.icd_code LIKE 'E10%' OR di.icd_code LIKE 'E13%'
                        OR di.icd_code LIKE 'E08%' OR di.icd_code LIKE 'E09%'
                      )
                    )
                  )
              ),
              0
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

