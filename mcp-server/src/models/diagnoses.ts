export interface DiagnosisRow {
  subject_id: number;
  hadm_id: number | null;
  icd_code: string | null;
  icd_version: number | null;
  long_title: string | null;
}

