// ============================================================================
// Motor de despacho de vuelo (Flight Release / OFP)
//
// Idea central: un despachador no puede liberar (release) un vuelo si el
// peso total excede el máximo de despegue de la aeronave, o si el
// combustible a bordo no alcanza para viaje + alterno + reserva +
// contingencia. Se valida ANTES de liberar — no se descubre en el aire.
//
// IMPORTANTE — valores de referencia, no cifras regulatorias: este
// prototipo no incluye una tabla real de pesos/consumos por modelo de
// aeronave (eso vive en el manual de vuelo de cada aeronave, que no
// tenemos). `createFlightRelease` recibe los pesos y combustibles YA
// calculados por quien despacha (o por otro sistema/planilla), y solo
// aplica la regla de bloqueo. La reserva mínima de combustible es un
// campo requerido pero SIN un valor mínimo regulatorio codificado — cada
// operador debe definir el suyo según su manual de operaciones aprobado
// (mismo criterio de transparencia usado en fleet-sms-module para los
// umbrales de FRAT y en fleet-crew-module para los límites de descanso).
// ============================================================================

const { get, all, run } = require("./db");

function today() {
  return new Date().toISOString().slice(0, 10);
}
function round1(n) {
  return Math.round(n * 10) / 10;
}

function computeWeightBalance({ emptyWeightKg, crewWeightKg = 0, passengerWeightKg = 0, cargoWeightKg = 0, fuelWeightKg = 0, maxTakeoffWeightKg }) {
  const totalWeightKg = round1(emptyWeightKg + crewWeightKg + passengerWeightKg + cargoWeightKg + fuelWeightKg);
  const marginKg = round1(maxTakeoffWeightKg - totalWeightKg);
  return { totalWeightKg, marginKg, withinLimits: totalWeightKg <= maxTakeoffWeightKg };
}

function computeFuelPlan({ tripFuelKg, alternateFuelKg = 0, reserveFuelKg, contingencyFuelKg = 0, fuelOnBoardKg }) {
  const requiredKg = round1(tripFuelKg + alternateFuelKg + reserveFuelKg + contingencyFuelKg);
  const marginKg = round1(fuelOnBoardKg - requiredKg);
  return { requiredKg, marginKg, sufficient: fuelOnBoardKg >= requiredKg };
}

/**
 * Crea un despacho en estado 'draft', con su peso/balance y plan de
 * combustible calculados y guardados — pero SIN liberarlo. Un draft puede
 * tener violaciones; recién `releaseFlight` las bloquea.
 */
