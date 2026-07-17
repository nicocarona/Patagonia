// ============================================================================
// Motor de reglas de programación (Scheduling)
//
// Antes de confirmar una reserva, valida:
//   1) Disponibilidad de la aeronave
//   2) Disponibilidad del piloto
//   3) Calificación vigente del piloto para el MODELO de aeronave
//   4) Límite de horas de servicio (duty time) del piloto en el día
//
// Todas las funciones que consultan la base de datos son async (necesario
// para soportar PostgreSQL — ver db.js). Los helpers puramente de cálculo
// de tiempo (toMinutes, rangesOverlap, durationHours) siguen síncronos.
// ============================================================================

const { get, all, run } = require("./db");

const DEFAULT_MAX_DAILY_DUTY_HOURS = 8;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function rangesOverlap(startA, endA, startB, endB) {
  return toMinutes(startA) < toMinutes(endB) && toMinutes(startB) < toMinutes(endA);
}

function durationHours(startTime, endTime) {
  return (toMinutes(endTime) - toMinutes(startTime)) / 60;
}

/**
 * Gating con el módulo de Mantenimiento (fleet-maintenance-module): la
 * columna `airworthy` es un espejo sincronizado por fleet-integration a
 * partir del dashboard de mantenimiento. Igual que en un ERP aeronáutico
 * real (mantenimiento certifica, operaciones no puede volar lo que
 * mantenimiento marcó fuera de servicio), Programación NO decide
 * aeronavegabilidad — solo la respeta.
 */
async function checkAircraftAirworthy(db, { aircraftId }) {
  const aircraft = await get(db, "SELECT * FROM aircraft WHERE id = ?", [aircraftId]);
  if (!aircraft) return { ok: false, reason: `Aeronave ${aircraftId} no encontrada.` };
  if (Number(aircraft.airworthy) === 0) {
    return {
      ok: false,
      reason: `${aircraft.tail_number} está marcada NO AERONAVEGABLE por Mantenimiento — no se puede programar hasta que se cierre la orden de trabajo pendiente.`,
    };
  }
  return { ok: true };
}

async function checkAircraftAvailability(db, { aircraftId, bookingDate, startTime, endTime, excludeBookingId }) {
  const bookings = await all(
    db,
    `SELECT * FROM bookings WHERE aircraft_id = ? AND booking_date = ? AND status = 'confirmed' AND id != ?`,
    [aircraftId, bookingDate, excludeBookingId ?? -1]
  );
  const conflict = bookings.find((b) => rangesOverlap(startTime, endTime, b.start_time, b.end_time));
  if (conflict) {
    return { ok: false, reason: `Aeronave ya reservada de ${conflict.start_time} a ${conflict.end_time} ese día (reserva #${conflict.id}).` };
  }
  return { ok: true };
}

async function checkPilotAvailability(db, { pilotId, bookingDate, startTime, endTime, excludeBookingId }) {
  const bookings = await all(
    db,
    `SELECT * FROM bookings WHERE pilot_id = ? AND booking_date = ? AND status = 'confirmed' AND id != ?`,
    [pilotId, bookingDate, excludeBookingId ?? -1]
  );
  const conflict = bookings.find((b) => rangesOverlap(startTime, endTime, b.start_time, b.end_time));
  if (conflict) {
    return { ok: false, reason: `El piloto ya tiene una reserva de ${conflict.start_time} a ${conflict.end_time} ese día (reserva #${conflict.id}).` };
  }
  return { ok: true };
}

async function checkPilotQualification(db, { pilotId, aircraftModel, bookingDate }) {
  const qualifications = await all(
    db,
    `SELECT * FROM crew_qualifications WHERE crew_id = ? AND aircraft_model = ?`,
    [pilotId, aircraftModel]
  );
  if (qualifications.length === 0) {
    return { ok: false, reason: `El piloto no tiene habilitación registrada para ${aircraftModel}.` };
  }
  const valid = qualifications.some((q) => q.valid_until >= bookingDate);
  if (!valid) {
    return { ok: false, reason: `La habilitación del piloto para ${aircraftModel} está vencida (venció ${qualifications[0].valid_until}).` };
  }
  return { ok: true };
}

