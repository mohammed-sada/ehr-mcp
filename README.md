# MIMIC-IV (hosp) MVP on PostgreSQL (Docker)

This repo provides a **fully reproducible** PostgreSQL setup in Docker for a **query-optimized** MVP subset of MIMIC-IV (hosp). On first startup, Postgres will:

- create the `hosp` schema + tables
- bulk load CSVs via `COPY`
- create helpful indexes for EHR-style queries

No manual database steps and no GUI required.

## Project structure

```
project-root/
├── ehr-data/                      # your current CSVs (provided)
├── mimic-data/                    # mounted into the container at /data
│   └── hosp/                      # place the 7 required hosp CSVs here
├── docker-compose.yml
├── .env                           # created locally (see env.example)
├── env.example
├── init/
│   ├── schema.sql
│   ├── load_data.sql
│   ├── indexes.sql
├── scripts/
│   └── prepare_data.sh            # optional helper to copy from ./ehr-data
└── Makefile                       # bonus: make up/down/logs/psql/reset
```

## Setup

### 1) Install Docker

Install Docker Desktop (Windows/macOS) or Docker Engine (Linux).

### 2) Put MIMIC files in the expected location

Place the following files in:

`./mimic-data/hosp/`

Required (this MVP only):

- `patients.csv`
- `admissions.csv`
- `labevents.csv`
- `d_labitems.csv`
- `prescriptions.csv`
- `diagnoses_icd.csv`
- `d_icd_diagnoses.csv`

If you already have these files in `./ehr-data/`, you can copy them over with:

```bash
bash scripts/prepare_data.sh
```

## EHR dataset (CSV) overview

This project ships with many MIMIC-IV `hosp` CSVs under `ehr-data/`, but **the Docker database only loads a small MVP subset (7 CSVs)** from `mimic-data/hosp/` into the `hosp` schema.

### What gets loaded into PostgreSQL (MVP tables)

All tables live under schema **`hosp`** and are created by `init/schema.sql`, then bulk-loaded via `COPY` in `init/load_data.sql`.

#### 1) `patients.csv` → `hosp.patients`

- **What it represents**: one row per patient.
- **Primary key**: `subject_id`
- **Key columns**:
  - `gender`
  - `anchor_age`, `anchor_year`, `anchor_year_group` (MIMIC “anchored” demographics)
  - `dod` (date of death; may be empty)


#### 2) `admissions.csv` → `hosp.admissions`

- **What it represents**: one row per hospital admission/encounter for a patient.
- **Primary key**: `hadm_id`
- **Key columns**:
  - `subject_id` (patient)
  - `admittime`, `dischtime`, `deathtime`
  - `admission_type`, `admission_location`, `discharge_location`
  - `insurance`, `language`, `marital_status`, `race`
  - `hospital_expire_flag` (1 if death occurred in hospital)


#### 3) `d_labitems.csv` → `hosp.d_labitems` (lab item dictionary)

- **What it represents**: a dictionary mapping lab test identifiers to human-readable names.
- **Primary key**: `itemid`
- **Key columns**:
  - `label` (e.g., “Lactate”)
  - `fluid`, `category`


#### 4) `labevents.csv` → `hosp.labevents`

- **What it represents**: individual lab measurements (often many rows per admission).
- **Primary key**: `labevent_id`
- **Key columns**:
  - `subject_id`, `hadm_id` (links to patient + admission)
  - `itemid` (links to `d_labitems`)
  - `charttime` (when measured), `storetime` (when stored)
  - `value` (raw), `valuenum` (numeric when available), `valueuom`
  - `ref_range_lower`, `ref_range_upper`, `flag` (e.g., abnormal)


#### 5) `prescriptions.csv` → `hosp.prescriptions`

- **What it represents**: medications ordered/administered during an admission (many rows per admission).
- **Primary key**: (none in this MVP)
- **Key columns**:
  - `subject_id`, `hadm_id`
  - `starttime`, `stoptime`
  - `drug`, `drug_type`, `route`
  - dosing fields: `dose_val_rx`, `dose_unit_rx`, `doses_per_24_hrs`
  - identifiers (often sparse): `pharmacy_id`, `poe_id`, `poe_seq`, `order_provider_id`
