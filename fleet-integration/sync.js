// ============================================================================
// Capa de integración — fleet-integration/sync.js
//
// Conecta los servicios independientes (cada uno con su propia base de
// datos) vía sus APIs REST. Siete flujos, en este orden porque cada uno
// depende del anterior:
//
//   1. syncMasterData()          Maestro (fleet-core-module) -> Facturación,
//                                 Programación, Mantenimiento, Tripulación,
//                                 Entrenamiento. Reparte identidad
//                                 (matrícula/legajo) ANTES de que cualquier
//                                 otro flujo la necesite.
//   2. syncAirworthiness()       Mantenimiento -> Programación. Si una
//                                 aeronave no está aeronavegable, Programación
//                                 debe rechazar nuevas reservas sobre ella —
//                                 el mismo patrón "bloquear antes, no
//                                 descubrir después" usado en cada módulo.
//   3. syncInventoryAlerts()     Mantenimiento -> Inventario. Un componente
//                                 due_soon/overdue sin stock disponible del
//                                 part_number correspondiente genera
//                                 automáticamente una orden de compra.
//   4. syncTrainingQualifications() Entrenamiento -> Programación. Empuja
//                                 las habilitaciones de tipo VIGENTES hacia
//                                 la tabla de habilitaciones de Programación
//                                 — el mismo gating que aeronavegabilidad,
//                                 pero para la tripulación: Entrenamiento
//                                 certifica, Programación solo respeta.
//   5. syncBookingsToBilling()   Programación -> Facturación (el flujo
//                                 original: reservas completadas se vuelven
//                                 vuelos facturables, idempotente).
//   6. syncFuelFromDispatch()    Despacho (fleet-dispatch-module) ->
//                                 Combustible (fleet-fuel-module). Cuando un
//                                 despacho se cierra, su plan de combustible
//                                 se convierte en un uplift real — el
//                                 consumo planeado se vuelve consumo
//                                 registrado, sin que nadie lo cargue a
//                                 mano.
//   7. syncFatigueToSms()        Tripulación (fleet-crew-module) -> SMS
//                                 (fleet-sms-module). Refresca, para cada
//                                 piloto, la última fotografía de su score
//                                 de fatiga REAL (calculado a partir de
//                                 horas de servicio). El FRAT ya no
//                                 necesita que alguien adivine qué tan
//                                 cansado está el piloto: si no se pasa un
//                                 fatigueScore explícito, lo hereda de acá.
//
// Por qué está separado en tres funciones en vez de una sola tabla
// compartida: la arquitectura es federada (cada módulo es un servicio HTTP
// independiente, con su propia base de datos) — el patrón más parecido a
// cómo Babcock Mission Critical Services conecta su ERP Sage X3 con
// sistemas de vuelo separados (ver README para la fuente), en vez de la
// plataforma única de Bristow/Ramco. La sincronización explícita y
// registrada es la forma honesta de simular integración entre sistemas
// reales, en vez de fingir que son una sola base de datos.
//
// AUTENTICACIÓN: desde que se agregó fleet-auth-module, todos los módulos
// exigen un token válido en cada request. Este script hace login UNA vez
// como la cuenta de servicio 'fleet-integration' (rol 'integration', con
// permiso de escritura en el maestro y en los espejos de identidad/
// aeronavegabilidad de cada módulo — ver fleet-auth-module/README.md) y
// reutiliza el mismo token en todas las llamadas de la corrida. Si el
// token expira a mitad de una corrida larga, se reintenta con un login
// fresco automáticamente.
//
// Requiere Node 22+ (usa fetch nativo). No tiene dependencias externas.
//
// Uso — una pasada de los siete flujos:
//   node sync.js
// Uso — solo un flujo (para depurar):
//   node sync.js --only=master-data
//   node sync.js --only=airworthiness
//   node sync.js --only=inventory-alerts
//   node sync.js --only=training-qualifications
//   node sync.js --only=bookings
//   node sync.js --only=fuel
//   node sync.js --only=fatigue
// ============================================================================

