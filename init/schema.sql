-- Minimal, query-friendly schema for a MIMIC-IV (hosp) MVP.
-- Note: Tables include ALL columns from the CSV headers so `COPY ... CSV HEADER`
-- works with no preprocessing.

CREATE SCHEMA IF NOT EXISTS hosp;

-- Make the hosp schema the default for new sessions (helps Adminer and psql UX).
-- This is safe for this MVP since we only load hosp tables.
ALTER DATABASE mimiciv SET search_path = hosp, public;

-- Tracks whether init steps have already run (so scripts are safe if executed twice).
CREATE TABLE IF NOT EXISTS hosp._init_status (
  name       TEXT PRIMARY KEY,
  ran_at     TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hosp.patients (
  subject_id            INTEGER PRIMARY KEY,
  gender                TEXT,
  anchor_age            INTEGER,
  anchor_year           INTEGER,
  anchor_year_group     TEXT,
  dod                   TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hosp.admissions (
  subject_id              INTEGER,
  hadm_id                 BIGINT PRIMARY KEY,
  admittime               TIMESTAMP,
  dischtime               TIMESTAMP,
  deathtime               TIMESTAMP,
  admission_type          TEXT,
  admit_provider_id       TEXT,
  admission_location      TEXT,
  discharge_location      TEXT,
  insurance               TEXT,
  language                TEXT,
  marital_status          TEXT,
  race                    TEXT,
  edregtime               TIMESTAMP,
  edouttime               TIMESTAMP,
  hospital_expire_flag    INTEGER
);

CREATE TABLE IF NOT EXISTS hosp.d_labitems (
  itemid      INTEGER PRIMARY KEY,
  label       TEXT,
  fluid       TEXT,
  category    TEXT
);

CREATE TABLE IF NOT EXISTS hosp.labevents (
  labevent_id        BIGINT PRIMARY KEY,
  subject_id         INTEGER,
  hadm_id            BIGINT,
  specimen_id        BIGINT,
  itemid             INTEGER,
  order_provider_id  TEXT,
  charttime          TIMESTAMP,
  storetime          TIMESTAMP,
  value              TEXT,
  valuenum           DOUBLE PRECISION,
  valueuom           TEXT,
  ref_range_lower    DOUBLE PRECISION,
  ref_range_upper    DOUBLE PRECISION,
  flag               TEXT,
  priority           TEXT,
  comments           TEXT
);

CREATE TABLE IF NOT EXISTS hosp.prescriptions (
  subject_id         INTEGER,
  hadm_id            BIGINT,
  pharmacy_id        BIGINT,
  -- In MIMIC-IV exports this can be a compound identifier like "10023239-119"
  poe_id             TEXT,
  poe_seq            INTEGER,
  order_provider_id  TEXT,
  starttime          TIMESTAMP,
  stoptime           TIMESTAMP,
  drug_type          TEXT,
  drug               TEXT,
  formulary_drug_cd  TEXT,
  gsn                TEXT,
  ndc                TEXT,
  prod_strength      TEXT,
  form_rx            TEXT,
  dose_val_rx        TEXT,
  dose_unit_rx       TEXT,
  form_val_disp      TEXT,
  form_unit_disp     TEXT,
  doses_per_24_hrs   DOUBLE PRECISION,
  route              TEXT
);

CREATE TABLE IF NOT EXISTS hosp.diagnoses_icd (
  subject_id   INTEGER,
  hadm_id      BIGINT,
  seq_num      INTEGER,
  icd_code     TEXT,
  icd_version  INTEGER
);

CREATE TABLE IF NOT EXISTS hosp.d_icd_diagnoses (
  icd_code     TEXT,
  icd_version  INTEGER,
  long_title   TEXT,
  -- In MIMIC-IV, `icd_code` can repeat across versions; keep this composite PK
  -- to ensure loading is always reproducible.
  PRIMARY KEY (icd_code, icd_version)
);

