// Datos de ejemplo: 3 despachos. Uno limpio (aprueba y se libera), uno con
// sobrepeso, y uno con combustible insuficiente — para demostrar el
// bloqueo tal como se hace en los demás módulos (mantenimiento, inventario).

const { createFlightRelease } = require("./dispatchEngine");

async function seed(db) {
  const { get } = require("./db");
  const row = await get(db, "SELECT COUNT(*) as n FROM flight_releases", []);
  if (row && row.n > 0) {
    console.log("Ya hay datos en fleet-dispatch-module, se omite el seed.");
    return;
  }

  // 1) Vuelo limpio: dentro de peso y con combustible suficiente.
  await createFlightRelease(db, {
    tailNumber: "XA-HEL1",
    picName: "Ana Reyes",
    flightDate: "2026-07-20",
    departureBase: "Base Norte",
    destination: "Campo Minero Sur",
    alternate: "Base Norte",
    route: "Directo",
    plannedDepartureTime: "08:00",
    estimatedFlightTimeHours: 1.5,
    weightBalance: {
      emptyWeightKg: 2200,
      crewWeightKg: 160,
      passengerWeightKg: 320,
      cargoWeightKg: 150,
      fuelWeightKg: 400,
      maxTakeoffWeightKg: 3400,
    },
    fuelPlan: {
      tripFuelKg: 220,
      alternateFuelKg: 60,
      reserveFuelKg: 80, // valor de referencia — cada operador define el suyo en su manual (ver comentario en dispatchEngine.js)
      contingencyFuelKg: 20,
      fuelOnBoardKg: 400,
    },
  });

  // 2) Sobrepeso: el peso total (2200+180+450+300+450=3580) excede el MTOW (3400).
  await createFlightRelease(db, {
    tailNumber: "XA-HEL2",
    picName: "Luis Camacho",
    flightDate: "2026-07-20",
    departureBase: "Base Costa",
    destination: "Plataforma Offshore 3",
    alternate: "Base Costa",
    route: "Directo costero",
    plannedDepartureTime: "09:30",
    estimatedFlightTimeHours: 1.1,
    weightBalance: {
      emptyWeightKg: 2200,
      crewWeightKg: 180,
      passengerWeightKg: 450,
      cargoWeightKg: 300,
      fuelWeightKg: 450,
      maxTakeoffWeightKg: 3400,
    },
    fuelPlan: {
      tripFuelKg: 200,
      alternateFuelKg: 50,
      reserveFuelKg: 80,
      contingencyFuelKg: 20,
      fuelOnBoardKg: 450,
    },
  });

  // 3) Combustible insuficiente: requerido (280+70+80+20=450) > a bordo (380).
  await createFlightRelease(db, {
    tailNumber: "XA-HEL3",
    picName: "Carla Núñez",
    flightDate: "2026-07-21",
    departureBase: "Base Norte",
    destination: "Hospital Regional (HEMS)",
    alternate: "Base Norte",
    route: "Directo",
    plannedDepartureTime: "14:00",
    estimatedFlightTimeHours: 1.8,
    weightBalance: {
      emptyWeightKg: 2100,
      crewWeightKg: 160,
      passengerWeightKg: 160,
      cargoWeightKg: 40,
      fuelWeightKg: 380,
      maxTakeoffWeightKg: 3200,
    },
    fuelPlan: {
      tripFuelKg: 280,
      alternateFuelKg: 70,
      reserveFuelKg: 80,
      contingencyFuelKg: 20,
      fuelOnBoardKg: 380,
    },
  });

  console.log("fleet-dispatch-module: 3 despachos de ejemplo creados (1 limpio, 1 con sobrepeso, 1 con combustible insuficiente).");
}

module.exports = { seed };
