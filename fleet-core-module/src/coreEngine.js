// ============================================================================
// Motor del maestro de datos (fleet-core-module)
//
// Reglas simples pero centrales: la matrícula (tail_number) y el legajo
// (employee_code) son claves únicas de negocio. Alta o edición aquí es lo
// que fleet-integration reparte a cada módulo operativo.
// ============================================================================

const { get, all, run } = require("./db");

async function createCustomer(db, { name, contactEmail, segment }) {
  if (!name) throw new Error("Falta el campo requerido: name");
  const result = await run(db, "INSERT INTO customers (name, contact_email, segment) VALUES (?, ?, ?)", [name, contactEmail ?? null, segment ?? null]);
  return get(db, "SELECT * FROM customers WHERE id = ?", [result.lastInsertRowid]);
}

async function upsertAircraft(db, params) {
  const { tailNumber, model } = params;
  if (!tailNumber || !model) throw new Error("Faltan campos requeridos: tailNumber, model");
  const existing = await get(db, "SELECT * FROM aircraft WHERE tail_number = ?", [tailNumber]);
  if (existing) {
    await run(
      db,
      `UPDATE aircraft SET model = ?, serial_number = ?, base = ?, customer_id = ?, status = ?, default_hourly_rate_cents = ? WHERE id = ?`,
      [
        model,
        params.serialNumber ?? existing.serial_number,
        params.base ?? existing.base,
        params.customerId ?? existing.customer_id,
        params.status ?? existing.status,
        params.defaultHourlyRateCents ?? existing.default_hourly_rate_cents,
        existing.id,
      ]
    );
    return get(db, "SELECT * FROM aircraft WHERE id = ?", [existing.id]);
  }
  const result = await run(
    db,
    `INSERT INTO aircraft (tail_number, model, serial_number, base, customer_id, status, default_hourly_rate_cents) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tailNumber, model, params.serialNumber ?? null, params.base ?? null, params.customerId ?? null, params.status ?? "active", params.defaultHourlyRateCents ?? null]
  );
  return get(db, "SELECT * FROM aircraft WHERE id = ?", [result.lastInsertRowid]);
}

async function upsertCrewMember(db, params) {
  const { employeeCode, name, role } = params;
  if (!employeeCode || !name || !role) throw new Error("Faltan campos requeridos: employeeCode, name, role");
  const existing = await get(db, "SELECT * FROM crew_members WHERE employee_code = ?", [employeeCode]);
  if (existing) {
    await run(
      db,
      `UPDATE crew_members SET name = ?, role = ?, base = ?, email = ?, hire_date = ?, status = ? WHERE id = ?`,
      [name, role, params.base ?? existing.base, params.email ?? existing.email, params.hireDate ?? existing.hire_date, params.status ?? existing.status, existing.id]
    );
    return get(db, "SELECT * FROM crew_members WHERE id = ?", [existing.id]);
  }
  const result = await run(
    db,
    `INSERT INTO crew_members (employee_code, name, role, base, email, hire_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [employeeCode, name, role, params.base ?? null, params.email ?? null, params.hireDate ?? null, params.status ?? "active"]
  );
  return get(db, "SELECT * FROM crew_members WHERE id = ?", [result.lastInsertRowid]);
}

async function logSync(db, { entityType, entityKey, targetModule, result }) {
  await run(
    db,
    `INSERT INTO sync_log (entity_type, entity_key, target_module, synced_at, result) VALUES (?, ?, ?, ?, ?)`,
    [entityType, entityKey, targetModule, new Date().toISOString(), result]
  );
}

async function getSyncStatus(db) {
  const aircraft = await all(db, "SELECT * FROM aircraft ORDER BY tail_number");
  const crew = await all(db, "SELECT * FROM crew_members ORDER BY employee_code");
  const recentLogs = await all(db, "SELECT * FROM sync_log ORDER BY id DESC LIMIT 40");
  return { aircraft, crew, recentLogs };
}

module.exports = {
  createCustomer,
  upsertAircraft,
  upsertCrewMember,
  logSync,
  getSyncStatus,
};
