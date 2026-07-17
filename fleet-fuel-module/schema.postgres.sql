-- fleet-fuel-module — Esquema PostgreSQL (SERIAL en vez de AUTOINCREMENT).

CREATE TABLE IF NOT EXISTS fuel_suppliers (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  contact_email         TEXT,
  base                  TEXT NOT NULL,
  contract_number       TEXT,
  price_per_liter_cents INTEGER NOT NULL,
  contract_start_date   TEXT,
  contract_end_date     TEXT,
  active                INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fuel_tanks (
  id                          SERIAL PRIMARY KEY,
  base                        TEXT UNIQUE NOT NULL,
  capacity_liters             REAL NOT NULL,
  current_level_liters        REAL NOT NULL DEFAULT 0,
  average_cost_per_liter_cents REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fuel_deliveries (
  id                     SERIAL PRIMARY KEY,
  base                   TEXT NOT NULL,
  supplier_id            INTEGER NOT NULL REFERENCES fuel_suppliers(id),
  liters                 REAL NOT NULL,
  price_per_liter_cents  INTEGER NOT NULL,
  total_cost_cents       INTEGER NOT NULL,
  delivery_date          TEXT NOT NULL,
  notes                  TEXT
);

CREATE TABLE IF NOT EXISTS fuel_uplifts (
  id                        SERIAL PRIMARY KEY,
  tail_number               TEXT NOT NULL,
  base                      TEXT NOT NULL,
  liters                    REAL NOT NULL,
  cost_per_liter_cents      REAL NOT NULL,
  total_cost_cents          REAL NOT NULL,
  uplift_date               TEXT NOT NULL,
  source_flight_release_id  INTEGER UNIQUE,
  notes                     TEXT
);

CREATE INDEX IF NOT EXISTS idx_deliveries_base_date ON fuel_deliveries(base, delivery_date);
CREATE INDEX IF NOT EXISTS idx_uplifts_tail_date ON fuel_uplifts(tail_number, uplift_date);
CREATE INDEX IF NOT EXISTS idx_uplifts_base_date ON fuel_uplifts(base, uplift_date);
