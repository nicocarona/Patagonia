// Demo de consola: crea la base en memoria, siembra 3 despachos, e intenta
// liberar los 3 — muestra cómo el sobrepeso y el combustible insuficiente
// bloquean la liberación, y cómo tras "corregir" los datos el vuelo sí sale.

const { openDatabase } = require("./db");
const { seed } = require("./seed");
const {
  getDispatchDashboard,
  releaseFlight,
  recomputeChecks,
  markDeparted,
  closeFlightRelease,
} = require("./dispatchEngine");

async function main() {
  const db = await openDatabase(":memory:");
  await seed(db);

  console.log("\n=== Tablero de despacho ===");
  const dashboard = await getDispatchDashboard(db);
  for (const r of dashboard) {
    console.log(
      `#${r.id} ${r.tail_number} ${r.pic_name} -> ${r.destination} | peso: ${r.weightBalance.within_limits ? "OK" : "EXCEDE"} (${r.weightBalance.computed_total_weight_kg}kg / ${r.weightBalance.max_takeoff_weight_kg}kg) | combustible: ${r.fuelPlan.sufficient ? "OK" : "INSUFICIENTE"} (${r.fuelPlan.fuel_on_board_kg}kg / ${r.fuelPlan.computed_required_kg}kg requeridos)`
    );
  }

  console.log("\n=== Intento 1: liberar despacho #1 (limpio) ===");
  try {
    const released = await releaseFlight(db, 1, { dispatcherName: "Marta Solís" });
    console.log(`OK -> liberado, estado: ${released.status}, despachado por: ${released.dispatcher_name}`);
  } catch (err) {
    console.log(`RECHAZADO -> ${err.message}`);
  }

  console.log("\n=== Intento 2: liberar despacho #2 (sobrepeso) ===");
  try {
    await releaseFlight(db, 2, { dispatcherName: "Marta Solís" });
  } catch (err) {
    console.log(`RECHAZADO -> ${err.message}`);
  }

  console.log("\n--- Corrigiendo: se baja carga y pasajeros en #2 ---");
  await recomputeChecks(db, 2, {
    weightBalance: { cargoWeightKg: 150, passengerWeightKg: 300 },
  });
  console.log("=== Reintento: liberar despacho #2 ===");
  try {
    const released = await releaseFlight(db, 2, { dispatcherName: "Marta Solís" });
    console.log(`OK -> liberado, estado: ${released.status}`);
  } catch (err) {
    console.log(`RECHAZADO -> ${err.message}`);
  }

  console.log("\n=== Intento 3: liberar despacho #3 (combustible insuficiente) ===");
  try {
    await releaseFlight(db, 3, { dispatcherName: "Marta Solís" });
  } catch (err) {
    console.log(`RECHAZADO -> ${err.message}`);
  }

  console.log("\n--- Corrigiendo: se carga más combustible en #3 ---");
  await recomputeChecks(db, 3, { fuelPlan: { fuelOnBoardKg: 460 } });
  console.log("=== Reintento: liberar despacho #3 ===");
  try {
    const released = await releaseFlight(db, 3, { dispatcherName: "Marta Solís" });
    console.log(`OK -> liberado, estado: ${released.status}`);
  } catch (err) {
    console.log(`RECHAZADO -> ${err.message}`);
  }

  console.log("\n=== Ciclo de vida completo del despacho #1: liberado -> despegado -> cerrado ===");
  const departed = await markDeparted(db, 1);
  console.log(`Despegó -> estado: ${departed.status}, hora: ${departed.departed_at}`);
  const closed = await closeFlightRelease(db, 1);
  console.log(`Cerrado -> estado: ${closed.status}`);

  console.log("\n=== Tablero final ===");
  const finalDashboard = await getDispatchDashboard(db);
  for (const r of finalDashboard) {
    console.log(`#${r.id} ${r.tail_number} -> estado: ${r.status}`);
  }
}

main().catch((err) => {
  console.error("Error en la demo:", err);
  process.exit(1);
});
