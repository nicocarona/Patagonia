#!/usr/bin/env node
// ============================================================================
// Script único para levantar TODO el sistema: los once módulos
// (autenticación, maestro, facturación, programación, tripulación/fatiga,
// SMS, mantenimiento, inventario, despacho de vuelo, entrenamiento y
// vigencias, combustible) y, opcionalmente, la sincronización entre ellos
// cada cierto intervalo.
//
// Nota: fleet-dispatch-module (despacho) solo participa de
// fleet-integration/sync.js en el flujo 6 (hacia Combustible) — en todo
// lo demás sigue siendo independiente (ver README del módulo).
//
// Funciona en Windows, macOS y Linux por igual porque usa Node puro
// (child_process), sin depender de sintaxis de bash/cmd para variables de
// entorno ni "&&".
//
// Uso:
//   node start-all.js                    Levanta los 7 módulos (SQLite local)
//   node start-all.js --sync             Además corre los 3 flujos de sincronización cada 30s
//   node start-all.js --sync-interval=10 Sincroniza cada 10s en vez de 30
//   node start-all.js --no-seed          No precarga datos de ejemplo
//
// Variables de entorno opcionales (si tus carpetas no son hermanas de esta):
//   AUTH_DIR=/ruta/a/fleet-auth-module
//   CORE_DIR=/ruta/a/fleet-core-module
//   BILLING_DIR=/ruta/a/fleet-billing-module
//   SCHEDULING_DIR=/ruta/a/fleet-scheduling-module
//   CREW_DIR=/ruta/a/fleet-crew-module
//   SMS_DIR=/ruta/a/fleet-sms-module
//   MAINTENANCE_DIR=/ruta/a/fleet-maintenance-module
//   INVENTORY_DIR=/ruta/a/fleet-inventory-module
//   INTEGRATION_DIR=/ruta/a/fleet-integration
//   AUTH_PORT=3007  CORE_PORT=3006  BILLING_PORT=3001  SCHEDULING_PORT=3002
//   CREW_PORT=3003  SMS_PORT=3004   MAINTENANCE_PORT=3005  INVENTORY_PORT=3008
//
// AUTENTICACIÓN: todos los módulos deben compartir el mismo AUTH_SECRET
// para que un token emitido por fleet-auth-module se verifique en los
// demás. Si no defines AUTH_SECRET, este script genera uno aleatorio al
// arrancar (válido solo mientras estos procesos sigan corriendo — al
// reiniciar, todos los tokens emitidos antes dejan de servir, lo cual es
// aceptable en desarrollo local pero NO en producción: ahí define
// AUTH_SECRET explícitamente y consérvalo estable entre despliegues).
//
// Para PostgreSQL: exporta DATABASE_URL_<MODULO> (AUTH, CORE, BILLING,
// SCHEDULING, CREW, SMS, MAINTENANCE) antes de correr este script y el
// script las pasa a cada servidor. Pueden apuntar a la misma base con
// esquemas separados o a bases distintas.
// ============================================================================

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const optionValue = (name, fallback) => {
  const found = args.find((a) => a.startsWith(`${name}=`));
  return found ? found.split("=")[1] : fallback;
};

const MODULES = [
  { key: "AUTH", label: "autenticacion", dirName: "fleet-auth-module", defaultPort: "3007", color: "90" /* gris */ },
  { key: "CORE", label: "maestro", dirName: "fleet-core-module", defaultPort: "3006", color: "32" /* verde */ },
  { key: "BILLING", label: "facturacion", dirName: "fleet-billing-module", defaultPort: "3001", color: "36" /* cian */ },
  { key: "SCHEDULING", label: "programacion", dirName: "fleet-scheduling-module", defaultPort: "3002", color: "35" /* magenta */ },
  { key: "CREW", label: "tripulacion", dirName: "fleet-crew-module", defaultPort: "3003", color: "34" /* azul */ },
  { key: "SMS", label: "sms", dirName: "fleet-sms-module", defaultPort: "3004", color: "31" /* rojo */ },
  { key: "MAINTENANCE", label: "mantenimiento", dirName: "fleet-maintenance-module", defaultPort: "3005", color: "33" /* amarillo */ },
  { key: "INVENTORY", label: "inventario", dirName: "fleet-inventory-module", defaultPort: "3008", color: "96" /* cian claro */ },
  { key: "DISPATCH", label: "despacho", dirName: "fleet-dispatch-module", defaultPort: "3009", color: "95" /* magenta claro */ },
  { key: "TRAINING", label: "entrenamiento", dirName: "fleet-training-module", defaultPort: "3010", color: "92" /* verde claro */ },
  { key: "FUEL", label: "combustible", dirName: "fleet-fuel-module", defaultPort: "3011", color: "93" /* amarillo claro */ },
];

for (const m of MODULES) {
  m.dir = process.env[`${m.key}_DIR`] || path.join(__dirname, "..", m.dirName);
  m.port = process.env[`${m.key}_PORT`] || m.defaultPort;
}

