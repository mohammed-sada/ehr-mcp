export interface PatientNoteRow {
  note_id: number;
  subject_id: number;
  body: string;
  created_at: string;
  source: string;
}

export type AddPatientNoteResult =
  | { ok: true; note: PatientNoteRow }
  | { ok: false; error: "unknown_subject" | "invalid_input" };
