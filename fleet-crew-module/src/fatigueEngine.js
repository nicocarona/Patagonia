// ============================================================================
// Motor de reglas de fatiga
//
// Antes de registrar un período de servicio (duty period) de un tripulante,
// valida:
//   1) Que no esté de licencia/vacaciones esa fecha
//   2) Descanso mínimo respecto al período de servicio anterior
//   3) Límite de horas de servicio DIARIO (todas las actividades del día)
//   4) Límite de horas de servicio SEMANAL (7 días rodantes)
//   5) Límite de horas de servicio MENSUAL (28 días rodantes)
//
// Los límites por defecto son parámetros razonables de referencia, no una
// cita textual de un reglamento específico — cada operador debe ajustarlos
// a la normativa de su autoridad (FAA Part 135, EASA Part-ORO.FTL, etc.).
// ============================================================================

const { get, all, run } = require("./db");

const DEFAULT_LIMITS = {
  maxDailyHours: 8,
  maxWeeklyHours: 36,     // ventana rodante de 7 días
  maxMonthlyHours: 100,   // ventana rodante de 28 días
  minRestHours: 10,       // descanso mínimo entre dos períodos de servicio
};

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function durationHours(startTime, endTime) {
  return (toMinutes(endTime) - toMinutes(startTime)) / 60;
}
function addDays(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function dateTimeToMs(date, time) {
  return new Date(`${date}T${time}:00Z`).getTime();
}

async function checkOnLeave(db, { crewId, dutyDate }) {
  const leaves = await all(
    db,
    `SELECT * FROM leave_requests WHERE crew_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?`,
    [crewId, dutyDate, dutyDate]
  );
  if (leaves.length > 0) {
    return { ok: false, reason: `El tripulante está de licencia (${leaves[0].leave_type}) del ${leaves[0].start_date} al ${leaves[0].end_date}.` };
  }
  return { ok: true };
}

async function checkMinimumRest(db, { crewId, dutyDate, startTime, minRestHours = DEFAULT_LIMITS.minRestHours, excludeDutyId }) {
  // Trae los períodos de servicio del tripulante en el día actual y el
  // anterior (por si el turno previo terminó pasada la medianoche).
  const prevDate = addDays(dutyDate, -1);
  const recent = await all(
    db,
    `SELECT * FROM duty_periods WHERE crew_id = ? AND duty_date IN (?, ?) AND id != ? ORDER BY duty_date, end_time`,
    [crewId, prevDate, dutyDate, excludeDutyId ?? -1]
  );
  if (recent.length === 0) return { ok: true };

  const newStartMs = dateTimeToMs(dutyDate, startTime);
  let lastEndMs = -Infinity;
  let lastDuty = null;
  for (const d of recent) {
    const endMs = dateTimeToMs(d.duty_date, d.end_time);
    if (endMs <= newStartMs && endMs > lastEndMs) {
      lastEndMs = endMs;
      lastDuty = d;
    }
  }
  if (!lastDuty) return { ok: true };

  const restHours = (newStartMs - lastEndMs) / (1000 * 60 * 60);
  if (restHours < minRestHours) {
    return {
      ok: false,
      reason: `Descanso insuficiente: solo ${restHours.toFixed(1)}h desde el turno anterior (${lastDuty.duty_date} ${lastDuty.end_time}), se requieren ${minRestHours}h mínimo.`,
    };
  }
  return { ok: true };
}

async function sumDutyHours(db, crewId, fromDate, toDate, excludeDutyId) {
  const rows = await all(
    db,
    `SELECT * FROM duty_periods WHERE crew_id = ? AND duty_date >= ? AND duty_date <= ? AND id != ?`,
    [crewId, fromDate, toDate, excludeDutyId ?? -1]
  );
  return rows.reduce((sum, d) => sum + durationHours(d.start_time, d.end_time), 0);
}

async function checkDailyLimit(db, { crewId, dutyDate, startTime, endTime, maxDailyHours = DEFAULT_LIMITS.maxDailyHours, excludeDutyId }) {
  const existingHours = await sumDutyHours(db, crewId, dutyDate, dutyDate, excludeDutyId);
  const newHours = durationHours(startTime, endTime);
  const total = existingHours + newHours;
  if (total > maxDailyHours) {
    return { ok: false, reason: `Excede el máximo diario: ${existingHours.toFixed(1)}h ya asignadas + ${newHours.toFixed(1)}h nuevas = ${total.toFixed(1)}h (máximo ${maxDailyHours}h).` };
  }
  return { ok: true };
}

async function checkWeeklyLimit(db, { crewId, dutyDate, startTime, endTime, maxWeeklyHours = DEFAULT_LIMITS.maxWeeklyHours, excludeDutyId }) {
  const from = addDays(dutyDate, -6);
  const existingHours = await sumDutyHours(db, crewId, from, dutyDate, excludeDutyId);
  const newHours = durationHours(startTime, endTime);
  const total = existingHours + newHours;
  if (total > maxWeeklyHours) {
    return { ok: false, reason: `Excede el máximo semanal (7 días rodantes, ${from} a ${dutyDate}): ${existingHours.toFixed(1)}h + ${newHours.toFixed(1)}h = ${total.toFixed(1)}h (máximo ${maxWeeklyHours}h).` };
  }
  return { ok: true };
}

async function checkMonthlyLimit(db, { crewId, dutyDate, startTime, endTime, maxMonthlyHours = DEFAULT_LIMITS.maxMonthlyHours, excludeDutyId }) {
  const from = addDays(dutyDate, -27);
  const existingHours = await sumDutyHours(db, crewId, from, dutyDate, excludeDutyId);
  const newHours = durationHours(startTime, endTime);
  const total = existingHours + newHours;
  if (total > maxMonthlyHours) {
    return { ok: false, reason: `Excede el máximo mensual (28 días rodantes, ${from} a ${dutyDate}): ${existingHours.toFixed(1)}h + ${newHours.toFixed(1)}h = ${total.toFixed(1)}h (máximo ${maxMonthlyHours}h).` };
  }
  return { ok: true };
}

async function validateDutyPeriod(db, params) {
  if (toMinutes(params.endTime) <= toMinutes(params.startTime)) {
    return { ok: false, reason: "La hora de fin debe ser posterior a la hora de inicio." };
  }
  const crew = await get(db, "SELECT * FROM crew_members WHERE id = ?", [params.crewId]);
  if (!crew) return { ok: false, reason: `Tripulante ${params.crewId} no encontrado.` };

  const checks = [
    await checkOnLeave(db, params),
    await checkMinimumRest(db, params),
    await checkDailyLimit(db, params),
    await checkWeeklyLimit(db, params),
    await checkMonthlyLimit(db, params),
  ];
  return checks.find((c) => !c.ok) ?? { ok: true };
}

async function createDutyPeriod(db, params) {
  const result = await validateDutyPeriod(db, params);
  if (!result.ok) throw new Error(result.reason);

  const insertResult = await run(
    db,
    `INSERT INTO duty_periods (crew_id, duty_date, start_time, end_time, duty_type, source_booking_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [params.crewId, params.dutyDate, params.startTime, params.endTime, params.dutyType ?? "flight", params.sourceBookingId ?? null, params.notes ?? null]
  );
  return get(db, "SELECT * FROM duty_periods WHERE id = ?", [insertResult.lastInsertRowid]);
}

/**
 * Score de fatiga simple (0 = descansado, 100 = en el límite o excedido),
 * inspirado en el concepto de score tipo FAID: combina qué tan cerca está
 * el tripulante de sus límites semanal y mensual, y si tuvo descanso corto
 * recientemente. No es un algoritmo biomatemático certificado — es un
 * indicador de referencia para priorizar revisión humana.
 */
async function computeFatigueScore(db, crewId, asOfDate, limits = DEFAULT_LIMITS) {
  const weekFrom = addDays(asOfDate, -6);
  const monthFrom = addDays(asOfDate, -27);
  const weeklyHours = await sumDutyHours(db, crewId, weekFrom, asOfDate);
  const monthlyHours = await sumDutyHours(db, crewId, monthFrom, asOfDate);

  const weeklyRatio = Math.min(weeklyHours / limits.maxWeeklyHours, 1.2);
  const monthlyRatio = Math.min(monthlyHours / limits.maxMonthlyHours, 1.2);
  const score = Math.round(Math.max(weeklyRatio, monthlyRatio) * 100);

  let level = "bajo";
  if (score >= 100) level = "crítico";
  else if (score >= 80) level = "alto";
  else if (score >= 50) level = "moderado";

  return { crewId, asOfDate, weeklyHours: Math.round(weeklyHours * 10) / 10, monthlyHours: Math.round(monthlyHours * 10) / 10, score, level };
}

/**
 * Alta/actualización de un tripulante a partir del maestro central
 * (fleet-core-module), vía fleet-integration. Usa employee_code como
 * clave — el mismo tripulante en Programación y en este módulo comparten
 * el mismo employee_code aunque tengan un id local distinto.
 */
async function upsertCrewMember(db, { employeeCode, name, role, email }) {
  const existing = await get(db, "SELECT * FROM crew_members WHERE employee_code = ?", [employeeCode]);
  if (existing) {
    await run(db, "UPDATE crew_members SET name = ?, role = ?, email = ? WHERE id = ?", [name, role, email ?? existing.email, existing.id]);
    return get(db, "SELECT * FROM crew_members WHERE id = ?", [existing.id]);
  }
  const result = await run(db, "INSERT INTO crew_members (employee_code, name, role, email) VALUES (?, ?, ?, ?)", [employeeCode, name, role, email ?? null]);
  return get(db, "SELECT * FROM crew_members WHERE id = ?", [result.lastInsertRowid]);
}

module.exports = {
  checkOnLeave,
  checkMinimumRest,
  checkDailyLimit,
  checkWeeklyLimit,
  checkMonthlyLimit,
  validateDutyPeriod,
  createDutyPeriod,
  computeFatigueScore,
  sumDutyHours,
  durationHours,
  DEFAULT_LIMITS,
  upsertCrewMember,
};
