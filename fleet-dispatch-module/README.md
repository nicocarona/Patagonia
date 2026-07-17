# fleet-dispatch-module

Despacho de vuelo (flight release / OFP — operational flight plan) para el
sistema de control de flota de helicópteros. Es el 9º módulo, y cubre el
punto 3 de la hoja de ruta (`AUDITORIA_Y_HOJA_DE_RUTA.docx`, sección 6):
hasta ahora, `fleet-scheduling-module` reservaba un bloque de horario, pero
nada generaba el plan de vuelo operacional (peso y balance, combustible,
alterno) que un despachador debe aprobar antes del despegue.

## Qué hace

Un despacho (`flight_releases`) nace en estado `draft` con dos anexos
obligatorios: **peso y balance** (`weight_balance`) y **plan de
combustible** (`fuel_plans`). El sistema calcula automáticamente:

- **Peso total** = peso vacío + tripulación + pasajeros + carga + combustible,
  comparado contra el peso máximo de despegue (MTOW) de la aeronave.
- **Combustible requerido** = viaje + alterno + reserva + contingencia,
  comparado contra el combustible cargado a bordo.

**El vuelo NO se puede liberar (`POST /dispatch/:id/release`) si cualquiera
de los dos cálculos falla.** El endpoint devuelve 409 con el motivo exacto
(cuántos kg de exceso o de déficit). Mismo patrón "bloquear antes, no
descubrir después" usado en mantenimiento (componentes vencidos),
inventario (stock negativo) y SMS (FRAT sin aprobar).

Un despacho `draft` se puede corregir con `POST /dispatch/:id/recompute`
(por ejemplo, bajar carga o cargar más combustible) y reintentar la
liberación. Ciclo de vida completo: `draft` → `released` → `departed` →
`closed` (o `cancelled` en cualquier punto antes de `departed`).

## Importante — sobre la reserva de combustible

Este prototipo **no incluye una tabla regulatoria de reservas mínimas de
combustible** (p. ej. los conocidos "30/45 minutos" de reserva VFR/IFR que
manejan distintas autoridades). El campo `reserveFuelKg` es obligatorio
pero su valor lo define quien despacha, según el manual de operaciones
aprobado de cada empresa — igual que se documentó para los umbrales de
FRAT en `fleet-sms-module` y los límites de descanso en
`fleet-crew-module`. No tomar los valores de `src/seed.js` como cifras
oficiales: son solo datos de ejemplo para la demo.

## Enlace con Programación y Combustible

`source_booking_id` es un campo opcional (entero, sin FK real entre bases
de datos) que puede apuntar a una reserva de `fleet-scheduling-module` —
mismo patrón de enlace por clave de negocio que usa `fleet-billing-module`
con sus reservas. Con Programación, el módulo sigue siendo independiente:
no hay sincronización ni modificación del esquema de Programación. Se
puede sumar en una siguiente iteración si se necesita, por ejemplo, que
Programación bloquee una reserva cuyo despacho fue cancelado, o que el
despacho se autocomplete con los datos de la reserva.

Con `fleet-fuel-module` SÍ hay sincronización: el **flujo 6** de
`fleet-integration/sync.js` (`syncFuelFromDispatch`) toma cada despacho
`closed` no sincronizado (`GET /dispatch/pending-fuel-sync`), convierte su
`trip_fuel_kg` a litros (densidad de referencia 0.8 kg/L, aproximación —
ver el propio `sync.js` para el detalle) y lo registra como un uplift real
en Combustible, marcando el despacho como sincronizado
(`POST /dispatch/:id/mark-fuel-synced`) para no reprocesarlo. Es una
aproximación: usa el combustible de viaje PLANEADO como consumo real,
porque este módulo no captura el remanente real de combustible al
aterrizar.

## Uso

```bash
node src/cli-demo.js       # demo de consola: 3 despachos, 2 bloqueados, corrección y reintento
SEED=1 npm start           # servidor HTTP en :3009 con datos de ejemplo
```

## Endpoints

