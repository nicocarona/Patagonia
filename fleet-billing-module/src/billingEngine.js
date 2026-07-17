// ============================================================================
// Motor de reglas de facturación
//
// Convierte un conjunto de vuelos (registrados por el módulo de operaciones)
// en una factura itemizada, aplicando las reglas de tarifas del contrato del
// cliente: tarifa de vuelo, posicionamiento, standby, tarifas de aterrizaje,
// mínimo diario, recargo de combustible y retainer mensual (HEMS).
//
// Las funciones que tocan base de datos son `async` (necesario para
// soportar PostgreSQL, que es asíncrono por naturaleza — ver db.js). Las
// funciones puramente de cálculo (computeFlightLineItems,
// applyRetainerLogic) siguen siendo síncronas porque no hacen I/O.
// ============================================================================

const { get, all, run } = require("./db");

function round(cents) {
  return Math.round(cents);
}

/**
 * Calcula los renglones de factura correspondientes a UN vuelo,
 * antes de aplicar la lógica de retainer (que opera sobre el conjunto
 * de vuelos del período). Función pura — sin I/O, no es async.
 */
function computeFlightLineItems(flight, contract, aircraft) {
  const items = [];
  const flightRate = contract.flight_rate_cents ?? aircraft.default_hourly_rate_cents;

  const flightAmount = round(flight.flight_hours * flightRate);
  items.push({
    line_type: "flight_time",
    description: `Tiempo de vuelo — ${aircraft.tail_number} (${flight.flight_date})`,
    quantity: flight.flight_hours,
    unit_rate_cents: flightRate,
    amount_cents: flightAmount,
  });

  let positioningAmount = 0;
  if (flight.positioning_hours > 0 && contract.positioning_rate_cents > 0) {
    positioningAmount = round(flight.positioning_hours * contract.positioning_rate_cents);
    items.push({
      line_type: "positioning",
      description: "Posicionamiento",
      quantity: flight.positioning_hours,
      unit_rate_cents: contract.positioning_rate_cents,
      amount_cents: positioningAmount,
    });
  }

  if (flight.standby_hours > 0 && contract.standby_rate_cents > 0) {
    items.push({
      line_type: "standby",
      description: "Espera en tierra (standby)",
      quantity: flight.standby_hours,
      unit_rate_cents: contract.standby_rate_cents,
      amount_cents: round(flight.standby_hours * contract.standby_rate_cents),
    });
  }

  if (flight.landing_count > 0 && contract.landing_fee_cents > 0) {
    items.push({
      line_type: "landing_fee",
      description: `Tarifas de aterrizaje (${flight.landing_count})`,
      quantity: flight.landing_count,
      unit_rate_cents: contract.landing_fee_cents,
      amount_cents: flight.landing_count * contract.landing_fee_cents,
    });
  }

  const billableHours = flight.flight_hours + flight.positioning_hours + flight.standby_hours;
  if (contract.daily_minimum_hours > billableHours) {
    const shortfallHours = round((contract.daily_minimum_hours - billableHours) * 100) / 100;
    items.push({
      line_type: "daily_minimum_adjustment",
      description: `Ajuste a mínimo diario contractual (${contract.daily_minimum_hours}h)`,
      quantity: shortfallHours,
      unit_rate_cents: flightRate,
      amount_cents: round(shortfallHours * flightRate),
    });
  }

  if (contract.fuel_surcharge_pct > 0) {
    const base = flightAmount + positioningAmount;
    items.push({
      line_type: "fuel_surcharge",
      description: `Recargo de combustible (${contract.fuel_surcharge_pct}%)`,
      quantity: null,
      unit_rate_cents: null,
      amount_cents: round((base * contract.fuel_surcharge_pct) / 100),
    });
  }

  return items;
}

/**
 * Aplica la lógica de retainer mensual (típica de contratos HEMS). Función
 * pura — sin I/O, no es async.
 */
function applyRetainerLogic(contract, totalFlightHours, flightTimeAmountCents) {
  const items = [];
  if (contract.contract_type !== "hems_retainer" || contract.monthly_retainer_cents <= 0) {
    return items;
  }

  items.push({
    line_type: "retainer",
    description: "Retainer mensual de disponibilidad (HEMS)",
    quantity: 1,
    unit_rate_cents: contract.monthly_retainer_cents,
    amount_cents: contract.monthly_retainer_cents,
  });

  const included = contract.retainer_included_hours;

  if (totalFlightHours <= included) {
    items.push({
      line_type: "retainer_credit",
      description: `Crédito — horas de vuelo cubiertas por retainer (hasta ${included}h)`,
      quantity: totalFlightHours,
      unit_rate_cents: null,
      amount_cents: -flightTimeAmountCents,
    });
  } else {
    const includedFraction = included / totalFlightHours;
    const creditAmount = round(flightTimeAmountCents * includedFraction);
    const overageHours = round((totalFlightHours - included) * 100) / 100;
    const overageRate = contract.overage_rate_cents ?? contract.flight_rate_cents;

    items.push({
      line_type: "retainer_credit",
      description: `Crédito — ${included}h incluidas en retainer`,
      quantity: included,
      unit_rate_cents: null,
      amount_cents: -creditAmount,
    });
    items.push({
      line_type: "overage",
      description: `Horas excedentes sobre retainer (${overageHours}h)`,
      quantity: overageHours,
      unit_rate_cents: overageRate,
      amount_cents: round(overageHours * overageRate),
    });
  }

  return items;
}

/**
 * Genera una factura para un cliente/contrato en un período dado. Toca base
 * de datos en varios pasos (leer contrato, leer vuelos, leer cada aeronave,
 * insertar factura, insertar renglones, marcar vuelos facturados) — por
 * eso es async y usa await en cada llamada a la capa de datos.
 */
