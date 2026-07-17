// ============================================================================
// Motor de autenticación: hash de contraseñas (scrypt, node:crypto — sin
// dependencias externas como bcrypt) y login.
// ============================================================================

const crypto = require("crypto");
const { get, run } = require("./db");
const { sign } = require("./auth");

function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt: salt.toString("hex") };
}

function verifyPassword(password, saltHex, expectedHashHex) {
  const { hash } = hashPassword(password, saltHex);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHashHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function createUser(db, { username, password, role, fullName }) {
  if (!username || !password || !role) throw new Error("Faltan campos requeridos: username, password, role");
  const existing = await get(db, "SELECT id FROM users WHERE username = ?", [username]);
  if (existing) throw new Error(`Ya existe un usuario con username '${username}'.`);
  const { hash, salt } = hashPassword(password);
  const result = await run(
    db,
    "INSERT INTO users (username, password_hash, password_salt, role, full_name) VALUES (?, ?, ?, ?, ?)",
    [username, hash, salt, role, fullName ?? null]
  );
  return get(db, "SELECT id, username, role, full_name, active, created_at FROM users WHERE id = ?", [result.lastInsertRowid]);
}

async function login(db, { username, password }) {
  if (!username || !password) throw new Error("Faltan campos requeridos: username, password");
  const user = await get(db, "SELECT * FROM users WHERE username = ?", [username]);
  if (!user || Number(user.active) !== 1) throw new Error("Usuario o contraseña incorrectos.");
  const ok = verifyPassword(password, user.password_salt, user.password_hash);
  if (!ok) throw new Error("Usuario o contraseña incorrectos.");
  const token = sign({ sub: user.username, role: user.role });
  return { token, username: user.username, role: user.role, fullName: user.full_name };
}

module.exports = { hashPassword, verifyPassword, createUser, login };