async function checkDailyDutyLimit(db, { pilotId, bookingDate, startTime, endTime, excludeBookingId, maxDailyDutyHours = DEFAULT_MAX_DAILY_DUTY_HOURS }) {
  const bookings = await all(
    db,
    `SELECT * FROM bookings WHERE pilot_id = ? AND booking_date = ? AND status = 'confirmed' AND id != ?`,
    [pilotId, bookingDate, excludeBookingId ?? -1]
  );
  const existingHours = bookings.reduce((sum, b) => sum + durationHours(b.start_time, b.end_time), 0);
  const newHours = durationHours(startTime, endTime);
  const totalHours = existingHours + newHours;
  if (totalHours > maxDailyDutyHours) {
    return {
      ok: false,
      reason: `Excede el límite de horas de servicio diario: ${existingHours.toFixed(1)}h ya asignadas + ${newHours.toFixed(1)}h nuevas = ${totalHours.toFixed(1)}h (máximo ${maxDailyDutyHours}h).`,
    };
  }
  return { ok: true };
}

async function runAllChecks(db, params) {
  const aircraft = await get(db, "SELECT * FROM aircraft WHERE id = ?", [params.aircraftId]);
  if (!aircraft) return { ok: false, reason: `Aeronave ${params.aircraftId} no encontrada.` };

  const checks = [
    await checkAircraftAirworthy(db, params),
    await checkAircraftAvailability(db, params),
    await checkPilotAvailability(db, params),
    await checkPilotQualification(db, { ...params, aircraftModel: aircraft.model }),
    await checkDailyDutyLimit(db, params),
  ];
  return checks.find((c) => !c.ok) ?? { ok: true };
}

/**
 * Corre las 4 validaciones y, si todas pasan, crea la reserva.
 */
