-- ============================================================================
-- fleet-training-module — Entrenamiento y vigencias de tripulación
--
-- Tercer módulo nuevo de la hoja de ruta (AUDITORIA_Y_HOJA_DE_RUTA.docx,
-- sección 6): hasta ahora, fleet-scheduling-module tenía una tabla mínima
-- de "crew_qualifications" (modelo de aeronave + fecha de vencimiento) que
-- alguien cargaba a mano para bloquear reservas de pilotos sin
-- habilitación vigente. Este módulo es la fuente de verdad real detrás de
-- ese dato: licencias, certificados médicos, habilitaciones de tipo de
-- aeronave (type ratings — "en qué material está habilitado" cada
-- piloto), habilitaciones especiales (NVG, HEMS, carga externa, offshore,
-- montaña, instructor) y entrenamientos recurrentes (CRM, mercancías
-- peligrosas, emergencias). fleet-integration/sync.js (flujo 5) empuja las
-- habilitaciones de tipo VIGENTES hacia la tabla de Programación, igual
-- que Mantenimiento empuja aeronavegabilidad (flujo 2) — así el bloqueo en
-- Programación deja de depender de que alguien lo cargue a mano.
--
-- Referencia de mercado: sistemas de gestión de tripulación de aerolíneas
-- grandes (p. ej. Lufthansa Systems NetLine/Crew) llevan licencias, type
-- ratings, chequeos de línea y certificados médicos en un solo perfil por
-- tripulante, con alertas configurables antes del vencimiento — mismo
-- concepto que aplicamos aquí a escala de operador de helicópteros.
--
-- IMPORTANTE — intervalos NO codificados como regla fija: este prototipo
-- no asume una periodicidad regulatoria específica (p. ej. cada 6 o 12
-- meses) para chequeos de línea o entrenamiento recurrente — esos plazos
-- varían según la autoridad de aviación civil y el programa de
-- entrenamiento aprobado de cada operador. Cada registro trae su propia
-- fecha de vencimiento, cargada por quien administra el programa; el
-- sistema solo calcula si esa fecha ya pasó o está por vencer (umbral de
-- ejemplo: 60 días — ver trainingEngine.js), no de dónde sale el plazo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crew_members (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code  TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'pilot' CHECK (role IN ('pilot','copilot','mechanic','paramedic','dispatcher')),
  base           TEXT
);

CREATE TABLE IF NOT EXISTS licenses (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id             INTEGER NOT NULL REFERENCES crew_members(id),
  license_type        TEXT NOT NULL, -- p.ej. 'ATPL(H)', 'CPL(H)', 'PPL(H)' — nomenclatura de referencia, no verificada contra una autoridad específica
  license_number       TEXT,
  issuing_authority    TEXT,
  issue_date           TEXT,
  expiry_date          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS medical_certificates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id        INTEGER NOT NULL REFERENCES crew_members(id),
  class          TEXT NOT NULL DEFAULT '1', -- clase 1/2/3 — nomenclatura de referencia común, no una tabla oficial de una autoridad específica
  issue_date     TEXT,
  expiry_date    TEXT NOT NULL
);

-- "En qué material está habilitado" cada piloto — el corazón del módulo.
CREATE TABLE IF NOT EXISTS type_ratings (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id                   INTEGER NOT NULL REFERENCES crew_members(id),
  aircraft_model             TEXT NOT NULL,
  qualified_date             TEXT,
  last_proficiency_check     TEXT, -- último chequeo de línea/simulador
  expiry_date                 TEXT NOT NULL,
  UNIQUE(crew_id, aircraft_model)
);

CREATE TABLE IF NOT EXISTS special_qualifications (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id              INTEGER NOT NULL REFERENCES crew_members(id),
  qualification_code  TEXT NOT NULL CHECK (qualification_code IN ('NVG','HEMS','EXTERNAL_LOAD','OFFSHORE','MOUNTAIN','HOIST','INSTRUCTOR','EXAMINER')),
  issue_date           TEXT,
  expiry_date          TEXT,   -- algunas habilitaciones no vencen (p.ej. instructor con revalidación distinta) — puede quedar NULL
  notes                TEXT
);

CREATE TABLE IF NOT EXISTS recurrent_trainings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id           INTEGER NOT NULL REFERENCES crew_members(id),
  training_type     TEXT NOT NULL, -- p.ej. 'CRM', 'Mercancías peligrosas', 'Emergencias/evacuación', 'Supervivencia'
  completed_date    TEXT NOT NULL,
  expiry_date       TEXT,
  provider          TEXT,
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_licenses_crew ON licenses(crew_id);
CREATE INDEX IF NOT EXISTS idx_medical_crew ON medical_certificates(crew_id);
CREATE INDEX IF NOT EXISTS idx_type_ratings_crew ON type_ratings(crew_id);
CREATE INDEX IF NOT EXISTS idx_special_quals_crew ON special_qualifications(crew_id);
CREATE INDEX IF NOT EXISTS idx_recurrent_crew ON recurrent_trainings(crew_id);
