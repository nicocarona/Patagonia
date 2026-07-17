-- ============================================================================
-- Módulo de Facturación — Sistema de Control de Flota de Helicópteros
-- Esquema de base de datos
--
-- Escrito en SQL estándar (compatible con SQLite y fácilmente portable a
-- PostgreSQL: ver notas de portabilidad al final de este archivo).
-- Todos los montos monetarios se guardan en CENTAVOS (INTEGER) para evitar
-- errores de redondeo con punto flotante.
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  contact_email       TEXT,
  tax_id              TEXT,
  payment_terms_days  INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE IF NOT EXISTS aircraft (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  tail_number                 TEXT NOT NULL UNIQUE,
  model                       TEXT NOT NULL,
  default_hourly_rate_cents   INTEGER NOT NULL
);

-- Un "contrato" define las reglas de tarifas para un cliente. Un cliente
-- puede tener varios contratos (p.ej. uno de chárter y otro de retainer HEMS).
CREATE TABLE IF NOT EXISTS contracts (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id               INTEGER NOT NULL REFERENCES customers(id),
  contract_type             TEXT NOT NULL CHECK (contract_type IN ('charter','hems_retainer','training','aerial_work')),
  flight_rate_cents         INTEGER,               -- si es NULL, se usa la tarifa por defecto de la aeronave
  positioning_rate_cents    INTEGER NOT NULL DEFAULT 0,
  standby_rate_cents        INTEGER NOT NULL DEFAULT 0,
  landing_fee_cents         INTEGER NOT NULL DEFAULT 0,
  fuel_surcharge_pct        REAL    NOT NULL DEFAULT 0,   -- % sobre (vuelo + posicionamiento)
  daily_minimum_hours       REAL    NOT NULL DEFAULT 0,   -- 0 = sin mínimo diario
  monthly_retainer_cents    INTEGER NOT NULL DEFAULT 0,   -- solo aplica a contract_type = 'hems_retainer'
  retainer_included_hours   REAL    NOT NULL DEFAULT 0,   -- horas de vuelo incluidas en el retainer
  overage_rate_cents        INTEGER,                       -- tarifa para horas que excedan el retainer
  tax_pct                   REAL    NOT NULL DEFAULT 0,
  active                    INTEGER NOT NULL DEFAULT 1
);

-- Registro de cada vuelo/misión facturable. Se captura una sola vez
-- (idealmente por integración automática con el módulo de operaciones)
-- y el motor de facturación lo consume sin doble digitación.
CREATE TABLE IF NOT EXISTS flights (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  aircraft_id         INTEGER NOT NULL REFERENCES aircraft(id),
  customer_id         INTEGER NOT NULL REFERENCES customers(id),
  contract_id         INTEGER NOT NULL REFERENCES contracts(id),
  flight_date         TEXT NOT NULL,     -- ISO 8601 (YYYY-MM-DD)
  mission_type        TEXT,
  flight_hours        REAL NOT NULL DEFAULT 0,   -- horas Hobbs/tach productivas
  positioning_hours   REAL NOT NULL DEFAULT 0,
  standby_hours       REAL NOT NULL DEFAULT 0,
  landing_count       INTEGER NOT NULL DEFAULT 0,
  notes               TEXT,
  invoiced            INTEGER NOT NULL DEFAULT 0,   -- 0 = pendiente de facturar
  invoice_id          INTEGER REFERENCES invoices(id),
  -- Referencia a la reserva de origen en el módulo de Programación
  -- (fleet-scheduling-module). UNIQUE evita crear un vuelo duplicado si el
  -- proceso de sincronización se corre más de una vez sobre la misma reserva.
  source_booking_id   INTEGER UNIQUE
);

CREATE TABLE IF NOT EXISTS invoices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number   TEXT NOT NULL UNIQUE,
  customer_id      INTEGER NOT NULL REFERENCES customers(id),
  contract_id      INTEGER NOT NULL REFERENCES contracts(id),
  period_start     TEXT NOT NULL,
  period_end       TEXT NOT NULL,
  issued_date      TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft',  -- draft | issued | paid | void
  subtotal_cents   INTEGER NOT NULL DEFAULT 0,
  tax_cents        INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id       INTEGER NOT NULL REFERENCES invoices(id),
  flight_id        INTEGER REFERENCES flights(id),
  line_type        TEXT NOT NULL,   -- flight_time | positioning | standby | landing_fee |
                                    -- fuel_surcharge | daily_minimum_adjustment |
                                    -- retainer | retainer_credit | overage
  description      TEXT NOT NULL,
  quantity         REAL,
  unit_rate_cents  INTEGER,
  amount_cents     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flights_customer_period ON flights(customer_id, flight_date);
CREATE INDEX IF NOT EXISTS idx_flights_invoiced ON flights(invoiced);
CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON invoice_line_items(invoice_id);

-- ============================================================================
-- NOTAS DE PORTABILIDAD A PostgreSQL (para producción)
-- ============================================================================
-- 1. Reemplazar "INTEGER PRIMARY KEY AUTOINCREMENT" por
--    "SERIAL PRIMARY KEY" (o "GENERATED ALWAYS AS IDENTITY").
-- 2. Los tipos TEXT/REAL/INTEGER son válidos en Postgres, pero se recomienda:
--       TEXT       -> TEXT (igual)
--       REAL       -> NUMERIC(10,2) para horas, o mantener REAL si la
--                      precisión de punto flotante es aceptable
--       fecha TEXT -> DATE / TIMESTAMPTZ
-- 3. Los montos en centavos (INTEGER) son igualmente válidos en Postgres;
--    alternativamente usar el tipo NUMERIC(12,2) si se prefiere no trabajar
--    en centavos.
-- 4. Los CHECK constraints y REFERENCES son compatibles sin cambios.
-- 5. El driver Node.js cambia de `node:sqlite` a `pg`; la capa de acceso a
--    datos (db.js) es la única que debe reescribirse — el motor de negocio
--    (billingEngine.js) no depende del motor de base de datos.
-- ============================================================================
