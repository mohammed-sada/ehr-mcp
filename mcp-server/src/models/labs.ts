export interface LatestLabResult {
  subject_id: number;
  hadm_id: number | null;
  itemid: number;
  label: string | null;
  charttime: string | null;
  valuenum: number | null;
  valueuom: string | null;
}

export interface LabHistoryRow {
  subject_id: number;
  hadm_id: number | null;
  itemid: number;
  charttime: string | null;
  valuenum: number | null;
  valueuom: string | null;
}

