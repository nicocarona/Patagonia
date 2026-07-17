-- fleet-core-module — Esquema PostgreSQL (SERIAL en vez de AUTOINCREMENT).

CREATE TABLE IF NOT EXISTS customers (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  contact_email       TEXT,
  segment             TEXT
);

CREATE TABLE IF NOT EXISTS aircraft (
  id                          SERIAL PRIMARY KEY,
  tail_number                 TEXT NOT NULL UNIQUE,
  model                       TEXT NOT NULL,
  serial_number               TEXT,
  base                        TEXT,
  customer_id                 INTEGER REFERENCES customers(id),
  status                      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','retired')),
  default_hourly_rate_cents   INTEGER,
  created_at                  TEXT NOT NULL DEFAULT NOW()::TEXT
);

CREATE TABLE IF NOT EXISTS crew_members (
  id             SERIAL PRIMARY KEY,
  employee_code  TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('pilot','copilot','mechanic','paramedic','dispatcher')),
  base           TEXT,
  email          TEXT,
  hire_date      TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','leave','terminated'))
);

CREATE TABLE IF NOT EXISTS sync_log (
  id            SERIAL PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  entity_key    TEXT NOT NULL,
  target_module TEXT NOT NULL,
  synced_at     TEXT NOT NULL,
  result        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync_log(entity_type, entity_key);
