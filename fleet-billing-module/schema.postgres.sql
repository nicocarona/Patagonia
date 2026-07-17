-- ============================================================================
-- Módulo de Facturación — Esquema PostgreSQL
--
-- Traducción directa de schema.sql (SQLite) siguiendo las notas de
-- portabilidad de ese archivo: SERIAL en vez de AUTOINCREMENT. El resto de
-- los tipos (TEXT, INTEGER, REAL) son válidos sin cambios en Postgres.
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  contact_email       TEXT,
  tax_id              TEXT,
  payment_terms_days  INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE IF NOT EXISTS aircraft (
  id                          SERIAL PRIMARY KEY,
  tail_number                 TEXT NOT NULL UNIQUE,
  model                       TEXT NOT NULL,
  default_hourly_rate_cents   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id                        SERIAL PRIMARY KEY,
  customer_id               INTEGER NOT NULL REFERENCES customers(id),
  contract_type             TEXT NOT NULL CHECK (contract_type IN ('charter','hems_retainer','training','aerial_work')),
  flight_rate_cents         INTEGER,
  positioning_rate_cents    INTEGER NOT NULL DEFAULT 0,
  standby_rate_cents        INTEGER NOT NULL DEFAULT 0,
  landing_fee_cents         INTEGER NOT NULL DEFAULT 0,
  fuel_surcharge_pct        REAL    NOT NULL DEFAULT 0,
  daily_minimum_hours       REAL    NOT NULL DEFAULT 0,
  monthly_retainer_cents    INTEGER NOT NULL DEFAULT 0,
  retainer_included_hours   REAL    NOT NULL DEFAULT 0,
  overage_rate_cents        INTEGER,
  tax_pct                   REAL    NOT NULL DEFAULT 0,
  active                    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS invoices (
  id               SERIAL PRIMARY KEY,
  invoice_number   TEXT NOT NULL UNIQUE,
  customer_id      INTEGER NOT NULL REFERENCES customers(id),
  contract_id      INTEGER NOT NULL REFERENCES contracts(id),
  period_start     TEXT NOT NULL,
  period_end       TEXT NOT NULL,
  issued_date      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft',
  subtotal_cents   INTEGER NOT NULL DEFAULT 0,
  tax_cents        INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS flights (
  id                  SERIAL PRIMARY KEY,
  aircraft_id         INTEGER NOT NULL REFERENCES aircraft(id),
  customer_id         INTEGER NOT NULL REFERENCES customers(id),
  contract_id         INTEGER NOT NULL REFERENCES contracts(id),
  flight_date         TEXT NOT NULL,
  mission_type        TEXT,
  flight_hours        REAL NOT NULL DEFAULT 0,
  positioning_hours   REAL NOT NULL DEFAULT 0,
  standby_hours       REAL NOT NULL DEFAULT 0,
  landing_count       INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  invoiced            INTEGER NOT NULL DEFAULT 0,
  invoice_id          INTEGER REFERENCES invoices(id),
  source_booking_id   INTEGER UNIQUE
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id               SERIAL PRIMARY KEY,
  invoice_id       INTEGER NOT NULL REFERENCES invoices(id),
  flight_id        INTEGER REFERENCES flights(id),
  line_type        TEXT NOT NULL,
  description      TEXT NOT NULL,
  quantity         REAL,
  unit_rate_cents  INTEGER,
  amount_cents     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flights_customer_period ON flights(customer_id, flight_date);
CREATE INDEX IF NOT EXISTS idx_flights_invoiced ON flights(invoiced);
CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON invoice_line_items(invoice_id);
