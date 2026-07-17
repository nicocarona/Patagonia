# fleet-core-module — Maestro de datos

Registro único de aeronaves, tripulantes y clientes (sección nueva agregada
en la auditoría de julio 2026 — ver `AUDITORIA_Y_HOJA_DE_RUTA.docx` en la
raíz del paquete para el detalle completo de qué se corrigió y por qué).

## Por qué existe

Los cinco módulos originales (facturación, programación, tripulación, SMS,
mantenimiento) se construyeron como servicios independientes, cada uno con
su propia tabla de aeronaves y/o tripulantes. Eso funcionaba mientras cada
módulo se probaba por separado, pero no es cómo opera un ERP aeronáutico
real: un operador grande como **Bristow Group** centraliza mantenimiento,
ingeniería, inventario y operaciones sobre una plataforma única (Ramco
Aviation M&E, seleccionada en 2021 — fuente: comunicado de prensa de Ramco,
junio 2021). Nuestra arquitectura es federada (cada módulo sigue siendo un
servicio HTTP separado, más parecida a cómo **Babcock Mission Critical
Services** conecta su ERP Sage X3 con sistemas de vuelo independientes —
fuente: caso de estudio de Inixion), así que en vez de fusionar las bases
de datos, este módulo es el **único lugar donde se da de alta** una
aeronave (por matrícula) o un tripulante (por legajo) antes de que exista
en cualquier otro sistema, y `fleet-integration/sync.js` reparte esa
identidad a cada módulo operativo.

## Uso rápido

```bash
SEED=1 node src/server.js     # API en http://localhost:3006 con datos de ejemplo
```

## Autenticación

Toda ruta salvo `GET /health` exige `Authorization: Bearer <token>`
(`POST /login` contra `fleet-auth-module`, puerto 3007). Dar de alta o
editar aeronaves y tripulantes exige rol `admin` o `integration`; crear
clientes exige `admin`. Ver `fleet-auth-module/README.md`.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET/POST | `/aircraft` | Listar / alta-edición de aeronave (upsert por `tailNumber`) |
| GET/POST | `/crew` | Listar / alta-edición de tripulante (upsert por `employeeCode`) |
| GET/POST | `/customers` | Listar / crear cliente |
| POST | `/sync-log` | Registro de auditoría: qué módulo recibió qué versión y cuándo |
| GET | `/sync-status` | Maestro completo + últimos 40 eventos de sincronización |

## Qué cambia en los demás módulos

- **Facturación / Programación / Mantenimiento**: ahora exponen `POST /aircraft`
  (upsert por `tail_number`) para recibir altas/ediciones desde este maestro.
- **Programación / Tripulación**: ahora exponen `POST /crew` (upsert por
  `employee_code`, columna nueva `employee_code TEXT UNIQUE` agregada al
  esquema de ambos). Antes, "Ana Reyes" en Programación y "Ana Reyes" en
  Tripulación eran dos registros sin ninguna clave que los conectara más
  allá de coincidir el nombre por casualidad — ahora comparten `employee_code`.
- **Programación**: tabla `aircraft` ahora tiene columnas `airworthy` y
  `airworthy_synced_at`, reflejo de solo lectura del estado calculado por
  Mantenimiento (ver más abajo).

## El gating mantenimiento → programación

Antes de esta corrección, Programación no sabía nada de mantenimiento: se
podía reservar una aeronave con un componente vencido. `fleet-integration/sync.js`
ahora consulta `GET /dashboard` en Mantenimiento y, si una aeronave está
`airworthy: false`, llama `POST /aircraft/:id/airworthy` en Programación
para marcarla. `schedulingEngine.checkAircraftAirworthy` bloquea cualquier
reserva nueva sobre una aeronave marcada así — el mismo patrón de "no lo
descubras después, bloquéalo antes" usado en las demás validaciones.

## Qué falta para producción

- Autenticación y control de quién puede dar de alta una aeronave o un
  tripulante (hoy cualquiera con acceso a la API puede hacerlo).
- Versionado de cambios (quién cambió qué matrícula/legajo y cuándo, más
  allá del log de sincronización).
- Reemplazar el polling de `fleet-integration/sync.js` por eventos
  (webhooks o cola de mensajes) para que la sincronización sea en tiempo
  real, no cada N segundos/minutos.
