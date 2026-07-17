-- Módulo de Mantenimiento por Componente — Esquema PostgreSQL (SERIAL en vez de AUTOINCREMENT).

CREATE TABLE IF NOT EXISTS aircraft (
  id                   SERIAL PRIMARY KEY,
  tail_number          TEXT NOT NULL UNIQUE,
  model                TEXT NOT NULL,
  total_hours          REAL NOT NULL DEFAULT 0,
  total_cycles         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS components (
  id                    SERIAL PRIMARY KEY,
  aircraft_id           INTEGER NOT NULL REFERENCES aircraft(id),
  name                  TEXT NOT NULL,
  part_number           TEXT,
  serial_number         TEXT,
  installed_date        TEXT NOT NULL,
  hours_limit           REAL,
  cycles_limit          INTEGER,
  calendar_limit_date   TEXT,
  hours_accumulated     REAL NOT NULL DEFAULT 0,
  cycles_accumulated    INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'installed' CHECK (status IN ('installed','removed'))
);

CREATE TABLE IF NOT EXISTS flight_logs (
  id             SERIAL PRIMARY KEY,
  aircraft_id    INTEGER NOT NULL REFERENCES aircraft(id),
  flight_date    TEXT NOT NULL,
  hobbs_hours    REAL NOT NULL,
  cycles         INTEGER NOT NULL DEFAULT 1,
  notes          TEXT
);

CREATE TABLE IF NOT EXISTS work_orders (
  id             SERIAL PRIMARY KEY,
  aircraft_id    INTEGER NOT NULL REFERENCES aircraft(id),
  component_id   INTEGER REFERENCES components(id),
  description    TEXT NOT NULL,
  action_type    TEXT NOT NULL DEFAULT 'repair' CHECK (action_type IN ('repair','inspection','overhaul','replacement')),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed')),
  opened_date    TEXT NOT NULL,
  closed_date    TEXT
);

CREATE INDEX IF NOT EXISTS idx_components_aircraft ON components(aircraft_id, status);
CREATE INDEX IF NOT EXISTS idx_flight_logs_aircraft ON flight_logs(aircraft_id, flight_date);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
