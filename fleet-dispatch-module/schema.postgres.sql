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
