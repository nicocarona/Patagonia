// ============================================================================
// Usuarios de ejemplo, uno por rol. TODOS con la misma contraseña de
// demostración ("changeme123") — es intencional para que el README pueda
// mostrar un solo comando de login por rol, pero es exactamente el tipo de
// credencial que se debe rotar antes de usar esto con datos reales. Ver
// "Qué falta para producción" en el README.
// ============================================================================

const { createUser } = require("./authEngine");

const DEMO_PASSWORD = "changeme123";

async function seed(db) {
  const users = [
    { username: "admin", role: "admin", fullName: "Administrador del sistema" },
    { username: "ana.reyes", role: "ops", fullName: "Ana Reyes — Programación" },
    { username: "jorge.villalobos", role: "maintenance", fullName: "Jorge Villalobos — Mantenimiento" },
    { username: "marta.solis", role: "safety", fullName: "Marta Solís — SMS" },
    { username: "finanzas", role: "finance", fullName: "Equipo de Facturación" },
    { username: "carla.nunez", role: "crew", fullName: "Carla Núñez — Tripulación" },
    { username: "fleet-integration", role: "integration", fullName: "Cuenta de servicio — fleet-integration/sync.js" },
    { username: "auditor", role: "readonly", fullName: "Auditor externo (solo lectura)" },
  ];

  const created = {};
  for (const u of users) {
    const result = await createUser(db, { username: u.username, password: DEMO_PASSWORD, role: u.role, fullName: u.fullName });
    created[u.username] = result;
  }
  return created;
}

module.exports = { seed, DEMO_PASSWORD };