async function createFlightRelease(db, params) {
  const required = ["tailNumber", "picName", "flightDate", "departureBase", "destination", "estimatedFlightTimeHours", "weightBalance", "fuelPlan"];
  for (const f of required) if (params[f] === undefined) throw new Error(`Falta el campo requerido: ${f}`);

  const wbRequired = ["emptyWeightKg", "maxTakeoffWeightKg"];
  for (const f of wbRequired) if (params.weightBalance[f] === undefined) throw new Error(`Falta el campo requerido en weightBalance: ${f}`);
  const fpRequired = ["tripFuelKg", "reserveFuelKg", "fuelOnBoardKg"];
  for (const f of fpRequired) if (params.fuelPlan[f] === undefined) throw new Error(`Falta el campo requerido en fuelPlan: ${f}`);

  const result = await run(
    db,
    `INSERT INTO flight_releases (source_booking_id, tail_number, pic_name, flight_date, departure_base, destination, alternate, route, planned_departure_time, estimated_flight_time_hours, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      params.sourceBookingId ?? null,
      params.tailNumber,
      params.picName,
      params.flightDate,
      params.departureBase,
      params.destination,
      params.alternate ?? null,
      params.route ?? null,
      params.plannedDepartureTime ?? null,
      params.estimatedFlightTimeHours,
    ]
  );
  const releaseId = result.lastInsertRowid;

  const wb = computeWeightBalance(params.weightBalance);
  await run(
    db,
    `INSERT INTO weight_balance (flight_release_id, empty_weight_kg, crew_weight_kg, passenger_weight_kg, cargo_weight_kg, fuel_weight_kg, max_takeoff_weight_kg, computed_total_weight_kg, margin_kg, within_limits)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      releaseId,
      params.weightBalance.emptyWeightKg,
      params.weightBalance.crewWeightKg ?? 0,
      params.weightBalance.passengerWeightKg ?? 0,
      params.weightBalance.cargoWeightKg ?? 0,
      params.weightBalance.fuelWeightKg ?? 0,
      params.weightBalance.maxTakeoffWeightKg,
      wb.totalWeightKg,
      wb.marginKg,
      wb.withinLimits ? 1 : 0,
    ]
  );

  const fp = computeFuelPlan(params.fuelPlan);
  await run(
    db,
    `INSERT INTO fuel_plans (flight_release_id, trip_fuel_kg, alternate_fuel_kg, reserve_fuel_kg, contingency_fuel_kg, fuel_on_board_kg, computed_required_kg, margin_kg, sufficient)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      releaseId,
      params.fuelPlan.tripFuelKg,
      params.fuelPlan.alternateFuelKg ?? 0,
      params.fuelPlan.reserveFuelKg,
      params.fuelPlan.contingencyFuelKg ?? 0,
      params.fuelPlan.fuelOnBoardKg,
      fp.requiredKg,
      fp.marginKg,
      fp.sufficient ? 1 : 0,
    ]
  );

  return getFlightReleaseWithDetails(db, releaseId);
}

async function getFlightReleaseWithDetails(db, releaseId) {
  const release = await get(db, "SELECT * FROM flight_releases WHERE id = ?", [releaseId]);
  if (!release) return null;
  const weightBalance = await get(db, "SELECT * FROM weight_balance WHERE flight_release_id = ?", [releaseId]);
  const fuelPlan = await get(db, "SELECT * FROM fuel_plans WHERE flight_release_id = ?", [releaseId]);
  return { ...release, weightBalance, fuelPlan };
}

/**
 * El bloqueo central: revisa peso/balance y combustible YA calculados
 * (guardados al crear el draft) y libera SOLO si ambos están dentro de
 * límite. Si algo cambió desde que se creó el draft (p.ej. se editó el
 * combustible a bordo), hay que recalcular con `recomputeChecks` antes.
 */
async function releaseFlight(db, releaseId, { dispatcherName }) {
  if (!dispatcherName) throw new Error("Falta el campo requerido: dispatcherName");
  const details = await getFlightReleaseWithDetails(db, releaseId);
  if (!details) throw new Error(`Despacho ${releaseId} no encontrado.`);
  if (details.status !== "draft") throw new Error(`Solo se puede liberar un despacho en estado 'draft' (estado actual: ${details.status}).`);

  const violations = [];
  if (!details.weightBalance || Number(details.weightBalance.within_limits) !== 1) {
    const wb = details.weightBalance;
    violations.push(
      wb
        ? `Peso total excede el máximo de despegue: ${wb.computed_total_weight_kg}kg > ${wb.max_takeoff_weight_kg}kg (excedente ${Math.abs(wb.margin_kg)}kg).`
        : "Falta el formulario de peso y balance."
    );
  }
  if (!details.fuelPlan || Number(details.fuelPlan.sufficient) !== 1) {
    const fp = details.fuelPlan;
    violations.push(
      fp
        ? `Combustible insuficiente: a bordo ${fp.fuel_on_board_kg}kg, se requieren ${fp.computed_required_kg}kg (déficit ${Math.abs(fp.margin_kg)}kg).`
        : "Falta el plan de combustible."
    );
  }

  if (violations.length > 0) {
    throw new Error(`No se puede liberar el vuelo — bloqueado por despacho:\n  - ${violations.join("\n  - ")}`);
  }

  await run(
    db,
    "UPDATE flight_releases SET status = 'released', dispatcher_name = ?, released_at = ? WHERE id = ?",
    [dispatcherName, new Date().toISOString(), releaseId]
  );
  return getFlightReleaseWithDetails(db, releaseId);
}

/**
 * Recalcula peso/balance y combustible con valores actualizados (p.ej. si
 * cambió la carga o el combustible cargado después de crear el draft) sin
 * tener que recrear todo el despacho.
 */
async function recomputeChecks(db, releaseId, { weightBalance, fuelPlan }) {
  const details = await getFlightReleaseWithDetails(db, releaseId);
  if (!details) throw new Error(`Despacho ${releaseId} no encontrado.`);
  if (details.status !== "draft") throw new Error(`Solo se puede editar un despacho en estado 'draft' (estado actual: ${details.status}).`);

  if (weightBalance) {
    const current = details.weightBalance || {};
    const next = {
      emptyWeightKg: weightBalance.emptyWeightKg ?? current.empty_weight_kg,
      crewWeightKg: weightBalance.crewWeightKg ?? current.crew_weight_kg ?? 0,
      passengerWeightKg: weightBalance.passengerWeightKg ?? current.passenger_weight_kg ?? 0,
      cargoWeightKg: weightBalance.cargoWeightKg ?? current.cargo_weight_kg ?? 0,
      fuelWeightKg: weightBalance.fuelWeightKg ?? current.fuel_weight_kg ?? 0,
      maxTakeoffWeightKg: weightBalance.maxTakeoffWeightKg ?? current.max_takeoff_weight_kg,
    };
    const wb = computeWeightBalance(next);
    await run(
      db,
      `UPDATE weight_balance SET empty_weight_kg = ?, crew_weight_kg = ?, passenger_weight_kg = ?, cargo_weight_kg = ?, fuel_weight_kg = ?, max_takeoff_weight_kg = ?, computed_total_weight_kg = ?, margin_kg = ?, within_limits = ? WHERE flight_release_id = ?`,
      [
        next.emptyWeightKg,
        next.crewWeightKg,
        next.passengerWeightKg,
        next.cargoWeightKg,
        next.fuelWeightKg,
        next.maxTakeoffWeightKg,
        wb.totalWeightKg,
        wb.marginKg,
        wb.withinLimits ? 1 : 0,
        releaseId,
      ]
    );
  }

  if (fuelPlan) {
    const current = details.fuelPlan || {};
    const next = {
      tripFuelKg: fuelPlan.tripFuelKg ?? current.trip_fuel_kg,
      alternateFuelKg: fuelPlan.alternateFuelKg ?? current.alternate_fuel_kg ?? 0,
      reserveFuelKg: fuelPlan.reserveFuelKg ?? current.reserve_fuel_kg,
      contingencyFuelKg: fuelPlan.contingencyFuelKg ?? current.contingency_fuel_kg ?? 0,
      fuelOnBoardKg: fuelPlan.fuelOnBoardKg ?? current.fuel_on_board_kg,
    };
    const fp = computeFuelPlan(next);
    await run(
      db,
      `UPDATE fuel_plans SET trip_fuel_kg = ?, alternate_fuel_kg = ?, reserve_fuel_kg = ?, contingency_fuel_kg = ?, fuel_on_board_kg = ?, computed_required_kg = ?, margin_kg = ?, sufficient = ? WHERE flight_release_id = ?`,
      [
        next.tripFuelKg,
        next.alternateFuelKg,
        next.reserveFuelKg,
        next.contingencyFuelKg,
        next.fuelOnBoardKg,
        fp.requiredKg,
        fp.marginKg,
        fp.sufficient ? 1 : 0,
        releaseId,
      ]
    );
  }

  return getFlightReleaseWithDetails(db, releaseId);
}

async function markDeparted(db, releaseId) {
  const release = await get(db, "SELECT * FROM flight_releases WHERE id = ?", [releaseId]);
  if (!release) throw new Error(`Despacho ${releaseId} no encontrado.`);
  if (release.status !== "released") throw new Error(`Solo se puede marcar como despegado un despacho 'released' (estado actual: ${release.status}).`);
  await run(db, "UPDATE flight_releases SET status = 'departed', departed_at = ? WHERE id = ?", [new Date().toISOString(), releaseId]);
  return getFlightReleaseWithDetails(db, releaseId);
}

async function closeFlightRelease(db, releaseId) {
  const release = await get(db, "SELECT * FROM flight_releases WHERE id = ?", [releaseId]);
  if (!release) throw new Error(`Despacho ${releaseId} no encontrado.`);
  if (release.status !== "departed") throw new Error(`Solo se puede cerrar un despacho 'departed' (estado actual: ${release.status}).`);
  await run(db, "UPDATE flight_releases SET status = 'closed', closed_at = ? WHERE id = ?", [new Date().toISOString(), releaseId]);
  return getFlightReleaseWithDetails(db, releaseId);
}

async function cancelFlightRelease(db, releaseId) {
  const release = await get(db, "SELECT * FROM flight_releases WHERE id = ?", [releaseId]);
  if (!release) throw new Error(`Despacho ${releaseId} no encontrado.`);
  if (release.status === "departed" || release.status === "closed") throw new Error(`No se puede cancelar un despacho ya '${release.status}'.`);
  await run(db, "UPDATE flight_releases SET status = 'cancelled' WHERE id = ?", [releaseId]);
  return getFlightReleaseWithDetails(db, releaseId);
}

async function getDispatchDashboard(db, { date } = {}) {
  const releases = date
    ? await all(db, "SELECT * FROM flight_releases WHERE flight_date = ? ORDER BY planned_departure_time", [date])
    : await all(db, "SELECT * FROM flight_releases ORDER BY flight_date DESC, planned_departure_time");
  const result = [];
  for (const r of releases) {
    result.push(await getFlightReleaseWithDetails(db, r.id));
  }
  return result;
}

/**
 * Despachos cerrados cuyo plan de combustible todavía no se reflejó como
 * consumo real en fleet-fuel-module (ver flujo 6 de fleet-integration).
 */
async function getPendingFuelSync(db) {
  const releases = await all(db, "SELECT * FROM flight_releases WHERE status = 'closed' AND synced_to_fuel = 0 ORDER BY flight_date");
  const result = [];
  for (const r of releases) result.push(await getFlightReleaseWithDetails(db, r.id));
  return result;
}

async function markFuelSynced(db, releaseId) {
  await run(db, "UPDATE flight_releases SET synced_to_fuel = 1 WHERE id = ?", [releaseId]);
  return getFlightReleaseWithDetails(db, releaseId);
}

module.exports = {
  computeWeightBalance,
  computeFuelPlan,
  createFlightRelease,
  getFlightReleaseWithDetails,
  releaseFlight,
  recomputeChecks,
  markDeparted,
  closeFlightRelease,
  cancelFlightRelease,
  getDispatchDashboard,
  getPendingFuelSync,
  markFuelSynced,
};
