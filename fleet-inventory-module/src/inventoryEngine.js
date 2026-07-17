// ============================================================================
// Motor de inventario y almacén de repuestos
//
// Regla central, igual patrón que en Mantenimiento y Programación: las
// operaciones que reducirían el stock por debajo de cero se BLOQUEAN, no
// se descubren después. `issueStock` es la única forma de sacar unidades
// del almacén, y valida antes de escribir.
// ============================================================================

const { get, all, run } = require("./db");

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function createPart(db, params) {
  const required = ["partNumber", "description"];
  for (const f of required) if (!params[f]) throw new Error(`Falta el campo requerido: ${f}`);
  const existing = await get(db, "SELECT id FROM parts WHERE part_number = ?", [params.partNumber]);
  if (existing) throw new Error(`Ya existe una parte con part_number '${params.partNumber}'.`);
  const result = await run(
    db,
    `INSERT INTO parts (part_number, description, category, unit_cost_cents, min_stock_qty, lead_time_days, preferred_supplier)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [params.partNumber, params.description, params.category ?? null, params.unitCostCents ?? 0, params.minStockQty ?? 0, params.leadTimeDays ?? 30, params.preferredSupplier ?? null]
  );
  return get(db, "SELECT * FROM parts WHERE id = ?", [result.lastInsertRowid]);
}

async function createWarehouse(db, { name, location }) {
  if (!name) throw new Error("Falta el campo requerido: name");
  const result = await run(db, "INSERT INTO warehouses (name, location) VALUES (?, ?)", [name, location ?? null]);
  return get(db, "SELECT * FROM warehouses WHERE id = ?", [result.lastInsertRowid]);
}

async function getOrCreateStockItem(db, partId, warehouseId) {
  const existing = await get(db, "SELECT * FROM stock_items WHERE part_id = ? AND warehouse_id = ?", [partId, warehouseId]);
  if (existing) return existing;
  const result = await run(db, "INSERT INTO stock_items (part_id, warehouse_id, quantity_on_hand) VALUES (?, ?, 0)", [partId, warehouseId]);
  return get(db, "SELECT * FROM stock_items WHERE id = ?", [result.lastInsertRowid]);
}

/**
 * Ingresa unidades al almacén (recepción de una compra, devolución, etc.).
 */
async function receiveStock(db, { partId, warehouseId, quantity, reference, notes, movementDate }) {
  if (!partId || !warehouseId || !quantity || quantity <= 0) throw new Error("Faltan campos requeridos o quantity debe ser mayor a 0: partId, warehouseId, quantity");
  const item = await getOrCreateStockItem(db, partId, warehouseId);
  await run(db, "UPDATE stock_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?", [quantity, item.id]);
  await run(
    db,
    `INSERT INTO stock_movements (part_id, warehouse_id, movement_type, quantity, reference, movement_date, notes) VALUES (?, ?, 'receipt', ?, ?, ?, ?)`,
    [partId, warehouseId, quantity, reference ?? null, movementDate ?? today(), notes ?? null]
  );
  return get(db, "SELECT * FROM stock_items WHERE id = ?", [item.id]);
}

/**
 * Saca unidades del almacén (instalación en una aeronave, consumo, etc.).
 * BLOQUEA si no hay suficiente stock — no permite quedar en negativo.
 */
async function issueStock(db, { partId, warehouseId, quantity, reference, notes, movementDate }) {
  if (!partId || !warehouseId || !quantity || quantity <= 0) throw new Error("Faltan campos requeridos o quantity debe ser mayor a 0: partId, warehouseId, quantity");
  const item = await getOrCreateStockItem(db, partId, warehouseId);
  if (item.quantity_on_hand < quantity) {
    const part = await get(db, "SELECT * FROM parts WHERE id = ?", [partId]);
    throw new Error(
      `Stock insuficiente para ${part?.part_number ?? `parte #${partId}`}: hay ${item.quantity_on_hand} unidad(es) en el almacén, se solicitaron ${quantity}.`
    );
  }
  await run(db, "UPDATE stock_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?", [quantity, item.id]);
  await run(
    db,
    `INSERT INTO stock_movements (part_id, warehouse_id, movement_type, quantity, reference, movement_date, notes) VALUES (?, ?, 'issue', ?, ?, ?, ?)`,
    [partId, warehouseId, quantity, reference ?? null, movementDate ?? today(), notes ?? null]
  );
  return get(db, "SELECT * FROM stock_items WHERE id = ?", [item.id]);
}

async function getTotalStock(db, partId) {
  const row = await get(db, "SELECT COALESCE(SUM(quantity_on_hand), 0) as total FROM stock_items WHERE part_id = ?", [partId]);
  return Number(row?.total ?? 0);
}

/**
 * Devuelve las partes cuyo stock total está en o por debajo de su punto de
 * reorden — la base del punto 1 de la hoja de ruta ("genera una orden de
 * compra automática cuando un componente crítico está por vencer sin
 * repuesto disponible").
 */
async function getReorderAlerts(db) {
  const parts = await all(db, "SELECT * FROM parts");
  const alerts = [];
  for (const part of parts) {
    const total = await getTotalStock(db, part.id);
    if (total <= part.min_stock_qty) {
      alerts.push({ part, totalStock: total });
    }
  }
  return alerts;
}

async function createPurchaseOrder(db, params) {
  const required = ["partId", "quantity"];
  for (const f of required) if (params[f] === undefined) throw new Error(`Falta el campo requerido: ${f}`);
  const part = await get(db, "SELECT * FROM parts WHERE id = ?", [params.partId]);
  if (!part) throw new Error(`Parte ${params.partId} no encontrada.`);
  const result = await run(
    db,
    `INSERT INTO purchase_orders (part_id, quantity, unit_cost_cents, supplier, status, triggered_by, related_note, requested_date, expected_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.partId,
      params.quantity,
      params.unitCostCents ?? part.unit_cost_cents,
      params.supplier ?? part.preferred_supplier ?? null,
      params.status ?? "draft",
      params.triggeredBy ?? "manual",
      params.relatedNote ?? null,
      params.requestedDate ?? today(),
      params.expectedDate ?? null,
    ]
  );
  return get(db, "SELECT * FROM purchase_orders WHERE id = ?", [result.lastInsertRowid]);
}

