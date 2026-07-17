const { run } = require("./db");

async function seed(db) {
  const h125 = await run(db, `INSERT INTO aircraft (tail_number, model, total_hours, total_cycles) VALUES (?, ?, ?, ?)`, ["XA-HEL1", "Airbus H125", 4281.2, 8120]);
  const h145 = await run(db, `INSERT INTO aircraft (tail_number, model, total_hours, total_cycles) VALUES (?, ?, ?, ?)`, ["XA-HEL2", "Airbus H145", 2103.7, 3980]);

  // XA-HEL1: un componente sano, uno "por vencer pronto", uno YA vencido.
  await run(db, `INSERT INTO components (aircraft_id, name, part_number, installed_date, hours_limit, hours_accumulated) VALUES (?, ?, ?, ?, ?, ?)`,
    [h125.lastInsertRowid, "Pala de rotor principal #1", "PN-MRB-100", "2023-01-15", 2200, 1850]); // sano
  await run(db, `INSERT INTO components (aircraft_id, name, part_number, installed_date, hours_limit, hours_accumulated) VALUES (?, ?, ?, ?, ?, ?)`,
    [h125.lastInsertRowid, "Caja de transmisión principal", "PN-MGB-200", "2020-06-01", 3000, 2985]); // por vencer (15h)
  await run(db, `INSERT INTO components (aircraft_id, name, part_number, installed_date, hours_limit, hours_accumulated) VALUES (?, ?, ?, ?, ?, ?)`,
    [h125.lastInsertRowid, "Eje de transmisión de cola", "PN-TDS-300", "2019-03-10", 2500, 2510]); // VENCIDO

  await run(db, `INSERT INTO components (aircraft_id, name, part_number, installed_date, calendar_limit_date) VALUES (?, ?, ?, ?, ?)`,
    [h125.lastInsertRowid, "Kit de flotación de emergencia", "PN-EFK-050", "2024-08-01", "2026-08-01"]); // vence calendario pronto

  // XA-HEL2: componentes todos sanos.
  await run(db, `INSERT INTO components (aircraft_id, name, part_number, installed_date, hours_limit, hours_accumulated) VALUES (?, ?, ?, ?, ?, ?)`,
    [h145.lastInsertRowid, "Pala de rotor principal #1", "PN-MRB-145", "2024-02-01", 2200, 640]);
  await run(db, `INSERT INTO components (aircraft_id, name, part_number, installed_date, cycles_limit, cycles_accumulated) VALUES (?, ?, ?, ?, ?, ?)`,
    [h145.lastInsertRowid, "Tren de aterrizaje", "PN-LG-145", "2024-02-01", 5000, 3980]);

  return {
    aircraft: { h125: h125.lastInsertRowid, h145: h145.lastInsertRowid },
  };
}

module.exports = { seed };
