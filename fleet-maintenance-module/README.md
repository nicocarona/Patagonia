# Módulo de Mantenimiento por Componente — Sistema de Control de Flota de Helicópteros

Prototipo funcional del módulo de mantenimiento (sección 3 de la
especificación funcional): seguimiento de vida útil de componentes de vida
limitada (horas, ciclos y/o calendario), bloqueo preventivo de vuelos que
excederían un límite, y órdenes de trabajo que resetean la vida de un
componente al hacerle overhaul o reemplazo.

## Requisitos

Node.js 22+. Mismo patrón dual SQLite/PostgreSQL que los demás módulos —
ver `fleet-billing-module/README.md` para el detalle completo.

## Uso rápido

```bash
node src/cli-demo.js          # Demo de consola
SEED=1 node src/server.js     # API en http://localhost:3005 con datos de ejemplo
```

## Autenticación

Toda ruta salvo `GET /health` exige `Authorization: Bearer <token>`
(`POST /login` contra `fleet-auth-module`, puerto 3007). Registrar
componentes, vuelos y órdenes de trabajo exige rol `admin` o
`maintenance`; actualizar el maestro de identidad exige `admin` o
`integration`. Ver `fleet-auth-module/README.md`.

## Idea central

Un helicóptero mediano tiene entre 30 y 50 componentes de vida limitada
(rotor, caja de transmisión, ejes, kits de flotación, etc.), cada uno con su
propio límite en una o más dimensiones:

- **Horas** (`hours_limit` / `hours_accumulated`)
- **Ciclos** (`cycles_limit` / `cycles_accumulated`) — por ejemplo aterrizajes
- **Calendario** (`calendar_limit_date`) — vencimiento por fecha, sin importar el uso

El sistema calcula, para cada componente, cuánto le queda en cada dimensión
aplicable y reporta el peor de los tres como estado global:

| Estado | Significado |
|---|---|
| `ok` | Vida remanente por sobre el umbral de aviso |
| `due_soon` | ≤25h, ≤50 ciclos o ≤30 días restantes (umbrales configurables en `maintenanceEngine.js`) |
| `overdue` | Límite ya alcanzado o superado |

Una aeronave es **aeronavegable** (`airworthy: true`) si ninguno de sus
componentes instalados está `overdue`.

## El bloqueo preventivo

La regla central: **el sistema no permite registrar un vuelo que haría que
algún componente exceda su límite** — no lo descubre después del hecho, lo
bloquea antes. `POST /flights` corre `checkFlightAgainstLimits` sobre todos
los componentes instalados de la aeronave; si cualquiera de ellos
proyectaría exceder su límite de horas, ciclos o calendario con ese vuelo,
la operación se rechaza con la lista específica de componentes en conflicto.
`POST /flights/check` expone la misma validación sin registrar nada, para
que una interfaz muestre la advertencia mientras se planifica el vuelo —
el mismo patrón de "validar antes de crear" usado en Programación
(disponibilidad de aeronave/piloto) y Tripulación (descanso mínimo).

Cuando un vuelo sí se registra, se actualizan las horas/ciclos acumulados de
**todos** los componentes instalados de esa aeronave (no solo el que estaba
más cerca del límite), reflejando que un componente acumula vida con cada
vuelo del helicóptero, esté o no cerca de vencer.

## Órdenes de trabajo y reset de vida

`POST /work-orders` abre una orden con `action_type` de `repair`,
`inspection`, `overhaul` o `replacement`, opcionalmente ligada a un
componente específico. Al cerrarla (`POST /work-orders/:id/close`):

- Si el tipo es `overhaul` o `replacement` y tiene un `component_id`, el
  sistema **resetea automáticamente** las horas y ciclos acumulados de ese
  componente a cero, con fecha de instalación igual a la fecha de cierre.
  Así el mantenimiento ejecutado se refleja de inmediato en el cálculo de
  vida remanente, sin un paso manual aparte.
- Si el tipo es `repair` o `inspection`, no se resetea nada — una reparación
  menor no renueva la vida límite del componente.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/aircraft` | Listar aeronaves |
| GET | `/aircraft/:id/components` | Componentes instalados de una aeronave |
| POST | `/components` | Registrar un nuevo componente |
| GET | `/dashboard` | Estado de vida de toda la flota (`?asOfDate=YYYY-MM-DD`) |
| POST | `/flights/check` | Validar un vuelo planeado sin registrarlo |
| POST | `/flights` | Registrar un vuelo (rechaza si excede algún límite) |
| GET | `/flights` | Listar vuelos registrados (`?aircraftId=`) |
| POST | `/work-orders` | Abrir una orden de trabajo |
| POST | `/work-orders/:id/close` | Cerrar (resetea vida si es overhaul/replacement) |
| GET | `/work-orders` | Listar órdenes (`?status=open\|closed`) |

## Qué falta para producción

- Integración con `fleet-scheduling-module` para que `checkFlightAgainstLimits`
  bloquee directamente la creación de una reserva (booking), no solo el
  registro posterior del vuelo real — hoy son independientes, igual que
  facturación/programación antes de conectarse vía `fleet-integration`.
- Catálogo de componentes por modelo de aeronave (hoy cada componente se
  crea a mano por aeronave individual) para agilizar el alta de una
  aeronave nueva a la flota.
- Alertas automáticas (correo/SMS) cuando un componente pasa a `due_soon`,
  no solo cuando se consulta el dashboard.
- Trazabilidad de partes: número de serie del componente saliente vs.
  entrante en un reemplazo, y adjuntar el certificado de conformidad (8130-3
  o equivalente) a la orden de trabajo.
- Autenticación y permisos por rol (quién puede cerrar una orden de trabajo).
