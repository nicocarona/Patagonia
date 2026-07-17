-- ============================================================================
-- Módulo de Tripulación y Fatiga — Sistema de Control de Flota de
-- Helicópteros
--
-- Independiente del módulo de Programación (fleet-scheduling-module): ese
-- módulo valida disponibilidad de piloto/aeronave para VUELOS. Este módulo
-- es la fuente de verdad de horas de servicio (duty time) de CUALQUIER
-- actividad —vuelo, entrenamiento, standby administrativo— y de las reglas
-- de fatiga acumuladas (diaria, semanal, mensual, descanso mínimo).
-- ============================================================================

CREATE TABLE IF NOT EXISTS crew_members (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code  TEXT UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('pilot','copilot','mechanic','paramedic','dispatcher')),
  email          TEXT
);

CREATE TABLE IF NOT EXISTS crew_qualifications (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id              INTEGER NOT NULL REFERENCES crew_members(id),
  aircraft_model       TEXT NOT NULL,
  qualification_type   TEXT NOT NULL DEFAULT 'type_rating', -- type_rating | nvis | hems_crew | instructor
  valid_until          TEXT NOT NULL
);

-- Cualquier período de servicio del tripulante, sea vuelo, entrenamiento,
-- standby o trabajo administrativo — toda actividad cuenta para las reglas
-- de fatiga, no solo las horas de vuelo.
CREATE TABLE IF NOT EXISTS duty_periods (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id             INTEGER NOT NULL REFERENCES crew_members(id),
  duty_date           TEXT NOT NULL,   -- ISO 8601 (YYYY-MM-DD)
  start_time          TEXT NOT NULL,   -- HH:MM (24h)
  end_time            TEXT NOT NULL,   -- HH:MM (24h)
  duty_type           TEXT NOT NULL DEFAULT 'flight', -- flight | training | standby | admin
  source_booking_id   INTEGER,   -- referencia opcional a una reserva del módulo de Programación
  notes               TEXT
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id      INTEGER NOT NULL REFERENCES crew_members(id),
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  leave_type   TEXT NOT NULL DEFAULT 'vacation', -- vacation | sick | other
  status       TEXT NOT NULL DEFAULT 'approved'  -- approved | pending | rejected
);

CREATE INDEX IF NOT EXISTS idx_duty_crew_date ON duty_periods(crew_id, duty_date);
CREATE INDEX IF NOT EXISTS idx_leave_crew_dates ON leave_requests(crew_id, start_date, end_date);

-- Ver fleet-billing-module/schema.sql para las notas de portabilidad a
-- PostgreSQL (mismo criterio aplicado aquí en schema.postgres.sql).
