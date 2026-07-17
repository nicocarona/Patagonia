// ============================================================================
// API HTTP del módulo de Inventario y Repuestos (node:http, sin dependencias)
//
// Endpoints:
//   GET    /health
//   GET    /parts
//   POST   /parts
//   GET    /parts/by-number/:partNumber   -> usado por fleet-integration (flujo 4)
//   GET    /warehouses
//   POST   /warehouses
//   POST   /stock/receive
//   POST   /stock/issue
//   GET    /reorder-alerts
//   GET    /dashboard
//   POST   /purchase-orders
//   POST   /purchase-orders/:id/receive
//   POST   /purchase-orders/:id/cancel
//   GET    /purchase-orders?status=
//
// Uso local (SQLite):          node src/server.js
// Uso con SEED:                 SEED=1 node src/server.js
// Uso en producción (Postgres): DATABASE_URL=postgres://... node src/server.js
// ============================================================================

const http = require("node:http");
const { URL } = require("node:url");
const { openDatabase, all, get } = require("./db");
const {
  createPart, createWarehouse, receiveStock, issueStock, getReorderAlerts,
  createPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder, getInventoryDashboard,
  findPartByNumber, hasOpenAutoPurchaseOrder,
} = require("./inventoryEngine");
const { requireAuth } = require("./auth");

const PORT = process.env.PORT || 3008;

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
    const existing = await get(db, "SELECT COUNT(*) as n FROM parts");
    if (Number(existing?.n ?? 0) > 0) {
      console.log("SEED=1 definido, pero ya hay datos cargados — se omite la siembra para no duplicar.");
    } else {
      const { seed } = require("./seed");
      await seed(db);
      console.log("Base de datos sembrada con datos de ejemplo (SEED=1).");
    }
  }

  const routes = [
    { method: "GET", pattern: /^\/health$/, auth: false, handler: async () => ({ status: 200, body: { ok: true, service: "fleet-inventory-module" } }) },
    { method: "GET", pattern: /^\/parts$/, handler: async () => ({ status: 200, body: await all(db, "SELECT * FROM parts ORDER BY part_number") }) },
    {
      method: "POST",
      pattern: /^\/parts$/,
      roles: ["admin", "maintenance"],
      handler: async (req) => {
        const b = await readBody(req);
        try {
          return { status: 201, body: await createPart(db, b) };
        } catch (err) {
          return { status: 400, body: { error: err.message } };
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/parts\/by-number\/([^/]+)$/,
      handler: async (req, url, m) => {
        const part = await findPartByNumber(db, decodeURIComponent(m[1]));
        if (!part) return { status: 404, body: { error: "Parte no encontrada" } };
        return { status: 200, body: part };
      },
    },
    { method: "GET", pattern: /^\/warehouses$/, handler: async () => ({ status: 200, body: await all(db, "SELECT * FROM warehouses ORDER BY name") }) },
    {
      method: "POST",
      pattern: /^\/warehouses$/,
      roles: ["admin", "maintenance"],
      handler: async (req) => {
        const b = await readBody(req);
        try {
          return { status: 201, body: await createWarehouse(db, b) };
        } catch (err) {
          return { status: 400, body: { error: err.message } };
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/stock\/receive$/,
      roles: ["admin", "maintenance"],
      handler: async (req) => {
        const b = await readBody(req);
        try {
          return { status: 200, body: await receiveStock(db, b) };
        } catch (err) {
          return { status: 400, body: { error: err.message } };
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/stock\/issue$/,
      roles: ["admin", "maintenance"],
      handler: async (req) => {
        const b = await readBody(req);
        try {
          return { status: 200, body: await issueStock(db, b) };
        } catch (err) {
          return { status: 400, body: { error: err.message } };
        }
      },
    },
    { method: "GET", pattern: /^\/reorder-alerts$/, handler: async () => ({ status: 200, body: await getReorderAlerts(db) }) },
    { method: "GET", pattern: /^\/dashboard$/, handler: async () => ({ status: 200, body: await getInventoryDashboard(db) }) },
    {
      method: "POST",
      pattern: /^\/purchase-orders$/,
      // admin/maintenance para altas manuales; integration para las
      // órdenes de compra que fleet-integration genera automáticamente.
      roles: ["admin", "maintenance", "integration"],
      handler: async (req) => {
        const b = await readBody(req);
        try {
          return { status: 201, body: await createPurchaseOrder(db, b) };
        } catch (err) {
          return { status: 400, body: { error: err.message } };
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/purchase-orders\/(\d+)\/receive$/,
      roles: ["admin", "maintenance"],
      handler: async (req, url, m) => {
        const b = await readBody(req);
        try {
          return { status: 200, body: await receivePurchaseOrder(db, Number(m[1]), b) };
        } catch (err) {
          return { status: 400, body: { error: err.message } };
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/purchase-orders\/(\d+)\/cancel$/,
      roles: ["admin", "maintenance"],
      handler: async (req, url, m) => {
        try {
          return { status: 200, body: await cancelPurchaseOrder(db, Number(m[1])) };
        } catch (err) {
          return { status: 400, body: { error: err.message } };
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/purchase-orders$/,
      handler: async (req, url) => {
        const status = url.searchParams.get("status");
        if (status) return { status: 200, body: await all(db, "SELECT * FROM purchase_orders WHERE status = ? ORDER BY requested_date DESC", [status]) };
        return { status: 200, body: await all(db, "SELECT * FROM purchase_orders ORDER BY requested_date DESC") };
      },
    },
    {
      // Usado por fleet-integration para no duplicar alertas: consulta si
      // ya hay una OC automática abierta para esta parte.
      method: "GET",
      pattern: /^\/purchase-orders\/has-open-auto\/(\d+)$/,
      handler: async (req, url, m) => ({ status: 200, body: { hasOpen: await hasOpenAutoPurchaseOrder(db, Number(m[1])) } }),
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
    console.log(`Módulo de Inventario escuchando en http://localhost:${PORT}`);
    console.log(`Motor de base de datos: ${db.engine}`);
  });
}

main().catch((err) => {
  console.error("No se pudo iniciar el servidor:", err.message);
  process.exit(1);
});
