-- ============================================================================
-- fleet-fuel-module — Gestión de combustible
--
-- Cuarto módulo nuevo de la hoja de ruta (AUDITORIA_Y_HOJA_DE_RUTA.docx,
-- sección 6). Distinto de fleet-dispatch-module: Despacho valida, PARA UN
-- VUELO PUNTUAL, que el combustible a bordo alcance (peso, kg). Este
-- módulo administra el combustible como INSUMO operativo continuo: con
-- qué proveedores hay contrato, cuánto combustible hay en el tanque de
-- cada base, cuánto entra (entregas de proveedor) y cuánto sale
-- (repostaje/"uplift" a cada aeronave), y a qué costo — el mismo tipo de
-- control que un operador real lleva sobre su insumo más caro después de
-- la propia aeronave.
--
-- Terminología: "uplift" es el término estándar en la industria para
-- cargar combustible a una aeronave (de "fuel uplift") — no es un
-- anglicismo nuestro, así lo nombran los sistemas de gestión de
-- combustible de aerolíneas y operadores reales.
--
-- Patrón "bloquear antes, no descubrir después" aplicado aquí: no se
-- puede registrar un uplift mayor al combustible disponible en el tanque
-- de esa base — mismo criterio que el stock negativo en
-- fleet-inventory-module.
--
-- IMPORTANTE — sobre el costeo: cada tanque lleva un costo promedio
-- ponderado por litro (weighted average cost), recalculado con cada
-- entrega — es un método contable estándar (el mismo que usa cualquier
-- sistema de inventario), NO una cifra específica de ningún proveedor o
-- mercado real. Los precios en src/seed.js son de ejemplo.
-- ============================================================================

CREATE TABLE IF NOT EXISTS fuel_suppliers (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  name                  TEXT NOT NULL,
  contact_email         TEXT,
  base                  TEXT NOT NULL,
  contract_number       TEXT,
  price_per_liter_cents INTEGER NOT NULL,
  contract_start_date   TEXT,
  contract_end_date     TEXT,
  active                INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fuel_tanks (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  base                        TEXT UNIQUE NOT NULL,
  capacity_liters             REAL NOT NULL,
  current_level_liters        REAL NOT NULL DEFAULT 0,
  average_cost_per_liter_cents REAL NOT NULL DEFAULT 0
);

-- Proveedor -> tanque de la base (entrada de combustible).
CREATE TABLE IF NOT EXISTS fuel_deliveries (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  base                   TEXT NOT NULL,
  supplier_id            INTEGER NOT NULL REFERENCES fuel_suppliers(id),
  liters                 REAL NOT NULL,
  price_per_liter_cents  INTEGER NOT NULL,
  total_cost_cents       INTEGER NOT NULL,
  delivery_date          TEXT NOT NULL,
  notes                  TEXT
);

-- Tanque de la base -> aeronave (salida de combustible / repostaje).
CREATE TABLE IF NOT EXISTS fuel_uplifts (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  tail_number               TEXT NOT NULL,
  base                      TEXT NOT NULL,
  liters                    REAL NOT NULL,
  cost_per_liter_cents      REAL NOT NULL, -- snapshot del costo promedio del tanque al momento del uplift
  total_cost_cents          REAL NOT NULL,
  uplift_date               TEXT NOT NULL,
  source_flight_release_id  INTEGER UNIQUE, -- referencia opcional a fleet-dispatch-module (clave de negocio, sin FK real)
  notes                     TEXT
);

CREATE INDEX IF NOT EXISTS idx_deliveries_base_date ON fuel_deliveries(base, delivery_date);
CREATE INDEX IF NOT EXISTS idx_uplifts_tail_date ON fuel_uplifts(tail_number, uplift_date);
CREATE INDEX IF NOT EXISTS idx_uplifts_base_date ON fuel_uplifts(base, uplift_date);
