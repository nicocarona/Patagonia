-- fleet-dispatch-module — Esquema PostgreSQL (SERIAL en vez de AUTOINCREMENT).

CREATE TABLE IF NOT EXISTS flight_releases (
  id                            SERIAL PRIMARY KEY,
  source_booking_id             INTEGER,
  tail_number                   TEXT NOT NULL,
  pic_name                      TEXT NOT NULL,
  flight_date                   TEXT NOT NULL,
  departure_base                TEXT NOT NULL,
  destination                   TEXT NOT NULL,
  alternate                     TEXT,
  route                         TEXT,
  planned_departure_time        TEXT,
  estimated_flight_time_hours   REAL NOT NULL,
  status                        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','released','departed','closed','cancelled')),
  dispatcher_name               TEXT,
  released_at                   TEXT,
  departed_at                   TEXT,
  closed_at                     TEXT,
  synced_to_fuel                INTEGER NOT NULL DEFAULT 0,
  created_at                    TEXT NOT NULL DEFAULT NOW()::TEXT
);

CREATE TABLE IF NOT EXISTS weight_balance (
  id                        SERIAL PRIMARY KEY,
  flight_release_id         INTEGER NOT NULL UNIQUE REFERENCES flight_releases(id),
  empty_weight_kg           REAL NOT NULL,
  crew_weight_kg            REAL NOT NULL DEFAULT 0,
  passenger_weight_kg       REAL NOT NULL DEFAULT 0,
  cargo_weight_kg           REAL NOT NULL DEFAULT 0,
  fuel_weight_kg            REAL NOT NULL DEFAULT 0,
  max_takeoff_weight_kg     REAL NOT NULL,
  computed_total_weight_kg  REAL,
  margin_kg                 REAL,
  within_limits             INTEGER
);

CREATE TABLE IF NOT EXISTS fuel_plans (
  id                     SERIAL PRIMARY KEY,
  flight_release_id      INTEGER NOT NULL UNIQUE REFERENCES flight_releases(id),
  trip_fuel_kg           REAL NOT NULL,
  alternate_fuel_kg      REAL NOT NULL DEFAULT 0,
  reserve_fuel_kg        REAL NOT NULL,
  contingency_fuel_kg    REAL NOT NULL DEFAULT 0,
  fuel_on_board_kg       REAL NOT NULL,
  computed_required_kg   REAL,
  margin_kg              REAL,
  sufficient             INTEGER
);

CREATE INDEX IF NOT EXISTS idx_flight_releases_status ON flight_releases(status);
CREATE INDEX IF NOT EXISTS idx_flight_releases_tail_date ON flight_releases(tail_number, flight_date);

CREATE TABLE IF NOT EXISTS flight_logs (
  id                      SERIAL PRIMARY KEY,
  flight_release_id       INTEGER REFERENCES flight_releases(id),
  tail_number             TEXT NOT NULL,
  pilot_employee_code     TEXT,
  flight_date             TEXT NOT NULL,
  actual_departure_time   TEXT NOT NULL,
  actual_arrival_time     TEXT NOT NULL,
  psv_start_time          TEXT,
  psv_end_time            TEXT,
  flight_hours            REAL,
  route_flown             TEXT,
  fuel_location            TEXT,
  fuel_liters              REAL,
  technical_remarks        TEXT,
  wb_screenshot_base64     TEXT,
  fpl_screenshot_base64    TEXT,
  pax_manifest_base64      TEXT,
  synced_to_maintenance    INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT NOW()::TEXT
);

-- Migración para bases creadas antes de estas columnas (la tabla ya existía
-- en producción, y CREATE TABLE IF NOT EXISTS no agrega columnas nuevas).
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS flight_hours REAL;
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS technical_remarks TEXT;
ALTER TABLE flight_logs ADD COLUMN IF NOT EXISTS synced_to_maintenance INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS oil_additions (
  id               SERIAL PRIMARY KEY,
  flight_log_id    INTEGER NOT NULL REFERENCES flight_logs(id),
  component        TEXT NOT NULL CHECK (component IN ('motor','xmsn','cola')),
  quantity         REAL NOT NULL,
  unit             TEXT NOT NULL DEFAULT 'L'
);

CREATE INDEX IF NOT EXISTS idx_flight_logs_tail_date ON flight_logs(tail_number, flight_date);
