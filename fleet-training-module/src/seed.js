// Datos de ejemplo: mismos employee_code que fleet-core-module/fleet-crew-module
// (EMP-0001 Ana Reyes, EMP-0002 Luis Camacho, EMP-0003 Carla Núñez), mismos
// modelos de aeronave que fleet-core-module (Airbus H125/H145/H175, Leonardo
// AW139). Incluye deliberadamente una habilitación de tipo VENCIDA (Ana en
// H145) y un certificado médico VENCIDO (Luis) para poder demostrar el
// bloqueo — igual criterio que los demás módulos.

const { get } = require("./db");
const {
  upsertCrewMember,
  addLicense,
  addMedicalCertificate,
  upsertTypeRating,
  addSpecialQualification,
  addRecurrentTraining,
} = require("./trainingEngine");

async function seed(db) {
  const row = await get(db, "SELECT COUNT(*) as n FROM crew_members", []);
  if (row && row.n > 0) {
    console.log("Ya hay datos en fleet-training-module, se omite el seed.");
    return;
  }

  await upsertCrewMember(db, { employeeCode: "EMP-0001", name: "Ana Reyes", role: "pilot", base: "Base Norte" });
  await upsertCrewMember(db, { employeeCode: "EMP-0002", name: "Luis Camacho", role: "pilot", base: "Base Sur" });
  await upsertCrewMember(db, { employeeCode: "EMP-0003", name: "Carla Núñez", role: "paramedic", base: "Base Sur" });

  // --- Ana Reyes (EMP-0001): al día en licencia/médico, habilitada en H125,
  //     pero su habilitación en H145 está VENCIDA (para demostrar el bloqueo).
  await addLicense(db, { employeeCode: "EMP-0001", licenseType: "ATPL(H)", licenseNumber: "LIC-10045", issuingAuthority: "Autoridad de Aviación Civil (referencia genérica)", issueDate: "2015-02-01", expiryDate: "2027-02-01" });
  await addMedicalCertificate(db, { employeeCode: "EMP-0001", class: "1", issueDate: "2025-09-01", expiryDate: "2026-09-01" });
  await upsertTypeRating(db, { employeeCode: "EMP-0001", aircraftModel: "Airbus H125", qualifiedDate: "2019-04-01", lastProficiencyCheck: "2026-04-01", expiryDate: "2026-10-01" });
  await upsertTypeRating(db, { employeeCode: "EMP-0001", aircraftModel: "Airbus H145", qualifiedDate: "2020-06-01", lastProficiencyCheck: "2025-01-10", expiryDate: "2025-07-10" }); // VENCIDA
  await addSpecialQualification(db, { employeeCode: "EMP-0001", qualificationCode: "NVG", issueDate: "2022-01-01", expiryDate: "2026-12-01", notes: "Visión nocturna — operación minera nocturna" });
  await addSpecialQualification(db, { employeeCode: "EMP-0001", qualificationCode: "EXTERNAL_LOAD", issueDate: "2021-03-01", expiryDate: "2026-09-01", notes: "Carga externa — abastecimiento a campamentos remotos" });
  await addRecurrentTraining(db, { employeeCode: "EMP-0001", trainingType: "CRM (Crew Resource Management)", completedDate: "2026-01-15", expiryDate: "2027-01-15", provider: "Centro de Entrenamiento Interno" });
  await addRecurrentTraining(db, { employeeCode: "EMP-0001", trainingType: "Emergencias y evacuación", completedDate: "2026-02-01", expiryDate: "2027-02-01", provider: "Centro de Entrenamiento Interno" });

  // --- Luis Camacho (EMP-0002): habilitado en H145, pero su certificado
  //     médico está VENCIDO (para demostrar que "flightReady" cae aunque la
  //     habilitación de tipo esté al día).
  await addLicense(db, { employeeCode: "EMP-0002", licenseType: "CPL(H)", licenseNumber: "LIC-10098", issuingAuthority: "Autoridad de Aviación Civil (referencia genérica)", issueDate: "2017-05-01", expiryDate: "2027-05-01" });
  await addMedicalCertificate(db, { employeeCode: "EMP-0002", class: "1", issueDate: "2024-06-01", expiryDate: "2025-06-01" }); // VENCIDO
  await upsertTypeRating(db, { employeeCode: "EMP-0002", aircraftModel: "Airbus H145", qualifiedDate: "2017-09-01", lastProficiencyCheck: "2026-03-01", expiryDate: "2026-09-01" });
  await upsertTypeRating(db, { employeeCode: "EMP-0002", aircraftModel: "Leonardo AW139", qualifiedDate: "2018-11-01", lastProficiencyCheck: "2026-02-01", expiryDate: "2026-08-01" });
  await addSpecialQualification(db, { employeeCode: "EMP-0002", qualificationCode: "HEMS", issueDate: "2018-01-01", expiryDate: "2026-12-01", notes: "Tripulación médica aérea" });
  await addSpecialQualification(db, { employeeCode: "EMP-0002", qualificationCode: "INSTRUCTOR", issueDate: "2020-01-01", expiryDate: null, notes: "Instructor de vuelo — revalida por chequeo de línea, sin fecha fija en este registro" });
  await addRecurrentTraining(db, { employeeCode: "EMP-0002", trainingType: "Mercancías peligrosas", completedDate: "2025-11-01", expiryDate: "2026-11-01", provider: "Centro de Entrenamiento Interno" });

  // --- Carla Núñez (EMP-0003): paramédica — sin licencia de piloto ni
  //     habilitación de tipo, pero sí habilitación especial HEMS y
  //     entrenamientos recurrentes propios de tripulación médica.
  await addSpecialQualification(db, { employeeCode: "EMP-0003", qualificationCode: "HEMS", issueDate: "2021-02-01", expiryDate: "2026-08-15", notes: "Por vencer pronto — priorizar revalidación" });
  await addRecurrentTraining(db, { employeeCode: "EMP-0003", trainingType: "Soporte vital avanzado", completedDate: "2025-08-01", expiryDate: "2026-08-01", provider: "Cruz Roja (referencia genérica)" });

  console.log("fleet-training-module: 3 perfiles de tripulación cargados (1 habilitación de tipo vencida, 1 médico vencido, 1 habilitación especial por vencer).");
}

module.exports = { seed };
