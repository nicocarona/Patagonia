// ============================================================================
// Demo de consola: siembra datos (incluye dos partes intencionalmente sin
// stock) y prueba escenarios de bloqueo por stock insuficiente, recepción
// de orden de compra, y el dashboard de reorden.
// Uso: node src/cli-demo.js
// ============================================================================

const { openDatabase } = require("./db");
const { seed } = require("./seed");
const { issueStock, createPurchaseOrder, receivePurchaseOrder, getReorderAlerts, getInventoryDashboard } = require("./inventoryEngine");

async function attempt(label, fn) {
  try {
    const result = await fn();
    console.log(`✔ ${label}`);
    if (result?.id) console.log(`  Registrado #${result.id}`);
  } catch (err) {
    console.log(`✘ ${label}`);
    console.log(`  ${err.message}`);
  }
  console.log();
}

function printDashboard(entries) {
  for (const e of entries) {
    const marker = e.belowReorderPoint ? "⚠ BAJO PUNTO DE REORDEN" : "✔ OK";
    console.log(`  ${marker.padEnd(26)} ${e.part.part_number.padEnd(14)} ${e.part.description.padEnd(32)} stock=${e.totalStock} (mínimo ${e.part.min_stock_qty})`);
    for (const po of e.openPurchaseOrders) {
      console.log(`      -> OC #${po.id} abierta: ${po.quantity} unidad(es), origen=${po.triggered_by}`);
    }
  }
  console.log();
}

async function main() {
  const db = await openDatabase();
  const ids = await seed(db);

  console.log("=".repeat(78));
  console.log("DEMO — Módulo de Inventario y Repuestos");
  console.log(`Motor de base de datos: ${db.engine}`);
  console.log("=".repeat(78));
  console.log();

  console.log("--- Dashboard inicial (nota: caja de transmisión y eje de cola en 0) ---\n");
  printDashboard(await getInventoryDashboard(db));

  await attempt("1) Sacar 1 unidad de la pala de rotor (hay 2 en stock -> debe ACEPTARSE)", () =>
    issueStock(db, { partId: ids.parts.rotorBlade, warehouseId: ids.warehouses.central, quantity: 1, reference: "Instalación en XA-HEL1" })
  );

  await attempt("2) Sacar 1 unidad del eje de cola (hay 0 en stock -> debe RECHAZARSE)", () =>
    issueStock(db, { partId: ids.parts.tailShaft, warehouseId: ids.warehouses.central, quantity: 1, reference: "Instalación en XA-HEL1" })
  );

  console.log("--- Alertas de reorden (stock total <= punto de reorden) ---\n");
  const alerts = await getReorderAlerts(db);
  for (const a of alerts) console.log(`  ⚠ ${a.part.part_number} — ${a.part.description}: stock total ${a.totalStock} (mínimo ${a.part.min_stock_qty})`);
  console.log();

  console.log("--- Generando orden de compra para el eje de cola ---\n");
  const po = await createPurchaseOrder(db, {
    partId: ids.parts.tailShaft, quantity: 1, triggeredBy: "manual",
    relatedNote: "Reposición tras detectar componente vencido en XA-HEL1 (fleet-maintenance-module).",
  });
  console.log(`Orden de compra #${po.id} creada (estado: ${po.status}).\n`);

  await attempt("3) Recibir la orden de compra (debe dar entrada al stock automáticamente)", () =>
    receivePurchaseOrder(db, po.id, { warehouseId: ids.warehouses.central })
  );

  await attempt("4) Reintentar sacar 1 unidad del eje de cola (ya llegó el repuesto -> debe ACEPTARSE)", () =>
    issueStock(db, { partId: ids.parts.tailShaft, warehouseId: ids.warehouses.central, quantity: 1, reference: "Instalación en XA-HEL1" })
  );

  console.log("--- Dashboard final ---\n");
  printDashboard(await getInventoryDashboard(db));
}

main().catch((err) => {
  console.error("Error en la demo:", err.message);
  process.exit(1);
});
