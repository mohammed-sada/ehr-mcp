#!/usr/bin/env bash
set -euo pipefail

# Copies the required MIMIC-IV hosp CSVs into ./mimic-data/hosp/
# so docker-compose can mount them at /data/hosp/.
#
# Usage:
#   bash scripts/prepare_data.sh
#
# Notes:
# - On Windows, run from WSL or Git Bash, or copy files manually.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${ROOT_DIR}/ehr-data"
DEST_DIR="${ROOT_DIR}/mimic-data/hosp"

mkdir -p "${DEST_DIR}"

required=(
  "patients.csv"
  "admissions.csv"
  "labevents.csv"
  "d_labitems.csv"
  "prescriptions.csv"
  "diagnoses_icd.csv"
  "d_icd_diagnoses.csv"
)

for f in "${required[@]}"; do
  if [[ ! -f "${SRC_DIR}/${f}" ]]; then
    echo "Missing source file: ${SRC_DIR}/${f}" >&2
    exit 1
  fi
  echo "Copying ${f} -> ${DEST_DIR}/${f}"
  cp -f "${SRC_DIR}/${f}" "${DEST_DIR}/${f}"
done

echo "Done. You should now have CSVs in: ${DEST_DIR}"