/**
 * Recibe una orden de compra: mueve su estado a 'received' Y da entrada al
 * stock automáticamente (un solo paso, para no depender de que alguien
 * recuerde hacer los dos por separado).
 */
async function receivePurchaseOrder(db, poId, { warehouseId, receivedDate }) {
  const po = await get(db, "SELECT * FROM purchase_orders WHERE id = ?", [poId]);
  if (!po) throw new Error(`Orden de compra ${poId} no encontrada.`);
  if (po.status === "received") throw new Error(`La orden de compra ${poId} ya fue recibida.`);
  if (po.status === "cancelled") throw new Error(`La orden de compra ${poId} está cancelada — no se puede recibir.`);
  if (!warehouseId) throw new Error("Falta el campo requerido: warehouseId");

  const finalDate = receivedDate ?? today();
  await run(db, "UPDATE purchase_orders SET status = 'received', received_date = ? WHERE id = ?", [finalDate, poId]);
  await receiveStock(db, {
    partId: po.part_id,
    warehouseId,
    quantity: po.quantity,
    reference: `Orden de compra #${poId}`,
    movementDate: finalDate,
  });
  return get(db, "SELECT * FROM purchase_orders WHERE id = ?", [poId]);
}

async function cancelPurchaseOrder(db, poId) {
  const po = await get(db, "SELECT * FROM purchase_orders WHERE id = ?", [poId]);
  if (!po) throw new Error(`Orden de compra ${poId} no encontrada.`);
  if (po.status === "received") throw new Error(`La orden de compra ${poId} ya fue recibida — no se puede cancelar.`);
  await run(db, "UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?", [poId]);
  return get(db, "SELECT * FROM purchase_orders WHERE id = ?", [poId]);
}

async function getInventoryDashboard(db) {
  const parts = await all(db, "SELECT * FROM parts ORDER BY part_number");
  const result = [];
  for (const part of parts) {
    const totalStock = await getTotalStock(db, part.id);
    const openPOs = await all(db, "SELECT * FROM purchase_orders WHERE part_id = ? AND status IN ('draft','submitted') ORDER BY requested_date", [part.id]);
    result.push({
      part,
      totalStock,
      belowReorderPoint: totalStock <= part.min_stock_qty,
      openPurchaseOrders: openPOs,
    });
  }
  return result;
}

/**
 * Busca una parte por part_number sin lanzar si no existe (usado por
 * fleet-integration para chequear si un componente de Mantenimiento tiene
 * repuesto catalogado antes de generar una orden de compra automática).
 */
async function findPartByNumber(db, partNumber) {
  return get(db, "SELECT * FROM parts WHERE part_number = ?", [partNumber]);
}

/**
 * Evita generar una segunda orden de compra automática para la misma
 * parte mientras ya haya una abierta (draft o submitted) — idempotencia
 * del flujo de alerta automática, mismo criterio que el resto del sistema.
 */
async function hasOpenAutoPurchaseOrder(db, partId) {
  const row = await get(
    db,
    "SELECT id FROM purchase_orders WHERE part_id = ? AND status IN ('draft','submitted') AND triggered_by = 'auto_maintenance_alert'",
    [partId]
  );
  return !!row;
}

module.exports = {
  createPart,
  createWarehouse,
  getOrCreateStockItem,
  receiveStock,
  issueStock,
  getTotalStock,
  getReorderAlerts,
  createPurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  getInventoryDashboard,
  findPartByNumber,
  hasOpenAutoPurchaseOrder,
};
