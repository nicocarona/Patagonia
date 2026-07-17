# Levantar todo el sistema con un solo comando

`start-all.js` arranca los **11 módulos** (autenticación, maestro,
facturación, programación, tripulación/fatiga, SMS, mantenimiento,
inventario, despacho de vuelo, entrenamiento y vigencias, combustible) al
mismo tiempo, y opcionalmente los 7 flujos de sincronización entre ellos,
sin que tengas que abrir varias terminales ni recordar comandos distintos
para Windows/Mac/Linux — todo corre en Node puro.

`fleet-dispatch-module` (despacho de vuelo) solo participa de
`fleet-integration/sync.js` en el flujo 6 (hacia combustible) — con
Programación se enlaza únicamente por el campo opcional
`source_booking_id`, sin sincronización (ver
`fleet-dispatch-module/README.md`).

Desde que se agregó `fleet-auth-module`, todos comparten la misma variable
`AUTH_SECRET` (el script genera una aleatoria automáticamente si no la
defines — ver advertencia al arrancar). Para probar cualquier endpoint
necesitas primero iniciar sesión — ver "Primer uso" más abajo.

## Antes de empezar

1. Instala **Node.js 22 o superior** (node.org, versión LTS más reciente).
2. Descomprime los 7 proyectos **en la misma carpeta**, uno junto al otro:

```
tu-carpeta/
  fleet-auth-module/
  fleet-core-module/
  fleet-billing-module/
  fleet-scheduling-module/
  fleet-crew-module/
  fleet-sms-module/
  fleet-maintenance-module/
  fleet-inventory-module/
  fleet-dispatch-module/
  fleet-training-module/
  fleet-fuel-module/
  fleet-integration/
  fleet-system/          <- este
```

Si prefieres otra organización de carpetas, usa las variables de entorno
`AUTH_DIR`, `CORE_DIR`, `BILLING_DIR`, `SCHEDULING_DIR`, `CREW_DIR`,
`SMS_DIR`, `MAINTENANCE_DIR`, `INVENTORY_DIR`, `DISPATCH_DIR`,
`TRAINING_DIR`, `FUEL_DIR` e `INTEGRATION_DIR` (ver más abajo).

## Uso

```bash
cd fleet-system
node start-all.js
```

Eso levanta:
- Autenticación en `http://localhost:3007`
- Maestro de datos en `http://localhost:3006`
- Facturación en `http://localhost:3001`
- Programación en `http://localhost:3002`
- Tripulación y fatiga en `http://localhost:3003`
- SMS (seguridad) en `http://localhost:3004`
- Mantenimiento en `http://localhost:3005`
- Inventario en `http://localhost:3008`
- Despacho de vuelo en `http://localhost:3009`
- Entrenamiento y vigencias en `http://localhost:3010`
- Combustible en `http://localhost:3011`

Los once con datos de ejemplo precargados. Verás la salida de los once
servidores en la misma terminal, cada línea con un prefijo de color
distinto para distinguirlos.

Presiona **Ctrl+C** una vez para apagar los once servidores juntos.

## Primer uso: iniciar sesión

Todos los endpoints (salvo `GET /health` y `POST /login`) exigen un token.
Con los 7 módulos corriendo:

```bash
TOKEN=$(curl -s -X POST http://localhost:3007/login -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl http://localhost:3002/bookings -H "Authorization: Bearer $TOKEN"
```

Ver `fleet-auth-module/README.md` para la lista completa de usuarios de
demostración y qué puede hacer cada rol.

## Opciones

| Comando | Qué hace |
|---|---|
| `node start-all.js` | Levanta los 11 módulos, sincronización manual |
| `node start-all.js --sync` | Además corre los 7 flujos de sincronización cada 30s (maestro → módulos, mantenimiento → programación, mantenimiento → inventario, entrenamiento → programación, programación → facturación, despacho → combustible, tripulación → SMS) |
| `node start-all.js --sync-interval=10` | Cambia el intervalo de sincronización (usar junto con `--sync`) |
| `node start-all.js --no-seed` | No precarga datos de ejemplo (para empezar con base vacía) |

## Variables de entorno (opcional)

```bash
CORE_PORT=4006 BILLING_PORT=4001 SCHEDULING_PORT=4002 node start-all.js
BILLING_DIR=/ruta/otra/fleet-billing-module node start-all.js
```

Para conectar a PostgreSQL en vez de SQLite (ver el README del módulo de
facturación para el detalle completo), define `DATABASE_URL_<MODULO>` para
cualquier combinación de `CORE`, `BILLING`, `SCHEDULING`, `CREW`, `SMS`,
`MAINTENANCE`:

```bash
DATABASE_URL_CORE=postgres://user:pass@host:5432/maestro \
DATABASE_URL_BILLING=postgres://user:pass@host:5432/facturacion \
DATABASE_URL_SCHEDULING=postgres://user:pass@host:5432/programacion \
node start-all.js
```

## Si algo no arranca

El script valida que las carpetas de los otros 10 proyectos existan antes
de arrancar nada, y te dice exactamente cuál falta y qué variable de
entorno usar para apuntarla a otra ruta.

## Orden de la sincronización — por qué importa

`--sync` corre, en cada pasada, los 7 flujos de `fleet-integration/sync.js`
en este orden fijo: primero el maestro reparte matrículas/legajos a los
demás módulos; luego mantenimiento actualiza el estado de aeronavegabilidad
en programación y genera alertas de reposición en inventario; luego
entrenamiento empuja las habilitaciones de tipo vigentes hacia
programación; luego programación manda reservas completadas a facturación;
luego despacho convierte los planes de combustible de vuelos cerrados en
consumo real dentro de combustible; y por último tripulación refresca el
score de fatiga real de cada piloto dentro de SMS, para que el FRAT lo
pueda heredar en vez de que alguien lo tipee a mano. Si corrieras el orden
al revés, programación podría intentar sincronizar una reserva de una
aeronave que el maestro todavía no le reparte, o un piloto sin
habilitación registrada todavía — el orden no es arbitrario, refleja la
dependencia real entre los siete flujos (ver `fleet-integration/README.md`).
