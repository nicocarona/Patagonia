// ============================================================================
// Motor de entrenamiento y vigencias
//
// Idea central: cada registro (licencia, médico, habilitación de tipo,
// habilitación especial, entrenamiento recurrente) tiene una fecha de
// vencimiento. Este motor no inventa el plazo — solo calcula, para una
// fecha de referencia dada, si el registro está vigente, por vencer
// (dentro del umbral de aviso) o vencido, y arma el perfil de vigencia
// completo de cada tripulante — el mismo tipo de "panel único por
// tripulante" que usan los sistemas de gestión de tripulación de
// aerolíneas grandes (ver README.md).
//
// EXPIRING_SOON_DAYS es un umbral de ejemplo (60 días), NO una regla
// regulatoria — cada operador define su propia ventana de aviso según su
// programa de entrenamiento aprobado.
// ============================================================================

const { get, all, run } = require("./db");

const EXPIRING_SOON_DAYS = 60;

function daysBetween(fromISO, toISO) {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

/**
 * Estado de un solo registro con fecha de vencimiento.
 * 'sin_vencimiento' para registros sin expiry_date (p.ej. algunas
 * habilitaciones especiales que no vencen en el modelo del operador).
 */
function computeItemStatus(expiryDate, referenceDate = new Date().toISOString().slice(0, 10)) {
  if (!expiryDate) return "sin_vencimiento";
  const daysLeft = daysBetween(referenceDate, expiryDate);
  if (daysLeft < 0) return "vencido";
  if (daysLeft <= EXPIRING_SOON_DAYS) return "por_vencer";
  return "vigente";
}

async function findOrCreateCrewMember(db, { employeeCode, name, role, base }) {
  const existing = await get(db, "SELECT * FROM crew_members WHERE employee_code = ?", [employeeCode]);
  if (existing) return existing;
  const result = await run(db, "INSERT INTO crew_members (employee_code, name, role, base) VALUES (?, ?, ?, ?)", [
    employeeCode,
    name || employeeCode,
    role || "pilot",
    base ?? null,
  ]);
  return get(db, "SELECT * FROM crew_members WHERE id = ?", [result.lastInsertRowid]);
}

async function upsertCrewMember(db, { employeeCode, name, role, base }) {
  const existing = await get(db, "SELECT * FROM crew_members WHERE employee_code = ?", [employeeCode]);
  if (existing) {
    await run(db, "UPDATE crew_members SET name = ?, role = ?, base = ? WHERE id = ?", [name, role, base ?? existing.base, existing.id]);
    return get(db, "SELECT * FROM crew_members WHERE id = ?", [existing.id]);
  }
  return findOrCreateCrewMember(db, { employeeCode, name, role, base });
}

async function addLicense(db, { employeeCode, licenseType, licenseNumber, issuingAuthority, issueDate, expiryDate }) {
  if (!expiryDate) throw new Error("Falta el campo requerido: expiryDate");
  const crew = await get(db, "SELECT * FROM crew_members WHERE employee_code = ?", [employeeCode]);
  if (!crew) throw new Error(`Tripulante ${employeeCode} no encontrado.`);
  const result = await run(
    db,
    `INSERT INTO licenses (crew_id, license_type, license_number, issuing_authority, issue_date, expiry_date) VALUES (?, ?, ?, ?, ?, ?)`,
    [crew.id, licenseType, licenseNumber ?? null, issuingAuthority ?? null, issueDate ?? null, expiryDate]
  );
  return get(db, "SELECT * FROM licenses WHERE id = ?", [result.lastInsertRowid]);
}

async function addMedicalCertificate(db, { employeeCode, class: medClass, issueDate, expiryDate }) {
  if (!expiryDate) throw new Error("Falta el campo requerido: expiryDate");
  const crew = await get(db, "SELECT * FROM crew_members WHERE employee_code = ?", [employeeCode]);
  if (!crew) throw new Error(`Tripulante ${employeeCode} no encontrado.`);
  const result = await run(db, `INSERT INTO medical_certificates (crew_id, class, issue_date, expiry_date) VALUES (?, ?, ?, ?)`, [
    crew.id,
    medClass ?? "1",
    issueDate ?? null,
    expiryDate,
  ]);
  return get(db, "SELECT * FROM medical_certificates WHERE id = ?", [result.lastInsertRowid]);
}

/**
 * Habilitación de tipo de aeronave — upsert por (crew_id, aircraft_model),
 * igual criterio de clave de negocio que el resto del sistema.
 */
async function upsertTypeRating(db, { employeeCode, aircraftModel, qualifiedDate, lastProficiencyCheck, expiryDate }) {
  if (!expiryDate) throw new Error("Falta el campo requerido: expiryDate");
  const crew = await get(db, "SELECT * FROM crew_members WHERE employee_code = ?", [employeeCode]);
  if (!crew) throw new Error(`Tripulante ${employeeCode} no encontrado.`);
  const existing = await get(db, "SELECT * FROM type_ratings WHERE crew_id = ? AND aircraft_model = ?", [crew.id, aircraftModel]);
  if (existing) {
    await run(
      db,
      `UPDATE type_ratings SET qualified_date = ?, last_proficiency_check = ?, expiry_date = ? WHERE id = ?`,
      [qualifiedDate ?? existing.qualified_date, lastProficiencyCheck ?? existing.last_proficiency_check, expiryDate, existing.id]
    );
    return get(db, "SELECT * FROM type_ratings WHERE id = ?", [existing.id]);
  }
  const result = await run(
    db,
    `INSERT INTO type_ratings (crew_id, aircraft_model, qualified_date, last_proficiency_check, expiry_date) VALUES (?, ?, ?, ?, ?)`,
    [crew.id, aircraftModel, qualifiedDate ?? null, lastProficiencyCheck ?? null, expiryDate]
  );
  return get(db, "SELECT * FROM type_ratings WHERE id = ?", [result.lastInsertRowid]);
}

async function addSpecialQualification(db, { employeeCode, qualificationCode, issueDate, expiryDate, notes }) {
  const crew = await get(db, "SELECT * FROM crew_members WHERE employee_code = ?", [employeeCode]);
  if (!crew) throw new Error(`Tripulante ${employeeCode} no encontrado.`);
  const result = await run(
    db,
    `INSERT INTO special_qualifications (crew_id, qualification_code, issue_date, expiry_date, notes) VALUES (?, ?, ?, ?, ?)`,
    [crew.id, qualificationCode, issueDate ?? null, expiryDate ?? null, notes ?? null]
  );
  return get(db, "SELECT * FROM special_qualifications WHERE id = ?", [result.lastInsertRowid]);
}

async function addRecurrentTraining(db, { employeeCode, trainingType, completedDate, expiryDate, provider, notes }) {
  if (!completedDate) throw new Error("Falta el campo requerido: completedDate");
  const crew = await get(db, "SELECT * FROM crew_members WHERE employee_code = ?", [employeeCode]);
  if (!crew) throw new Error(`Tripulante ${employeeCode} no encontrado.`);
  const result = await run(
    db,
    `INSERT INTO recurrent_trainings (crew_id, training_type, completed_date, expiry_date, provider, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    [crew.id, trainingType, completedDate, expiryDate ?? null, provider ?? null, notes ?? null]
  );
  return get(db, "SELECT * FROM recurrent_trainings WHERE id = ?", [result.lastInsertRowid]);
}

/**
 * Perfil de vigencia completo de un tripulante: licencias, médicos,
 * habilitaciones de tipo, habilitaciones especiales y entrenamientos
 * recurrentes, cada uno con su estado calculado, más un resumen general
 * ("flightReady": listo para volar en general — licencia y médico
 * vigentes) y, por separado, la lista de modelos en los que está
 * habilitado HOY.
 */
async function getCrewCurrencyProfile(db, employeeCode, { referenceDate } = {}) {
  const crew = await get(db, "SELECT * FROM crew_members WHERE employee_code = ?", [employeeCode]);
  if (!crew) return null;

  const [licenses, medicals, typeRatings, specialQuals, recurrent] = await Promise.all([
    all(db, "SELECT * FROM licenses WHERE crew_id = ? ORDER BY expiry_date DESC", [crew.id]),
    all(db, "SELECT * FROM medical_certificates WHERE crew_id = ? ORDER BY expiry_date DESC", [crew.id]),
    all(db, "SELECT * FROM type_ratings WHERE crew_id = ? ORDER BY aircraft_model", [crew.id]),
    all(db, "SELECT * FROM special_qualifications WHERE crew_id = ? ORDER BY qualification_code", [crew.id]),
    all(db, "SELECT * FROM recurrent_trainings WHERE crew_id = ? ORDER BY completed_date DESC", [crew.id]),
  ]);

  const withStatus = (rows) => rows.map((r) => ({ ...r, status: computeItemStatus(r.expiry_date, referenceDate) }));

  const licensesWithStatus = withStatus(licenses);
  const medicalsWithStatus = withStatus(medicals);
  const typeRatingsWithStatus = withStatus(typeRatings);
  const specialQualsWithStatus = withStatus(specialQuals);
  const recurrentWithStatus = withStatus(recurrent);

  const currentLicense = licensesWithStatus.find((l) => l.status === "vigente" || l.status === "por_vencer");
  const currentMedical = medicalsWithStatus.find((m) => m.status === "vigente" || m.status === "por_vencer");
  const currentAircraftModels = typeRatingsWithStatus.filter((t) => t.status === "vigente" || t.status === "por_vencer").map((t) => t.aircraft_model);

  return {
    crew,
    licenses: licensesWithStatus,
    medicalCertificates: medicalsWithStatus,
    typeRatings: typeRatingsWithStatus,
    specialQualifications: specialQualsWithStatus,
    recurrentTrainings: recurrentWithStatus,
    summary: {
      flightReady: Boolean(currentLicense) && Boolean(currentMedical),
      licenseOk: Boolean(currentLicense),
      medicalOk: Boolean(currentMedical),
      currentAircraftModels,
    },
  };
}

async function getFleetCurrencyDashboard(db, { referenceDate } = {}) {
  const crewMembers = await all(db, "SELECT * FROM crew_members ORDER BY name");
  const profiles = [];
  for (const c of crewMembers) {
    profiles.push(await getCrewCurrencyProfile(db, c.employee_code, { referenceDate }));
  }
  return profiles;
}

/**
 * El gate: ¿puede este tripulante volar ESTE modelo de aeronave en la
 * fecha dada? Verifica licencia, médico y habilitación de tipo — los tres
 * tienen que estar vigentes (no vencidos; "por_vencer" todavía cuenta como
 * vigente, solo avisa). Pensado para que otros módulos (Programación,
 * Despacho) lo consulten antes de asignar un piloto a un vuelo.
 */
async function checkPilotCurrency(db, { employeeCode, aircraftModel, referenceDate = new Date().toISOString().slice(0, 10) }) {
  const profile = await getCrewCurrencyProfile(db, employeeCode, { referenceDate });
  if (!profile) return { ok: false, reason: `Tripulante ${employeeCode} no encontrado en fleet-training-module.` };

  const violations = [];
  if (!profile.summary.licenseOk) violations.push("licencia vencida o inexistente");
  if (!profile.summary.medicalOk) violations.push("certificado médico vencido o inexistente");

  const rating = profile.typeRatings.find((t) => t.aircraft_model === aircraftModel);
  if (!rating) {
    violations.push(`sin habilitación registrada para ${aircraftModel}`);
  } else if (rating.status === "vencido") {
    violations.push(`habilitación para ${aircraftModel} vencida (venció ${rating.expiry_date})`);
  }

  if (violations.length > 0) {
    return { ok: false, reason: `${employeeCode} no está habilitado para volar: ${violations.join("; ")}.` };
  }
  return { ok: true };
}

module.exports = {
  computeItemStatus,
  findOrCreateCrewMember,
  upsertCrewMember,
  addLicense,
  addMedicalCertificate,
  upsertTypeRating,
  addSpecialQualification,
  addRecurrentTraining,
  getCrewCurrencyProfile,
  getFleetCurrencyDashboard,
  checkPilotCurrency,
  EXPIRING_SOON_DAYS,
};
