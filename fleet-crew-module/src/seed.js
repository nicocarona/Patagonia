const { run } = require("./db");

async function seed(db) {
  const ana = await run(db, `INSERT INTO crew_members (employee_code, name, role, email) VALUES (?, ?, ?, ?)`, ["EMP-0001", "Ana Reyes", "pilot", "ana.reyes@operador.com"]);
  const luis = await run(db, `INSERT INTO crew_members (employee_code, name, role, email) VALUES (?, ?, ?, ?)`, ["EMP-0002", "Luis Camacho", "pilot", "luis.camacho@operador.com"]);
  const carla = await run(db, `INSERT INTO crew_members (employee_code, name, role, email) VALUES (?, ?, ?, ?)`, ["EMP-0003", "Carla Núñez", "paramedic", "carla.nunez@operador.com"]);

  await run(db, `INSERT INTO crew_qualifications (crew_id, aircraft_model, qualification_type, valid_until) VALUES (?, 'Airbus H125', 'type_rating', ?)`, [ana.lastInsertRowid, "2027-01-01"]);
  await run(db, `INSERT INTO crew_qualifications (crew_id, aircraft_model, qualification_type, valid_until) VALUES (?, 'Airbus H145', 'type_rating', ?)`, [luis.lastInsertRowid, "2027-06-01"]);

  // Luis ya trabajó 30h esta semana (lunes a jueves), acercándose al límite
  // semanal de 36h — útil para ver el score de fatiga en amarillo/rojo.
  const luisWeek = [
    ["2026-07-13", "07:00", "15:00"], // lunes, 8h
    ["2026-07-14", "07:00", "15:00"], // martes, 8h
    ["2026-07-15", "07:00", "15:00"], // miércoles, 8h
    ["2026-07-16", "08:00", "14:00"], // jueves, 6h  -> total 30h
  ];
  for (const [date, start, end] of luisWeek) {
    await run(db, `INSERT INTO duty_periods (crew_id, duty_date, start_time, end_time, duty_type) VALUES (?, ?, ?, ?, 'flight')`, [luis.lastInsertRowid, date, start, end]);
  }

  // Ana está de vacaciones la semana del 20 al 24 de julio.
  await run(db, `INSERT INTO leave_requests (crew_id, start_date, end_date, leave_type, status) VALUES (?, '2026-07-20', '2026-07-24', 'vacation', 'approved')`, [ana.lastInsertRowid]);

  // Ana tuvo un turno el 17 de julio que termina tarde, para probar la
  // regla de descanso mínimo al día siguiente.
  await run(db, `INSERT INTO duty_periods (crew_id, duty_date, start_time, end_time, duty_type) VALUES (?, '2026-07-17', '14:00', '23:00', 'flight')`, [ana.lastInsertRowid]);

  return {
    crew: { ana: ana.lastInsertRowid, luis: luis.lastInsertRowid, carla: carla.lastInsertRowid },
  };
}

module.exports = { seed };
