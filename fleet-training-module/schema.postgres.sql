-- fleet-training-module — Esquema PostgreSQL (SERIAL en vez de AUTOINCREMENT).

CREATE TABLE IF NOT EXISTS crew_members (
  id             SERIAL PRIMARY KEY,
  employee_code  TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'pilot' CHECK (role IN ('pilot','copilot','mechanic','paramedic','dispatcher')),
  base           TEXT
);

CREATE TABLE IF NOT EXISTS licenses (
  id                  SERIAL PRIMARY KEY,
  crew_id             INTEGER NOT NULL REFERENCES crew_members(id),
  license_type        TEXT NOT NULL,
  license_number       TEXT,
  issuing_authority    TEXT,
  issue_date           TEXT,
  expiry_date          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medical_certificates (
  id             SERIAL PRIMARY KEY,
  crew_id        INTEGER NOT NULL REFERENCES crew_members(id),
  class          TEXT NOT NULL DEFAULT '1',
  issue_date     TEXT,
  expiry_date    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS type_ratings (
  id                        SERIAL PRIMARY KEY,
  crew_id                   INTEGER NOT NULL REFERENCES crew_members(id),
  aircraft_model             TEXT NOT NULL,
  qualified_date             TEXT,
  last_proficiency_check     TEXT,
  expiry_date                 TEXT NOT NULL,
  UNIQUE(crew_id, aircraft_model)
);

CREATE TABLE IF NOT EXISTS special_qualifications (
  id                   SERIAL PRIMARY KEY,
  crew_id              INTEGER NOT NULL REFERENCES crew_members(id),
  qualification_code  TEXT NOT NULL CHECK (qualification_code IN ('NVG','HEMS','EXTERNAL_LOAD','OFFSHORE','MOUNTAIN','HOIST','INSTRUCTOR','EXAMINER')),
  issue_date           TEXT,
  expiry_date          TEXT,
  notes                TEXT
);

CREATE TABLE IF NOT EXISTS recurrent_trainings (
  id                SERIAL PRIMARY KEY,
  crew_id           INTEGER NOT NULL REFERENCES crew_members(id),
  training_type     TEXT NOT NULL,
  completed_date    TEXT NOT NULL,
  expiry_date       TEXT,
  provider          TEXT,
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_licenses_crew ON licenses(crew_id);
CREATE INDEX IF NOT EXISTS idx_medical_crew ON medical_certificates(crew_id);
CREATE INDEX IF NOT EXISTS idx_type_ratings_crew ON type_ratings(crew_id);
CREATE INDEX IF NOT EXISTS idx_special_quals_crew ON special_qualifications(crew_id);
CREATE INDEX IF NOT EXISTS idx_recurrent_crew ON recurrent_trainings(crew_id);
