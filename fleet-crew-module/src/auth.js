// ============================================================================
// auth.js — verificación/emisión de tokens (JWT mínimo, HS256, node:crypto)
//
// Este archivo es idéntico (copia deliberada, no un paquete compartido) en
// los siete módulos: fleet-auth-module lo usa para FIRMAR tokens al hacer
// login; los otros seis lo usan solo para VERIFICAR el token que llega en
// cada request. No hay dependencia externa (no se pudo instalar
// jsonwebtoken por la restricción de red del sandbox — ver README de
// fleet-auth-module) — es un JWT HS256 hecho a mano sobre node:crypto,
// suficiente para el prototipo pero MENOS auditado que una librería
// madura. Ver "Qué falta para producción" en el README para el detalle.
//
// Todos los módulos deben compartir el mismo AUTH_SECRET (variable de
// entorno) — es la única forma en que un token emitido por
// fleet-auth-module pueda verificarse en, por ejemplo, fleet-billing-module.
// ============================================================================

const crypto = require("crypto");

const SECRET = process.env.AUTH_SECRET || "dev-secret-CAMBIAR-en-produccion";
if (SECRET === "dev-secret-CAMBIAR-en-produccion" && process.env.NODE_ENV === "production") {
  console.warn("⚠ AUTH_SECRET no está definido — usando el secreto de desarrollo. NO uses esto en producción.");
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64").toString("utf8");
}
function hmac(data) {
  return base64url(crypto.createHmac("sha256", SECRET).update(data).digest());
}

/**
 * Firma un token para el `payload` dado (típicamente { sub: username, role }).
 * Expira en `expiresInSeconds` (8 horas por defecto — turno típico).
 */
function sign(payload, expiresInSeconds = 8 * 3600) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };
  const headerPart = base64url(JSON.stringify(header));
  const payloadPart = base64url(JSON.stringify(fullPayload));
  const signature = hmac(`${headerPart}.${payloadPart}`);
  return `${headerPart}.${payloadPart}.${signature}`;
}

/**
 * Verifica firma + expiración. Lanza si el token es inválido o expiró.
 */
function verify(token) {
  if (!token) throw new Error("Falta el token de autenticación.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token con formato inválido.");
  const [headerPart, payloadPart, signature] = parts;
  const expected = hmac(`${headerPart}.${payloadPart}`);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  const valid = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  if (!valid) throw new Error("Firma del token inválida.");
  const payload = JSON.parse(base64urlDecode(payloadPart));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) throw new Error("El token expiró — vuelve a iniciar sesión.");
  return payload;
}

/**
 * Extrae y verifica el token del header Authorization: Bearer <token> de
 * un request de node:http, y opcionalmente exige que el rol del token esté
 * en `allowedRoles`. El rol 'admin' siempre pasa, sin importar la lista.
 * Lanza un Error con `.statusCode` (401 sin token/token inválido, 403 rol
 * insuficiente) que el dispatcher de cada server.js debe capturar.
 */
function requireAuth(req, allowedRoles) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  let payload;
  try {
    payload = verify(token);
  } catch (err) {
    const wrapped = new Error(err.message);
    wrapped.statusCode = 401;
    throw wrapped;
  }
  if (allowedRoles && allowedRoles.length > 0 && payload.role !== "admin" && !allowedRoles.includes(payload.role)) {
    const err = new Error(`Rol '${payload.role}' no autorizado para esta operación — se requiere uno de: ${allowedRoles.join(", ")}.`);
    err.statusCode = 403;
    throw err;
  }
  return payload;
}

module.exports = { sign, verify, requireAuth };
