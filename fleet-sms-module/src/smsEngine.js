// ============================================================================
// Motor de SMS (Sistema de Gestión de Seguridad)
//
// Tres piezas:
//   1. FRAT (Flight Risk Assessment Tool) — evaluación de riesgo ANTES de
//      cada misión. Suma 6 factores (0-4 cada uno) en un score total; el
//      nivel de riesgo resultante determina si el vuelo puede autorizarse
//      solo, o si exige aprobación explícita de un supervisor.
//   2. Registro de ocurrencias — reportes de incidentes/accidentes/cuasi
//      accidentes, con seguimiento de causa raíz.
//   3. Registro de peligros (hazard register) — identificación proactiva,
//      calificada con matriz de riesgo (probabilidad x consecuencia).
//
// Los umbrales de FRAT son un modelo de referencia (similar en espíritu a
// las herramientas FRAT usadas en HEMS/aerial work), no una norma de una
// autoridad específica — cada operador debe calibrarlos según su propio
// manual de SMS aceptado por su autoridad reguladora.
// ============================================================================

const { get, all, run } = require("./db");

const FRAT_THRESHOLDS = [
  { max: 6, level: "bajo", requiresApproval: false },
  { max: 12, level: "moderado", requiresApproval: false },
  { max: 18, level: "alto", requiresApproval: true },
  { max: 24, level: "extremo", requiresApproval: true },
];

function classifyFratScore(totalScore) {
  const bucket = FRAT_THRESHOLDS.find((t) => totalScore <= t.max) ?? FRAT_THRESHOLDS[FRAT_THRESHOLDS.length - 1];
  return bucket;
}

/**
 * Traduce el score de fatiga REAL de fleet-crew-module (0-100, ver
 * computeFatigueScore allá) a la escala 0-4 que usa el FRAT. Es una
 * traducción propia de este sistema, no una tabla de una autoridad
 * específica — mismo criterio de transparencia que FRAT_THRESHOLDS.
 */
function fatigueScoreToBand(score0to100) {
  return Math.min(4, Math.floor(score0to100 / 25));
}

/**
 * Busca la última fotografía conocida de fatiga real de un piloto
 * (sincronizada por el flujo 7 de fleet-integration) — no llama a
 * fleet-crew-module directamente, este módulo solo lee lo que ya se
 * reflejó localmente, igual que Programación con la aeronavegabilidad.
 */
async function getFatigueSnapshot(db, employeeCode) {
  return get(db, "SELECT * FROM fatigue_snapshots WHERE employee_code = ?", [employeeCode]);
}

