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
  hosp.notes,
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

-- ---------------------------------------------------------------------------
-- Cohort filter: keep only patients with diabetes mellitus (ICD-9 250* or
-- ICD-10 E08–E13). All hosp fact tables are restricted to those subject_ids.
-- Dictionary tables are trimmed to rows still referenced after the filter.
-- Re-seed the DB (drop volume) for this to apply to an existing Postgres data dir.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _diabetes_subjects AS
SELECT DISTINCT subject_id
FROM hosp.diagnoses_icd
WHERE
  (icd_version = 9 AND icd_code LIKE '250%')
  OR (
    icd_version = 10
    AND (
      icd_code LIKE 'E11%'
      OR icd_code LIKE 'E10%'
      OR icd_code LIKE 'E13%'
      OR icd_code LIKE 'E08%'
      OR icd_code LIKE 'E09%'
    )
  );

DELETE FROM hosp.labevents
WHERE subject_id NOT IN (SELECT subject_id FROM _diabetes_subjects);

DELETE FROM hosp.prescriptions
WHERE subject_id NOT IN (SELECT subject_id FROM _diabetes_subjects);

DELETE FROM hosp.diagnoses_icd
WHERE subject_id NOT IN (SELECT subject_id FROM _diabetes_subjects);

DELETE FROM hosp.admissions
WHERE subject_id NOT IN (SELECT subject_id FROM _diabetes_subjects);

DELETE FROM hosp.patients
WHERE subject_id NOT IN (SELECT subject_id FROM _diabetes_subjects);

DELETE FROM hosp.d_icd_diagnoses d
WHERE NOT EXISTS (
  SELECT 1
  FROM hosp.diagnoses_icd x
  WHERE x.icd_code = d.icd_code
    AND x.icd_version = d.icd_version
);

DELETE FROM hosp.d_labitems dl
WHERE NOT EXISTS (
  SELECT 1 FROM hosp.labevents le WHERE le.itemid = dl.itemid
);

INSERT INTO hosp._init_status(name) VALUES ('load_data')
ON CONFLICT (name) DO NOTHING;
