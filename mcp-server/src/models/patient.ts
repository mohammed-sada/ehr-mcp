export interface PatientInfo {
  subject_id: number;
  gender: string | null;
  anchor_age: number | null;
}

export interface AdmissionSummary {
  hadm_id: number;
  admittime: string | null;
  dischtime: string | null;
}

export interface PatientInfoResponse {
  patient: PatientInfo | null;
  admissions: AdmissionSummary[];
}

