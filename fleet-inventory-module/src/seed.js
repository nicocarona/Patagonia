// ============================================================================
// Datos de ejemplo. Los part_number coinciden deliberadamente con los del
// seed de fleet-maintenance-module (PN-MRB-100, PN-MGB-200, PN-TDS-300,
// etc.) para poder demostrar el flujo 4 de integración: el eje de
// transmisión de cola (PN-TDS-300) está VENCIDO en Mantenimiento y aquí
// tiene CERO stock a propósito — es justo el escenario que debe disparar
// una orden de compra automática.
// ============================================================================

const { createPart, createWarehouse, receiveStock } = require("./inventoryEngine");

async function seed(db) {
  const central = await createWarehouse(db, { name: "Almacén Central", location: "Base Norte" });
  const costa = await createWarehouse(db, { name: "Almacén Base Costa", location: "Base Costa" });

  const rotorBlade = await createPart(db, {
    partNumber: "PN-MRB-100", description: "Pala de rotor principal", category: "rotor",
    unitCostCents: 4_500_000, minStockQty: 1, leadTimeDays: 45, preferredSupplier: "Airbus Helicopters Support",
  });
  const gearbox = await createPart(db, {
    partNumber: "PN-MGB-200", description: "Caja de transmisión principal", category: "transmision",
    unitCostCents: 18_000_000, minStockQty: 1, leadTimeDays: 90, preferredSupplier: "Airbus Helicopters Support",
  });
  const tailShaft = await createPart(db, {
    partNumber: "PN-TDS-300", description: "Eje de transmisión de cola", category: "transmision",
    unitCostCents: 2_100_000, minStockQty: 1, leadTimeDays: 60, preferredSupplier: "Airbus Helicopters Support",
  });
  const floatKit = await createPart(db, {
    partNumber: "PN-EFK-050", description: "Kit de flotación de emergencia", category: "otro",
    unitCostCents: 950_000, minStockQty: 1, leadTimeDays: 30, preferredSupplier: "Survival Systems Inc.",
  });
  const consumable = await createPart(db, {
    partNumber: "PN-FLT-010", description: "Filtro de aceite de motor", category: "consumible",
    unitCostCents: 25_000, minStockQty: 4, leadTimeDays: 10, preferredSupplier: "Distribuidora Aeronáutica Regional",
  });

  // Stock sano para la pala de rotor y el filtro consumible.
  await receiveStock(db, { partId: rotorBlade.id, warehouseId: central.id, quantity: 2, reference: "Stock inicial" });
  await receiveStock(db, { partId: consumable.id, warehouseId: central.id, quantity: 10, reference: "Stock inicial" });
  await receiveStock(db, { partId: consumable.id, warehouseId: costa.id, quantity: 6, reference: "Stock inicial" });

  // A propósito SIN stock: la caja de transmisión (due_soon en Mantenimiento)
  // y el eje de cola (overdue en Mantenimiento) — dispara el flujo 4.
  // (No se llama receiveStock para gearbox ni tailShaft: quedan en 0.)

  // Kit de flotación: 1 unidad, justo en el punto de reorden (no dispara
  // alerta por sí solo, pero está cerca).
  await receiveStock(db, { partId: floatKit.id, warehouseId: costa.id, quantity: 1, reference: "Stock inicial" });

  return {
    warehouses: { central: central.id, costa: costa.id },
    parts: { rotorBlade: rotorBlade.id, gearbox: gearbox.id, tailShaft: tailShaft.id, floatKit: floatKit.id, consumable: consumable.id },
  };
}

module.exports = { seed };
