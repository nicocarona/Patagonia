-- Módulo SMS — Esquema PostgreSQL (SERIAL en vez de AUTOINCREMENT).

CREATE TABLE IF NOT EXISTS occurrences (
  id                SERIAL PRIMARY KEY,
  report_date       TEXT NOT NULL,
  reported_by       TEXT,
  occurrence_type   TEXT NOT NULL CHECK (occurrence_type IN ('incident','accident','hazard_report','near_miss')),
  aircraft_tail     TEXT,
  description       TEXT NOT NULL,
  severity          TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical')),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','closed')),
  root_cause        TEXT,
  closed_date       TEXT
);

CREATE TABLE IF NOT EXISTS hazards (
  id                SERIAL PRIMARY KEY,
  identified_date   TEXT NOT NULL,
  category          TEXT,
  description       TEXT NOT NULL,
  likelihood        INTEGER NOT NULL DEFAULT 1 CHECK (likelihood BETWEEN 1 AND 5),
  consequence       INTEGER NOT NULL DEFAULT 1 CHECK (consequence BETWEEN 1 AND 5),
  risk_score        INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','mitigated','closed'))
);

CREATE TABLE IF NOT EXISTS corrective_actions (
  id                SERIAL PRIMARY KEY,
  occurrence_id     INTEGER REFERENCES occurrences(id),
  hazard_id         INTEGER REFERENCES hazards(id),
  description       TEXT NOT NULL,
  assigned_to       TEXT,
  due_date          TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
  completed_date    TEXT
);

CREATE TABLE IF NOT EXISTS frat_assessments (
  id                    SERIAL PRIMARY KEY,
  flight_date           TEXT NOT NULL,
  aircraft_tail         TEXT,
  mission_type          TEXT,
  pilot_employee_code   TEXT,
  weather_score         INTEGER NOT NULL DEFAULT 0 CHECK (weather_score BETWEEN 0 AND 4),
  terrain_score         INTEGER NOT NULL DEFAULT 0 CHECK (terrain_score BETWEEN 0 AND 4),
  pilot_currency_score  INTEGER NOT NULL DEFAULT 0 CHECK (pilot_currency_score BETWEEN 0 AND 4),
  fatigue_score         INTEGER NOT NULL DEFAULT 0 CHECK (fatigue_score BETWEEN 0 AND 4),
  fatigue_source        TEXT NOT NULL DEFAULT 'manual' CHECK (fatigue_source IN ('manual','tripulacion')),
  aircraft_status_score INTEGER NOT NULL DEFAULT 0 CHECK (aircraft_status_score BETWEEN 0 AND 4),
  operational_pressure_score INTEGER NOT NULL DEFAULT 0 CHECK (operational_pressure_score BETWEEN 0 AND 4),
  total_score           INTEGER NOT NULL,
  risk_level            TEXT NOT NULL,
  requires_approval     INTEGER NOT NULL DEFAULT 0,
  approved_by           TEXT,
  notes                 TEXT
);

CREATE TABLE IF NOT EXISTS fatigue_snapshots (
  id                SERIAL PRIMARY KEY,
  employee_code     TEXT UNIQUE NOT NULL,
  snapshot_date     TEXT NOT NULL,
  score_0_100       INTEGER NOT NULL,
  level             TEXT NOT NULL,
  fatigue_band_0_4  INTEGER NOT NULL CHECK (fatigue_band_0_4 BETWEEN 0 AND 4),
  synced_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_occurrences_status ON occurrences(status);
CREATE INDEX IF NOT EXISTS idx_hazards_status ON hazards(status);
CREATE INDEX IF NOT EXISTS idx_frat_date ON frat_assessments(flight_date);
