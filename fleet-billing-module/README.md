# Módulo de Facturación — Sistema de Control de Flota de Helicópteros

Prototipo funcional del módulo de facturación descrito en la especificación
de funcionalidades (sección 4 — "Módulo: Facturación"). Genera facturas
itemizadas a partir de vuelos registrados, aplicando reglas de tarifa de
vuelo, posicionamiento, standby, mínimo diario, recargo de combustible y
retainer mensual (contratos tipo HEMS).

## Requisitos

- Node.js **22 o superior** (usa el módulo nativo `node:sqlite`, sin
  dependencias externas — no se requiere `npm install`).

## Autenticación

Desde `fleet-auth-module` (agregado en la auditoría de julio 2026), toda
ruta salvo `GET /health` exige `Authorization: Bearer <token>` — consíguelo
con `POST /login` contra `fleet-auth-module` (puerto 3007 por defecto).
`GET /aircraft`, `/customers`, `/contracts`, `/flights`, `/invoices` solo
piden un token válido (cualquier rol); crear vuelos/facturas exige rol
`admin`, `finance` o (para el flujo de sincronización) `integration`. Ver
`fleet-auth-module/README.md` para los usuarios de demostración.

## Por qué SQLite y no PostgreSQL

Se pidió Node.js + PostgreSQL, pero el entorno donde se construyó este
prototipo no tiene acceso a internet ni permisos de administrador para
instalar un servidor de PostgreSQL o el driver `pg`. Para entregar un
prototipo que corra de inmediato, se usó `node:sqlite` (incluido en Node 22+,
sin instalación). El esquema (`schema.sql`) está escrito en SQL portable y
`src/db.js` es la única pieza que conoce el motor de base de datos — el
motor de negocio (`billingEngine.js`) no depende de SQLite en absoluto.

**Para migrar a PostgreSQL en tu propia máquina** (con `npm install pg`):
reemplaza `src/db.js` por una versión que use `pg.Pool` en vez de
`DatabaseSync`, y ajusta `schema.sql` según las notas de portabilidad al
final de ese archivo (básicamente: `SERIAL` en vez de `AUTOINCREMENT`). El
resto del código no cambia.

## Estructura

```
fleet-billing-module/
├── schema.sql              Esquema de base de datos + notas de portabilidad a Postgres
├── src/
│   ├── db.js                Capa de acceso a datos (única pieza ligada a SQLite)
│   ├── billingEngine.js     Motor de reglas de facturación (sin dependencias de BD)
│   ├── seed.js               Datos de ejemplo (2 clientes, 2 aeronaves, 7 vuelos)
│   ├── cli-demo.js          Demo de consola: genera y muestra 2 facturas
│   └── server.js             API HTTP (node:http, sin Express)
└── package.json
```

## Uso rápido

```bash
# Demo de consola — siembra datos de ejemplo y muestra 2 facturas formateadas
node src/cli-demo.js

# Levantar la API con datos de ejemplo precargados
SEED=1 node src/server.js
# -> Módulo de facturación escuchando en http://localhost:3000
```

## Endpoints de la API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/aircraft` | Lista de aeronaves |
| GET | `/customers` | Lista de clientes |
| GET | `/contracts?customerId=` | Contratos (filtrable por cliente) |
| GET | `/flights?customerId=&invoiced=0` | Vuelos registrados |
| POST | `/flights` | Registrar un vuelo facturable |
| POST | `/invoices/generate` | Generar factura de un período |
| GET | `/invoices?customerId=` | Listar facturas |
| GET | `/invoices/:id` | Factura con todos sus renglones |

### Ejemplo — generar una factura

```bash
curl -X POST http://localhost:3000/invoices/generate \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "contractId": 1,
    "periodStart": "2026-07-01",
    "periodEnd": "2026-07-31"
  }'
```

### Ejemplo — registrar un vuelo

```bash
curl -X POST http://localhost:3000/flights \
  -H "Content-Type: application/json" \
  -d '{
    "aircraft_id": 1,
    "customer_id": 1,
    "contract_id": 1,
    "flight_date": "2026-08-05",
    "mission_type": "Transporte de personal",
    "flight_hours": 2.3,
    "positioning_hours": 0.5,
    "landing_count": 2
  }'
```

