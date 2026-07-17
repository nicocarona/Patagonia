-- ============================================================================
-- Módulo SMS (Sistema de Gestión de Seguridad) — Sistema de Control de
-- Flota de Helicópteros
--
-- Cubre lo descrito en la sección 6 de la especificación funcional: reporte
-- de ocurrencias/peligros, evaluación de riesgo de vuelo (FRAT) antes de
-- cada misión, registro de peligros (hazard register) y seguimiento de
-- acciones correctivas.
-- ============================================================================

CREATE TABLE IF NOT EXISTS occurrences (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date       TEXT NOT NULL,   -- ISO 8601 (YYYY-MM-DD)
  reported_by       TEXT,
  occurrence_type   TEXT NOT NULL CHECK (occurrence_type IN ('incident','accident','hazard_report','near_miss')),
  aircraft_tail     TEXT,
  description       TEXT NOT NULL,
  severity          TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical')),
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','closed')),
  root_cause        TEXT,
  closed_date       TEXT
);

-- Registro de peligros (hazard register): identificados proactivamente,
-- no necesariamente ligados a una ocurrencia ya sucedida.
CREATE TABLE IF NOT EXISTS hazards (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  identified_date   TEXT NOT NULL,
  category          TEXT,      -- ej. "mantenimiento", "clima", "terreno", "procedimientos"
  description       TEXT NOT NULL,
  likelihood        INTEGER NOT NULL DEFAULT 1 CHECK (likelihood BETWEEN 1 AND 5),
  consequence       INTEGER NOT NULL DEFAULT 1 CHECK (consequence BETWEEN 1 AND 5),
  risk_score        INTEGER NOT NULL DEFAULT 1,  -- likelihood * consequence (1 a 25)
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','mitigated','closed'))
);

CREATE TABLE IF NOT EXISTS corrective_actions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  occurrence_id     INTEGER REFERENCES occurrences(id),
  hazard_id         INTEGER REFERENCES hazards(id),
  description       TEXT NOT NULL,
  assigned_to       TEXT,
  due_date          TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
  completed_date    TEXT
);

-- Evaluación de riesgo de vuelo (FRAT) — se hace ANTES de cada misión,
-- calificando 6 factores de 0 a 4. La suma determina el nivel de riesgo y,
-- si es alto o extremo, exige una aprobación explícita antes de autorizar
-- el vuelo (ver smsEngine.js).
--
-- fatigue_score puede ingresarse a mano (fatigue_source='manual', el
-- comportamiento original) o heredarse del score REAL calculado por
-- fleet-crew-module a partir de horas de servicio (fatigue_source=
-- 'tripulacion') si se pasa pilot_employee_code y hay una fotografía
-- reciente en fatigue_snapshots — ver el flujo 7 de
-- fleet-integration/sync.js.
CREATE TABLE IF NOT EXISTS frat_assessments (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  flight_date           TEXT NOT NULL,
  aircraft_tail         TEXT,
  mission_type          TEXT,
  pilot_employee_code   TEXT,    -- opcional: si viene, permite heredar fatigue_score real (ver fatigue_snapshots)
  weather_score         INTEGER NOT NULL DEFAULT 0 CHECK (weather_score BETWEEN 0 AND 4),
  terrain_score         INTEGER NOT NULL DEFAULT 0 CHECK (terrain_score BETWEEN 0 AND 4),
  pilot_currency_score  INTEGER NOT NULL DEFAULT 0 CHECK (pilot_currency_score BETWEEN 0 AND 4),
  fatigue_score         INTEGER NOT NULL DEFAULT 0 CHECK (fatigue_score BETWEEN 0 AND 4),
  fatigue_source        TEXT NOT NULL DEFAULT 'manual' CHECK (fatigue_source IN ('manual','tripulacion')),
  aircraft_status_score INTEGER NOT NULL DEFAULT 0 CHECK (aircraft_status_score BETWEEN 0 AND 4),
  operational_pressure_score INTEGER NOT NULL DEFAULT 0 CHECK (operational_pressure_score BETWEEN 0 AND 4),
  total_score           INTEGER NOT NULL,
  risk_level            TEXT NOT NULL,  -- bajo | moderado | alto | extremo
  requires_approval     INTEGER NOT NULL DEFAULT 0,
  approved_by           TEXT,
  notes                 TEXT
);

-- Espejo del score de fatiga REAL calculado por fleet-crew-module
-- (computeFatigueScore, 0-100) para cada piloto — lo mantiene actualizado
-- el flujo 7 de fleet-integration/sync.js ("Tripulación -> SMS"). Un solo
-- registro "vigente" por piloto (upsert por employee_code): no es un
-- historial, es la última fotografía conocida, igual que
-- fleet-scheduling-module.aircraft.airworthy es un espejo, no un log.
CREATE TABLE IF NOT EXISTS fatigue_snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code     TEXT UNIQUE NOT NULL,
  snapshot_date     TEXT NOT NULL,
  score_0_100       INTEGER NOT NULL,   -- score crudo de fleet-crew-module (0=descansado, 100+=en el límite o excedido)
  level             TEXT NOT NULL,      -- bajo | moderado | alto | crítico (mismas etiquetas que fleet-crew-module)
  fatigue_band_0_4  INTEGER NOT NULL CHECK (fatigue_band_0_4 BETWEEN 0 AND 4), -- score_0_100 traducido a la escala del FRAT
  synced_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_occurrences_status ON occurrences(status);
CREATE INDEX IF NOT EXISTS idx_hazards_status ON hazards(status);
CREATE INDEX IF NOT EXISTS idx_frat_date ON frat_assessments(flight_date);

-- Ver fleet-billing-module/schema.sql para las notas de portabilidad a
-- PostgreSQL (mismo criterio aplicado aquí en schema.postgres.sql).
