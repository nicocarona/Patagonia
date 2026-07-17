# fleet-auth-module — Autenticación y roles

Séptimo módulo del sistema, agregado para cerrar la brecha de producción
más señalada en todos los README anteriores: "cualquiera con la URL puede
leer y escribir datos". A partir de este módulo, los otros seis exigen un
token válido en cada request, y ciertas operaciones exigen un rol
específico.

## Uso rápido

```bash
SEED=1 node src/server.js     # API en http://localhost:3007 con 8 usuarios de ejemplo
```

## Cómo funciona

`POST /login` recibe `username`/`password` y devuelve un token (JWT HS256,
firmado con `node:crypto`, sin librería externa — ver `src/auth.js` para
por qué se implementó a mano). Ese token se manda en cada request a
cualquiera de los otros seis módulos como header
`Authorization: Bearer <token>`. Todos los módulos comparten la misma
variable de entorno `AUTH_SECRET`: es lo que permite que un token emitido
aquí se verifique correctamente en, por ejemplo, `fleet-billing-module`,
sin que ese módulo tenga que llamar de vuelta a este servicio en cada
request (verificación de firma local, sin ida y vuelta de red).

## Roles y qué puede hacer cada uno

| Rol | Puede |
|---|---|
| `admin` | Todo, en los 7 módulos |
| `ops` | Crear/editar/cancelar reservas y calificaciones en Programación |
| `maintenance` | Registrar vuelos, componentes, abrir/cerrar órdenes de trabajo |
| `safety` | Reportar ocurrencias, gestionar peligros, aprobar FRAT de alto riesgo |
| `finance` | Generar facturas, registrar vuelos facturables manuales |
| `crew` | Editar habilitaciones, períodos de servicio, licencias |
| `integration` | Cuenta de servicio de `fleet-integration/sync.js` — puede escribir en el maestro y en los espejos de identidad/aeronavegabilidad de cada módulo |
| `readonly` | Solo lectura en todos los módulos (para auditoría externa) |

## Usuarios de ejemplo (SEED=1)

Los 8 usuarios listados abajo, todos con la contraseña `changeme123`.
**Esto es solo para el prototipo** — antes de usar el sistema con datos
reales, crea usuarios nuevos (`POST /users`, requiere rol `admin`) con
contraseñas propias y desactiva o elimina estos.

| Usuario | Rol |
|---|---|
| `admin` | admin |
| `ana.reyes` | ops |
| `jorge.villalobos` | maintenance |
| `marta.solis` | safety |
| `finanzas` | finance |
| `carla.nunez` | crew |
| `fleet-integration` | integration |
| `auditor` | readonly |

## Ejemplo de uso end-to-end

```bash
TOKEN=$(curl -s -X POST http://localhost:3007/login -H "Content-Type: application/json" \
  -d '{"username":"ana.reyes","password":"changeme123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -s http://localhost:3002/bookings -H "Authorization: Bearer $TOKEN"
```

## Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/health` | pública | Healthcheck |
| POST | `/login` | pública | Devuelve `{ token, username, role, fullName }` |
| GET | `/users` | rol `admin` | Listar usuarios (sin hash de contraseña) |
| POST | `/users` | rol `admin` | Crear usuario nuevo |

## Qué falta para producción

- **El JWT es implementación propia, no una librería auditada.** Cubre lo
  esencial (firma HS256, expiración, verificación de tiempo constante para
  evitar timing attacks) pero no tiene revocación de tokens antes de que
  expiren, ni rotación de `AUTH_SECRET` sin invalidar todas las sesiones
  activas. Para producción real, considera migrar a una librería madura
  (`jsonwebtoken`, `jose`) o a un proveedor de identidad externo (Auth0,
  Clerk, Cognito).
- **Sin límite de intentos de login (rate limiting)** — un atacante puede
  probar contraseñas sin restricción.
- **Sin refresh tokens** — el usuario tiene que volver a hacer login cada
  8 horas (duración del token). Aceptable para un turno de trabajo, no
  ideal para una sesión de varios días.
- **Sin recuperación de contraseña** ni políticas de complejidad de
  contraseña.
- **Sin auditoría de quién hizo qué** — los otros módulos no registran
  todavía qué usuario ejecutó cada acción (el token identifica al usuario
  en cada request, pero ningún módulo lo persiste junto al registro que
  crea/modifica).
