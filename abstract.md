
# Title: Evaluating LLM-Augmented EHR Querying for Diabetes Patient Cohorts

**Authors:** Mohamed Abusada, Mohammed Al-Ani

### Abstract


### Background
Electronic Health Records (EHRs) are central to clinician care, yet extracting specific information is still difficult and time-consuming due to the complexity of EHR schemas and reliance on structured query languages (e.g., SQL). While large language models (LLMs) enable natural-language access to data, their reliability when retrieving and reasoning over EHR data through external tools remains insufficiently evaluated.

### Objective
Develop and evaluate a tool-augmented LLM framework for natural-language querying of EHR data using a reproducible benchmark derived from MIMIC-IV (demo).

### Methods
We deploy a PostgreSQL instance of the MIMIC-IV (demo) dataset and expose structured clinical data through seven Model Context Protocol (MCP) tools: patient demographics and admissions, latest lab value, lab history, ICD diagnoses, medications (with a glycemic-control filter), clinical note writing, and note retrieval. From the dataset we select a cohort of eight diabetes patients (five female, three male; age range 29-78; 1-20 admissions; Type 1 and Type 2 diabetes) and design 20 benchmark tasks grounded in diabetes care: seven simple single-tool retrieval tasks (demographics, glucose, HbA1c, creatinine, diagnoses, medications), seven multi-step tasks requiring two or more tool calls (diabetes lab panel, glucose extremes, comorbidity screening, insulin regimen review, renal trajectory, length of stay, diabetes documentation completeness), and six reasoning tasks combining tool outputs with clinical logic (hypoglycemia detection, hyperglycemia burden, glucose summary statistics, metformin safety assessment, disease burden quantification, and metabolic status note generation). An agentic tool-use loop (Vercel AI SDK with multi-step execution via OpenRouter) orchestrates each LLM to autonomously select and call the MCP tools, read the returned data, and answer each benchmark task. We run multiple LLMs on the same benchmark and compare their outputs against SQL ground-truth answers, scoring for correctness and tool-use reliability (with full experimental results pending).


### Results (Expected)
Performance is expected to be higher for simple retrieval and lower for multi-step and reasoning-based tasks. We will report answer correctness and orchestration/tool reliability across task types and LLMs.

### Conclusion
This work provides a reproducible evaluation framework for LLMs interacting with EHR systems, establishing agentic MCP-based tool orchestration as a baseline for improving accuracy and reliability in clinical data access.