const CORE_URL = process.env.CORE_URL || "http://localhost:3006";
const BILLING_URL = process.env.BILLING_URL || "http://localhost:3001";
const SCHEDULING_URL = process.env.SCHEDULING_URL || "http://localhost:3002";
const CREW_URL = process.env.CREW_URL || "http://localhost:3003";
const SMS_URL = process.env.SMS_URL || "http://localhost:3004";
const MAINTENANCE_URL = process.env.MAINTENANCE_URL || "http://localhost:3005";
const INVENTORY_URL = process.env.INVENTORY_URL || "http://localhost:3008";
const TRAINING_URL = process.env.TRAINING_URL || "http://localhost:3010";
const DISPATCH_URL = process.env.DISPATCH_URL || "http://localhost:3009";
const FUEL_URL = process.env.FUEL_URL || "http://localhost:3011";
const AUTH_URL = process.env.AUTH_URL || "http://localhost:3007";

// Densidad de referencia para convertir combustible de kg (como lo
// registra fleet-dispatch-module, parte del peso total) a litros (como lo
// registra fleet-fuel-module, insumo comprado por volumen). 0.8 kg/L es un
// valor de referencia comúnmente citado para Jet A-1 a temperatura
// estándar — la densidad real varía con la temperatura y el lote
// específico de combustible; esto NO es una cifra regulatoria ni de un
// proveedor real, es una aproximación para esta demo.
const JET_FUEL_KG_PER_LITER = 0.8;
const AUTH_USERNAME = process.env.AUTH_INTEGRATION_USERNAME || "fleet-integration";
const AUTH_PASSWORD = process.env.AUTH_INTEGRATION_PASSWORD || "changeme123";

let authToken = null;

async function login() {
  const res = await fetch(`${AUTH_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: AUTH_USERNAME, password: AUTH_PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `No se pudo autenticar contra fleet-auth-module (${AUTH_URL}/login) como '${AUTH_USERNAME}': ${body.error ?? res.status}. ` +
      `¿Está corriendo fleet-auth-module? ¿AUTH_INTEGRATION_PASSWORD coincide con la contraseña real del usuario 'fleet-integration'?`
    );
  }
  authToken = body.token;
  return authToken;
}

async function ensureAuth() {
  if (!authToken) await login();
  return authToken;
}

async function getJSON(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  let res = await fetch(url, { ...opts, headers });
  if (res.status === 401 && authToken) {
    // El token pudo haber expirado a mitad de la corrida — un reintento
    // con login fresco, no más.
    await login();
    headers["Authorization"] = `Bearer ${authToken}`;
    res = await fetch(url, { ...opts, headers });
  }
  const body = await res.json();
  if (!res.ok) throw new Error(`${opts?.method ?? "GET"} ${url} -> ${res.status}: ${body.error ?? JSON.stringify(body)}`);
  return body;
}

async function logToCore(entry) {
  try {
    await getJSON(`${CORE_URL}/sync-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
  } catch (err) {
    // El log de auditoría no debe tumbar la sincronización real si el
    // maestro está caído — se avisa por consola y se sigue.
    console.log(`  (no se pudo escribir el log de sync en el maestro: ${err.message})`);
  }
}

