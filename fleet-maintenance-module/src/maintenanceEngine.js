// ============================================================================
// Motor de mantenimiento por componente
//
// Idea central (sección 3 de la especificación funcional): un helicóptero
// mediano tiene 30-50 componentes de vida limitada, cada uno con su propio
// límite en horas, ciclos y/o calendario. El sistema debe:
//   1) Calcular cuánta vida le queda a cada componente.
//   2) BLOQUEAR el registro de un vuelo si haría que algún componente
//      exceda su límite — no descubrirlo después del vuelo.
//   3) Permitir "resetear" la vida de un componente cuando se sobrehaula
//      o se reemplaza.
// ============================================================================

const { get, all, run } = require("./db");

const DUE_SOON_HOURS_THRESHOLD = 25;      // aviso si quedan <= 25h
const DUE_SOON_CYCLES_THRESHOLD = 50;     // aviso si quedan <= 50 ciclos
const DUE_SOON_CALENDAR_DAYS_THRESHOLD = 30; // aviso si quedan <= 30 días

function daysBetween(fromIso, toIso) {
  const from = new Date(fromIso + "T00:00:00Z").getTime();
  const to = new Date(toIso + "T00:00:00Z").getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

/**
 * Calcula el estado de vida remanente de un componente: cuánto le queda en
 * cada dimensión aplicable, y el estado global (ok / due_soon / overdue) —
 * el peor de los tres manda, igual que en la operación real.
 */
function computeComponentStatus(component, asOfDate) {
  const remaining = {};
  let worst = "ok";

  if (component.hours_limit != null) {
    remaining.hours = Math.round((component.hours_limit - component.hours_accumulated) * 10) / 10;
    if (remaining.hours <= 0) worst = "overdue";
    else if (remaining.hours <= DUE_SOON_HOURS_THRESHOLD && worst !== "overdue") worst = "due_soon";
  }
  if (component.cycles_limit != null) {
    remaining.cycles = component.cycles_limit - component.cycles_accumulated;
    if (remaining.cycles <= 0) worst = "overdue";
    else if (remaining.cycles <= DUE_SOON_CYCLES_THRESHOLD && worst !== "overdue") worst = "due_soon";
  }
  if (component.calendar_limit_date != null) {
    remaining.calendarDays = daysBetween(asOfDate, component.calendar_limit_date);
    if (remaining.calendarDays <= 0) worst = "overdue";
    else if (remaining.calendarDays <= DUE_SOON_CALENDAR_DAYS_THRESHOLD && worst !== "overdue") worst = "due_soon";
  }

  return { ...component, remaining, lifeStatus: worst };
}

/**
 * Revisa si un vuelo planeado (con estas horas/ciclos) haría que algún
 * componente instalado en la aeronave exceda su límite. Se llama ANTES de
 * registrar el vuelo — este es el "bloqueo" descrito en la especificación.
 */
async function checkFlightAgainstLimits(db, { aircraftId, plannedHours, plannedCycles = 1, asOfDate }) {
  const components = await all(db, "SELECT * FROM components WHERE aircraft_id = ? AND status = 'installed'", [aircraftId]);
  const violations = [];

  for (const c of components) {
    if (c.hours_limit != null) {
      const projected = c.hours_accumulated + plannedHours;
      if (projected > c.hours_limit) {
        violations.push(`${c.name}: excedería su límite de horas (${projected.toFixed(1)}h > ${c.hours_limit}h límite).`);
      }
    }
    if (c.cycles_limit != null) {
      const projected = c.cycles_accumulated + plannedCycles;
      if (projected > c.cycles_limit) {
        violations.push(`${c.name}: excedería su límite de ciclos (${projected} > ${c.cycles_limit} límite).`);
      }
    }
    if (c.calendar_limit_date != null && asOfDate > c.calendar_limit_date) {
      violations.push(`${c.name}: su límite calendario (${c.calendar_limit_date}) ya venció.`);
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/**
 * Registra un vuelo: SOLO si no excede ningún límite de componente. Si pasa
 * la validación, incrementa horas/ciclos de la aeronave y de todos sus
 * componentes instalados.
 */
async function logFlight(db, { aircraftId, flightDate, hobbsHours, cycles = 1, notes }) {
  const check = await checkFlightAgainstLimits(db, { aircraftId, plannedHours: hobbsHours, plannedCycles: cycles, asOfDate: flightDate });
  if (!check.ok) {
    throw new Error(`No se puede registrar el vuelo — excede límites de componente:\n  - ${check.violations.join("\n  - ")}`);
  }

  await run(db, "UPDATE aircraft SET total_hours = total_hours + ?, total_cycles = total_cycles + ? WHERE id = ?", [hobbsHours, cycles, aircraftId]);

  const components = await all(db, "SELECT * FROM components WHERE aircraft_id = ? AND status = 'installed'", [aircraftId]);
  for (const c of components) {
    await run(db, "UPDATE components SET hours_accumulated = hours_accumulated + ?, cycles_accumulated = cycles_accumulated + ? WHERE id = ?", [hobbsHours, cycles, c.id]);
  }

  const result = await run(
    db,
    `INSERT INTO flight_logs (aircraft_id, flight_date, hobbs_hours, cycles, notes) VALUES (?, ?, ?, ?, ?)`,
    [aircraftId, flightDate, hobbsHours, cycles, notes ?? null]
  );
  return get(db, "SELECT * FROM flight_logs WHERE id = ?", [result.lastInsertRowid]);
}

async function createComponent(db, params) {
  const required = ["aircraftId", "name", "installedDate"];
  for (const f of required) if (!params[f]) throw new Error(`Falta el campo requerido: ${f}`);
  const result = await run(
    db,
    `INSERT INTO components (aircraft_id, name, part_number, serial_number, installed_date, hours_limit, cycles_limit, calendar_limit_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [params.aircraftId, params.name, params.partNumber ?? null, params.serialNumber ?? null, params.installedDate, params.hoursLimit ?? null, params.cyclesLimit ?? null, params.calendarLimitDate ?? null]
  );
  return get(db, "SELECT * FROM components WHERE id = ?", [result.lastInsertRowid]);
}

/**
 * Resetea la vida útil de un componente (overhaul o reemplazo por uno
 * nuevo). No borra el historial — el componente sigue siendo el mismo
 * registro, pero sus horas/ciclos acumulados vuelven a cero desde la fecha
 * del overhaul.
 */
async function resetComponentLife(db, componentId, resetDate) {
  const component = await get(db, "SELECT * FROM components WHERE id = ?", [componentId]);
  if (!component) throw new Error(`Componente ${componentId} no encontrado.`);
  await run(
    db,
    `UPDATE components SET hours_accumulated = 0, cycles_accumulated = 0, installed_date = ? WHERE id = ?`,
    [resetDate ?? new Date().toISOString().slice(0, 10), componentId]
  );
  return get(db, "SELECT * FROM components WHERE id = ?", [componentId]);
}

async function createWorkOrder(db, params) {
  const required = ["aircraftId", "description"];
  for (const f of required) if (!params[f]) throw new Error(`Falta el campo requerido: ${f}`);
  const result = await run(
    db,
    `INSERT INTO work_orders (aircraft_id, component_id, description, action_type, status, opened_date)
     VALUES (?, ?, ?, ?, 'open', ?)`,
    [params.aircraftId, params.componentId ?? null, params.description, params.actionType ?? "repair", params.openedDate ?? new Date().toISOString().slice(0, 10)]
  );
  return get(db, "SELECT * FROM work_orders WHERE id = ?", [result.lastInsertRowid]);
}

/**
 * Cierra una orden de trabajo. Si su action_type es 'overhaul' o
 * 'replacement' y está ligada a un componente, resetea automáticamente la
 * vida de ese componente — así el mantenimiento ejecutado se refleja de
 * inmediato en el cálculo de vida remanente, sin un paso manual aparte.
 */
async function closeWorkOrder(db, workOrderId, closedDate) {
  const wo = await get(db, "SELECT * FROM work_orders WHERE id = ?", [workOrderId]);
  if (!wo) throw new Error(`Orden de trabajo ${workOrderId} no encontrada.`);
  const finalDate = closedDate ?? new Date().toISOString().slice(0, 10);
  await run(db, "UPDATE work_orders SET status = 'closed', closed_date = ? WHERE id = ?", [finalDate, workOrderId]);

  if ((wo.action_type === "overhaul" || wo.action_type === "replacement") && wo.component_id) {
    await resetComponentLife(db, wo.component_id, finalDate);
  }
  return get(db, "SELECT * FROM work_orders WHERE id = ?", [workOrderId]);
}

async function getFleetDashboard(db, asOfDate) {
  const aircraftList = await all(db, "SELECT * FROM aircraft");
  const result = [];
  for (const aircraft of aircraftList) {
    const components = await all(db, "SELECT * FROM components WHERE aircraft_id = ? AND status = 'installed'", [aircraft.id]);
    const withStatus = components.map((c) => computeComponentStatus(c, asOfDate));
    const overdue = withStatus.filter((c) => c.lifeStatus === "overdue");
    const dueSoon = withStatus.filter((c) => c.lifeStatus === "due_soon");
    result.push({
      aircraft,
      airworthy: overdue.length === 0,
      overdueComponents: overdue,
      dueSoonComponents: dueSoon,
      components: withStatus,
    });
  }
  return result;
}

/**
 * Alta/actualización de una aeronave a partir del maestro central
 * (fleet-core-module), vía fleet-integration. No toca horas/ciclos
 * acumulados de una aeronave ya existente — esos valores son propiedad de
 * este módulo (se actualizan solo con logFlight), el maestro central solo
 * aporta identidad (matrícula/modelo).
 */
async function upsertAircraft(db, { tailNumber, model }) {
  const existing = await get(db, "SELECT * FROM aircraft WHERE tail_number = ?", [tailNumber]);
  if (existing) {
    await run(db, "UPDATE aircraft SET model = ? WHERE id = ?", [model, existing.id]);
    return get(db, "SELECT * FROM aircraft WHERE id = ?", [existing.id]);
  }
  const result = await run(db, "INSERT INTO aircraft (tail_number, model) VALUES (?, ?)", [tailNumber, model]);
  return get(db, "SELECT * FROM aircraft WHERE id = ?", [result.lastInsertRowid]);
}

module.exports = {
  upsertAircraft,
  computeComponentStatus,
  checkFlightAgainstLimits,
  logFlight,
  createComponent,
  resetComponentLife,
  createWorkOrder,
  closeWorkOrder,
  getFleetDashboard,
};
