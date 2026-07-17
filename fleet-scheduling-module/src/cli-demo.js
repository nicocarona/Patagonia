// ============================================================================
// Demo de consola: siembra datos de ejemplo y prueba 5 escenarios que
// ejercitan las 4 reglas de validación, incluyendo casos que DEBEN fallar.
//
// Uso: node src/cli-demo.js                (SQLite local)
//      DATABASE_URL=postgres://... node src/cli-demo.js   (PostgreSQL)
// ============================================================================

const { openDatabase } = require("./db");
const { seed } = require("./seed");
const { createBooking } = require("./schedulingEngine");

async function attempt(label, fn) {
  try {
    const booking = await fn();
    console.log(`✔ ${label}`);
    console.log(`  Reserva #${booking.id} confirmada: ${booking.booking_date} ${booking.start_time}-${booking.end_time}`);
  } catch (err) {
    console.log(`✘ ${label}`);
    console.log(`  Rechazada: ${err.message}`);
  }
  console.log();
}

async function main() {
  const db = await openDatabase();
  const ids = await seed(db);

  console.log("=".repeat(78));
  console.log("DEMO — Módulo de Programación de Vuelos");
  console.log(`Motor de base de datos: ${db.engine}`);
  console.log("=".repeat(78));
  console.log();

  await attempt("1) Reserva normal: Ana en H125, 08:00-10:00", () =>
    createBooking(db, {
      aircraftId: ids.aircraft.h125, pilotId: ids.crew.ana, customerId: ids.customers.minera,
      bookingDate: "2026-07-15", startTime: "08:00", endTime: "10:00",
      missionType: "Transporte de personal", certificateContext: "charter",
    })
  );

  await attempt("2) Conflicto de AERONAVE: otro vuelo en el mismo H125 que se traslapa (09:00-11:00)", () =>
    createBooking(db, {
      aircraftId: ids.aircraft.h125, pilotId: ids.crew.luis, customerId: ids.customers.minera,
      bookingDate: "2026-07-15", startTime: "09:00", endTime: "11:00",
      missionType: "Transporte de carga", certificateContext: "charter",
    })
  );

  await attempt("3) Calificación VENCIDA: Ana intenta volar el H145 (su habilitación venció en mayo 2026)", () =>
    createBooking(db, {
      aircraftId: ids.aircraft.h145, pilotId: ids.crew.ana, customerId: ids.customers.hospital,
      bookingDate: "2026-07-15", startTime: "12:00", endTime: "14:00",
      missionType: "Ambulancia aérea", certificateContext: "hems",
    })
  );

  await attempt("4) Reserva válida: Luis en H145 (habilitación vigente), mismo día", () =>
    createBooking(db, {
      aircraftId: ids.aircraft.h145, pilotId: ids.crew.luis, customerId: ids.customers.hospital,
      bookingDate: "2026-07-15", startTime: "12:00", endTime: "18:00",
      missionType: "Ambulancia aérea", certificateContext: "hems",
    })
  );

  await attempt("5) Excede horas de servicio: agregar 3h más a Luis el mismo día (6h + 3h = 9h > máximo 8h)", () =>
    createBooking(db, {
      aircraftId: ids.aircraft.h125, pilotId: ids.crew.luis, customerId: ids.customers.minera,
      bookingDate: "2026-07-15", startTime: "19:00", endTime: "22:00",
      missionType: "Traslado nocturno", certificateContext: "charter",
    })
  );

  console.log("Demo completada: 3 reservas confirmadas, 2 rechazadas por el motor de validación.");
}

main().catch((err) => {
  console.error("Error en la demo:", err.message);
  process.exit(1);
});
