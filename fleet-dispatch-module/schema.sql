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
