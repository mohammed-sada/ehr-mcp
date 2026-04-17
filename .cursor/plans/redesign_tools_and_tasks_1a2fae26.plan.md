---
name: Redesign Tools and Tasks
overview: Redesign the MCP tools (minor changes) and the 20 benchmark tasks to be clinically grounded in diabetes care, use richer patient diversity, and align with the EHR-MCP reference paper's methodology for a publishable evaluation study.
todos:
  - id: update-tasks
    content: Rewrite tasks.ts with 8 patients and 20 clinically-grounded task definitions
    status: completed
  - id: update-sql
    content: Rewrite sql.ts with matching SQL ground-truth queries for all 20 tasks
    status: completed
  - id: verify-data
    content: Run each SQL ground truth against the database to verify non-empty/correct results
    status: completed
  - id: update-abstract
    content: Update abstract.md methods section to reflect the final tool/task design
    status: completed
isProject: false
---

# Redesign MCP Tools and Benchmark Tasks for Diabetes EHR Study

## Tools: Keep Current 7, Minor Description Refinements

The current active tools are well-designed and sufficient. No new tools needed. The commented-out tools (count_distinct_lab_itemids, top_lab_itemids_by_count, top_glycemic_drugs, recent_lab_events) should stay commented out since they're not clinically motivated.

Active tools in [mcp-server/src/server/clinicalTools.ts](mcp-server/src/server/clinicalTools.ts):
- `patient_info` — demographics + admissions
- `latest_lab` — latest lab value by subject_id + itemid
- `lab_history` — time-series for one lab by subject_id + itemid
- `diagnoses` — ICD codes with titles for a patient
- `medications` — prescriptions with optional glycemic filter
- `add_patient_note` — write a clinical note
- `patient_notes` — read saved notes

## Patient Selection: Expand to 8 Patients

Replace the current 3-patient set with 8 patients that cover diverse profiles:

- **10014354** (M, 60) — 20 admissions, 18 HbA1c values (6.7–10.2), insulin + metformin, CKD
- **10037928** (F, 78) — 10 admissions, 17 HbA1c values (7.4–12.0), elderly, multiple comorbidities
- **10015860** (M, 53) — 13 admissions, HbA1c up to 13.9, glucose range 39–523
- **10019003** (F, 65) — 8 admissions, rich lab/med data
- **10023239** (F, 29) — 3 admissions, Type 1 DM with DKA, HbA1c 8.3–10.9
- **10035185** (M, 70) — 1 admission, HbA1c 7.7 (keep from current set)
- **10007795** (F, 53) — 5 admissions, multiple diabetes complications
- **10009628** (M, 58) — 1 admission (keep from current set, simpler case)

This gives: both genders, age range 29–78, 1–20 admissions, Type 1 and Type 2, with and without HbA1c.

## Task Redesign: 20 Tasks in 3 Difficulty Tiers

### SIMPLE (7 tasks) — Single tool call, deterministic answer

Each maps to exactly one MCP tool.

| ID | Question (paraphrased) | Expected Tool | Patient | Clinical Rationale |
|----|----------------------|---------------|---------|-------------------|
| 1 | Patient demographics (gender, age) | patient_info | 10035185 | Basic chart review |
| 2 | List all admissions with dates | patient_info | 10014354 | Admission history for chronic disease |
| 3 | Latest serum glucose (itemid=50931) | latest_lab | 10009628 | Acute glycemic monitoring |
| 4 | Latest HbA1c (itemid=50852) | latest_lab | 10037928 | Long-term glycemic control |
| 5 | Latest creatinine (itemid=50912) | latest_lab | 10015860 | Diabetic nephropathy screening |
| 6 | All diabetes-related ICD diagnoses | diagnoses | 10007795 | Complication documentation |
| 7 | Glycemic-control medications list | medications(glycemic) | 10023239 | Treatment regimen review |

### MULTI-STEP (7 tasks) — 2+ tool calls, deterministic answer

| ID | Question (paraphrased) | Expected Tools | Patient | Clinical Rationale |
|----|----------------------|----------------|---------|-------------------|
| 8 | Diabetes lab panel: latest glucose, HbA1c, creatinine, potassium | latest_lab x4 | 10014354 | Comprehensive metabolic check |
| 9 | Highest and lowest glucose values ever recorded | lab_history(glucose) | 10037928 | Glycemic variability assessment |
| 10 | Does the patient have CKD, hypertension, or cardiovascular disease documented? | diagnoses + filter | 10015860 | Diabetes comorbidity screening |
| 11 | What insulin formulations + routes have been used? | medications(glycemic) + filter | 10014354 | Insulin regimen review |
| 12 | First vs last creatinine: has renal function worsened? | lab_history(creatinine) | 10019003 | Renal trajectory assessment |
| 13 | Length of stay (hours) for most recent admission | patient_info + compute | 10007795 | Utilization metric |
| 14 | How many admissions, and how many carry a diabetes diagnosis? | patient_info + diagnoses | 10023239 | Diabetes documentation completeness |

### REASONING (6 tasks) — Multi-step + clinical logic, deterministic answer

| ID | Question (paraphrased) | Expected Tools | Patient | Clinical Rationale |
|----|----------------------|----------------|---------|-------------------|
| 15 | Count glucose readings below 70 mg/dL (hypoglycemic episodes) | lab_history(glucose) + threshold | 10037928 | Hypoglycemia surveillance |
| 16 | What proportion of glucose values exceed 200 mg/dL? | lab_history(glucose) + compute | 10014354 | Hyperglycemia burden |
| 17 | Summarize glucose: count, mean, min, max | lab_history(glucose) + statistics | 10035185 | Glycemic summary |
| 18 | Is the patient on metformin? Given their latest creatinine and gender, is it within safe prescribing limits? (contraindicated if Cr >1.5 M / >1.4 F) | latest_lab(creatinine) + medications(glycemic) + patient_info + reasoning | 10019003 | Medication safety check |
| 19 | How many distinct diabetes ICD codes are documented across all admissions? | diagnoses + filter + count | 10014354 | Disease burden quantification |
| 20 | Retrieve latest glucose, HbA1c, creatinine; list glycemic meds; then write a clinical note summarizing metabolic status | latest_lab x3 + medications + add_patient_note | 10015860 | Clinical documentation (tests write tool) |

## Key Differences from Current Implementation

- **Replaced** non-clinical tasks (9, 10, 17, 19) with HbA1c, comorbidity, hypoglycemia, and medication safety tasks
- **Added** HbA1c as a primary outcome measure (tasks 4, 8, 16, 20)
- **Added** a write/action task (task 20) to test `add_patient_note`
- **Added** clinical reasoning task (task 18) requiring cross-tool integration + domain knowledge
- **Expanded** patient set from 3 to 8 for diversity
- **All tasks** have deterministic SQL ground truth (important for evaluation)
- **Task difficulty** now genuinely scales: simple = 1 tool call, multi = 2+ calls, reasoning = multi calls + clinical logic

## Files to Modify

1. [mcp-server/src/evaluation/tasks.ts](mcp-server/src/evaluation/tasks.ts) — Replace SUBJECTS array and all 20 task definitions
2. [mcp-server/src/evaluation/sql.ts](mcp-server/src/evaluation/sql.ts) — Rewrite all 20 SQL ground-truth queries to match new tasks
3. [abstract.md](abstract.md) — Update methods section to reference the final task design
