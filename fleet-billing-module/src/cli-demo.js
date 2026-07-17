// ============================================================================
// Demo de línea de comandos: siembra datos de ejemplo, genera una factura
// para cada cliente y la imprime formateada en consola.
//
// Uso:  node src/cli-demo.js                (SQLite local)
//       DATABASE_URL=postgres://... node src/cli-demo.js   (PostgreSQL)
// ============================================================================

const { openDatabase } = require("./db");
const { seed } = require("./seed");
const { generateInvoice } = require("./billingEngine");

function money(cents) {
  return (cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function printInvoice(invoice) {
  console.log("=".repeat(78));
  console.log(`FACTURA ${invoice.invoice_number}  —  ${invoice.customer.name}`);
  console.log(`Período: ${invoice.period_start} a ${invoice.period_end}   Emitida: ${invoice.issued_date}`);
  console.log("-".repeat(78));
  for (const item of invoice.line_items) {
    const qty = item.quantity != null ? `${item.quantity} x ` : "";
    const rate = item.unit_rate_cents != null ? `$${money(item.unit_rate_cents)}` : "";
    const label = `${item.description}`.padEnd(52);
    const qtyRate = `${qty}${rate}`.padEnd(14);
    const amount = `$${money(item.amount_cents)}`.padStart(12);
    console.log(`${label}${qtyRate}${amount}`);
  }
  console.log("-".repeat(78));
  console.log(`${"Subtotal".padEnd(66)}$${money(invoice.subtotal_cents).padStart(11)}`);
  console.log(`${"Impuestos".padEnd(66)}$${money(invoice.tax_cents).padStart(11)}`);
  console.log(`${"TOTAL".padEnd(66)}$${money(invoice.total_cents).padStart(11)}`);
  console.log("=".repeat(78));
  console.log();
}

async function main() {
  const db = await openDatabase(); // :memory: si es SQLite — usar un archivo, ej. "./flota.db", para persistir
  const ids = await seed(db);

  const invoiceCharter = await generateInvoice(db, {
    customerId: ids.customers.minera,
    contractId: ids.contracts.charter,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    invoiceNumber: "INV-2026-0001",
    issuedDate: "2026-08-01",
  });
  printInvoice(invoiceCharter);

  const invoiceRetainer = await generateInvoice(db, {
    customerId: ids.customers.hospital,
    contractId: ids.contracts.retainer,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    invoiceNumber: "INV-2026-0002",
    issuedDate: "2026-08-01",
  });
  printInvoice(invoiceRetainer);

  console.log("Demo completada. Ambas facturas fueron generadas y persistidas.");
  console.log(`Motor de base de datos: ${db.engine}`);
}

main().catch((err) => {
  console.error("Error en la demo:", err.message);
  process.exit(1);
});
