# fleet-fuel-module

Gestión de combustible para el sistema de control de flota de
helicópteros. Es el 11º módulo, y cubre el punto de la hoja de ruta sobre
combustible (`AUDITORIA_Y_HOJA_DE_RUTA.docx`, sección 6).

## En qué se diferencia de `fleet-dispatch-module`

`fleet-dispatch-module` valida, **para un vuelo puntual**, que el
combustible a bordo (en kg, como parte del peso total) alcance para viaje
+ alterno + reserva + contingencia — es una verificación operacional
antes de despegar. Este módulo administra el combustible como **insumo
continuo del negocio**: con qué proveedores hay contrato y a qué precio,
cuánto combustible físico hay en el tanque de cada base, cuánto entra
(entregas) y cuánto sale (repostaje/"uplift" a cada aeronave), y a qué
costo — el tipo de control que un operador real lleva sobre su insumo más
caro después de la propia aeronave.

## Qué rastrea

- **Proveedores** (`fuel_suppliers`): contrato, precio por litro, base
  que atienden, vigencia.
- **Tanques por base** (`fuel_tanks`): capacidad, nivel actual, costo
  promedio ponderado por litro (weighted average cost — se recalcula con
  cada entrega, mismo método contable que cualquier sistema de
  inventario).
- **Entregas** (`fuel_deliveries`): proveedor → tanque. Sube el nivel y
  actualiza el costo promedio.
- **Uplifts** (`fuel_uplifts`): tanque → aeronave (repostaje). Baja el
  nivel, registra el costo al costo promedio vigente del tanque.

## El gate

`POST /uplifts` **rechaza** (409) un repostaje que exceda el combustible
disponible en el tanque de esa base — mismo patrón "bloquear antes, no
descubrir después" que el stock negativo en `fleet-inventory-module`. Una
entrega (`POST /deliveries`) que exceda la capacidad del tanque se
registra igual (ya ocurrió físicamente) pero devuelve un aviso
(`overCapacityWarning`).

## Enlace con otros módulos

- `tail_number` y `base` son las mismas claves de negocio que usa el
  resto del sistema — sin FK real entre bases de datos distintas.
- **Flujo 6 de integración** (`fleet-integration/sync.js`,
  `syncFuelFromDispatch`): cuando un despacho de vuelo
  (`fleet-dispatch-module`) se cierra (`status: 'closed'`), su plan de
  combustible se convierte automáticamente en un uplift aquí —
  `source_flight_release_id` referencia el despacho de origen (`UNIQUE`,
  así el flujo es idempotente). Ver `fleet-integration/README.md` para el
  detalle de la conversión kg → litros.
- No se conecta (todavía) con `fleet-billing-module` — el costo de
  combustible por aeronave (`GET /cost-by-aircraft`) no se refleja hoy en
  el costo por hora de vuelo facturado. Queda como posible siguiente paso.

## Uso

```bash
node src/cli-demo.js       # demo de consola: tablero + bloqueo de un uplift + idempotencia
SEED=1 npm start           # servidor HTTP en :3011 con datos de ejemplo
```

## Endpoints

Todos (salvo `GET /health`) requieren `Authorization: Bearer <token>`.
Lectura abierta a cualquier rol autenticado. Escritura de proveedores y
entregas restringida a `admin`/`finance` (combustible es una compra con
impacto contable); tanques y uplifts también aceptan `integration` (para
que `fleet-integration/sync.js` pueda registrar el consumo real de
`fleet-dispatch-module`); uplifts manuales también aceptan `ops`.

| Método | Ruta | Roles | Qué hace |
|---|---|---|---|
| GET | `/health` | público | estado del servicio |
| GET | `/dashboard` | cualquiera | tanques con nivel, % lleno, entregas y uplifts recientes |
| GET | `/cost-by-aircraft?since=YYYY-MM-DD` | cualquiera | litros y costo total de combustible por matrícula |
| GET | `/suppliers` | cualquiera | lista de proveedores |
| POST | `/suppliers` | admin, finance | crea un proveedor |
| POST | `/tanks` | admin, finance, integration | crea el tanque de una base (idempotente) |
| POST | `/deliveries` | admin, finance | registra una entrega de proveedor a tanque |
| POST | `/uplifts` | admin, ops, integration | registra un repostaje — **rechaza si no hay stock suficiente** |

### Ejemplo

```bash
TOKEN=$(curl -s -X POST http://localhost:3007/login -H "Content-Type: application/json" \
  -d '{"username":"finanzas","password":"changeme123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -s http://localhost:3011/dashboard -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:3011/uplifts -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{
  "tailNumber": "XA-HEL1", "base": "Base Norte", "liters": 350, "upliftDate": "2026-07-20"
}'
```

## Modo dual SQLite / PostgreSQL

Igual que el resto de los módulos: sin `DATABASE_URL`, usa `node:sqlite`;
con `DATABASE_URL` definido, usa PostgreSQL vía el paquete opcional `pg`
(no probado localmente).

## Qué falta para producción

- No hay control de calidad de combustible (certificados de análisis,
  agua/sedimento) ni trazabilidad por lote de proveedor.
- El costo promedio ponderado se recalcula en tiempo real por tanque, pero
  no hay cierre de período (mensual) para congelar el costo usado en
  reportes financieros.
- No se conecta con `fleet-billing-module` — el costo real de combustible
  no ajusta el costo por hora facturado.
- No hay alertas de nivel mínimo de tanque (para disparar una entrega
  antes de quedarse sin stock, similar al flujo de reposición de
  `fleet-inventory-module`).
- Los precios y contratos en `src/seed.js` son de ejemplo, no cifras de
  mercado real.
