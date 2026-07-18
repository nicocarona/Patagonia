-- ============================================================================
-- fleet-dispatch-module — Despacho de vuelo (Flight Release / OFP)
--
-- Segundo módulo nuevo de la hoja de ruta (AUDITORIA_Y_HOJA_DE_RUTA.docx,
-- sección 6, punto 3): hasta ahora, Programación reservaba un bloque de
-- horario, pero nada generaba el plan de vuelo operacional (peso y
-- balance, combustible, alterno) que un despachador debe aprobar antes del
-- despegue. Este módulo cubre esa función: NO se puede liberar (release)
-- un vuelo si el peso total excede el máximo de despegue, o si el
-- combustible a bordo no alcanza para viaje + alterno + reserva +
-- contingencia — mismo patrón "bloquear antes, no descubrir después" que
-- el resto del sistema.
--
-- source_booking_id enlaza (opcionalmente, texto libre igual que en
-- facturación) con una reserva de fleet-scheduling-module — no hay FK real
-- entre bases de datos distintas.
--
-- synced_to_fuel: cuando un despacho se cierra, fleet-integration (flujo
-- 6) convierte su plan de combustible en un uplift real dentro de
-- fleet-fuel-module — este campo evita reprocesarlo, mismo patrón que
-- synced_to_billing en fleet-scheduling-module.
-- ============================================================================

CREATE TABLE IF NOT EXISTS flight_releases (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_booking_id             INTEGER,               -- referencia opcional a una reserva de Programación
  tail_number                   TEXT NOT NULL,
  pic_name                      TEXT NOT NULL,          -- piloto al mando (pilot in command)
  flight_date                   TEXT NOT NULL,
  departure_base                TEXT NOT NULL,
  destination                   TEXT NOT NULL,
  alternate                     TEXT,                   -- aeródromo alterno
  route                         TEXT,
  planned_departure_time        TEXT,                   -- HH:MM
  estimated_flight_time_hours   REAL NOT NULL,
  status                        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','released','departed','closed','cancelled')),
  dispatcher_name               TEXT,                   -- quien autorizó la liberación
  released_at                   TEXT,
  departed_at                   TEXT,
  closed_at                     TEXT,
  synced_to_fuel                INTEGER NOT NULL DEFAULT 0,
  created_at                    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weight_balance (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  flight_release_id         INTEGER NOT NULL UNIQUE REFERENCES flight_releases(id),
  empty_weight_kg           REAL NOT NULL,
  crew_weight_kg            REAL NOT NULL DEFAULT 0,
  passenger_weight_kg       REAL NOT NULL DEFAULT 0,
  cargo_weight_kg           REAL NOT NULL DEFAULT 0,
  fuel_weight_kg            REAL NOT NULL DEFAULT 0,
  max_takeoff_weight_kg     REAL NOT NULL,
  computed_total_weight_kg  REAL,
  margin_kg                 REAL,
  within_limits             INTEGER
);

CREATE TABLE IF NOT EXISTS fuel_plans (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  flight_release_id      INTEGER NOT NULL UNIQUE REFERENCES flight_releases(id),
  trip_fuel_kg           REAL NOT NULL,
  alternate_fuel_kg      REAL NOT NULL DEFAULT 0,
  reserve_fuel_kg        REAL NOT NULL,
  contingency_fuel_kg    REAL NOT NULL DEFAULT 0,
  fuel_on_board_kg       REAL NOT NULL,
  computed_required_kg   REAL,
  margin_kg              REAL,
  sufficient             INTEGER
);

CREATE INDEX IF NOT EXISTS idx_flight_releases_status ON flight_releases(status);
CREATE INDEX IF NOT EXISTS idx_flight_releases_tail_date ON flight_releases(tail_number, flight_date);

-- ============================================================================
-- Bitácora de vuelo (flight_logs) — lo que el piloto carga DESPUÉS del vuelo,
-- a pedido del operador: horarios reales, PSV (período de servicio de vuelo,
-- por defecto 1h antes del despegue y 30min después del aterrizaje, editable
-- si el operador lo ajusta distinto), ruta realmente volada, combustible y
-- aceite cargados, y tres archivos de respaldo para fiscalización DGAC
-- (captura del W&B, del FPL y del manifiesto de pasajeros), guardados como
-- base64 directo en la base de datos — no en el disco del servidor, que en
-- Render no es persistente entre reinicios (ver README).
-- ============================================================================

CREATE TABLE IF NOT EXISTS flight_logs (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  flight_release_id       INTEGER REFERENCES flight_releases(id), -- opcional: enlaza con el despacho de origen
  tail_number             TEXT NOT NULL,
  pilot_employee_code     TEXT,
  flight_date             TEXT NOT NULL,
  actual_departure_time   TEXT NOT NULL,   -- HH:MM
  actual_arrival_time     TEXT NOT NULL,   -- HH:MM
  psv_start_time          TEXT,            -- HH:MM, por defecto departure -1h
  psv_end_time            TEXT,            -- HH:MM, por defecto arrival +30min
  route_flown             TEXT,
  fuel_location            TEXT,           -- dónde se cargó combustible
  fuel_liters              REAL,
  wb_screenshot_base64     TEXT,           -- captura del peso y balance (generada por la app o subida)
  fpl_screenshot_base64    TEXT,           -- captura del FPL DGAC
  pax_manifest_base64      TEXT,           -- captura del manifiesto de pasajeros
  created_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oil_additions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  flight_log_id    INTEGER NOT NULL REFERENCES flight_logs(id),
  component        TEXT NOT NULL CHECK (component IN ('motor','xmsn','cola')),
  quantity         REAL NOT NULL,
  unit             TEXT NOT NULL DEFAULT 'L'
);

CREATE INDEX IF NOT EXISTS idx_flight_logs_tail_date ON flight_logs(tail_number, flight_date);