async function generateInvoice(db, { customerId, contractId, periodStart, periodEnd, invoiceNumber, issuedDate }) {
  const contract = await get(db, "SELECT * FROM contracts WHERE id = ?", [contractId]);
  if (!contract) throw new Error(`Contrato ${contractId} no encontrado`);

  const flights = await all(
    db,
    `SELECT * FROM flights
     WHERE customer_id = ? AND contract_id = ? AND invoiced = 0
       AND flight_date >= ? AND flight_date <= ?
     ORDER BY flight_date ASC`,
    [customerId, contractId, periodStart, periodEnd]
  );

  if (flights.length === 0) {
    throw new Error("No hay vuelos pendientes de facturar en el período indicado.");
  }

  const allLineItems = [];
  let totalFlightHours = 0;
  let flightTimeAmountCents = 0;

  for (const flight of flights) {
    const aircraft = await get(db, "SELECT * FROM aircraft WHERE id = ?", [flight.aircraft_id]);
    const items = computeFlightLineItems(flight, contract, aircraft);
    for (const item of items) {
      allLineItems.push({ ...item, flight_id: flight.id });
      if (item.line_type === "flight_time") flightTimeAmountCents += item.amount_cents;
    }
    totalFlightHours += flight.flight_hours;
  }

  const retainerItems = applyRetainerLogic(contract, totalFlightHours, flightTimeAmountCents);
  allLineItems.push(...retainerItems);

  const subtotalCents = allLineItems.reduce((sum, i) => sum + i.amount_cents, 0);
  const taxCents = round((subtotalCents * contract.tax_pct) / 100);
  const totalCents = subtotalCents + taxCents;

  const invoiceResult = await run(
    db,
    `INSERT INTO invoices (invoice_number, customer_id, contract_id, period_start, period_end, issued_date, status, subtotal_cents, tax_cents, total_cents)
     VALUES (?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`,
    [invoiceNumber, customerId, contractId, periodStart, periodEnd, issuedDate, subtotalCents, taxCents, totalCents]
  );
  const invoiceId = invoiceResult.lastInsertRowid;

  for (const item of allLineItems) {
    await run(
      db,
      `INSERT INTO invoice_line_items (invoice_id, flight_id, line_type, description, quantity, unit_rate_cents, amount_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [invoiceId, item.flight_id ?? null, item.line_type, item.description, item.quantity ?? null, item.unit_rate_cents ?? null, item.amount_cents]
    );
  }

  for (const flight of flights) {
    await run(db, "UPDATE flights SET invoiced = 1, invoice_id = ? WHERE id = ?", [invoiceId, flight.id]);
  }

  return getInvoiceWithLineItems(db, invoiceId);
}

async function getInvoiceWithLineItems(db, invoiceId) {
  const invoice = await get(db, "SELECT * FROM invoices WHERE id = ?", [invoiceId]);
  if (!invoice) return null;
  const lineItems = await all(db, "SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY id ASC", [invoiceId]);
  const customer = await get(db, "SELECT * FROM customers WHERE id = ?", [invoice.customer_id]);
  return { ...invoice, customer, line_items: lineItems };
}

/**
 * Crea un vuelo facturable a partir de una reserva cerrada en el módulo de
 * Programación. Idempotente por source_booking_id (columna UNIQUE).
 */
async function createFlightFromBooking(db, booking) {
  const existing = await get(db, "SELECT * FROM flights WHERE source_booking_id = ?", [booking.sourceBookingId]);
  if (existing) return { flight: existing, created: false };

  const result = await run(
    db,
    `INSERT INTO flights (aircraft_id, customer_id, contract_id, flight_date, mission_type, flight_hours, positioning_hours, standby_hours, landing_count, notes, source_booking_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      booking.aircraftId,
      booking.customerId,
      booking.contractId,
      booking.flightDate,
      booking.missionType ?? null,
      booking.flightHours ?? 0,
      booking.positioningHours ?? 0,
      booking.standbyHours ?? 0,
      booking.landingCount ?? 0,
      `Sincronizado automáticamente desde reserva #${booking.sourceBookingId} del módulo de Programación.`,
      booking.sourceBookingId,
    ]
  );
  const flight = await get(db, "SELECT * FROM flights WHERE id = ?", [result.lastInsertRowid]);
  return { flight, created: true };
}

/**
 * Alta/actualización de una aeronave a partir del maestro central
 * (fleet-core-module), vía fleet-integration. Si la aeronave es nueva, se
 * le asigna una tarifa por defecto que el administrador de facturación
 * debe ajustar luego — este módulo no inventa tarifas comerciales, solo
 * evita que falte la fila de referencia.
 */
async function upsertAircraft(db, { tailNumber, model, defaultHourlyRateCents }) {
  const existing = await get(db, "SELECT * FROM aircraft WHERE tail_number = ?", [tailNumber]);
  if (existing) {
    await run(db, "UPDATE aircraft SET model = ? WHERE id = ?", [model, existing.id]);
    return get(db, "SELECT * FROM aircraft WHERE id = ?", [existing.id]);
  }
  const result = await run(
    db,
    "INSERT INTO aircraft (tail_number, model, default_hourly_rate_cents) VALUES (?, ?, ?)",
    [tailNumber, model, defaultHourlyRateCents ?? 0]
  );
  return get(db, "SELECT * FROM aircraft WHERE id = ?", [result.lastInsertRowid]);
}

module.exports = {
  computeFlightLineItems,
  applyRetainerLogic,
  generateInvoice,
  getInvoiceWithLineItems,
  createFlightFromBooking,
  upsertAircraft,
};
