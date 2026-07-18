// ============================================================================
// API HTTP del módulo de Tripulación y Fatiga (node:http, sin dependencias)
//
// Endpoints:
//   GET    /crew
//   GET    /crew/:id/qualifications
//   POST   /crew/:id/qualifications
//   GET    /crew/:id/fatigue-score?date=
//   GET    /duty-periods?crewId=&date=
//   POST   /duty-periods
//   POST   /duty-periods/validate
//   GET    /leave-requests?crewId=
//   POST   /leave-requests
//
// Uso local (SQLite):        node src/server.js
// Uso con SEED:               SEED=1 node src/server.js
// Uso en producción (Postgres): DATABASE_URL=postgres://... node src/server.js
// ============================================================================

const http = require("node:http");
const { URL } = require("node:url");
const { openDatabase, all, get, run } = require("./db");
const { createDutyPeriod, validateDutyPeriod, computeFatigueScore, upsertCrewMember } = require("./fatigueEngine");
const { requireAuth } = require("./auth");

const PORT = process.env.PORT || 3003;

function sendJSON(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

async function main() {
  const db = await openDatabase(process.env.DB_FILE || ":memory:");

  if (process.env.SEED === "1") {
    const existing = await get(db, "SELECT COUNT(*) as n FROM crew_members");
    if (Number(existing?.n ?? 0) > 0) {
      console.log("SEED=1 definido, pero ya hay datos cargados — se omite la siembra para no duplicar.");
    } else {
      const { seed } = require("./seed");
      await seed(db);
      console.log("Base de datos sembrada con datos de ejemplo (SEED=1).");
    }
  }

  const routes = [
    { method: "GET", pattern: /^\/health$/, auth: false, handler: async () => ({ status: 200, body: { ok: true, service: "fleet-crew-module" } }) },
    { method: "GET", pattern: /^\/crew$/, handler: async () => ({ status: 200, body: await all(db, "SELECT * FROM crew_members") }) },
    {
      // Usado por fleet-integration para sembrar/actualizar el maestro de
      // tripulantes (fleet-core-module) dentro de este módulo.
      method: "POST",
      pattern: /^\/crew$/,
      roles: ["admin", "integration"],
      handler: async (req) => {
        const b = await readBody(req);
        if (!b.employeeCode || !b.name || !b.role) return { status: 400, body: { error: "Se requiere employeeCode, name y role" } };
        return { status: 200, body: await upsertCrewMember(db, b) };
      },
    },
    {
      method: "GET",
      pattern: /^\/crew\/(\d+)\/qualifications$/,
      handler: async (req, url, m) => ({ status: 200, body: await all(db, "SELECT * FROM crew_qualifications WHERE crew_id = ?", [m[1]]) }),
    },
    {
      method: "POST",
      pattern: /^\/crew\/(\d+)\/qualifications$/,
      roles: ["admin", "crew"],
      handler: async (req, url, m) => {
        const b = await readBody(req);
        if (!b.aircraft_model || !b.valid_until) return { status: 400, body: { error: "Se requiere aircraft_model y valid_until" } };
        const result = await run(
          db,
          `INSERT INTO crew_qualifications (crew_id, aircraft_model, qualification_type, valid_until) VALUES (?, ?, ?, ?)`,
          [m[1], b.aircraft_model, b.qualification_type ?? "type_rating", b.valid_until]
        );
        return { status: 201, body: await get(db, "SELECT * FROM crew_qualifications WHERE id = ?", [result.lastInsertRowid]) };
      },
    },
    {
      method: "GET",
      pattern: /^\/crew\/(\d+)\/fatigue-score$/,
      handler: async (req, url, m) => {
        const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
        return { status: 200, body: await computeFatigueScore(db, Number(m[1]), date) };
      },
    },
    {
      method: "GET",
      pattern: /^\/duty-periods$/,
      handler: async (req, url) => {
        const conditions = [];
        const params = [];
        if (url.searchParams.get("crewId")) { conditions.push("crew_id = ?"); params.push(url.searchParams.get("crewId")); }
        if (url.searchParams.get("date")) { conditions.push("duty_date = ?"); params.push(url.searchParams.get("date")); }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        return { status: 200, body: await all(db, `SELECT * FROM duty_periods ${where} ORDER BY duty_date, start_time`, params) };
      },
    },
    {
      method: "POST",
      pattern: /^\/duty-periods\/validate$/,
      roles: ["admin", "crew", "ops"],
      handler: async (req) => {
        const b = await readBody(req);
        return { status: 200, body: await validateDutyPeriod(db, b) };
      },
    },
    {
      method: "POST",
      pattern: /^\/duty-periods$/,
      roles: ["admin", "crew", "ops"],
      handler: async (req) => {
        const b = await readBody(req);
        const required = ["crewId", "dutyDate", "startTime", "endTime"];
        for (const f of required) if (b[f] === undefined) return { status: 400, body: { error: `Falta el campo requerido: ${f}` } };
        try {
          return { status: 201, body: await createDutyPeriod(db, b) };
        } catch (err) {
          return { status: 400, body: { error: err.message } };
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/leave-requests$/,
      handler: async (req, url) => {
        const crewId = url.searchParams.get("crewId");
        const sql = crewId ? "SELECT * FROM leave_requests WHERE crew_id = ?" : "SELECT * FROM leave_requests";
        return { status: 200, body: await all(db, sql, crewId ? [crewId] : []) };
      },
    },
    {
      method: "POST",
      pattern: /^\/leave-requests$/,
      roles: ["admin", "crew"],
      handler: async (req) => {
        const b = await readBody(req);
        const required = ["crewId", "startDate", "endDate"];
        for (const f of required) if (b[f] === undefined) return { status: 400, body: { error: `Falta el campo requerido: ${f}` } };
        const result = await run(
          db,
          `INSERT INTO leave_requests (crew_id, start_date, end_date, leave_type, status) VALUES (?, ?, ?, ?, ?)`,
          [b.crewId, b.startDate, b.endDate, b.leaveType ?? "vacation", b.status ?? "approved"]
        );
        return { status: 201, body: await get(db, "SELECT * FROM leave_requests WHERE id = ?", [result.lastInsertRowid]) };
      },
    },
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    if (!route) return sendJSON(res, 404, { error: "Ruta no encontrada" });
    try {
      if (route.auth !== false) {
        try {
          req.auth = requireAuth(req, route.roles);
        } catch (err) {
          return sendJSON(res, err.statusCode || 401, { error: err.message });
        }
      }
      const match = url.pathname.match(route.pattern);
      const { status, body } = await route.handler(req, url, match);
      sendJSON(res, status, body);
    } catch (err) {
      sendJSON(res, 500, { error: err.message });
    }
  });

  server.listen(PORT, () => {
    console.log(`Módulo de Tripulación y Fatiga escuchando en http://localhost:${PORT}`);
    console.log(`Motor de base de datos: ${db.engine}`);
  });
}

main().catch((err) => {
  console.error("No se pudo iniciar el servidor:", err.message);
  process.exit(1);
});
