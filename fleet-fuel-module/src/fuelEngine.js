// ============================================================================
// Motor de gestión de combustible
//
// Dos movimientos posibles:
//   - Entrega (fuel_deliveries): proveedor -> tanque de una base. Sube el
//     nivel del tanque y recalcula el costo promedio ponderado por litro
//     (weighted average cost — mismo método contable que cualquier
//     sistema de inventario, no una cifra de mercado real).
//   - Uplift (fuel_uplifts): tanque -> aeronave. Baja el nivel del tanque
//     y registra el costo al costo promedio vigente del tanque en ese
//     momento. THROWS si el tanque no tiene suficiente combustible —
//     mismo patrón "bloquear antes, no descubrir después" que el stock
//     negativo en fleet-inventory-module.
// ============================================================================

const { get, all, run } = require("./db");

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function createSupplier(db, { name, contactEmail, base, contractNumber, pricePerLiterCents, contractStartDate, contractEndDate }) {
  if (!name || !base || pricePerLiterCents === undefined) throw new Error("Se requiere name, base y pricePerLiterCents");
  const result = await run(
    db,
    `INSERT INTO fuel_suppliers (name, contact_email, base, contract_number, price_per_liter_cents, contract_start_date, contract_end_date) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, contactEmail ?? null, base, contractNumber ?? null, pricePerLiterCents, contractStartDate ?? null, contractEndDate ?? null]
  );
  return get(db, "SELECT * FROM fuel_suppliers WHERE id = ?", [result.lastInsertRowid]);
}

async function ensureTank(db, { base, capacityLiters }) {
  const existing = await get(db, "SELECT * FROM fuel_tanks WHERE base = ?", [base]);
  if (existing) return existing;
  const result = await run(db, `INSERT INTO fuel_tanks (base, capacity_liters, current_level_liters, average_cost_per_liter_cents) VALUES (?, ?, 0, 0)`, [
    base,
    capacityLiters,
  ]);
  return get(db, "SELECT * FROM fuel_tanks WHERE id = ?", [result.lastInsertRowid]);
}

/**
 * Entrega de proveedor a tanque. Si excede la capacidad, se registra
 * igual pero se avisa (no bloqueamos una entrega física que ya ocurrió —
 * a diferencia del uplift, que sí podemos y debemos bloquear antes de que
 * pase).
 */
async function recordDelivery(db, { base, supplierId, liters, pricePerLiterCents, deliveryDate, notes }) {
  if (!base || !supplierId || !liters || !pricePerLiterCents || !deliveryDate) {
    throw new Error("Se requiere base, supplierId, liters, pricePerLiterCents y deliveryDate");
  }
  const tank = await get(db, "SELECT * FROM fuel_tanks WHERE base = ?", [base]);
  if (!tank) throw new Error(`No hay tanque registrado para la base ${base}. Créalo primero con ensureTank/POST /tanks.`);

  const totalCostCents = Math.round(liters * pricePerLiterCents);
  const newLevel = tank.current_level_liters + liters;
  const newAvgCost = newLevel > 0 ? (tank.average_cost_per_liter_cents * tank.current_level_liters + pricePerLiterCents * liters) / newLevel : 0;

  await run(db, "UPDATE fuel_tanks SET current_level_liters = ?, average_cost_per_liter_cents = ? WHERE id = ?", [newLevel, round2(newAvgCost), tank.id]);

  const result = await run(
    db,
    `INSERT INTO fuel_deliveries (base, supplier_id, liters, price_per_liter_cents, total_cost_cents, delivery_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [base, supplierId, liters, pricePerLiterCents, totalCostCents, deliveryDate, notes ?? null]
  );

  const overCapacity = newLevel > tank.capacity_liters;
  const delivery = await get(db, "SELECT * FROM fuel_deliveries WHERE id = ?", [result.lastInsertRowid]);
  return { delivery, tank: await get(db, "SELECT * FROM fuel_tanks WHERE id = ?", [tank.id]), overCapacityWarning: overCapacity };
}

/**
 * El gate: repostar una aeronave desde el tanque de su base. Bloquea si
 * no hay suficiente combustible físico en el tanque.
 */
async function recordUplift(db, { tailNumber, base, liters, upliftDate, sourceFlightReleaseId, notes }) {
  if (!tailNumber || !base || !liters || !upliftDate) throw new Error("Se requiere tailNumber, base, liters y upliftDate");

  const tank = await get(db, "SELECT * FROM fuel_tanks WHERE base = ?", [base]);
  if (!tank) throw new Error(`No hay tanque registrado para la base ${base}.`);
  if (tank.current_level_liters < liters) {
    throw new Error(
      `Combustible insuficiente en el tanque de ${base}: hay ${tank.current_level_liters}L, se requieren ${liters}L para repostar ${tailNumber}.`
    );
  }

  if (sourceFlightReleaseId) {
    const existing = await get(db, "SELECT * FROM fuel_uplifts WHERE source_flight_release_id = ?", [sourceFlightReleaseId]);
    if (existing) return { uplift: existing, tank, alreadyExisted: true };
  }

  const costPerLiterCents = tank.average_cost_per_liter_cents;
  const totalCostCents = round2(liters * costPerLiterCents);
  const newLevel = tank.current_level_liters - liters;

  await run(db, "UPDATE fuel_tanks SET current_level_liters = ? WHERE id = ?", [newLevel, tank.id]);

  const result = await run(
    db,
    `INSERT INTO fuel_uplifts (tail_number, base, liters, cost_per_liter_cents, total_cost_cents, uplift_date, source_flight_release_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [tailNumber, base, liters, costPerLiterCents, totalCostCents, upliftDate, sourceFlightReleaseId ?? null, notes ?? null]
  );

  const uplift = await get(db, "SELECT * FROM fuel_uplifts WHERE id = ?", [result.lastInsertRowid]);
  return { uplift, tank: await get(db, "SELECT * FROM fuel_tanks WHERE id = ?", [tank.id]), alreadyExisted: false };
}

async function getFuelDashboard(db) {
  const tanks = await all(db, "SELECT * FROM fuel_tanks ORDER BY base");
  const result = [];
  for (const tank of tanks) {
    const recentDeliveries = await all(db, "SELECT * FROM fuel_deliveries WHERE base = ? ORDER BY delivery_date DESC LIMIT 5", [tank.base]);
    const recentUplifts = await all(db, "SELECT * FROM fuel_uplifts WHERE base = ? ORDER BY uplift_date DESC LIMIT 5", [tank.base]);
    result.push({
      tank,
      percentFull: tank.capacity_liters > 0 ? round2((tank.current_level_liters / tank.capacity_liters) * 100) : null,
      recentDeliveries,
      recentUplifts,
    });
  }
  return result;
}

/**
 * Costo total de combustible por aeronave — el número que eventualmente
 * alimentaría el costo por hora de vuelo en Facturación (no conectado
 * todavía, ver README "Qué falta para producción").
 */
async function getCostByAircraft(db, { since } = {}) {
  const uplifts = since
    ? await all(db, "SELECT * FROM fuel_uplifts WHERE uplift_date >= ? ORDER BY tail_number", [since])
    : await all(db, "SELECT * FROM fuel_uplifts ORDER BY tail_number");

  const byTail = {};
  for (const u of uplifts) {
    if (!byTail[u.tail_number]) byTail[u.tail_number] = { tailNumber: u.tail_number, totalLiters: 0, totalCostCents: 0, upliftCount: 0 };
    byTail[u.tail_number].totalLiters = round2(byTail[u.tail_number].totalLiters + u.liters);
    byTail[u.tail_number].totalCostCents += u.total_cost_cents;
    byTail[u.tail_number].upliftCount++;
  }
  return Object.values(byTail);
}

async function getSuppliers(db) {
  return all(db, "SELECT * FROM fuel_suppliers ORDER BY name");
}

module.exports = {
  createSupplier,
  ensureTank,
  recordDelivery,
  recordUplift,
  getFuelDashboard,
  getCostByAircraft,
  getSuppliers,
};
