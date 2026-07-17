// ============================================================================
// Demo de consola: siembra datos (incluye un componente ya vencido) y prueba
// escenarios de bloqueo de vuelos, overhaul, y el dashboard de flota.
// Uso: node src/cli-demo.js
// ============================================================================

const { openDatabase } = require("./db");
const { seed } = require("./seed");
const { logFlight, createWorkOrder, closeWorkOrder, getFleetDashboard } = require("./maintenanceEngine");

async function attempt(label, fn) {
  try {
    const result = await fn();
    console.log(`✔ ${label}`);
    if (result?.id) console.log(`  Registrado #${result.id}`);
  } catch (err) {
    console.log(`✘ ${label}`);
    console.log(`  ${err.message.split("\n").join("\n  ")}`);
  }
  console.log();
}

function printDashboard(entry) {
  console.log(`${entry.aircraft.tail_number} (${entry.aircraft.model}) — ${entry.aircraft.total_hours.toFixed(1)}h totales — ${entry.airworthy ? "AERONAVEGABLE" : "NO AERONAVEGABLE"}`);
  for (const c of entry.components) {
    const bits = [];
    if (c.remaining.hours != null) bits.push(`${c.remaining.hours}h restantes`);
    if (c.remaining.cycles != null) bits.push(`${c.remaining.cycles} ciclos restantes`);
    if (c.remaining.calendarDays != null) bits.push(`${c.remaining.calendarDays} días restantes`);
    const marker = c.lifeStatus === "overdue" ? "✘ VENCIDO" : c.lifeStatus === "due_soon" ? "⚠ POR VENCER" : "✔ OK";
    console.log(`  ${marker}  ${c.name.padEnd(32)} ${bits.join(", ")}`);
  }
  console.log();
}

async function main() {
  const db = await openDatabase();
  const ids = await seed(db);

  console.log("=".repeat(78));
  console.log("DEMO — Módulo de Mantenimiento por Componente");
  console.log(`Motor de base de datos: ${db.engine}`);
  console.log("=".repeat(78));
  console.log();

  console.log("--- Estado inicial de la flota ---\n");
  for (const entry of await getFleetDashboard(db, "2026-07-14")) printDashboard(entry);

  await attempt("1) Intentar registrar un vuelo de 20h en XA-HEL1 (el eje de cola YA está vencido -> debe RECHAZARSE)", () =>
    logFlight(db, { aircraftId: ids.aircraft.h125, flightDate: "2026-07-15", hobbsHours: 20 })
  );

  console.log("--- Abriendo orden de trabajo de reemplazo para el eje de cola ---\n");
  const woResult = await createWorkOrder(db, {
    aircraftId: ids.aircraft.h125,
    description: "Reemplazo de eje de transmisión de cola por vida límite excedida.",
    actionType: "replacement",
  });
  // Necesitamos el component_id real del eje de cola para vincular la OT correctamente:
  const { all } = require("./db");
  const components = await all(db, "SELECT * FROM components WHERE aircraft_id = ? AND name LIKE '%cola%'", [ids.aircraft.h125]);
  await run_link_and_close(db, woResult.id, components[0].id);

  async function run_link_and_close(db, woId, componentId) {
    const { run } = require("./db");
    await run(db, "UPDATE work_orders SET component_id = ? WHERE id = ?", [componentId, woId]);
    await closeWorkOrder(db, woId, "2026-07-16");
    console.log(`Orden de trabajo #${woId} cerrada — componente #${componentId} reseteado a 0 horas.\n`);
  }

  await attempt("2) Reintentar el mismo vuelo de 20h en XA-HEL1 (el eje de cola ya no bloquea, pero la caja de transmisión sigue con solo 15h -> debe RECHAZARSE también)", () =>
    logFlight(db, { aircraftId: ids.aircraft.h125, flightDate: "2026-07-17", hobbsHours: 20 })
  );

  console.log("--- Haciendo overhaul de la caja de transmisión también ---\n");
  const woGearbox = await createWorkOrder(db, {
    aircraftId: ids.aircraft.h125,
    description: "Overhaul de caja de transmisión principal por vida límite próxima a vencer.",
    actionType: "overhaul",
  });
  const gearboxComponents = await all(db, "SELECT * FROM components WHERE aircraft_id = ? AND name LIKE '%transmisi%n principal%'", [ids.aircraft.h125]);
  const { run: runQuery } = require("./db");
  await runQuery(db, "UPDATE work_orders SET component_id = ? WHERE id = ?", [gearboxComponents[0].id, woGearbox.id]);
  await closeWorkOrder(db, woGearbox.id, "2026-07-17");
  console.log(`Orden de trabajo #${woGearbox.id} cerrada — componente #${gearboxComponents[0].id} reseteado a 0 horas.\n`);

  await attempt("3) Reintentar el mismo vuelo de 20h en XA-HEL1 (ambos componentes ya resueltos -> debe ACEPTARSE)", () =>
    logFlight(db, { aircraftId: ids.aircraft.h125, flightDate: "2026-07-17", hobbsHours: 20 })
  );

  console.log("--- Estado final de la flota ---\n");
  for (const entry of await getFleetDashboard(db, "2026-07-17")) printDashboard(entry);
}

main().catch((err) => {
  console.error("Error en la demo:", err.message);
  process.exit(1);
});