- **How to join**:
  - `prescriptions.hadm_id = admissions.hadm_id`


#### 6) `diagnoses_icd.csv` → `hosp.diagnoses_icd`

- **What it represents**: ICD diagnoses assigned to an admission (many rows per admission).
- **Primary key**: (none in this MVP)
- **Key columns**:
  - `subject_id`, `hadm_id`
  - `seq_num` (ordering/priority within admission)
  - `icd_code`, `icd_version`
  

#### 7) `d_icd_diagnoses.csv` → `hosp.d_icd_diagnoses` (ICD dictionary)

- **What it represents**: a dictionary mapping ICD codes to human-readable diagnosis titles.
- **Primary key**: composite `(icd_code, icd_version)` (ICD-9 vs ICD-10)
- **Key columns**:
  - `long_title`


### What is *not* loaded (but included in `ehr-data/`)

`ehr-data/` contains additional MIMIC-IV `hosp` exports (e.g., `transfers.csv`, `procedures_icd.csv`, `emar*.csv`, etc.). They’re included for convenience, but **this MVP does not import them into Postgres** unless you extend `init/schema.sql` + `init/load_data.sql`.

### 3) Start Postgres + auto-import

```bash
docker-compose up -d
```

Or (bonus):

```bash
make up
```

<!-- On first run, initialization can take a while because `labevents.csv` and `prescriptions.csv` are large. -->

## Verify

### Connect with `psql`

From your host machine:

```bash
psql "host=localhost port=5432 user=postgres password=postgres dbname=mimiciv"
```

Or from inside the container:

```bash
docker compose exec -it postgres psql -U postgres -d mimiciv
```

### If you use Adminer

- **URL**: `http://localhost:8080`
- **System**: `PostgreSQL`
- **Server**: `postgres`
- **Username**: `postgres`
- **Password**: `postgres`
- **Database**: `mimiciv`

All tables live under the **`hosp` schema** (not `public`).

### Sanity checks

```sql
SELECT COUNT(*) FROM hosp.patients;
SELECT COUNT(*) FROM hosp.admissions;
SELECT COUNT(*) FROM hosp.labevents;
```

## Example queries

### Latest creatinine for a patient (join with `d_labitems`)

```sql
SELECT
  le.subject_id,
  le.hadm_id,
  le.charttime,
  le.valuenum,
  le.valueuom,
  dli.label
FROM hosp.labevents le
JOIN hosp.d_labitems dli
  ON dli.itemid = le.itemid
WHERE le.subject_id = 10003400
  AND lower(dli.label) LIKE '%creatinine%'
  AND le.valuenum IS NOT NULL
ORDER BY le.charttime DESC
LIMIT 1;
```

### Medication history (by admission)

```sql
SELECT
  subject_id, hadm_id, starttime, stoptime, drug, route, dose_val_rx, dose_unit_rx
FROM hosp.prescriptions
WHERE subject_id = 10003400
ORDER BY starttime NULLS LAST;
```

### Diagnosis lookup (ICD code → title)

```sql
SELECT
  di.subject_id,
  di.hadm_id,
  di.icd_code,
  di.icd_version,
  did.long_title
FROM hosp.diagnoses_icd di
JOIN hosp.d_icd_diagnoses did
  ON did.icd_code = di.icd_code
 AND did.icd_version = di.icd_version
WHERE di.subject_id = 10003400
ORDER BY di.hadm_id, di.seq_num;
```

## Notes / constraints

- **Reproducible from scratch**: remove the volume with `make reset` (or `docker compose down -v`) to force a full re-init + reload.
- **No foreign keys** (by design for MVP): we prioritize fast imports and flexible querying.
- **Composite PK for `d_icd_diagnoses`**: MIMIC uses `icd_code` + `icd_version` together; this prevents duplicate-key failures during import.

