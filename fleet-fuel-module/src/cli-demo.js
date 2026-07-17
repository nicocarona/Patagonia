// Demo de consola: siembra tanques/proveedores/movimientos, muestra el
// tablero, y prueba el gate recordUplift contra un tanque con poco stock.

const { openDatabase } = require("./db");
const { seed } = require("./seed");
const { getFuelDashboard, getCostByAircraft, recordUplift } = require("./fuelEngine");

async function main() {
  const db = await openDatabase(":memory:");
  await seed(db);

  console.log("=== Tablero de combustible ===");
  const dashboard = await getFuelDashboard(db);
  for (const entry of dashboard) {
    console.log(
      `${entry.tank.base}: ${entry.tank.current_level_liters}L / ${entry.tank.capacity_liters}L (${entry.percentFull}%) — costo promedio ${(entry.tank.average_cost_per_liter_cents / 100).toFixed(2)}/L`
    );
  }

  console.log("\n=== Costo de combustible por aeronave ===");
  const costs = await getCostByAircraft(db);
  for (const c of costs) {
    console.log(`${c.tailNumber}: ${c.totalLiters}L en ${c.upliftCount} uplift(s), costo total $${(c.totalCostCents / 100).toFixed(2)}`);
  }

  console.log("\n=== Intento 1: repostar XA-HEL3 en Base Costa con 200L (hay stock) ===");
  try {
    const r = await recordUplift(db, { tailNumber: "XA-HEL3", base: "Base Costa", liters: 200, upliftDate: "2026-07-17" });
    console.log(`OK -> uplift #${r.uplift.id}, tanque de Base Costa queda en ${r.tank.current_level_liters}L`);
  } catch (err) {
    console.log(`RECHAZADO -> ${err.message}`);
  }

  console.log("\n=== Intento 2: repostar XA-HEL4 en Base Costa con 500L (excede lo que queda) ===");
  try {
    await recordUplift(db, { tailNumber: "XA-HEL4", base: "Base Costa", liters: 500, upliftDate: "2026-07-17" });
  } catch (err) {
    console.log(`RECHAZADO -> ${err.message}`);
  }

  console.log("\n=== Idempotencia: repetir un uplift con el mismo source_flight_release_id no duplica ===");
  const first = await recordUplift(db, { tailNumber: "XA-HEL1", base: "Base Norte", liters: 300, upliftDate: "2026-07-18", sourceFlightReleaseId: 999 });
  console.log(`Primera vez -> uplift #${first.uplift.id}, alreadyExisted: ${first.alreadyExisted}`);
  const second = await recordUplift(db, { tailNumber: "XA-HEL1", base: "Base Norte", liters: 300, upliftDate: "2026-07-18", sourceFlightReleaseId: 999 });
  console.log(`Segunda vez -> uplift #${second.uplift.id}, alreadyExisted: ${second.alreadyExisted}`);
}

main().catch((err) => {
  console.error("Error en la demo:", err);
  process.exit(1);
});
