// ============================================================================
// Demo de consola: siembra datos y prueba escenarios de FRAT (bajo, alto sin
// aprobación -> rechazado, alto con aprobación -> aceptado), más el
// dashboard de seguridad.
// Uso: node src/cli-demo.js
// ============================================================================

const { openDatabase } = require("./db");
const { seed } = require("./seed");
const { createFratAssessment, getSafetyDashboard } = require("./smsEngine");

async function attempt(label, fn) {
  try {
    const result = await fn();
    console.log(`✔ ${label}`);
    console.log(`  Score ${result.total_score}/24 — riesgo ${result.risk_level.toUpperCase()}${result.approved_by ? ` (aprobado por ${result.approved_by})` : ""}`);
  } catch (err) {
    console.log(`✘ ${label}`);
    console.log(`  Rechazado: ${err.message}`);
  }
  console.log();
}

async function main() {
  const db = await openDatabase();
  await seed(db);

  console.log("=".repeat(78));
  console.log("DEMO — Módulo SMS (Seguridad)");
  console.log(`Motor de base de datos: ${db.engine}`);
  console.log("=".repeat(78));
  console.log();

  await attempt("1) FRAT de riesgo bajo: buen clima, terreno conocido, piloto descansado", () =>
    createFratAssessment(db, {
      flightDate: "2026-07-18", aircraftTail: "XA-HEL1", missionType: "Transporte de personal",
      weatherScore: 0, terrainScore: 1, pilotCurrencyScore: 0, fatigueScore: 0, aircraftStatusScore: 0, operationalPressureScore: 1,
    })
  );

  await attempt("2) FRAT de riesgo ALTO sin aprobación: clima marginal + terreno desconocido + piloto fatigado (debe RECHAZARSE)", () =>
    createFratAssessment(db, {
      flightDate: "2026-07-19", aircraftTail: "XA-HEL2", missionType: "Ambulancia aérea nocturna",
      weatherScore: 3, terrainScore: 4, pilotCurrencyScore: 2, fatigueScore: 3, aircraftStatusScore: 1, operationalPressureScore: 3,
    })
  );

  await attempt("3) El mismo FRAT de riesgo alto, ahora CON aprobación de supervisor (debe aceptarse)", () =>
    createFratAssessment(db, {
      flightDate: "2026-07-19", aircraftTail: "XA-HEL2", missionType: "Ambulancia aérea nocturna",
      weatherScore: 3, terrainScore: 4, pilotCurrencyScore: 2, fatigueScore: 3, aircraftStatusScore: 1, operationalPressureScore: 3,
      approvedBy: "Jefe de Operaciones — María Elena Soto",
    })
  );

  console.log("-".repeat(78));
  console.log("Dashboard de seguridad:");
  const dashboard = await getSafetyDashboard(db);
  console.log(`  Ocurrencias abiertas: ${dashboard.openOccurrencesCount}`);
  for (const s of dashboard.openOccurrencesBySeverity) {
    if (s.count > 0) console.log(`    - ${s.severity}: ${s.count}`);
  }
  console.log(`  Peligros de mayor riesgo (top 5):`);
  for (const h of dashboard.topHazards) {
    console.log(`    - [score ${h.risk_score}] ${h.description}`);
  }
  console.log(`  Acciones correctivas pendientes: ${dashboard.pendingCorrectiveActionsCount}`);
  console.log(`  Vuelos de alto riesgo entre los últimos 10 FRAT: ${dashboard.highRiskFlightsLast10}`);
  console.log("-".repeat(78));
}

main().catch((err) => {
  console.error("Error en la demo:", err.message);
  process.exit(1);
});
