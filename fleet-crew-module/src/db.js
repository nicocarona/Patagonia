// Capa de acceso a datos — modo dual SQLite / PostgreSQL.
// Ver la explicación completa en fleet-billing-module/src/db.js (mismo
// patrón, aplicado aquí al módulo de Tripulación y Fatiga).

const fs = require("fs");
const path = require("path");

const USE_POSTGRES = !!process.env.DATABASE_URL;

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
      throw new Error("DATABASE_URL está definido pero el paquete 'pg' no está instalado. Corre: npm install pg");
    }
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
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
    if (isInsert && !/RETURNING/i.test(finalSql)) finalSql += " RETURNING id";
    const res = await conn.pool.query(finalSql, params);
    return { lastInsertRowid: res.rows[0]?.id ?? null, changes: res.rowCount };
  }
  const info = conn.db.prepare(sql).run(...params);
  return { lastInsertRowid: Number(info.lastInsertRowid), changes: info.changes };
}

module.exports = { openDatabase, all, get, run, USE_POSTGRES };