async function createBooking(db, params) {
  const { aircraftId, pilotId, customerId, bookingDate, startTime, endTime, missionType, certificateContext, maxDailyDutyHours } = params;

  if (toMinutes(endTime) <= toMinutes(startTime)) {
    throw new Error("La hora de fin debe ser posterior a la hora de inicio.");
  }

  const aircraft = await get(db, "SELECT * FROM aircraft WHERE id = ?", [aircraftId]);
  if (!aircraft) throw new Error(`Aeronave ${aircraftId} no encontrada.`);
  const pilot = await get(db, "SELECT * FROM crew_members WHERE id = ?", [pilotId]);
  if (!pilot) throw new Error(`Tripulante ${pilotId} no encontrado.`);

  const result = await runAllChecks(db, { aircraftId, pilotId, bookingDate, startTime, endTime, maxDailyDutyHours });
  if (!result.ok) throw new Error(result.reason);

  const insertResult = await run(
    db,
    `INSERT INTO bookings (aircraft_id, pilot_id, customer_id, booking_date, start_time, end_time, mission_type, certificate_context, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
    [aircraftId, pilotId, customerId ?? null, bookingDate, startTime, endTime, missionType ?? null, certificateContext ?? "charter"]
  );
  return get(db, "SELECT * FROM bookings WHERE id = ?", [insertResult.lastInsertRowid]);
}

/**
 * Valida una reserva SIN crearla.
 */
async function validateBooking(db, params) {
  return runAllChecks(db, params);
}

async function cancelBooking(db, bookingId) {
  const booking = await get(db, "SELECT * FROM bookings WHERE id = ?", [bookingId]);
  if (!booking) throw new Error(`Reserva ${bookingId} no encontrada.`);
  await run(db, "UPDATE bookings SET status = 'cancelled' WHERE id = ?", [bookingId]);
  return get(db, "SELECT * FROM bookings WHERE id = ?", [bookingId]);
}

/**
 * Cierra una reserva confirmada con los datos REALES del vuelo y el
 * contrato de facturación aplicable.
 */
async function closeBooking(db, bookingId, closure) {
  const booking = await get(db, "SELECT * FROM bookings WHERE id = ?", [bookingId]);
  if (!booking) throw new Error(`Reserva ${bookingId} no encontrada.`);
  if (booking.status !== "confirmed") throw new Error(`Solo se pueden cerrar reservas confirmadas (estado actual: ${booking.status}).`);

  const required = ["billingContractId", "actualFlightHours"];
  for (const f of required) if (closure[f] === undefined) throw new Error(`Falta el campo requerido para el cierre: ${f}`);

  await run(
    db,
    `UPDATE bookings SET
       status = 'completed',
       billing_contract_id = ?,
       actual_flight_hours = ?,
       actual_positioning_hours = ?,
       actual_standby_hours = ?,
       actual_landing_count = ?,
       closed_at = ?
     WHERE id = ?`,
    [
      closure.billingContractId,
      closure.actualFlightHours,
      closure.actualPositioningHours ?? 0,
      closure.actualStandbyHours ?? 0,
      closure.actualLandingCount ?? 0,
      new Date().toISOString(),
      bookingId,
    ]
  );
  return get(db, "SELECT * FROM bookings WHERE id = ?", [bookingId]);
}

async function markBookingSynced(db, bookingId) {
  await run(db, "UPDATE bookings SET synced_to_billing = 1 WHERE id = ?", [bookingId]);
  return get(db, "SELECT * FROM bookings WHERE id = ?", [bookingId]);
}

async function getPendingSync(db) {
  return all(db, "SELECT * FROM bookings WHERE status = 'completed' AND synced_to_billing = 0 ORDER BY booking_date");
}

async function setAircraftAirworthy(db, aircraftId, airworthy) {
  await run(db, "UPDATE aircraft SET airworthy = ?, airworthy_synced_at = ? WHERE id = ?", [airworthy ? 1 : 0, new Date().toISOString(), aircraftId]);
  return get(db, "SELECT * FROM aircraft WHERE id = ?", [aircraftId]);
}

async function upsertCrewMember(db, { employeeCode, name, role, email }) {
  const existing = await get(db, "SELECT * FROM crew_members WHERE employee_code = ?", [employeeCode]);
  if (existing) {
    await run(db, "UPDATE crew_members SET name = ?, role = ?, email = ? WHERE id = ?", [name, role, email ?? existing.email, existing.id]);
    return get(db, "SELECT * FROM crew_members WHERE id = ?", [existing.id]);
  }
  const result = await run(db, "INSERT INTO crew_members (employee_code, name, role, email) VALUES (?, ?, ?, ?)", [employeeCode, name, role, email ?? null]);
  return get(db, "SELECT * FROM crew_members WHERE id = ?", [result.lastInsertRowid]);
}

async function upsertAircraft(db, { tailNumber, model, base }) {
  const existing = await get(db, "SELECT * FROM aircraft WHERE tail_number = ?", [tailNumber]);
  if (existing) {
    await run(db, "UPDATE aircraft SET model = ?, base = ? WHERE id = ?", [model, base ?? existing.base, existing.id]);
    return get(db, "SELECT * FROM aircraft WHERE id = ?", [existing.id]);
  }
  const result = await run(db, "INSERT INTO aircraft (tail_number, model, base) VALUES (?, ?, ?)", [tailNumber, model, base ?? null]);
  return get(db, "SELECT * FROM aircraft WHERE id = ?", [result.lastInsertRowid]);
}

module.exports = {
  checkAircraftAirworthy,
  checkAircraftAvailability,
  checkPilotAvailability,
  checkPilotQualification,
  checkDailyDutyLimit,
  createBooking,
  validateBooking,
  cancelBooking,
  closeBooking,
  markBookingSynced,
  getPendingSync,
  durationHours,
  rangesOverlap,
  setAircraftAirworthy,
  upsertAircraft,
  upsertCrewMember,
};
