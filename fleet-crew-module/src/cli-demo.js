// ============================================================================
// Demo de consola: siembra datos y prueba 5 escenarios de fatiga.
// Uso: node src/cli-demo.js
// ============================================================================

const { openDatabase } = require("./db");
const { seed } = require("./seed");
const { createDutyPeriod, computeFatigueScore } = require("./fatigueEngine");

async function attempt(label, fn) {
  try {
    const duty = await fn();
    console.log(`✔ ${label}`);
    console.log(`  Registrado #${duty.id}: ${duty.duty_date} ${duty.start_time}-${duty.end_time} (${duty.duty_type})`);
  } catch (err) {
    console.log(`✘ ${label}`);
    console.log(`  Rechazado: ${err.message}`);
  }
  console.log();
}

async function main() {
  const db = await openDatabase();
  const ids = await seed(db);

  console.log("=".repeat(78));
  console.log("DEMO — Módulo de Tripulación y Fatiga");
  console.log(`Motor de base de datos: ${db.engine}`);
  console.log("=".repeat(78));
  console.log();

  await attempt("1) Turno normal: Carla (paramédico), 08:00-16:00", () =>
    createDutyPeriod(db, { crewId: ids.crew.carla, dutyDate: "2026-07-17", startTime: "08:00", endTime: "16:00", dutyType: "standby" })
  );

  await attempt("2) Descanso insuficiente: Ana intenta un turno el 18 de julio a las 05:00 (su turno anterior terminó el 17 a las 23:00 → solo 6h de descanso, se requieren 10h)", () =>
    createDutyPeriod(db, { crewId: ids.crew.ana, dutyDate: "2026-07-18", startTime: "05:00", endTime: "13:00", dutyType: "flight" })
  );

  await attempt("3) Tripulante de licencia: Ana intenta un turno el 22 de julio (está de vacaciones del 20 al 24)", () =>
    createDutyPeriod(db, { crewId: ids.crew.ana, dutyDate: "2026-07-22", startTime: "08:00", endTime: "12:00", dutyType: "flight" })
  );

  await attempt("4) Excede límite SEMANAL: Luis ya tiene 30h esta semana (lun-jue), agregar 8h más el viernes = 38h > máximo 36h", () =>
    createDutyPeriod(db, { crewId: ids.crew.luis, dutyDate: "2026-07-17", startTime: "07:00", endTime: "15:00", dutyType: "flight" })
  );

  await attempt("5) Turno válido: Luis, 4h el viernes (30h + 4h = 34h, dentro del límite semanal)", () =>
    createDutyPeriod(db, { crewId: ids.crew.luis, dutyDate: "2026-07-17", startTime: "07:00", endTime: "11:00", dutyType: "flight" })
  );

  console.log("-".repeat(78));
  console.log("Scores de fatiga al 2026-07-17:");
  for (const [name, id] of Object.entries({ Ana: ids.crew.ana, Luis: ids.crew.luis, Carla: ids.crew.carla })) {
    const score = await computeFatigueScore(db, id, "2026-07-17");
    console.log(`  ${name.padEnd(8)} semanal: ${String(score.weeklyHours).padStart(5)}h   mensual: ${String(score.monthlyHours).padStart(5)}h   score: ${String(score.score).padStart(3)} (${score.level})`);
  }
  console.log("-".repeat(78));
}

main().catch((err) => {
  console.error("Error en la demo:", err.message);
  process.exit(1);
});
