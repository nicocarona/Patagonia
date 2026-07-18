// ============================================================================
// API HTTP del módulo de facturación
//
// Construida sobre el módulo nativo `node:http` (sin Express ni otras
// dependencias externas). Funciona igual con SQLite o PostgreSQL — el motor
// se elige solo, según si DATABASE_URL está definido (ver db.js).
//
// Endpoints:
//   GET    /aircraft
//   GET    /customers
//   GET    /contracts?customerId=
//   GET    /flights?customerId=&invoiced=0
//   POST   /flights
//   POST   /flights/from-booking      -> integración con Programación (idempotente)
//   POST   /invoices/generate
//   GET    /invoices?customerId=
//   GET    /invoices/:id
//
// Uso local (SQLite):        node src/server.js
// Uso con SEED:               SEED=1 node src/server.js
// Uso en producción (Postgres): DATABASE_URL=postgres://... node src/server.js
// ============================================================================

const http = require("node:http");
const { URL } = require("node:url");
const { openDatabase, all, get, run } = require("./db");
const { generateInvoice, getInvoiceWithLineItems, createFlightFromBooking, upsertAircraft } = require("./billingEngine");
const { requireAuth } = require("./auth");

const PORT = process.env.PORT || 3000;

function sendJSON(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function nextInvoiceNumber(db) {
  const row = await get(db, "SELECT COUNT(*) as n FROM invoices");
  const seq = String((Number(row?.n) ?? 0) + 1).padStart(4, "0");
  const year = new Date().getFullYear();
  return `INV-${year}-${seq}`;
}

async function main() {
  const db = await openDatabase(process.env.DB_FILE || ":memory:");

  if (process.env.SEED === "1") {
    // Guarda de seguridad: si ya hay clientes cargados (típico en una base
    // Postgres persistente que sobrevive reinicios del servidor), NO
    // vuelve a sembrar — evita duplicar datos de ejemplo cada vez que el
    // servicio se reinicia en producción. En SQLite en memoria esto nunca
    // aplica porque cada arranque empieza con una base vacía.
    const existing = await get(db, "SELECT COUNT(*) as n FROM customers");
    if (Number(existing?.n ?? 0) > 0) {
      console.log("SEED=1 definido, pero ya hay datos cargados — se omite la siembra para no duplicar.");
    } else {
      const { seed } = require("./seed");
      await seed(db);
      console.log("Base de datos sembrada con datos de ejemplo (SEED=1).");
    }
  }

  const routes = [
    { method: "GET", pattern: /^\/health$/, auth: false, handler: async () => ({ status: 200, body: { ok: true, service: "fleet-billing-module" } }) },
    { method: "GET", pattern: /^\/aircraft$/, handler: async () => ({ status: 200, body: await all(db, "SELECT * FROM aircraft") }) },
    {
      // Usado por fleet-integration para sembrar/actualizar el maestro de
      // aeronaves (fleet-core-module) dentro de este módulo.
      method: "POST",
      pattern: /^\/aircraft$/,
      roles: ["admin", "integration"],
      handler: async (req) => {
        const b = await readBody(req);
        if (!b.tailNumber || !b.model) return { status: 400, body: { error: "Se requiere tailNumber y model" } };
        return { status: 200, body: await upsertAircraft(db, b) };
      },
    },
    { method: "GET", pattern: /^\/customers$/, handler: async () => ({ status: 200, body: await all(db, "SELECT * FROM customers") }) },
    {
      method: "GET",
      pattern: /^\/contracts$/,
      handler: async (req, url) => {
        const customerId = url.searchParams.get("customerId");
        const sql = customerId ? "SELECT * FROM contracts WHERE customer_id = ?" : "SELECT * FROM contracts";
        const params = customerId ? [customerId] : [];
        return { status: 200, body: await all(db, sql, params) };
      },
    },
    {
      method: "GET",
      pattern: /^\/flights$/,
      handler: async (req, url) => {
        const conditions = [];
        const params = [];
        if (url.searchParams.get("customerId")) { conditions.push("customer_id = ?"); params.push(url.searchParams.get("customerId")); }
        if (url.searchParams.get("invoiced") !== null) { conditions.push("invoiced = ?"); params.push(Number(url.searchParams.get("invoiced"))); }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        return { status: 200, body: await all(db, `SELECT * FROM flights ${where} ORDER BY flight_date`, params) };
      },
    },
    {
      method: "POST",
      pattern: /^\/flights$/,
      roles: ["admin", "finance"],
      handler: async (req) => {
        const b = await readBody(req);
        const required = ["aircraft_id", "customer_id", "contract_id", "flight_date"];
        for (const field of required) {
          if (b[field] === undefined) return { status: 400, body: { error: `Falta el campo requerido: ${field}` } };
        }
        const result = await run(
          db,
          `INSERT INTO flights (aircraft_id, customer_id, contract_id, flight_date, mission_type, flight_hours, positioning_hours, standby_hours, landing_count, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [b.aircraft_id, b.customer_id, b.contract_id, b.flight_date, b.mission_type ?? null, b.flight_hours ?? 0, b.positioning_hours ?? 0, b.standby_hours ?? 0, b.landing_count ?? 0, b.notes ?? null]
        );
        const flight = await get(db, "SELECT * FROM flights WHERE id = ?", [result.lastInsertRowid]);
        return { status: 201, body: flight };
      },
    },
    {
      method: "POST",
      pattern: /^\/flights\/from-booking$/,
      roles: ["admin", "integration", "finance"],
      handler: async (req) => {
        const b = await readBody(req);
        const required = ["sourceBookingId", "aircraftId", "customerId", "contractId", "flightDate", "flightHours"];
        for (const f of required) if (b[f] === undefined) return { status: 400, body: { error: `Falta el campo requerido: ${f}` } };
        const { flight, created } = await createFlightFromBooking(db, b);
        return { status: created ? 201 : 200, body: { ...flight, alreadyExisted: !created } };
      },
    },
    {
      method: "POST",
      pattern: /^\/invoices\/generate$/,
      roles: ["admin", "finance"],
      handler: async (req) => {
        const b = await readBody(req);
        const required = ["customerId", "contractId", "periodStart", "periodEnd"];
        for (const field of required) {
          if (b[field] === undefined) return { status: 400, body: { error: `Falta el campo requerido: ${field}` } };
        }
        try {
          const invoice = await generateInvoice(db, {
            customerId: b.customerId,
            contractId: b.contractId,
            periodStart: b.periodStart,
            periodEnd: b.periodEnd,
            invoiceNumber: b.invoiceNumber ?? (await nextInvoiceNumber(db)),
            issuedDate: b.issuedDate ?? new Date().toISOString().slice(0, 10),
          });
          return { status: 201, body: invoice };
        } catch (err) {
          return { status: 400, body: { error: err.message } };
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/invoices$/,
      handler: async (req, url) => {
        const customerId = url.searchParams.get("customerId");
        const sql = customerId ? "SELECT * FROM invoices WHERE customer_id = ?" : "SELECT * FROM invoices";
        const params = customerId ? [customerId] : [];
        return { status: 200, body: await all(db, sql, params) };
      },
    },
    {
      method: "GET",
      pattern: /^\/invoices\/(\d+)$/,
      handler: async (req, url, match) => {
        const invoice = await getInvoiceWithLineItems(db, Number(match[1]));
        if (!invoice) return { status: 404, body: { error: "Factura no encontrada" } };
        return { status: 200, body: invoice };
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
    console.log(`Módulo de facturación escuchando en http://localhost:${PORT}`);
    console.log(`Motor de base de datos: ${db.engine}${db.engine === "sqlite" ? " (en memoria — los datos se pierden al reiniciar, salvo que uses DB_FILE)" : ""}`);
  });
}

main().catch((err) => {
  console.error("No se pudo iniciar el servidor:", err.message);
  process.exit(1);
});
