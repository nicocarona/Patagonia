-- Módulo de Tripulación y Fatiga — Esquema PostgreSQL (SERIAL en vez de AUTOINCREMENT).

CREATE TABLE IF NOT EXISTS crew_members (
  id             SERIAL PRIMARY KEY,
  employee_code  TEXT UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('pilot','copilot','mechanic','paramedic','dispatcher')),
  email          TEXT
);

CREATE TABLE IF NOT EXISTS crew_qualifications (
  id                   SERIAL PRIMARY KEY,
  crew_id              INTEGER NOT NULL REFERENCES crew_members(id),
  aircraft_model       TEXT NOT NULL,
  qualification_type   TEXT NOT NULL DEFAULT 'type_rating',
  valid_until          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS duty_periods (
  id                  SERIAL PRIMARY KEY,
  crew_id             INTEGER NOT NULL REFERENCES crew_members(id),
  duty_date           TEXT NOT NULL,
  start_time          TEXT NOT NULL,
  end_time            TEXT NOT NULL,
  duty_type           TEXT NOT NULL DEFAULT 'flight',
  source_booking_id   INTEGER,
  notes               TEXT
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id           SERIAL PRIMARY KEY,
  crew_id      INTEGER NOT NULL REFERENCES crew_members(id),
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  leave_type   TEXT NOT NULL DEFAULT 'vacation',
  status       TEXT NOT NULL DEFAULT 'approved'
);

CREATE INDEX IF NOT EXISTS idx_duty_crew_date ON duty_periods(crew_id, duty_date);
CREATE INDEX IF NOT EXISTS idx_leave_crew_dates ON leave_requests(crew_id, start_date, end_date);
