export interface MedicationRow {
  subject_id: number;
  hadm_id: number | null;
  starttime: string | null;
  stoptime: string | null;
  drug: string | null;
  route: string | null;
  dose_val_rx: string | null;
  dose_unit_rx: string | null;
}

