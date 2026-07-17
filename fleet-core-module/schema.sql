-- ============================================================================
-- fleet-core-module — Maestro de datos (Master Data / System of Record)
--
-- Por qué existe este módulo: en la auditoría de julio 2026 se detectó que
-- cada módulo (facturación, programación, tripulación, mantenimiento) tenía
-- su PROPIA tabla de aeronaves y/o tripulantes, sin ninguna clave común más
-- allá de coincidencias de texto (tail_number, nombre). Eso es exactamente
-- lo que un ERP aeronáutico real evita: un operador grande como Bristow
-- Group centraliza mantenimiento, ingeniería, inventario y operaciones
-- sobre UNA plataforma integrada (Ramco Aviation M&E, seleccionada en 2021 —
-- ver README para la fuente). Nuestro equivalente, dado que cada módulo es
-- un servicio HTTP independiente (arquitectura federada, más parecida a
-- cómo Babcock MCS conecta su ERP Sage X3 con sistemas de vuelo separados),
-- es tener UN registro maestro y sincronizar identidad (no datos operativos)
-- hacia cada módulo vía fleet-integration/sync.js.
--
-- Este módulo NO reemplaza las tablas locales de cada módulo — sigue
-- existiendo aircraft en facturación, scheduling, mantenimiento, etc. Lo
-- que aporta es la matrícula/legajo como clave única de la que todo lo
-- demás cuelga, y el punto único donde se da de alta una aeronave o un
-- tripulante nuevo antes de que exista en cualquier otro sistema.
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  contact_email       TEXT,
  segment             TEXT   -- offshore | hems | mining | vip | training | aerial_work
);

CREATE TABLE IF NOT EXISTS aircraft (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  tail_number                 TEXT NOT NULL UNIQUE,
  model                       TEXT NOT NULL,
  serial_number               TEXT,
  base                        TEXT,
  customer_id                 INTEGER REFERENCES customers(id),  -- null = flota propia / uso compartido
  status                      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','retired')),
  default_hourly_rate_cents   INTEGER,   -- referencia inicial para el módulo de facturación
  created_at                  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crew_members (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code  TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('pilot','copilot','mechanic','paramedic','dispatcher')),
  base           TEXT,
  email          TEXT,
  hire_date      TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','leave','terminated'))
);

-- Bitácora de sincronización: qué módulo recibió qué versión del maestro y
-- cuándo. Sirve para depurar por qué un módulo quedó desactualizado, igual
-- que un log de integración en un ERP real.
CREATE TABLE IF NOT EXISTS sync_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT NOT NULL,  -- aircraft | crew
  entity_key    TEXT NOT NULL,  -- tail_number o employee_code
  target_module TEXT NOT NULL,  -- billing | scheduling | maintenance | crew
  synced_at     TEXT NOT NULL,
  result        TEXT NOT NULL   -- ok | error
);

CREATE INDEX IF NOT EXISTS idx_sync_log_entity ON sync_log(entity_type, entity_key);
