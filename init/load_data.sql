-- Load CSVs into the hosp schema.
-- Assumes files are available inside the container at: /data/hosp/*.csv

DO $$
BEGIN
  -- Make this script safe if it gets executed more than once.
  IF EXISTS (SELECT 1 FROM hosp._init_status WHERE name = 'load_data') THEN
    RAISE NOTICE 'Skipping load_data.sql (already ran).';
    RETURN;
  END IF;

  -- Ensure tables exist even if Docker executes files in an unexpected order.
  -- (In this repo, `indexes.sql` also orchestrates execution.)
  PERFORM 1;
END
$$;

-- Faster bulk load (safe for init container)
SET maintenance_work_mem = '256MB';

-- If this runs multiple times, reload deterministically.
TRUNCATE TABLE
  hosp.patients,
  hosp.admissions,
  hosp.d_labitems,
  hosp.labevents,
  hosp.prescriptions,
  hosp.diagnoses_icd,
  hosp.d_icd_diagnoses;

COPY hosp.patients
FROM '/data/hosp/patients.csv'
WITH (FORMAT csv, HEADER true, DELIMITER ',', NULL '', QUOTE '"');

COPY hosp.admissions
FROM '/data/hosp/admissions.csv'
WITH (FORMAT csv, HEADER true, DELIMITER ',', NULL '', QUOTE '"');

COPY hosp.d_labitems
FROM '/data/hosp/d_labitems.csv'
WITH (FORMAT csv, HEADER true, DELIMITER ',', NULL '', QUOTE '"');

COPY hosp.labevents
FROM '/data/hosp/labevents.csv'
WITH (FORMAT csv, HEADER true, DELIMITER ',', NULL '', QUOTE '"');

COPY hosp.prescriptions
FROM '/data/hosp/prescriptions.csv'
WITH (FORMAT csv, HEADER true, DELIMITER ',', NULL '', QUOTE '"');

COPY hosp.diagnoses_icd
FROM '/data/hosp/diagnoses_icd.csv'
WITH (FORMAT csv, HEADER true, DELIMITER ',', NULL '', QUOTE '"');

COPY hosp.d_icd_diagnoses
FROM '/data/hosp/d_icd_diagnoses.csv'
WITH (FORMAT csv, HEADER true, DELIMITER ',', NULL '', QUOTE '"');

INSERT INTO hosp._init_status(name) VALUES ('load_data')
ON CONFLICT (name) DO NOTHING;
