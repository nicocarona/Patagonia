const { run } = require("./db");
const { upsertFatigueSnapshot, createFratAssessment } = require("./smsEngine");

async function seed(db) {
  const occ1 = await run(
    db,
    `INSERT INTO occurrences (report_date, reported_by, occurrence_type, aircraft_tail, description, severity, status)
     VALUES ('2026-07-05', 'Ana Reyes', 'near_miss', 'XA-HEL1', 'Aproximación con tráfico VFR no coordinado cerca de la base norte.', 'medium', 'open')`
  );
  await run(
    db,
    `INSERT INTO occurrences (report_date, reported_by, occurrence_type, aircraft_tail, description, severity, status, root_cause, closed_date)
     VALUES ('2026-06-20', 'Luis Camacho', 'incident', 'XA-HEL2', 'Vibración anómala en vuelo, aterrizaje precautorio.', 'high', 'closed', 'Desbalance de pala detectado en inspección — corregido en mantenimiento.', '2026-06-25')`
  );

  const haz1 = await run(
    db,
    `INSERT INTO hazards (identified_date, category, description, likelihood, consequence, risk_score, status)
     VALUES ('2026-07-01', 'terreno', 'Zona de aterrizaje en sitio minero sin manga de viento ni señalización nocturna.', 4, 3, 12, 'open')`
  );
  await run(
    db,
    `INSERT INTO hazards (identified_date, category, description, likelihood, consequence, risk_score, status)
     VALUES ('2026-06-10', 'procedimientos', 'Checklist de despacho no incluye verificación de NOTAM de zona restringida.', 2, 4, 8, 'mitigated')`
  );

  await run(
    db,
    `INSERT INTO corrective_actions (occurrence_id, description, assigned_to, due_date, status)
     VALUES (?, 'Coordinar frecuencia común con operadores VFR de la zona norte.', 'Jefe de Operaciones', '2026-07-31', 'pending')`,
    [occ1.lastInsertRowid]
  );
  await run(
    db,
    `INSERT INTO corrective_actions (hazard_id, description, assigned_to, due_date, status)
     VALUES (?, 'Instalar manga de viento y balizas en sitio minero.', 'Mantenimiento de Bases', '2026-08-15', 'in_progress')`,
    [haz1.lastInsertRowid]
  );

  // FRAT de bajo riesgo — se aprueba solo (fatiga cargada a mano, sin conexión a Tripulación).
  await run(
    db,
    `INSERT INTO frat_assessments
      (flight_date, aircraft_tail, mission_type, weather_score, terrain_score, pilot_currency_score, fatigue_score, fatigue_source, aircraft_status_score, operational_pressure_score, total_score, risk_level, requires_approval, approved_by)
     VALUES ('2026-07-14', 'XA-HEL1', 'Transporte de personal', 0, 1, 0, 1, 'manual', 0, 0, 2, 'bajo', 0, NULL)`
  );

  // Fotografía de fatiga real de ejemplo (simula lo que el flujo 7 sincronizaría
  // desde fleet-crew-module) + un FRAT que la hereda automáticamente al no
  // traer fatigueScore explícito — demuestra fatigue_source='tripulacion'.
  await upsertFatigueSnapshot(db, { employeeCode: "EMP-0002", snapshotDate: "2026-07-16", score: 62, level: "moderado" });
  await createFratAssessment(db, {
    flightDate: "2026-07-17",
    aircraftTail: "XA-HEL2",
    missionType: "Traslado HEMS",
    pilotEmployeeCode: "EMP-0002",
    weatherScore: 1,
    terrainScore: 1,
    pilotCurrencyScore: 0,
    aircraftStatusScore: 0,
    operationalPressureScore: 1,
    // fatigueScore NO se pasa a propósito — se hereda de fatigue_snapshots (EMP-0002, score 62 -> banda 2).
  });

  return {};
}

module.exports = { seed };
