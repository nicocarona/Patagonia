-- ============================================================================
-- Módulo de Programación de Vuelos — Esquema PostgreSQL
-- Traducción directa de schema.sql (SQLite): SERIAL en vez de AUTOINCREMENT.
-- ============================================================================

CREATE TABLE IF NOT EXISTS aircraft (
  id                          SERIAL PRIMARY KEY,
  tail_number                 TEXT NOT NULL UNIQUE,
  model                       TEXT NOT NULL,
  base                        TEXT,
  airworthy                   INTEGER NOT NULL DEFAULT 1,
  airworthy_synced_at         TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id      SERIAL PRIMARY KEY,
  name    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crew_members (
  id             SERIAL PRIMARY KEY,
  employee_code  TEXT UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('pilot','copilot','mechanic','paramedic','dispatcher')),
  email          TEXT
);

CREATE TABLE IF NOT EXISTS crew_qualifications (
  id                  SERIAL PRIMARY KEY,
  crew_id             INTEGER NOT NULL REFERENCES crew_members(id),
  aircraft_model      TEXT NOT NULL,
  qualification_type  TEXT NOT NULL DEFAULT 'type_rating',
  valid_until         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id                       SERIAL PRIMARY KEY,
  aircraft_id              INTEGER NOT NULL REFERENCES aircraft(id),
  pilot_id                 INTEGER NOT NULL REFERENCES crew_members(id),
  customer_id              INTEGER REFERENCES customers(id),
  booking_date             TEXT NOT NULL,
  start_time               TEXT NOT NULL,
  end_time                 TEXT NOT NULL,
  mission_type             TEXT,
  certificate_context      TEXT NOT NULL DEFAULT 'charter',
  status                   TEXT NOT NULL DEFAULT 'confirmed',
  notes                    TEXT,
  billing_contract_id      INTEGER,
  actual_flight_hours      REAL,
  actual_positioning_hours REAL,
  actual_standby_hours     REAL,
  actual_landing_count     INTEGER,
  closed_at                TEXT,
  synced_to_billing        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bookings_aircraft_date ON bookings(aircraft_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_pilot_date ON bookings(pilot_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_qualifications_crew ON crew_qualifications(crew_id);