const INTEGRATION_DIR = process.env.INTEGRATION_DIR || path.join(__dirname, "..", "fleet-integration");
const DO_SYNC = flag("--sync");
const SYNC_INTERVAL_SEC = Number(optionValue("--sync-interval", "30"));
const SEED = flag("--no-seed") ? "0" : "1";

let AUTH_SECRET = process.env.AUTH_SECRET;
if (!AUTH_SECRET) {
  AUTH_SECRET = crypto.randomBytes(24).toString("hex");
  console.log("⚠ AUTH_SECRET no estaba definido — se generó uno aleatorio para esta corrida.");
  console.log("  Los tokens emitidos ahora dejarán de servir si reinicias este script. Para producción,");
  console.log("  define AUTH_SECRET explícitamente y mantenlo estable entre despliegues.\n");
}

function checkFile(dir, relativeFile, label) {
  if (!fs.existsSync(path.join(dir, relativeFile))) {
    console.error(`✘ No se encontró ${label} en: ${dir}`);
    console.error(`  Ajusta la variable de entorno correspondiente (p.ej. ${label.toUpperCase()}_DIR) o coloca las carpetas como hermanas de fleet-system/.`);
    process.exit(1);
  }
}
for (const m of MODULES) checkFile(m.dir, path.join("src", "server.js"), m.dirName);

const children = [];

function launch(label, cwd, scriptPath, env, color) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);

  const prefix = `\x1b[${color}m[${label}]\x1b[0m`;
  const pipeLines = (stream) => {
    stream.on("data", (chunk) => {
      chunk
        .toString()
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .forEach((line) => console.log(`${prefix} ${line}`));
    });
  };
  pipeLines(child.stdout);
  pipeLines(child.stderr);

  child.on("exit", (code) => {
    console.log(`${prefix} proceso terminado (código ${code}).`);
  });

  return child;
}

console.log("Levantando el sistema de control de flota (11 módulos)...\n");

for (const m of MODULES) {
  const dbUrlEnvName = `DATABASE_URL_${m.key}`;
  launch(
    m.label,
    m.dir,
    path.join(m.dir, "src", "server.js"),
    { PORT: m.port, SEED, AUTH_SECRET, ...(process.env[dbUrlEnvName] ? { DATABASE_URL: process.env[dbUrlEnvName] } : {}) },
    m.color
  );
}

setTimeout(() => {
  console.log("\nListo:");
  for (const m of MODULES) console.log(`  ${m.label.padEnd(14)} http://localhost:${m.port}`);
  console.log("\nPresiona Ctrl+C para detener todos los servidores.\n");

  if (DO_SYNC) {
    checkFile(INTEGRATION_DIR, "sync.js", "fleet-integration");
    const syncScript = path.join(INTEGRATION_DIR, "sync.js");
    console.log(`Sincronización automática activada (maestro, aeronavegabilidad, inventario, habilitaciones, facturación, combustible, fatiga): cada ${SYNC_INTERVAL_SEC}s.\n`);

    const byLabel = Object.fromEntries(MODULES.map((m) => [m.label, m]));
    const runSync = () => {
      const syncChild = spawn(process.execPath, [syncScript], {
        cwd: INTEGRATION_DIR,
        env: {
          ...process.env,
          AUTH_URL: `http://localhost:${byLabel.autenticacion.port}`,
          CORE_URL: `http://localhost:${byLabel.maestro.port}`,
          BILLING_URL: `http://localhost:${byLabel.facturacion.port}`,
          SCHEDULING_URL: `http://localhost:${byLabel.programacion.port}`,
          CREW_URL: `http://localhost:${byLabel.tripulacion.port}`,
          MAINTENANCE_URL: `http://localhost:${byLabel.mantenimiento.port}`,
          INVENTORY_URL: `http://localhost:${byLabel.inventario.port}`,
          TRAINING_URL: `http://localhost:${byLabel.entrenamiento.port}`,
          DISPATCH_URL: `http://localhost:${byLabel.despacho.port}`,
          FUEL_URL: `http://localhost:${byLabel.combustible.port}`,
          SMS_URL: `http://localhost:${byLabel.sms.port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const prefix = "\x1b[90m[sync]\x1b[0m";
      syncChild.stdout.on("data", (c) => c.toString().split("\n").filter(Boolean).forEach((l) => console.log(`${prefix} ${l}`)));
      syncChild.stderr.on("data", (c) => c.toString().split("\n").filter(Boolean).forEach((l) => console.log(`${prefix} ${l}`)));
    };

    runSync();
    setInterval(runSync, SYNC_INTERVAL_SEC * 1000);
  } else {
    console.log(`Sincronización manual: cd ${path.relative(process.cwd(), INTEGRATION_DIR) || "fleet-integration"} && node sync.js`);
    console.log("(o vuelve a correr este script con --sync para que se haga sola)\n");
  }
}, 1500);

function shutdown() {
  console.log("\nDeteniendo servidores...");
  for (const child of children) child.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
