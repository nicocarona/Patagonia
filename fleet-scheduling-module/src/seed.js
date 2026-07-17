const { run } = require("./db");

async function seed(db) {
  const h125 = await run(db, `INSERT INTO aircraft (tail_number, model, base) VALUES (?, ?, ?)`, ["XA-HEL1", "Airbus H125", "Base Norte"]);
  const h145 = await run(db, `INSERT INTO aircraft (tail_number, model, base) VALUES (?, ?, ?)`, ["XA-HEL2", "Airbus H145", "Base Sur"]);

  const ana = await run(db, `INSERT INTO crew_members (employee_code, name, role, email) VALUES (?, ?, ?, ?)`, ["EMP-0001", "Ana Reyes", "pilot", "ana.reyes@operador.com"]);
  const luis = await run(db, `INSERT INTO crew_members (employee_code, name, role, email) VALUES (?, ?, ?, ?)`, ["EMP-0002", "Luis Camacho", "pilot", "luis.camacho@operador.com"]);

  await run(db, `INSERT INTO crew_qualifications (crew_id, aircraft_model, qualification_type, valid_until) VALUES (?, ?, 'type_rating', ?)`,
    [ana.lastInsertRowid, "Airbus H125", "2027-01-01"]);
  await run(db, `INSERT INTO crew_qualifications (crew_id, aircraft_model, qualification_type, valid_until) VALUES (?, ?, 'type_rating', ?)`,
    [ana.lastInsertRowid, "Airbus H145", "2026-05-01"]); // vencida respecto a las fechas de la demo (julio 2026)

  await run(db, `INSERT INTO crew_qualifications (crew_id, aircraft_model, qualification_type, valid_until) VALUES (?, ?, 'type_rating', ?)`,
    [luis.lastInsertRowid, "Airbus H125", "2027-06-01"]);
  await run(db, `INSERT INTO crew_qualifications (crew_id, aircraft_model, qualification_type, valid_until) VALUES (?, ?, 'type_rating', ?)`,
    [luis.lastInsertRowid, "Airbus H145", "2027-06-01"]);

  const minera = await run(db, `INSERT INTO customers (name) VALUES (?)`, ["Minera del Norte S.A."]);
  const hospital = await run(db, `INSERT INTO customers (name) VALUES (?)`, ["Red Hospitalaria Aeromédica"]);

  return {
    aircraft: { h125: h125.lastInsertRowid, h145: h145.lastInsertRowid },
    crew: { ana: ana.lastInsertRowid, luis: luis.lastInsertRowid },
    customers: { minera: minera.lastInsertRowid, hospital: hospital.lastInsertRowid },
  };
}

module.exports = { seed };
