-- Run manually if your Postgres volume was created before hosp.notes existed:
--   docker compose exec -T postgres psql -U postgres -d mimiciv -f /path/to/this/file.sql
-- Or paste into psql. Safe to run multiple times (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS hosp.notes (
  note_id     BIGSERIAL PRIMARY KEY,
  subject_id  INTEGER NOT NULL REFERENCES hosp.patients (subject_id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT NOT NULL DEFAULT 'mcp'
);

CREATE INDEX IF NOT EXISTS idx_notes_subject_id ON hosp.notes (subject_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON hosp.notes (subject_id, created_at DESC);
