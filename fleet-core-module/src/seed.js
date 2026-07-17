// ============================================================================
// Datos de ejemplo del maestro central. La flota y los segmentos de cliente
// están inspirados en la estructura típica de un operador offshore/HEMS de
// gran escala (ver README para las fuentes: Bristow Group, Babcock MCS) —
// NO son datos reales de ninguna empresa, son ilustrativos.
// ============================================================================

const { run } = require("./db");

async function seed(db) {
  const minera = await run(db, `INSERT INTO customers (name, contact_email, segment) VALUES (?, ?, ?)`, ["Minera del Norte S.A.", "ops@mineradelnorte.example", "mining"]);
  const hospital = await run(db, `INSERT INTO customers (name, contact_email, segment) VALUES (?, ?, ?)`, ["Red Hospitalaria Aeromédica", "dispatch@redaeromedica.example", "hems"]);
  const offshore = await run(db, `INSERT INTO customers (name, contact_email, segment) VALUES (?, ?, ?)`, ["Energía Costa Afuera S.A.", "logistica@ecaoffshore.example", "offshore"]);
  const gobierno = await run(db, `INSERT INTO customers (name, contact_email, segment) VALUES (?, ?, ?)`, ["Servicio Nacional de Búsqueda y Rescate", "sar@gobierno.example", "sar"]);

  const aircraftRows = [
    { tail: "XA-HEL1", model: "Airbus H125", serial: "SN-8801", base: "Base Norte", customer: minera.lastInsertRowid, rate: 185000 },
    { tail: "XA-HEL2", model: "Airbus H145", serial: "SN-8802", base: "Base Sur", customer: hospital.lastInsertRowid, rate: 240000 },
    { tail: "XA-HEL3", model: "Airbus H175", serial: "SN-8803", base: "Base Costa", customer: offshore.lastInsertRowid, rate: 320000 },
    { tail: "XA-HEL4", model: "Leonardo AW139", serial: "SN-8804", base: "Base Costa", customer: gobierno.lastInsertRowid, rate: 310000 },
  ];
  const aircraftIds = {};
  for (const a of aircraftRows) {
    const res = await run(
      db,
      `INSERT INTO aircraft (tail_number, model, serial_number, base, customer_id, status, default_hourly_rate_cents) VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [a.tail, a.model, a.serial, a.base, a.customer, a.rate]
    );
    aircraftIds[a.tail] = res.lastInsertRowid;
  }

  const crewRows = [
    { code: "EMP-0001", name: "Ana Reyes", role: "pilot", base: "Base Norte", email: "ana.reyes@operador.com", hire: "2019-03-01" },
    { code: "EMP-0002", name: "Luis Camacho", role: "pilot", base: "Base Sur", email: "luis.camacho@operador.com", hire: "2017-08-15" },
    { code: "EMP-0003", name: "Carla Núñez", role: "paramedic", base: "Base Sur", email: "carla.nunez@operador.com", hire: "2021-01-10" },
    { code: "EMP-0004", name: "Jorge Villalobos", role: "mechanic", base: "Base Costa", email: "jorge.villalobos@operador.com", hire: "2015-05-20" },
    { code: "EMP-0005", name: "Marta Solís", role: "dispatcher", base: "Base Costa", email: "marta.solis@operador.com", hire: "2022-11-02" },
  ];
  const crewIds = {};
  for (const c of crewRows) {
    const res = await run(
      db,
      `INSERT INTO crew_members (employee_code, name, role, base, email, hire_date, status) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [c.code, c.name, c.role, c.base, c.email, c.hire]
    );
    crewIds[c.code] = res.lastInsertRowid;
  }

  return {
    customers: { minera: minera.lastInsertRowid, hospital: hospital.lastInsertRowid, offshore: offshore.lastInsertRowid, gobierno: gobierno.lastInsertRowid },
    aircraft: aircraftIds,
    crew: crewIds,
  };
}

module.exports = { seed };