async function upsertFatigueSnapshot(db, { employeeCode, snapshotDate, score, level }) {
  const band = fatigueScoreToBand(score);
  const existing = await get(db, "SELECT * FROM fatigue_snapshots WHERE employee_code = ?", [employeeCode]);
  const syncedAt = new Date().toISOString();
  if (existing) {
    await run(
      db,
      `UPDATE fatigue_snapshots SET snapshot_date = ?, score_0_100 = ?, level = ?, fatigue_band_0_4 = ?, synced_at = ? WHERE id = ?`,
      [snapshotDate, score, level, band, syncedAt, existing.id]
    );
    return get(db, "SELECT * FROM fatigue_snapshots WHERE id = ?", [existing.id]);
  }
  const result = await run(
    db,
    `INSERT INTO fatigue_snapshots (employee_code, snapshot_date, score_0_100, level, fatigue_band_0_4, synced_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [employeeCode, snapshotDate, score, level, band, syncedAt]
  );
  return get(db, "SELECT * FROM fatigue_snapshots WHERE id = ?", [result.lastInsertRowid]);
}

/**
 * Calcula y registra una evaluación FRAT. Si el nivel de riesgo resultante
 * es "alto" o "extremo", exige que venga un `approvedBy` (nombre de quien
 * autoriza) — si no viene, RECHAZA la creación, igual que el patrón de
 * bloqueo usado en los módulos de Programación y Tripulación.
 *
 * Fatiga: si `params.fatigueScore` viene explícito, se usa tal cual
 * (fatigue_source='manual'). Si NO viene pero sí `params.pilotEmployeeCode`
 * y hay una fotografía de fatiga real sincronizada para ese piloto, se usa
 * esa (fatigue_source='tripulacion') — el despachador ya no tiene que
 * adivinar qué tan cansado está el piloto, lo calcula Tripulación a partir
 * de horas de servicio reales.
 */
async function createFratAssessment(db, params) {
  let fatigueScore = params.fatigueScore;
  let fatigueSource = "manual";
  if (fatigueScore === undefined && params.pilotEmployeeCode) {
    const snapshot = await getFatigueSnapshot(db, params.pilotEmployeeCode);
    if (snapshot) {
      fatigueScore = snapshot.fatigue_band_0_4;
      fatigueSource = "tripulacion";
    }
  }

  const scores = {
    weather_score: params.weatherScore ?? 0,
    terrain_score: params.terrainScore ?? 0,
    pilot_currency_score: params.pilotCurrencyScore ?? 0,
    fatigue_score: fatigueScore ?? 0,
    aircraft_status_score: params.aircraftStatusScore ?? 0,
    operational_pressure_score: params.operationalPressureScore ?? 0,
  };
  for (const [key, val] of Object.entries(scores)) {
    if (val < 0 || val > 4) throw new Error(`${key} debe estar entre 0 y 4 (recibido: ${val}).`);
  }

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const { level, requiresApproval } = classifyFratScore(totalScore);

  if (requiresApproval && !params.approvedBy) {
    throw new Error(
      `Riesgo ${level.toUpperCase()} (score ${totalScore}/24): este vuelo requiere aprobación explícita de un supervisor antes de autorizarse. Falta el campo "approvedBy".`
    );
  }

  const result = await run(
    db,
    `INSERT INTO frat_assessments
      (flight_date, aircraft_tail, mission_type, pilot_employee_code, weather_score, terrain_score, pilot_currency_score,
       fatigue_score, fatigue_source, aircraft_status_score, operational_pressure_score, total_score, risk_level,
       requires_approval, approved_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.flightDate, params.aircraftTail ?? null, params.missionType ?? null, params.pilotEmployeeCode ?? null,
      scores.weather_score, scores.terrain_score, scores.pilot_currency_score,
      scores.fatigue_score, fatigueSource, scores.aircraft_status_score, scores.operational_pressure_score,
      totalScore, level, requiresApproval ? 1 : 0, params.approvedBy ?? null, params.notes ?? null,
    ]
  );
  return get(db, "SELECT * FROM frat_assessments WHERE id = ?", [result.lastInsertRowid]);
}

/**
 * Calcula el resultado de un FRAT SIN guardarlo — para que la UI muestre el
 * nivel de riesgo en vivo mientras el despachador llena el formulario.
 * Mismo criterio de herencia de fatiga real que createFratAssessment.
 */
async function previewFratScore(db, scores) {
  let fatigueScore = scores.fatigueScore;
  let fatigueSource = "manual";
  if (fatigueScore === undefined && scores.pilotEmployeeCode) {
    const snapshot = await getFatigueSnapshot(db, scores.pilotEmployeeCode);
    if (snapshot) {
      fatigueScore = snapshot.fatigue_band_0_4;
      fatigueSource = "tripulacion";
    }
  }
  const total = (scores.weatherScore ?? 0) + (scores.terrainScore ?? 0) + (scores.pilotCurrencyScore ?? 0) +
    (fatigueScore ?? 0) + (scores.aircraftStatusScore ?? 0) + (scores.operationalPressureScore ?? 0);
  const { level, requiresApproval } = classifyFratScore(total);
  return { totalScore: total, level, requiresApproval, fatigueScoreUsed: fatigueScore ?? 0, fatigueSource };
}

async function createOccurrence(db, params) {
  const required = ["reportDate", "occurrenceType", "description"];
  for (const f of required) if (!params[f]) throw new Error(`Falta el campo requerido: ${f}`);
  const result = await run(
    db,
    `INSERT INTO occurrences (report_date, reported_by, occurrence_type, aircraft_tail, description, severity, status)
     VALUES (?, ?, ?, ?, ?, ?, 'open')`,
    [params.reportDate, params.reportedBy ?? null, params.occurrenceType, params.aircraftTail ?? null, params.description, params.severity ?? "low"]
  );
  return get(db, "SELECT * FROM occurrences WHERE id = ?", [result.lastInsertRowid]);
}

