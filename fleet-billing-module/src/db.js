// ============================================================================
// Capa de acceso a datos — modo dual SQLite / PostgreSQL
//
// Si la variable de entorno DATABASE_URL está definida, usa PostgreSQL
// (driver `pg`, requiere `npm install pg` — no incluido por defecto porque
// este proyecto se entrega sin dependencias externas). Si no está definida,
// usa `node:sqlite` (nativo de Node 22+, cero instalación) — ideal para
// correr el prototipo localmente o para demos.
//
// El resto del sistema (billingEngine.js, server.js, seed.js) llama
// SIEMPRE a las mismas 4 funciones (openDatabase, all, get, run) sin saber
// cuál motor está detrás — toda la conversión vive aquí.
//
// IMPORTANTE — no probado contra un servidor Postgres real: este código se
// escribió para el entorno de producción del usuario. En el entorno donde
// se generó este prototipo no había acceso a internet ni permisos para
// instalar el driver `pg` o levantar un servidor Postgres, así que la ruta
// SQLite es la que se validó de punta a punta; la ruta Postgres sigue el
// patrón estándar del driver `pg` pero se recomienda probarla en tu propio
// entorno antes de usarla en producción.
// ============================================================================

const fs = require("fs");
const path = require("path");

const USE_POSTGRES = !!process.env.DATABASE_URL;

/**
 * Convierte placeholders estilo SQLite ("?") a placeholders estilo
 * PostgreSQL ("$1", "$2", ...). Nuestras consultas no usan "?" dentro de
 * literales de texto, así que un reemplazo posicional simple es seguro.
 */
function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function openDatabase(fileOrUnused) {
  if (USE_POSTGRES) {
    let Pool;
    try {
      ({ Pool } = require("pg"));
    } catch (err) {
      throw new Error(
        "DATABASE_URL está definido pero el paquete 'pg' no está instalado. Corre: npm install pg"
      );
    }
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // La mayoría de los proveedores administrados (Render, Railway, RDS)
      // requieren SSL y usan certificados que Node no valida por defecto.
      // Desactiva esto (PGSSL_STRICT=1) solo si tu proveedor exige
      // validación estricta del certificado.
      ssl: process.env.PGSSL_STRICT === "1" ? true : { rejectUnauthorized: false },
    });
    const schema = fs.readFileSync(path.join(__dirname, "..", "schema.postgres.sql"), "utf8");
    await pool.query(schema);
    return { engine: "postgres", pool };
  }

  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(fileOrUnused || ":memory:");
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  db.exec(schema);
  return { engine: "sqlite", db };
}

async function all(conn, sql, params = []) {
  if (conn.engine === "postgres") {
    const res = await conn.pool.query(toPgPlaceholders(sql), params);
    return res.rows;
  }
  return conn.db.prepare(sql).all(...params);
}

async function get(conn, sql, params = []) {
  if (conn.engine === "postgres") {
    const res = await conn.pool.query(toPgPlaceholders(sql), params);
    return res.rows[0];
  }
  return conn.db.prepare(sql).get(...params);
}

async function run(conn, sql, params = []) {
  if (conn.engine === "postgres") {
    let finalSql = toPgPlaceholders(sql);
    const isInsert = /^\s*INSERT/i.test(sql);
    // Emula lastInsertRowid (que sí devuelve node:sqlite) pidiéndole a
    // Postgres que regrese el id insertado.
    if (isInsert && !/RETURNING/i.test(finalSql)) finalSql += " RETURNING id";
    const res = await conn.pool.query(finalSql, params);
    return { lastInsertRowid: res.rows[0]?.id ?? null, changes: res.rowCount };
  }
  const info = conn.db.prepare(sql).run(...params);
  return { lastInsertRowid: Number(info.lastInsertRowid), changes: info.changes };
}

module.exports = { openDatabase, all, get, run, USE_POSTGRES };
