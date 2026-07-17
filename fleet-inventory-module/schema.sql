-- ============================================================================
-- fleet-inventory-module — Inventario y almacén de repuestos
--
-- Primer módulo nuevo de la hoja de ruta (AUDITORIA_Y_HOJA_DE_RUTA.docx,
-- sección 6, punto 1): hasta ahora, Mantenimiento asumía que un componente
-- de reemplazo simplemente existe cuando se cierra una orden de trabajo.
-- Este módulo rastrea el stock físico real y, vía fleet-integration
-- (flujo 4), genera automáticamente una orden de compra cuando un
-- componente de Mantenimiento está por vencer sin repuesto disponible.
--
-- La clave de enlace con Mantenimiento es part_number (texto libre, igual
-- que en fleet-maintenance-module.components.part_number) — no hay FK real
-- entre bases de datos distintas, es la misma convención de matching por
-- clave de negocio usada en toda la capa de integración (tail_number para
-- aeronaves, employee_code para tripulantes).
-- ============================================================================

CREATE TABLE IF NOT EXISTS warehouses (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  location  TEXT
);

CREATE TABLE IF NOT EXISTS parts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number       TEXT NOT NULL UNIQUE,
  description       TEXT NOT NULL,
  category          TEXT,          -- rotor | transmision | aviónica | tren_aterrizaje | consumible | otro
  unit_cost_cents   INTEGER NOT NULL DEFAULT 0,
  min_stock_qty     INTEGER NOT NULL DEFAULT 0,   -- punto de reorden
  lead_time_days    INTEGER NOT NULL DEFAULT 30,  -- tiempo típico de entrega del proveedor
  preferred_supplier TEXT
);

CREATE TABLE IF NOT EXISTS stock_items (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id              INTEGER NOT NULL REFERENCES parts(id),
  warehouse_id         INTEGER NOT NULL REFERENCES warehouses(id),
  quantity_on_hand     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (part_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id        INTEGER NOT NULL REFERENCES parts(id),
  warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
  movement_type  TEXT NOT NULL CHECK (movement_type IN ('receipt','issue','adjustment')),
  quantity       INTEGER NOT NULL,   -- siempre positivo; el signo lo da movement_type
  reference      TEXT,               -- p.ej. "OT #12 (fleet-maintenance-module)" o número de PO
  movement_date  TEXT NOT NULL,
  notes          TEXT
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id               INTEGER NOT NULL REFERENCES parts(id),
  quantity              INTEGER NOT NULL,
  unit_cost_cents       INTEGER NOT NULL,
  supplier              TEXT,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','received','cancelled')),
  triggered_by          TEXT NOT NULL DEFAULT 'manual' CHECK (triggered_by IN ('manual','auto_reorder','auto_maintenance_alert')),
  related_note          TEXT,     -- para auto_maintenance_alert: qué componente/aeronave la disparó
  requested_date        TEXT NOT NULL,
  expected_date         TEXT,
  received_date         TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_items_part ON stock_items(part_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_part ON stock_movements(part_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