// ----------------------------------------------------------------------------
// 1) Maestro -> módulos operativos
// ----------------------------------------------------------------------------
async function syncMasterData() {
  console.log("== 1/7 Maestro (fleet-core-module) -> módulos operativos ==");
  await ensureAuth();
  const [coreAircraft, coreCrew] = await Promise.all([
    getJSON(`${CORE_URL}/aircraft`),
    getJSON(`${CORE_URL}/crew`),
  ]);

  const aircraftTargets = [
    { name: "billing", url: BILLING_URL },
    { name: "scheduling", url: SCHEDULING_URL },
    { name: "maintenance", url: MAINTENANCE_URL },
  ];
  const crewTargets = [
    { name: "scheduling", url: SCHEDULING_URL },
    { name: "crew", url: CREW_URL },
    { name: "training", url: TRAINING_URL },
  ];

  let aircraftSynced = 0;
  for (const aircraft of coreAircraft) {
    for (const target of aircraftTargets) {
      try {
        await getJSON(`${target.url}/aircraft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tailNumber: aircraft.tail_number,
            model: aircraft.model,
            base: aircraft.base,
            defaultHourlyRateCents: aircraft.default_hourly_rate_cents,
          }),
        });
        await logToCore({ entityType: "aircraft", entityKey: aircraft.tail_number, targetModule: target.name, result: "ok" });
        aircraftSynced++;
      } catch (err) {
        console.log(`  ⚠ ${aircraft.tail_number} -> ${target.name}: ${err.message}`);
        await logToCore({ entityType: "aircraft", entityKey: aircraft.tail_number, targetModule: target.name, result: "error" });
      }
    }
  }

  let crewSynced = 0;
  for (const member of coreCrew) {
    for (const target of crewTargets) {
      try {
        await getJSON(`${target.url}/crew`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeCode: member.employee_code,
            name: member.name,
            role: member.role,
            email: member.email,
          }),
        });
        await logToCore({ entityType: "crew", entityKey: member.employee_code, targetModule: target.name, result: "ok" });
        crewSynced++;
      } catch (err) {
        console.log(`  ⚠ ${member.employee_code} (${member.name}) -> ${target.name}: ${err.message}`);
        await logToCore({ entityType: "crew", entityKey: member.employee_code, targetModule: target.name, result: "error" });
      }
    }
  }

  console.log(`Maestro sincronizado: ${aircraftSynced} escritura(s) de aeronave, ${crewSynced} escritura(s) de tripulante.\n`);
  return { aircraftSynced, crewSynced };
}

// ----------------------------------------------------------------------------
// 2) Mantenimiento -> Programación (gating de aeronavegabilidad)
// ----------------------------------------------------------------------------
async function syncAirworthiness() {
  console.log("== 2/7 Mantenimiento -> Programación (aeronavegabilidad) ==");
  await ensureAuth();
  const [dashboard, schedAircraft] = await Promise.all([
    getJSON(`${MAINTENANCE_URL}/dashboard`),
    getJSON(`${SCHEDULING_URL}/aircraft`),
  ]);

  let updated = 0;
  let unchanged = 0;
  for (const entry of dashboard) {
    const match = schedAircraft.find((sa) => sa.tail_number === entry.aircraft.tail_number);
    if (!match) {
      console.log(`  ⚠ ${entry.aircraft.tail_number}: no existe todavía en Programación (correr primero la sincronización de maestro). Se omite.`);
      continue;
    }
    const currentlyAirworthy = Number(match.airworthy) === 1;
    if (currentlyAirworthy === entry.airworthy) {
      unchanged++;
      continue;
    }
    await getJSON(`${SCHEDULING_URL}/aircraft/${match.id}/airworthy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ airworthy: entry.airworthy }),
    });
    console.log(`  ${entry.airworthy ? "✔" : "✘"} ${entry.aircraft.tail_number}: Programación actualizada a ${entry.airworthy ? "AERONAVEGABLE" : "NO AERONAVEGABLE"}.`);
    updated++;
  }

  console.log(`Aeronavegabilidad sincronizada: ${updated} actualización(es), ${unchanged} sin cambio.\n`);
  return { updated, unchanged };
}

