// Datos de ejemplo: 3 tanques (mismas bases que fleet-core-module: Base
// Norte, Base Sur, Base Costa), 2 proveedores, entregas que cargan los
// tanques, y uplifts a las aeronaves de fleet-core-module (XA-HEL1..4).
// Base Costa se deja deliberadamente con poco combustible para demostrar
// el bloqueo de un uplift que excede lo disponible.

const { get } = require("./db");
const { createSupplier, ensureTank, recordDelivery, recordUplift } = require("./fuelEngine");

async function seed(db) {
  const row = await get(db, "SELECT COUNT(*) as n FROM fuel_tanks", []);
  if (row && row.n > 0) {
    console.log("Ya hay datos en fleet-fuel-module, se omite el seed.");
    return;
  }

  const proveedorNorte = await createSupplier(db, {
    name: "Combustibles del Norte S.A.",
    contactEmail: "ventas@combnorte.example",
    base: "Base Norte",
    contractNumber: "CTR-2025-014",
    pricePerLiterCents: 95,
    contractStartDate: "2025-01-01",
    contractEndDate: "2027-01-01",
  });
  const proveedorCosta = await createSupplier(db, {
    name: "Jet Fuel Costa S.A.",
    contactEmail: "logistica@jetfuelcosta.example",
    base: "Base Costa",
    contractNumber: "CTR-2024-088",
    pricePerLiterCents: 102,
    contractStartDate: "2024-06-01",
    contractEndDate: "2026-06-01", // vence pronto — dato de ejemplo, revisar renovación
  });
  const proveedorSur = await createSupplier(db, {
    name: "Distribuidora Sur de Combustibles",
    contactEmail: "contratos@dsc.example",
    base: "Base Sur",
    contractNumber: "CTR-2025-031",
    pricePerLiterCents: 98,
    contractStartDate: "2025-03-01",
    contractEndDate: "2027-03-01",
  });

  await ensureTank(db, { base: "Base Norte", capacityLiters: 20000 });
  await ensureTank(db, { base: "Base Sur", capacityLiters: 15000 });
  await ensureTank(db, { base: "Base Costa", capacityLiters: 18000 });

  await recordDelivery(db, { base: "Base Norte", supplierId: proveedorNorte.id, liters: 12000, pricePerLiterCents: 95, deliveryDate: "2026-07-01" });
  await recordDelivery(db, { base: "Base Sur", supplierId: proveedorSur.id, liters: 9000, pricePerLiterCents: 98, deliveryDate: "2026-07-03" });
  // Base Costa recibe poco a propósito, para demostrar el bloqueo de un uplift grande más abajo.
  await recordDelivery(db, { base: "Base Costa", supplierId: proveedorCosta.id, liters: 800, pricePerLiterCents: 102, deliveryDate: "2026-07-10" });

  await recordUplift(db, { tailNumber: "XA-HEL1", base: "Base Norte", liters: 400, upliftDate: "2026-07-15", notes: "Vuelo minero de rutina" });
  await recordUplift(db, { tailNumber: "XA-HEL2", base: "Base Sur", liters: 500, upliftDate: "2026-07-16", notes: "Traslado HEMS" });

  console.log("fleet-fuel-module: 3 tanques, 3 proveedores, 3 entregas y 2 uplifts cargados (Base Costa con poco stock a propósito).");
}

module.exports = { seed };
