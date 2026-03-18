-- Query-oriented indexes for MVP clinical queries.
--
-- Important: Docker executes all .sql files in /docker-entrypoint-initdb.d in filename order.
-- To make initialization robust, we orchestrate here:
--   1) create schema/tables
--   2) load data
--   3) create indexes

\i /docker-entrypoint-initdb.d/schema.sql
\i /docker-entrypoint-initdb.d/load_data.sql

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM hosp._init_status WHERE name = 'indexes') THEN
    RAISE NOTICE 'Skipping indexes.sql (already ran).';
    RETURN;
  END IF;
END
$$;

-- patients
CREATE INDEX IF NOT EXISTS idx_patients_subject_id ON hosp.patients (subject_id);

-- admissions
CREATE INDEX IF NOT EXISTS idx_admissions_subject_id ON hosp.admissions (subject_id);

-- labevents
CREATE INDEX IF NOT EXISTS idx_labevents_subject_id ON hosp.labevents (subject_id);
CREATE INDEX IF NOT EXISTS idx_labevents_hadm_id ON hosp.labevents (hadm_id);
CREATE INDEX IF NOT EXISTS idx_labevents_itemid ON hosp.labevents (itemid);
CREATE INDEX IF NOT EXISTS idx_labevents_subject_item_time ON hosp.labevents (subject_id, itemid, charttime DESC);

-- prescriptions
CREATE INDEX IF NOT EXISTS idx_prescriptions_subject_id ON hosp.prescriptions (subject_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_hadm_id ON hosp.prescriptions (hadm_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_subject_drug_time ON hosp.prescriptions (subject_id, drug, starttime DESC);

-- diagnoses_icd
CREATE INDEX IF NOT EXISTS idx_diagnoses_icd_subject_id ON hosp.diagnoses_icd (subject_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_icd_hadm_id ON hosp.diagnoses_icd (hadm_id);
CREATE INDEX IF NOT EXISTS idx_diagnoses_icd_icd_code ON hosp.diagnoses_icd (icd_code);

-- d_labitems / d_icd_diagnoses
CREATE INDEX IF NOT EXISTS idx_d_labitems_label ON hosp.d_labitems (label);
CREATE INDEX IF NOT EXISTS idx_d_icd_diagnoses_long_title ON hosp.d_icd_diagnoses (long_title);

INSERT INTO hosp._init_status(name) VALUES ('indexes')
ON CONFLICT (name) DO NOTHING;