// ----------------------------------------------------------------------------
// 3) Mantenimiento -> Inventario (alertas de reposición automática)
// ----------------------------------------------------------------------------
async function syncInventoryAlerts() {
  console.log("== 3/7 Mantenimiento -> Inventario (alertas de reposición) ==");
  await ensureAuth();
  const [maintDashboard, invDashboard] = await Promise.all([
    getJSON(`${MAINTENANCE_URL}/dashboard`),
    getJSON(`${INVENTORY_URL}/dashboard`),
  ]);

  const invByPartNumber = {};
  for (const entry of invDashboard) invByPartNumber[entry.part.part_number] = entry;

  let created = 0;
  let upToDate = 0;
  let skipped = 0;

  for (const aircraftEntry of maintDashboard) {
    for (const component of aircraftEntry.components) {
      if (component.lifeStatus !== "due_soon" && component.lifeStatus !== "overdue") continue;
      if (!component.part_number) {
        skipped++;
        continue;
      }
      const invEntry = invByPartNumber[component.part_number];
      if (!invEntry) {
        console.log(`  ⚠ ${component.part_number} (${component.name} en ${aircraftEntry.aircraft.tail_number}): no está catalogado en Inventario. Se omite.`);
        skipped++;
        continue;
      }
      if (invEntry.totalStock > 0) {
        upToDate++;
        continue;
      }
      const alreadyOpen = invEntry.openPurchaseOrders.some((po) => po.triggered_by === "auto_maintenance_alert");
      if (alreadyOpen) {
        upToDate++;
        continue;
      }
      const po = await getJSON(`${INVENTORY_URL}/purchase-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partId: invEntry.part.id,
          quantity: 1,
          triggeredBy: "auto_maintenance_alert",
          relatedNote: `${component.name} (${component.part_number}) en ${aircraftEntry.aircraft.tail_number} está ${component.lifeStatus === "overdue" ? "VENCIDO" : "por vencer"} y no hay stock disponible.`,
        }),
      });
      console.log(`  ✔ OC #${po.id} generada automáticamente para ${component.part_number} (${aircraftEntry.aircraft.tail_number}: ${component.name}, ${component.lifeStatus}).`);
      created++;
    }
  }

  console.log(`Alertas de inventario sincronizadas: ${created} orden(es) de compra generada(s), ${upToDate} sin necesidad, ${skipped} omitida(s).\n`);
  return { created, upToDate, skipped };
}

// ----------------------------------------------------------------------------
// 4) Entrenamiento -> Programación (habilitaciones de tipo vigentes)
// ----------------------------------------------------------------------------
async function syncTrainingQualifications() {
  console.log("== 4/7 Entrenamiento -> Programación (habilitaciones de tipo) ==");
  await ensureAuth();
  const [trainingDashboard, schedCrew] = await Promise.all([
    getJSON(`${TRAINING_URL}/currency`),
    getJSON(`${SCHEDULING_URL}/crew`),
  ]);

  let created = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const profile of trainingDashboard) {
    const match = schedCrew.find((sc) => sc.employee_code === profile.crew.employee_code);
    if (!match) {
      console.log(`  ⚠ ${profile.crew.employee_code} (${profile.crew.name}): no existe todavía en Programación (correr primero la sincronización de maestro). Se omite.`);
      skipped += profile.typeRatings.length;
      continue;
    }

    const current = await getJSON(`${SCHEDULING_URL}/crew/${match.id}/qualifications`);

    for (const rating of profile.typeRatings) {
      if (rating.status === "vencido") {
        // No se empuja una habilitación vencida — Programación simplemente
        // no tendrá una fila vigente para ese modelo y el gate existente
        // (checkPilotQualification) bloqueará la reserva por su cuenta.
        skipped++;
        continue;
      }
      const alreadyThere = current.some((q) => q.aircraft_model === rating.aircraft_model && q.valid_until === rating.expiry_date);
      if (alreadyThere) {
        unchanged++;
        continue;
      }
      await getJSON(`${SCHEDULING_URL}/crew/${match.id}/qualifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aircraft_model: rating.aircraft_model, qualification_type: "type_rating", valid_until: rating.expiry_date }),
      });
      console.log(`  ✔ ${profile.crew.employee_code} (${profile.crew.name}): Programación actualizada — ${rating.aircraft_model} vigente hasta ${rating.expiry_date}.`);
      created++;
    }
  }

  console.log(`Habilitaciones de tipo sincronizadas: ${created} actualización(es), ${unchanged} sin cambio, ${skipped} omitida(s) (vencidas o tripulante no encontrado).\n`);
  return { created, unchanged, skipped };
}

// ----------------------------------------------------------------------------
// 5) Programación -> Facturación (reservas completadas -> vuelos facturables)
// ----------------------------------------------------------------------------
async function buildBillingLookupMaps() {
  const [schedAircraft, billAircraft, billCustomers] = await Promise.all([
    getJSON(`${SCHEDULING_URL}/aircraft`),
    getJSON(`${BILLING_URL}/aircraft`),
    getJSON(`${BILLING_URL}/customers`),
  ]);
  const aircraftMap = {};
  for (const sa of schedAircraft) {
    const match = billAircraft.find((ba) => ba.tail_number === sa.tail_number);
    if (match) aircraftMap[sa.id] = match.id;
  }
  return { aircraftMap, billCustomers };
}

async function syncBookingsToBilling() {
  console.log("== 5/7 Programación -> Facturación (reservas completadas) ==");
  await ensureAuth();
  const pending = await getJSON(`${SCHEDULING_URL}/bookings/pending-sync`);
  if (pending.length === 0) {
    console.log("No hay reservas completadas pendientes de sincronizar.\n");
    return { synced: 0, skipped: 0 };
  }

  const { aircraftMap, billCustomers } = await buildBillingLookupMaps();
  let synced = 0;
  let skipped = 0;

  for (const booking of pending) {
    const billingAircraftId = aircraftMap[booking.aircraft_id];
    if (!billingAircraftId) {
      console.log(`⚠ Reserva #${booking.id}: no se encontró aeronave equivalente en Facturación (aircraft_id ${booking.aircraft_id}). Se omite.`);
      skipped++;
      continue;
    }
    const billingCustomerId = booking.customer_id;
    const customerExists = billCustomers.some((c) => c.id === billingCustomerId);
    if (!customerExists) {
      console.log(`⚠ Reserva #${booking.id}: cliente ${billingCustomerId} no existe en Facturación. Se omite.`);
      skipped++;
      continue;
    }

    const result = await getJSON(`${BILLING_URL}/flights/from-booking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceBookingId: booking.id,
        aircraftId: billingAircraftId,
        customerId: billingCustomerId,
        contractId: booking.billing_contract_id,
        flightDate: booking.booking_date,
        missionType: booking.mission_type,
        flightHours: booking.actual_flight_hours,
        positioningHours: booking.actual_positioning_hours,
        standbyHours: booking.actual_standby_hours,
        landingCount: booking.actual_landing_count,
      }),
    });

    await getJSON(`${SCHEDULING_URL}/bookings/${booking.id}/mark-synced`, { method: "POST" });

    if (result.alreadyExisted) {
      console.log(`= Reserva #${booking.id}: ya existía como vuelo facturable #${result.id} (sin duplicar).`);
    } else {
      console.log(`✔ Reserva #${booking.id} -> vuelo facturable #${result.id} creado (${result.flight_hours}h, aeronave ${billingAircraftId}, cliente ${billingCustomerId}).`);
    }
    synced++;
  }

  console.log(`Sincronización de reservas completada: ${synced} procesada(s), ${skipped} omitida(s).\n`);
  return { synced, skipped };
}

// ----------------------------------------------------------------------------
// 6) Despacho -> Combustible (consumo real de un vuelo cerrado)
// ----------------------------------------------------------------------------
async function syncFuelFromDispatch() {
  console.log("== 6/7 Despacho -> Combustible (consumo real por vuelo) ==");
  await ensureAuth();
  const pending = await getJSON(`${DISPATCH_URL}/dispatch/pending-fuel-sync`);
  if (pending.length === 0) {
    console.log("No hay despachos cerrados pendientes de sincronizar con Combustible.\n");
    return { synced: 0, skipped: 0 };
  }

  let synced = 0;
  let skipped = 0;

  for (const release of pending) {
    if (!release.fuelPlan) {
      console.log(`  ⚠ Despacho #${release.id} (${release.tail_number}): no tiene plan de combustible. Se omite.`);
      skipped++;
      continue;
    }
    // Aproximación: usamos el combustible de viaje PLANEADO
    // (trip_fuel_kg) como consumo real, porque el despacho no registra el
    // remanente real al aterrizar — ver README de fleet-fuel-module.
    const liters = Math.round((release.fuelPlan.trip_fuel_kg / JET_FUEL_KG_PER_LITER) * 10) / 10;
    try {
      const result = await getJSON(`${FUEL_URL}/uplifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tailNumber: release.tail_number,
          base: release.departure_base,
          liters,
          upliftDate: release.flight_date,
          sourceFlightReleaseId: release.id,
          notes: `Consumo estimado a partir del plan de combustible del despacho #${release.id} (trip_fuel_kg=${release.fuelPlan.trip_fuel_kg}, densidad de referencia ${JET_FUEL_KG_PER_LITER}kg/L).`,
        }),
      });
      await getJSON(`${DISPATCH_URL}/dispatch/${release.id}/mark-fuel-synced`, { method: "POST" });
      if (result.alreadyExisted) {
        console.log(`  = Despacho #${release.id} (${release.tail_number}): ya existía como uplift #${result.uplift.id} (sin duplicar).`);
      } else {
        console.log(`  ✔ Despacho #${release.id} (${release.tail_number}): uplift #${result.uplift.id} registrado — ${liters}L en ${release.departure_base}.`);
      }
      synced++;
    } catch (err) {
      // El caso esperado aquí es que el tanque de esa base no tenga
      // suficiente combustible registrado — no marcamos como sincronizado
      // para poder reintentar después de la próxima entrega.
      console.log(`  ⚠ Despacho #${release.id} (${release.tail_number}): ${err.message}`);
      skipped++;
    }
  }

  console.log(`Consumo de combustible sincronizado: ${synced} procesado(s), ${skipped} omitido(s).\n`);
  return { synced, skipped };
}