## Reglas de facturación implementadas

1. **Tiempo de vuelo**: horas Hobbs/tach × tarifa (la tarifa del contrato
   sobrescribe la tarifa por defecto de la aeronave, si está definida).
2. **Posicionamiento**: tramo de traslado hacia/desde el cliente, tarifa
   independiente.
3. **Standby**: espera en tierra de aeronave y tripulación.
4. **Tarifas de aterrizaje**: monto fijo por aterrizaje, multiplicado por
   el número de aterrizajes del vuelo.
5. **Mínimo diario**: si las horas facturables del día no alcanzan el
   mínimo contractual, se agrega un renglón de ajuste por la diferencia.
6. **Recargo de combustible**: porcentaje sobre (vuelo + posicionamiento).
7. **Retainer mensual (HEMS)**: tarifa fija mensual que incluye N horas de
   vuelo. Si el uso real es menor o igual al incluido, se acredita el 100%
   del tiempo de vuelo (el cliente solo paga el retainer). Si excede el
   incluido, se acredita la porción cubierta y el resto se cobra a la
   tarifa de excedente (`overage_rate_cents`).

Todas las reglas están implementadas en `src/billingEngine.js`, con
comentarios en español explicando cada paso. Los montos se manejan en
**centavos** (enteros) para evitar errores de redondeo de punto flotante.

## Modo PostgreSQL (acceso multi-región / en vivo)

El módulo ahora soporta PostgreSQL sin cambiar el motor de negocio: si la
variable de entorno `DATABASE_URL` está definida, `src/db.js` usa el driver
`pg`; si no, sigue usando SQLite local (como hasta ahora).

```bash
npm install pg   # solo necesario para el modo Postgres

DATABASE_URL=postgres://usuario:password@host:5432/nombre_db \
SEED=1 \
node src/server.js
```

Al arrancar, el servidor aplica automáticamente `schema.postgres.sql` (no
hace falta correr migraciones a mano). El log de arranque indica qué motor
quedó activo: `Motor de base de datos: postgres` o `sqlite`.

**Importante — no se pudo probar el camino Postgres en el entorno donde se
generó este prototipo** (sin acceso a internet ni permisos para instalar
`pg` o levantar un servidor Postgres). El código sigue el patrón estándar
del driver `pg` y la ruta SQLite se validó de punta a punta tras el
refactor (mismos resultados que antes), pero antes de usar el modo Postgres
en producción, pruébalo en tu propio entorno.

### Para que usuarios de distintas ciudades se conecten en vivo

La base de datos Postgres nunca debe quedar expuesta directamente a
internet. El flujo correcto es:

1. Aloja Postgres en un proveedor administrado (Render, Railway, AWS RDS,
   DigitalOcean) — te da una `DATABASE_URL` con SSL.
2. Aloja esta API (este mismo `server.js`) en un servicio que corra 24/7
   (Render, Railway, Fly.io) con `DATABASE_URL` como variable de entorno.
3. Los usuarios remotos hablan con la URL pública de la API (por HTTPS),
   nunca directo con la base de datos.
4. Antes de exponerlo así, agrega autenticación (hoy no la hay — cualquiera
   con la URL puede leer/escribir).

## Qué falta para producción

Este es un prototipo funcional del motor de reglas, no un sistema listo
para producción. Antes de usarlo con clientes reales habría que agregar:

- Autenticación y autorización (JWT/OAuth) en la API.
- Migración a PostgreSQL (ver sección anterior) con backups y réplicas.
- Validación de entrada más estricta (hoy se valida solo la presencia de
  campos requeridos, no sus tipos/rangos).
- Generación de PDF de la factura (se puede usar `pdf-lib` o `pptxgenjs`-like
  para maquetar el documento a partir del JSON que ya devuelve la API).
- Integración con el motor de reglas de mantenimiento/operaciones para que
  los vuelos se registren automáticamente al cerrar cada misión, en vez de
  capturarse manualmente vía `POST /flights`.
- Integración con un proveedor de contabilidad (API de QuickBooks Online,
  Sage Intacct, o el sistema contable local que use la empresa).
- Manejo de moneda multi-divisa si se factura en USD y moneda local.
- Estados de factura completos (draft → issued → paid → void) con flujo de
  aprobación y registro de pagos parciales.