Todos (salvo `GET /health`) requieren `Authorization: Bearer <token>`
emitido por `fleet-auth-module`. Roles: `admin` u `ops` para todo lo que
escribe (reutiliza el rol `ops` existente — no se creó un rol `dispatcher`
nuevo, ya que las funciones de despacho ya estaban cubiertas por `ops` en
el resto del sistema). Lectura (`GET`) abierta a cualquier rol autenticado.

| Método | Ruta | Roles | Qué hace |
|---|---|---|---|
| GET | `/health` | público | estado del servicio |
| GET | `/dispatch?date=YYYY-MM-DD` | cualquiera | tablero de despachos (todos o filtrados por fecha) |
| GET | `/dispatch/:id` | cualquiera | detalle de un despacho con peso/balance y combustible |
| POST | `/dispatch` | admin, ops | crea un despacho `draft` con peso/balance y plan de combustible |
| POST | `/dispatch/:id/recompute` | admin, ops | recalcula peso/balance y/o combustible de un `draft` |
| POST | `/dispatch/:id/release` | admin, ops | libera el vuelo — **bloquea si hay sobrepeso o combustible insuficiente** |
| POST | `/dispatch/:id/depart` | admin, ops | marca como despegado (requiere estar `released`) |
| POST | `/dispatch/:id/close` | admin, ops | cierra el despacho (requiere estar `departed`) |
| POST | `/dispatch/:id/cancel` | admin, ops | cancela (no permitido si ya `departed`/`closed`) |
| GET | `/dispatch/pending-fuel-sync` | cualquiera | despachos `closed` cuyo consumo aún no se registró en Combustible (usado por el flujo 6) |
| POST | `/dispatch/:id/mark-fuel-synced` | admin, integration | marca un despacho como ya sincronizado con Combustible |

### Ejemplo: crear y liberar un despacho

```bash
TOKEN=$(curl -s -X POST http://localhost:3007/login -H "Content-Type: application/json" \
  -d '{"username":"ana.reyes","password":"changeme123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -s -X POST http://localhost:3009/dispatch -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "tailNumber": "XA-HEL1", "picName": "Ana Reyes", "flightDate": "2026-07-25",
  "departureBase": "Base Norte", "destination": "Campo Minero Sur",
  "estimatedFlightTimeHours": 1.5,
  "weightBalance": { "emptyWeightKg": 2200, "crewWeightKg": 160, "passengerWeightKg": 320, "cargoWeightKg": 150, "fuelWeightKg": 400, "maxTakeoffWeightKg": 3400 },
  "fuelPlan": { "tripFuelKg": 220, "alternateFuelKg": 60, "reserveFuelKg": 80, "contingencyFuelKg": 20, "fuelOnBoardKg": 400 }
}'

curl -s -X POST http://localhost:3009/dispatch/1/release -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"dispatcherName":"Marta Solís"}'
```

## Modo dual SQLite / PostgreSQL

Igual que el resto de los módulos: sin `DATABASE_URL`, usa `node:sqlite`
en memoria o archivo (`SQLITE_FILE`); con `DATABASE_URL` definido, usa
PostgreSQL vía el paquete opcional `pg` (no probado localmente, mismo
patrón documentado en `fleet-billing-module/src/db.js`).

## Qué falta para producción

- No hay tabla real de límites de peso/combustible por modelo de aeronave
  (viene del manual de vuelo — hoy los ingresa quien despacha a mano).
- No calcula centro de gravedad (CG), solo peso total — un W&B real
  también valida que el CG quede dentro de la envolvente, no solo el peso.
- No hay integración con METAR/TAF ni NOTAM para condiciones meteorológicas
  o restricciones de espacio aéreo.
- No hay firma digital ni versión impresa/PDF del OFP para llevar a bordo.
- No hay enlace automático con Programación (ver sección arriba) ni con
  Mantenimiento (aunque Programación ya bloquea reservas en aeronaves no
  aeronavegables vía el sync existente, Despacho no vuelve a verificar ese
  estado al momento de liberar) ni con Entrenamiento (no verifica que el
  PIC tenga habilitación vigente para el modelo — eso hoy solo lo hace
  Programación al crear la reserva, vía el flujo 4).
- No hay historial de ediciones (`recompute` sobrescribe sin dejar rastro
  de quién cambió qué).
