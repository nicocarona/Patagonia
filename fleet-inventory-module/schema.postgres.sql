-- fleet-inventory-module — Esquema PostgreSQL (SERIAL en vez de AUTOINCREMENT).

CREATE TABLE IF NOT EXISTS warehouses (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  location  TEXT
);

CREATE TABLE IF NOT EXISTS parts (
  id                SERIAL PRIMARY KEY,
  part_number       TEXT NOT NULL UNIQUE,
  description       TEXT NOT NULL,
  category          TEXT,
  unit_cost_cents   INTEGER NOT NULL DEFAULT 0,
  min_stock_qty     INTEGER NOT NULL DEFAULT 0,
  lead_time_days    INTEGER NOT NULL DEFAULT 30,
  preferred_supplier TEXT
);

CREATE TABLE IF NOT EXISTS stock_items (
  id                   SERIAL PRIMARY KEY,
  part_id              INTEGER NOT NULL REFERENCES parts(id),
  warehouse_id         INTEGER NOT NULL REFERENCES warehouses(id),
  quantity_on_hand     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (part_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id             SERIAL PRIMARY KEY,
  part_id        INTEGER NOT NULL REFERENCES parts(id),
  warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
  movement_type  TEXT NOT NULL CHECK (movement_type IN ('receipt','issue','adjustment')),
  quantity       INTEGER NOT NULL,
  reference      TEXT,
  movement_date  TEXT NOT NULL,
  notes          TEXT
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                    SERIAL PRIMARY KEY,
  part_id               INTEGER NOT NULL REFERENCES parts(id),
  quantity              INTEGER NOT NULL,
  unit_cost_cents       INTEGER NOT NULL,
  supplier              TEXT,
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','received','cancelled')),
  triggered_by          TEXT NOT NULL DEFAULT 'manual' CHECK (triggered_by IN ('manual','auto_reorder','auto_maintenance_alert')),
  related_note          TEXT,
  requested_date        TEXT NOT NULL,
  expected_date         TEXT,
  received_date         TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_items_part ON stock_items(part_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_part ON stock_movements(part_id, movement_date);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
