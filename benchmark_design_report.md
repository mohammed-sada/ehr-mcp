# Benchmark Design Report: Tools and Tasks for Evaluating LLM-Augmented EHR Querying in Diabetes Care

**Project:** Evaluating LLM-Augmented EHR Querying for Diabetes Patient Cohorts  
**Authors:** Mohamed Abusada, Mohammed Al-Ani  
**Date:** April 2026

---

## 1. Overview

This study evaluates whether large language models (LLMs), when connected to an electronic health record (EHR) database via the Model Context Protocol (MCP), can autonomously retrieve and reason over clinical data for diabetes patient management. We follow the methodology established by Masayoshi et al. (EHR-MCP, arXiv:2509.15957), who demonstrated near-perfect tool-use accuracy for simple retrieval tasks and identified challenges in complex multi-step tasks in a real hospital setting.

Our contribution differs in three key ways:

1. We use a **reproducible public dataset** (MIMIC-IV demo) rather than proprietary hospital data, enabling replication.
2. We focus on **diabetes care** rather than infection control, designing clinically grounded tasks specific to diabetes management.
3. We benchmark **multiple LLMs** on the same task set, enabling cross-model comparison.

The system architecture consists of a PostgreSQL database containing MIMIC-IV clinical data, an MCP server exposing seven clinical tools, and a LangGraph ReAct agent that orchestrates the LLM to call these tools and answer natural-language questions. Each task has a deterministic SQL ground-truth answer, allowing objective scoring.

---

## 2. MCP Tools (7 Tools)

The MCP server exposes seven tools that cover the main clinical data access patterns needed for diabetes care. The tool design mirrors how a clinician interacts with an EHR: looking up patient demographics, checking labs, reviewing diagnoses, examining medications, and writing clinical notes.


| #   | Tool Name          | Parameters                               | Description                                                                                                                                                                                                        |
| --- | ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `patient_info`     | subject_id                               | Returns patient demographics (gender, age) and all hospital admissions with admit/discharge timestamps.                                                                                                            |
| 2   | `latest_lab`       | subject_id, itemid                       | Returns the single most recent numeric lab result for a given lab test (identified by MIMIC-IV item ID).                                                                                                           |
| 3   | `lab_history`      | subject_id, itemid, limit?               | Returns the chronological time-series of all measurements for a given lab test.                                                                                                                                    |
| 4   | `diagnoses`        | subject_id                               | Returns all ICD-9/ICD-10 diagnosis codes with human-readable titles for a patient.                                                                                                                                 |
| 5   | `medications`      | subject_id, limit?, prescription_filter? | Returns prescription records. Supports a `glycemic` filter that restricts output to diabetes-related drugs (insulin, metformin, sulfonylureas, DPP-4 inhibitors, GLP-1 receptor agonists, SGLT2 inhibitors, TZDs). |
| 6   | `add_patient_note` | subject_id, body, source?                | Writes a free-text clinical note to the patient chart. Tests the LLM's ability to not only read but also **write** clinical documentation.                                                                         |
| 7   | `patient_notes`    | subject_id, limit?                       | Retrieves previously saved clinical notes for a patient.                                                                                                                                                           |


**Design rationale:** We intentionally provide a small, focused set of tools (similar to the 5 tools in the reference paper). This forces the LLM to compose answers from atomic data-access operations rather than relying on a single "do everything" tool. The `glycemic` filter on the medications tool tests whether the LLM can select appropriate tool parameters for diabetes-specific queries.

---

## 3. Patient Cohort (8 Patients)

We selected 8 patients from the MIMIC-IV demo dataset who have at least one diabetes-related ICD diagnosis. The cohort was chosen to maximize diversity across clinically relevant dimensions:


| Patient       | Gender | Age | Admissions | HbA1c Range  | Key Characteristics                             |
| ------------- | ------ | --- | ---------- | ------------ | ----------------------------------------------- |
| P1 (10014354) | M      | 60  | 20         | 6.7 -- 10.2% | Insulin + metformin, CKD, most complex case     |
| P2 (10037928) | F      | 78  | 10         | 7.4 -- 12.0% | Elderly, multiple comorbidities                 |
| P3 (10015860) | M      | 53  | 13         | 6.6 -- 13.9% | Glucose range 39--523 mg/dL, severe variability |
| P4 (10019003) | F      | 65  | 8          | --           | Rich lab and medication data                    |
| P5 (10023239) | F      | 29  | 3          | 8.3 -- 10.9% | Type 1 DM with DKA, youngest patient            |
| P6 (10035185) | M      | 70  | 1          | 7.7%         | Single admission, straightforward case          |
| P7 (10007795) | F      | 53  | 5          | --           | Multiple diabetes complications                 |
| P8 (10009628) | M      | 58  | 1          | --           | Simplest case, minimal data                     |


**Diversity summary:** 5 female / 3 male; age 29--78; admission count 1--20; includes both Type 1 and Type 2 diabetes; includes patients with and without HbA1c data.

---

## 4. Benchmark Tasks (20 Tasks)

Tasks are organized into three difficulty tiers, following the simple/complex structure of the reference paper but with finer granularity. Each task is derived from a real clinical scenario in diabetes management.

### 4.1 Simple Tasks (7 tasks) -- Single tool call expected

These test whether the LLM can select the correct tool and pass the right parameters for a straightforward clinical question.


