-- ============================================================================
-- Módulo de Programación de Vuelos (Scheduling) — Sistema de Control de Flota
-- de Helicópteros
--
-- Igual que el módulo de facturación: SQL portable, pensado para migrar a
-- PostgreSQL sin tocar el motor de negocio (ver notas al final).
-- ============================================================================

CREATE TABLE IF NOT EXISTS aircraft (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  tail_number                 TEXT NOT NULL UNIQUE,
  model                       TEXT NOT NULL,
  base                        TEXT,
  -- Reflejo del estado de aeronavegabilidad del módulo de Mantenimiento
  -- (fleet-maintenance-module), empujado por fleet-integration/sync.js.
  -- Es un espejo de solo lectura para este módulo: la fuente de verdad
  -- sigue siendo el dashboard de mantenimiento, no este campo.
  airworthy                   INTEGER NOT NULL DEFAULT 1,
  airworthy_synced_at         TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crew_members (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Identificador único de legajo, igual en todos los módulos — es la
  -- clave que fleet-integration usa para enlazar al mismo tripulante entre
  -- Programación, Tripulación/Fatiga y el maestro central (fleet-core-module).
  employee_code  TEXT UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('pilot','copilot','mechanic','paramedic','dispatcher')),
  email          TEXT
);

-- Habilitación de un tripulante para volar un modelo específico de aeronave.
-- Una habilitación en H125 NO autoriza volar un H145: cada modelo requiere
-- su propio registro.
CREATE TABLE IF NOT EXISTS crew_qualifications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id           INTEGER NOT NULL REFERENCES crew_members(id),
  aircraft_model    TEXT NOT NULL,
  qualification_type TEXT NOT NULL DEFAULT 'type_rating', -- type_rating | nvis | hems_crew | instructor
  valid_until       TEXT NOT NULL   -- ISO 8601 (YYYY-MM-DD)
);

-- Reserva/misión programada. certificate_context distingue bajo qué marco
-- regulatorio/actividad vuela (impacta reglas de duty time y facturación).
CREATE TABLE IF NOT EXISTS bookings (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  aircraft_id              INTEGER NOT NULL REFERENCES aircraft(id),
  pilot_id                 INTEGER NOT NULL REFERENCES crew_members(id),
  customer_id              INTEGER REFERENCES customers(id),
  booking_date             TEXT NOT NULL,   -- ISO 8601 (YYYY-MM-DD)
  start_time               TEXT NOT NULL,   -- HH:MM (24h)
  end_time                 TEXT NOT NULL,   -- HH:MM (24h)
  mission_type             TEXT,
  certificate_context      TEXT NOT NULL DEFAULT 'charter', -- charter | training | hems | aerial_work
  status                   TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | completed | cancelled
  notes                    TEXT,
  -- Datos de cierre (se llenan cuando el vuelo se completa realmente; el
  -- bloque reservado arriba es la ventana planeada, no necesariamente igual
  -- a las horas Hobbs/tach reales facturables).
  billing_contract_id      INTEGER,   -- id del contrato en el módulo de facturación
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

-- ============================================================================
-- NOTAS DE PORTABILIDAD A PostgreSQL — igual criterio que en el módulo de
-- facturación: SERIAL/IDENTITY en vez de AUTOINCREMENT, TIME/DATE nativos en
-- vez de TEXT si se prefiere validación de tipo a nivel de BD. El motor de
-- negocio (schedulingEngine.js) no depende del motor de base de datos.
-- ============================================================================
