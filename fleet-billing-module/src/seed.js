// ============================================================================
// Datos de ejemplo — 2 clientes con contratos distintos y una pequeña flota,
// para poder probar el motor de facturación de punta a punta.
//
// async porque las inserciones dependen del id devuelto por la inserción
// anterior (lastInsertRowid), y con PostgreSQL eso requiere esperar la
// respuesta del servidor.
// ============================================================================

const { run } = require("./db");

async function seed(db) {
  const h125 = await run(db, `INSERT INTO aircraft (tail_number, model, default_hourly_rate_cents) VALUES (?, ?, ?)`,
    ["XA-HEL1", "Airbus H125", 185000]);
  const h145 = await run(db, `INSERT INTO aircraft (tail_number, model, default_hourly_rate_cents) VALUES (?, ?, ?)`,
    ["XA-HEL2", "Airbus H145", 320000]);

  const minera = await run(db, `INSERT INTO customers (name, contact_email, tax_id, payment_terms_days) VALUES (?, ?, ?, ?)`,
    ["Minera del Norte S.A.", "operaciones@mineradelnorte.com", "MDN850101ABC", 30]);
  const hospital = await run(db, `INSERT INTO customers (name, contact_email, tax_id, payment_terms_days) VALUES (?, ?, ?, ?)`,
    ["Red Hospitalaria Aeromédica", "contratos@redhems.org", "RHA920215XYZ", 15]);

  const contractCharter = await run(
    db,
    `INSERT INTO contracts
      (customer_id, contract_type, flight_rate_cents, positioning_rate_cents, standby_rate_cents,
       landing_fee_cents, fuel_surcharge_pct, daily_minimum_hours, monthly_retainer_cents,
       retainer_included_hours, overage_rate_cents, tax_pct, active)
     VALUES (?, 'charter', ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?, 1)`,
    [minera.lastInsertRowid, 190000, 95000, 60000, 5000, 8, 2.0, 16]
  );

  const contractRetainer = await run(
    db,
    `INSERT INTO contracts
      (customer_id, contract_type, flight_rate_cents, positioning_rate_cents, standby_rate_cents,
       landing_fee_cents, fuel_surcharge_pct, daily_minimum_hours, monthly_retainer_cents,
       retainer_included_hours, overage_rate_cents, tax_pct, active)
     VALUES (?, 'hems_retainer', ?, 0, ?, 0, ?, 0, ?, ?, ?, ?, 1)`,
    [hospital.lastInsertRowid, 320000, 40000, 5, 45000000, 40, 260000, 16]
  );

  const flightsData = [
    [h125.lastInsertRowid, minera.lastInsertRowid, contractCharter.lastInsertRowid, "2026-07-02", "Transporte de personal", 2.5, 0.5, 0, 2],
    [h125.lastInsertRowid, minera.lastInsertRowid, contractCharter.lastInsertRowid, "2026-07-09", "Transporte de carga", 0.8, 0.4, 0, 1],
    [h125.lastInsertRowid, minera.lastInsertRowid, contractCharter.lastInsertRowid, "2026-07-21", "Transporte de personal", 3.1, 0.5, 1.0, 2],
  ];
  for (const row of flightsData) {
    await run(db, `INSERT INTO flights (aircraft_id, customer_id, contract_id, flight_date, mission_type, flight_hours, positioning_hours, standby_hours, landing_count)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, row);
  }

  const hemsFlights = [
    ["2026-07-03", 10.5],
    ["2026-07-10", 12.0],
    ["2026-07-16", 9.5],
    ["2026-07-27", 14.0],
  ];
  for (const [date, hours] of hemsFlights) {
    await run(db, `INSERT INTO flights (aircraft_id, customer_id, contract_id, flight_date, mission_type, flight_hours, positioning_hours, standby_hours, landing_count)
              VALUES (?, ?, ?, ?, 'Ambulancia aérea', ?, 0, 0, 1)`,
      [h145.lastInsertRowid, hospital.lastInsertRowid, contractRetainer.lastInsertRowid, date, hours]);
  }

  return {
    aircraft: { h125: h125.lastInsertRowid, h145: h145.lastInsertRowid },
    customers: { minera: minera.lastInsertRowid, hospital: hospital.lastInsertRowid },
    contracts: { charter: contractCharter.lastInsertRowid, retainer: contractRetainer.lastInsertRowid },
  };
}

module.exports = { seed };