| ID  | Clinical Question                       | Expected Tool          | Patient | Clinical Rationale                                     |
| --- | --------------------------------------- | ---------------------- | ------- | ------------------------------------------------------ |
| 1   | What is the patient's gender and age?   | patient_info           | P6      | Basic chart review before clinical assessment          |
| 2   | List all hospital admissions with dates | patient_info           | P1      | Admission history review for a chronic disease patient |
| 3   | What is the most recent serum glucose?  | latest_lab             | P8      | Acute glycemic monitoring                              |
| 4   | What is the latest HbA1c result?        | latest_lab             | P2      | Long-term glycemic control assessment                  |
| 5   | What is the latest serum creatinine?    | latest_lab             | P3      | Diabetic nephropathy screening                         |
| 6   | List all diabetes-related ICD diagnoses | diagnoses              | P7      | Complication documentation review                      |
| 7   | List all glycemic-control medications   | medications (glycemic) | P5      | Treatment regimen review                               |


### 4.2 Multi-Step Tasks (7 tasks) -- Two or more tool calls expected

These require the LLM to combine information from multiple tool calls to construct a complete answer.


| ID  | Clinical Question                                                    | Expected Tools             | Patient | Clinical Rationale                  |
| --- | -------------------------------------------------------------------- | -------------------------- | ------- | ----------------------------------- |
| 8   | Retrieve a diabetes lab panel: glucose, HbA1c, creatinine, potassium | latest_lab x 4             | P1      | Comprehensive metabolic assessment  |
| 9   | What are the highest and lowest glucose values ever recorded?        | lab_history                | P2      | Glycemic variability assessment     |
| 10  | Does the patient have CKD, hypertension, or cardiovascular disease?  | diagnoses + filtering      | P3      | Diabetes comorbidity screening      |
| 11  | What insulin formulations and routes have been used?                 | medications + filtering    | P1      | Insulin regimen review              |
| 12  | Has creatinine worsened over time? (first vs. last value)            | lab_history + comparison   | P4      | Renal function trajectory           |
| 13  | Length of stay for the most recent admission?                        | patient_info + computation | P7      | Healthcare utilization metric       |
| 14  | How many admissions carry a diabetes diagnosis?                      | patient_info + diagnoses   | P5      | Diabetes documentation completeness |


### 4.3 Reasoning Tasks (6 tasks) -- Multi-step + clinical logic

These are the most challenging. The LLM must retrieve data from multiple tools and then apply clinical knowledge or perform calculations to arrive at the answer.


| ID  | Clinical Question                                                               | Expected Tools                                               | Patient | Clinical Rationale                   |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------- | ------------------------------------ |
| 15  | How many glucose readings fall below 70 mg/dL (hypoglycemia)?                   | lab_history + threshold logic                                | P2      | Hypoglycemia surveillance            |
| 16  | What proportion of glucose readings exceed 200 mg/dL?                           | lab_history + percentage calculation                         | P1      | Hyperglycemia burden quantification  |
| 17  | Summarize glucose values: count, mean, min, max                                 | lab_history + statistics                                     | P6      | Glycemic summary for clinical review |
| 18  | Is metformin safe given the patient's creatinine and gender?                    | patient_info + latest_lab + medications + clinical reasoning | P4      | Medication safety assessment         |
| 19  | How many distinct diabetes ICD codes across all admissions?                     | diagnoses + filtering + counting                             | P1      | Disease burden quantification        |
| 20  | Retrieve labs and meds, then write a clinical note summarizing metabolic status | latest_lab x 3 + medications + add_patient_note              | P3      | Clinical documentation generation    |


### Task Difficulty Distribution

```
Simple (35%):     |||||||  7 tasks -- single tool call
Multi-step (35%): |||||||  7 tasks -- 2+ tool calls
Reasoning (30%):  ||||||   6 tasks -- multi-tool + clinical logic
```

---

## 5. Evaluation Methodology

- **Ground truth:** Every task has a deterministic SQL query that produces the correct answer directly from the database.
- **Scoring:** LLM outputs are compared against the SQL ground truth. We measure answer correctness (exact match for structured data, Dice coefficient for list-based answers) and tool-use reliability (correct tool selection, correct arguments).
- **Stability:** Each task will be executed multiple times per LLM to assess reproducibility.
- **Cross-model comparison:** We will run the same 20-task benchmark across multiple LLMs to compare performance.

---

## 6. Alignment with Reference Paper (EHR-MCP)


| Dimension       | EHR-MCP (Masayoshi et al.) | Our Study                            |
| --------------- | -------------------------- | ------------------------------------ |
| Dataset         | Proprietary hospital EHR   | MIMIC-IV demo (public, reproducible) |
| Clinical domain | Infection control (MRSA)   | Diabetes care                        |
| Patients        | 8                          | 8                                    |
| Tools           | 5                          | 7                                    |
| Tasks           | 6 (4 simple, 2 complex)    | 20 (7 simple, 7 multi, 6 reasoning)  |
| LLMs tested     | GPT-4.1 only               | Multiple LLMs                        |
| Agent framework | LangGraph ReAct            | LangGraph ReAct                      |
| Evaluation      | Accuracy + Dice            | Accuracy + Dice + tool reliability   |
| Reproducibility | Limited (private data)     | Fully reproducible                   |


---

## 7. Summary

This benchmark design provides a clinically grounded, reproducible evaluation framework for assessing how well LLMs can interact with EHR data through MCP tools. The 7 tools cover the core data access patterns of diabetes care (demographics, labs, diagnoses, medications, note writing), and the 20 tasks span realistic clinical scenarios from simple lookups to complex reasoning requiring both tool orchestration and domain knowledge. All ground-truth answers are verified against the live database, ensuring the benchmark is answerable and the evaluation is deterministic.