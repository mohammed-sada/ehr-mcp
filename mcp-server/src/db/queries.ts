import { pool } from "./index.js";
import type { PatientInfoResponse } from "../models/patient.js";
import type {
  LatestLabResult,
  LabHistoryRow
} from "../models/labs.js";
import type { DiagnosisRow } from "../models/diagnoses.js";
import type { MedicationRow } from "../models/medications.js";
import type { AddPatientNoteResult, PatientNoteRow } from "../models/patientNote.js";

/** Same glycemic filter as `evaluation/sql.ts` (task 8 / 12). */
const GLYCEMIC_PRESCRIPTION_SQL = `
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

export async function getPatientInfo(subjectId: number): Promise<PatientInfoResponse> {
  const patient = await pool.query<{
    subject_id: number;
    gender: string | null;
    anchor_age: number | null;
  }>(
    `
    SELECT subject_id, gender, anchor_age
    FROM hosp.patients
    WHERE subject_id = $1
    `,
    [subjectId]
  );

  const admissions = await pool.query<{
    hadm_id: number;
    admittime: string | null;
    dischtime: string | null;
  }>(
    `
    SELECT hadm_id, admittime::text as admittime, dischtime::text as dischtime
    FROM hosp.admissions
    WHERE subject_id = $1
    ORDER BY admittime NULLS LAST
    `,
    [subjectId]
  );

  return {
    patient: patient.rows[0] ?? null,
    admissions: admissions.rows
  };
}

export async function getLatestLab(subjectId: number, itemid: number): Promise<LatestLabResult | null> {
  const r = await pool.query<LatestLabResult>(
    `
    SELECT
      le.subject_id,
      le.hadm_id,
      le.itemid,
      dli.label,
      le.charttime::text as charttime,
      le.valuenum,
      le.valueuom
    FROM hosp.labevents le
    LEFT JOIN hosp.d_labitems dli ON dli.itemid = le.itemid
    WHERE le.subject_id = $1
      AND le.itemid = $2
      AND le.valuenum IS NOT NULL
    ORDER BY le.charttime DESC NULLS LAST
    LIMIT 1
    `,
    [subjectId, itemid]
  );
  return r.rows[0] ?? null;
}

export async function getLabHistory(subjectId: number, itemid: number, limit = 5000): Promise<LabHistoryRow[]> {
  const r = await pool.query<LabHistoryRow>(
    `
    SELECT
      subject_id,
      hadm_id,
      itemid,
      charttime::text as charttime,
      valuenum,
      valueuom
    FROM hosp.labevents
    WHERE subject_id = $1
      AND itemid = $2
      AND valuenum IS NOT NULL
    ORDER BY charttime ASC NULLS LAST
    LIMIT $3
    `,
    [subjectId, itemid, limit]
  );
  return r.rows;
}

export async function getDiagnoses(subjectId: number): Promise<DiagnosisRow[]> {
  const r = await pool.query<DiagnosisRow>(
    `
    SELECT
      di.subject_id,
      di.hadm_id,
      di.icd_code,
      di.icd_version,
      did.long_title
    FROM hosp.diagnoses_icd di
    LEFT JOIN hosp.d_icd_diagnoses did
      ON did.icd_code = di.icd_code
     AND did.icd_version = di.icd_version
    WHERE di.subject_id = $1
    ORDER BY di.hadm_id NULLS LAST, di.seq_num NULLS LAST
    `,
    [subjectId]
  );
  return r.rows;
}

export type PrescriptionFilter = "all" | "glycemic";

export async function getMedications(
  subjectId: number,
  limit = 5000,
  options?: { prescriptionFilter?: PrescriptionFilter }
): Promise<MedicationRow[]> {
  const filter = options?.prescriptionFilter ?? "all";
  const whereGlycemic = filter === "glycemic" ? `AND (${GLYCEMIC_PRESCRIPTION_SQL})` : "";
  const r = await pool.query<MedicationRow>(
    `
    SELECT
      subject_id,
      hadm_id,
      starttime::text as starttime,
      stoptime::text as stoptime,
      drug,
      route,
      dose_val_rx,
      dose_unit_rx
    FROM hosp.prescriptions
    WHERE subject_id = $1
    ${whereGlycemic}
    ORDER BY starttime ASC NULLS LAST
    LIMIT $2
    `,
    [subjectId, limit]
  );
  return r.rows;
}

/** Append a clinician/AI note for a patient (must exist in cohort). */
export async function addPatientNote(
  subjectId: number,
  body: string,
  source = "mcp"
): Promise<AddPatientNoteResult> {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, error: "invalid_input" };
  }
  const r = await pool.query<PatientNoteRow>(
    `
    INSERT INTO hosp.notes (subject_id, body, source)
    SELECT $1::int, $2::text, $3::text
    WHERE EXISTS (SELECT 1 FROM hosp.patients p WHERE p.subject_id = $1::int)
    RETURNING note_id, subject_id, body, created_at::text AS created_at, source
    `,
    [subjectId, trimmed, source]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, error: "unknown_subject" };
  return {
    ok: true,
    note: {
      ...row,
      note_id: Number(row.note_id)
    }
  };
}

export async function listPatientNotes(subjectId: number, limit = 100): Promise<PatientNoteRow[]> {
  const r = await pool.query<PatientNoteRow>(
    `
    SELECT note_id, subject_id, body, created_at::text AS created_at, source
    FROM hosp.notes
    WHERE subject_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [subjectId, Math.min(limit, 500)]
  );
  return r.rows.map((row) => ({
    ...row,
    note_id: Number(row.note_id)
  }));
}