// ----------------------------------------------------------------------------
// 7) Tripulación -> SMS (fatiga real disponible para el FRAT)
// ----------------------------------------------------------------------------
async function syncFatigueToSms() {
  console.log("== 7/7 Tripulación -> SMS (fatiga real para FRAT) ==");
  await ensureAuth();
  const crew = await getJSON(`${CREW_URL}/crew`);
  const pilots = crew.filter((c) => c.role === "pilot" && c.employee_code);
  if (pilots.length === 0) {
    console.log("No hay pilotos con employee_code en Tripulación todavía. Se omite.\n");
    return { synced: 0, skipped: 0 };
  }

  const today = new Date().toISOString().slice(0, 10);
  let synced = 0;
  let skipped = 0;

  for (const pilot of pilots) {
    try {
      const fatigue = await getJSON(`${CREW_URL}/crew/${pilot.id}/fatigue-score?date=${today}`);
      await getJSON(`${SMS_URL}/fatigue-snapshots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeCode: pilot.employee_code,
          snapshotDate: today,
          score: fatigue.score,
          level: fatigue.level,
        }),
      });
      console.log(`  ✔ ${pilot.employee_code} (${pilot.name}): fatiga ${fatigue.score}/100 (${fatigue.level}) reflejada en SMS.`);
      synced++;
    } catch (err) {
      console.log(`  ⚠ ${pilot.employee_code} (${pilot.name}): ${err.message}`);
      skipped++;
    }
  }

  console.log(`Fatiga sincronizada: ${synced} piloto(s) actualizado(s), ${skipped} omitido(s).\n`);
  return { synced, skipped };
}

// ----------------------------------------------------------------------------
async function syncAll() {
  const masterData = await syncMasterData();
  const airworthiness = await syncAirworthiness();
  const inventoryAlerts = await syncInventoryAlerts();
  const trainingQualifications = await syncTrainingQualifications();
  const bookings = await syncBookingsToBilling();
  const fuel = await syncFuelFromDispatch();
  const fatigue = await syncFatigueToSms();
  return { masterData, airworthiness, inventoryAlerts, trainingQualifications, bookings, fuel, fatigue };
}

// Compatibilidad con el nombre usado por versiones anteriores del proyecto.
async function syncOnce() {
  return syncBookingsToBilling();
}

if (require.main === module) {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.split("=")[1] : null;

  const run = only === "master-data" ? syncMasterData
    : only === "airworthiness" ? syncAirworthiness
    : only === "inventory-alerts" ? syncInventoryAlerts
    : only === "training-qualifications" ? syncTrainingQualifications
    : only === "bookings" ? syncBookingsToBilling
    : only === "fuel" ? syncFuelFromDispatch
    : only === "fatigue" ? syncFatigueToSms
    : syncAll;

  run().catch((err) => {
    console.error("Error en la sincronización:", err.message);
    process.exit(1);
  });
}

module.exports = {
  syncAll,
  syncMasterData,
  syncAirworthiness,
  syncInventoryAlerts,
  syncTrainingQualifications,
  syncBookingsToBilling,
  syncFuelFromDispatch,
  syncFatigueToSms,
  syncOnce,
};