async function closeOccurrence(db, occurrenceId, { rootCause, closedDate }) {
  const occ = await get(db, "SELECT * FROM occurrences WHERE id = ?", [occurrenceId]);
  if (!occ) throw new Error(`Ocurrencia ${occurrenceId} no encontrada.`);
  if (!rootCause) throw new Error("No se puede cerrar una ocurrencia sin registrar la causa raíz (rootCause).");
  await run(
    db,
    `UPDATE occurrences SET status = 'closed', root_cause = ?, closed_date = ? WHERE id = ?`,
    [rootCause, closedDate ?? new Date().toISOString().slice(0, 10), occurrenceId]
  );
  return get(db, "SELECT * FROM occurrences WHERE id = ?", [occurrenceId]);
}

async function createHazard(db, params) {
  const required = ["identifiedDate", "description"];
  for (const f of required) if (!params[f]) throw new Error(`Falta el campo requerido: ${f}`);
  const likelihood = params.likelihood ?? 1;
  const consequence = params.consequence ?? 1;
  if (likelihood < 1 || likelihood > 5 || consequence < 1 || consequence > 5) {
    throw new Error("likelihood y consequence deben estar entre 1 y 5.");
  }
  const riskScore = likelihood * consequence;
  const result = await run(
    db,
    `INSERT INTO hazards (identified_date, category, description, likelihood, consequence, risk_score, status)
     VALUES (?, ?, ?, ?, ?, ?, 'open')`,
    [params.identifiedDate, params.category ?? null, params.description, likelihood, consequence, riskScore]
  );
  return get(db, "SELECT * FROM hazards WHERE id = ?", [result.lastInsertRowid]);
}

async function createCorrectiveAction(db, params) {
  const required = ["description"];
  for (const f of required) if (!params[f]) throw new Error(`Falta el campo requerido: ${f}`);
  if (!params.occurrenceId && !params.hazardId) {
    throw new Error("La acción correctiva debe vincularse a una ocurrencia (occurrenceId) o a un peligro (hazardId).");
  }
  const result = await run(
    db,
    `INSERT INTO corrective_actions (occurrence_id, hazard_id, description, assigned_to, due_date, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [params.occurrenceId ?? null, params.hazardId ?? null, params.description, params.assignedTo ?? null, params.dueDate ?? null]
  );
  return get(db, "SELECT * FROM corrective_actions WHERE id = ?", [result.lastInsertRowid]);
}

async function completeCorrectiveAction(db, actionId, completedDate) {
  const action = await get(db, "SELECT * FROM corrective_actions WHERE id = ?", [actionId]);
  if (!action) throw new Error(`Acción correctiva ${actionId} no encontrada.`);
  await run(db, `UPDATE corrective_actions SET status = 'done', completed_date = ? WHERE id = ?`, [completedDate ?? new Date().toISOString().slice(0, 10), actionId]);
  return get(db, "SELECT * FROM corrective_actions WHERE id = ?", [actionId]);
}

async function getSafetyDashboard(db) {
  const openOccurrences = await all(db, "SELECT * FROM occurrences WHERE status != 'closed'");
  const openHazards = await all(db, "SELECT * FROM hazards WHERE status != 'closed' ORDER BY risk_score DESC");
  const pendingActions = await all(db, "SELECT * FROM corrective_actions WHERE status != 'done'");
  const recentFrats = await all(db, "SELECT * FROM frat_assessments ORDER BY flight_date DESC LIMIT 10");
  const highRiskFrats = recentFrats.filter((f) => f.risk_level === "alto" || f.risk_level === "extremo");

  return {
    openOccurrencesCount: openOccurrences.length,
    openOccurrencesBySeverity: ["low", "medium", "high", "critical"].map((sev) => ({
      severity: sev,
      count: openOccurrences.filter((o) => o.severity === sev).length,
    })),
    topHazards: openHazards.slice(0, 5),
    pendingCorrectiveActionsCount: pendingActions.length,
    recentFratAssessments: recentFrats,
    highRiskFlightsLast10: highRiskFrats.length,
  };
}

module.exports = {
  classifyFratScore,
  fatigueScoreToBand,
  getFatigueSnapshot,
  upsertFatigueSnapshot,
  createFratAssessment,
  previewFratScore,
  createOccurrence,
  closeOccurrence,
  createHazard,
  createCorrectiveAction,
  completeCorrectiveAction,
  getSafetyDashboard,
  FRAT_THRESHOLDS,
};
