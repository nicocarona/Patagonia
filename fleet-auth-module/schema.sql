-- ============================================================================
-- fleet-auth-module — Usuarios y roles
--
-- Roles usados en todo el sistema (ver AUDITORIA_Y_HOJA_DE_RUTA.docx,
-- sección 6, punto 9 — "autenticación y control de acceso por rol"):
--   admin        acceso total en los 7 módulos
--   ops          crea/edita reservas en Programación
--   maintenance  registra vuelos, abre/cierra órdenes de trabajo
--   safety       reporta ocurrencias, aprueba FRAT de alto riesgo
--   finance      genera facturas
--   crew         edita habilitaciones, períodos de servicio, licencias
--   integration  cuenta de servicio usada por fleet-integration/sync.js
--   readonly     solo lectura en todos los módulos
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin','ops','maintenance','safety','finance','crew','integration','readonly')),
  full_name       TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
