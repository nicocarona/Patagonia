-- ============================================================================
-- Módulo de Mantenimiento por Componente — Sistema de Control de Flota de
-- Helicópteros
--
-- Cubre la sección 3 de la especificación funcional: seguimiento individual
-- de cada componente de vida limitada (no solo de la aeronave completa),
-- con límites en horas, ciclos y/o calendario, y bloqueo de vuelos que
-- harían exceder cualquiera de esos límites.
-- ============================================================================

CREATE TABLE IF NOT EXISTS aircraft (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  tail_number          TEXT NOT NULL UNIQUE,
  model                TEXT NOT NULL,
  total_hours          REAL NOT NULL DEFAULT 0,
  total_cycles         INTEGER NOT NULL DEFAULT 0
);

-- Un componente de vida limitada instalado en una aeronave. Puede tener
-- límite por horas, por ciclos, por calendario, o combinación (el que se
-- cumpla primero manda — como en la realidad).
CREATE TABLE IF NOT EXISTS components (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  aircraft_id           INTEGER NOT NULL REFERENCES aircraft(id),
  name                  TEXT NOT NULL,          -- ej. "Pala de rotor principal #1"
  part_number           TEXT,
  serial_number         TEXT,
  installed_date        TEXT NOT NULL,
  hours_limit           REAL,                    -- NULL = sin límite por horas
  cycles_limit          INTEGER,                 -- NULL = sin límite por ciclos
  calendar_limit_date   TEXT,                    -- NULL = sin límite calendario
  hours_accumulated     REAL NOT NULL DEFAULT 0,  -- horas acumuladas desde instalación/overhaul
  cycles_accumulated    INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'installed' CHECK (status IN ('installed','removed'))
);

-- Cada vuelo registrado incrementa las horas/ciclos de la aeronave Y de
-- todos sus componentes instalados — así es como se acumula la vida de
-- cada componente en la realidad (están todos en la misma aeronave).
CREATE TABLE IF NOT EXISTS flight_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  aircraft_id    INTEGER NOT NULL REFERENCES aircraft(id),
  flight_date    TEXT NOT NULL,
  hobbs_hours    REAL NOT NULL,
  cycles         INTEGER NOT NULL DEFAULT 1,
  notes          TEXT
);

CREATE TABLE IF NOT EXISTS work_orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
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

-- Ver fleet-billing-module/schema.sql para las notas de portabilidad a
-- PostgreSQL (mismo criterio aplicado aquí en schema.postgres.sql).
