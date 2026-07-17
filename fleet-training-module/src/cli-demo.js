// Demo de consola: siembra 3 perfiles, muestra el tablero de vigencia
// completo, y prueba el gate checkPilotCurrency contra escenarios
// vigentes/vencidos.

const { openDatabase } = require("./db");
const { seed } = require("./seed");
const { getFleetCurrencyDashboard, checkPilotCurrency } = require("./trainingEngine");

function printProfile(p) {
  console.log(`\n--- ${p.crew.name} (${p.crew.employee_code}, ${p.crew.role}) ---`);
  console.log(`  flightReady: ${p.summary.flightReady} | licencia: ${p.summary.licenseOk ? "OK" : "NO"} | médico: ${p.summary.medicalOk ? "OK" : "NO"}`);
  console.log(`  habilitado hoy en: ${p.summary.currentAircraftModels.join(", ") || "(ninguno)"}`);
  for (const t of p.typeRatings) console.log(`    type rating ${t.aircraft_model}: ${t.status} (vence ${t.expiry_date})`);
  for (const s of p.specialQualifications) console.log(`    habilitación especial ${s.qualification_code}: ${s.status}${s.expiry_date ? ` (vence ${s.expiry_date})` : ""}`);
  for (const r of p.recurrentTrainings) console.log(`    entrenamiento ${r.training_type}: ${r.status}${r.expiry_date ? ` (vence ${r.expiry_date})` : ""}`);
}

async function main() {
  const db = await openDatabase(":memory:");
  await seed(db);

  console.log("=== Tablero de vigencia de tripulación ===");
  const dashboard = await getFleetCurrencyDashboard(db);
  for (const p of dashboard) printProfile(p);

  console.log("\n=== Gate: checkPilotCurrency ===");
  const cases = [
    { employeeCode: "EMP-0001", aircraftModel: "Airbus H125", label: "Ana en H125 (todo vigente)" },
    { employeeCode: "EMP-0001", aircraftModel: "Airbus H145", label: "Ana en H145 (habilitación de tipo vencida)" },
    { employeeCode: "EMP-0002", aircraftModel: "Airbus H145", label: "Luis en H145 (médico vencido)" },
    { employeeCode: "EMP-0002", aircraftModel: "Leonardo AW139", label: "Luis en AW139 (médico vencido, aunque la habilitación de tipo esté al día)" },
    { employeeCode: "EMP-0003", aircraftModel: "Airbus H125", label: "Carla (paramédica, sin habilitación de piloto)" },
  ];
  for (const c of cases) {
    const result = await checkPilotCurrency(db, c);
    console.log(`${c.label} -> ${result.ok ? "OK, puede volar" : "BLOQUEADO: " + result.reason}`);
  }
}

main().catch((err) => {
  console.error("Error en la demo:", err);
  process.exit(1);
});
