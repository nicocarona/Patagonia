# Módulo de Programación de Vuelos — Sistema de Control de Flota de Helicópteros

Prototipo funcional del módulo de scheduling (sección 2 de la especificación
de funcionalidades). Valida y confirma reservas de vuelo aplicando las 4
reglas descritas en el documento: disponibilidad de aeronave, disponibilidad
de tripulación, calificación vigente por modelo de aeronave y límite de horas
de servicio diario.

## Requisitos

Node.js 22+ (usa `node:sqlite`, sin dependencias — mismo criterio que el
módulo de facturación; ver ese README para la nota completa sobre por qué
no se usó PostgreSQL en este entorno).

## Autenticación

Toda ruta salvo `GET /health` exige `Authorization: Bearer <token>`
(consíguelo con `POST /login` contra `fleet-auth-module`, puerto 3007).
Crear/cancelar/cerrar reservas y calificaciones exige rol `admin`, `ops` o
`crew` (según la ruta); actualizar aeronavegabilidad o el maestro de
identidad exige `admin` o `integration`. Ver `fleet-auth-module/README.md`.

## Estructura

```
fleet-scheduling-module/
├── schema.sql                  Aeronaves, tripulación, calificaciones, reservas
├── src/
│   ├── db.js                    Capa de acceso a datos (SQLite)
│   ├── schedulingEngine.js      Motor de validación (4 reglas) + creación de reservas
│   ├── seed.js                   Datos de ejemplo (2 aeronaves, 2 pilotos, calificaciones)
│   ├── cli-demo.js              Demo de consola: 5 escenarios, incluye 2 rechazos esperados
│   └── server.js                 API HTTP
└── package.json
```

## Uso rápido

```bash
node src/cli-demo.js          # Demo de consola con 5 escenarios de validación
SEED=1 node src/server.js     # API en http://localhost:3002 con datos de ejemplo
```

## Reglas de validación implementadas

1. **Disponibilidad de aeronave** — rechaza si la aeronave ya tiene otra
   reserva confirmada que se traslapa en horario ese día.
2. **Disponibilidad de tripulación** — mismo chequeo, para el piloto asignado.
3. **Calificación vigente por modelo** — el piloto debe tener una
   habilitación (`crew_qualifications`) para el modelo exacto de la
   aeronave, con `valid_until` no vencida a la fecha de la reserva. Una
   habilitación en H125 no sirve para reservar un H145.
4. **Límite de horas de servicio diario** — suma la duración de todas las
   reservas confirmadas del piloto ese día (de cualquier cliente/contexto)
   más la nueva reserva; si excede el máximo (8h por defecto, configurable
   por llamada vía `maxDailyDutyHours`), la rechaza.

Si cualquier regla falla, la API responde **400** con el motivo específico
en `error`. El endpoint `POST /bookings/validate` corre las mismas 4 reglas
sin crear la reserva — pensado para que la UI muestre el conflicto antes de
que el usuario confirme (igual que describe la sección 2 de la
especificación: "el sistema bloquea la reserva... no se descubre después").

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/aircraft` | Lista de aeronaves |
| GET | `/crew` | Lista de tripulantes |
| GET | `/crew/:id/qualifications` | Habilitaciones de un tripulante |
| POST | `/crew/:id/qualifications` | Registrar una habilitación |
| GET | `/bookings?aircraftId=&pilotId=&date=` | Consultar reservas |
| POST | `/bookings/validate` | Validar sin crear |
| POST | `/bookings` | Validar y crear |
| POST | `/bookings/:id/cancel` | Cancelar una reserva |

## Modo PostgreSQL

Mismo patrón que el módulo de facturación: define `DATABASE_URL` y el
servidor usa Postgres automáticamente (aplica `schema.postgres.sql` solo).
Sin `DATABASE_URL`, sigue usando SQLite local.

```bash
npm install pg
DATABASE_URL=postgres://usuario:password@host:5432/nombre_db SEED=1 node src/server.js
```

Ver la nota completa sobre despliegue multi-región (y la advertencia de que
la ruta Postgres no se pudo probar en este entorno) en el README del
módulo de facturación.

## Qué falta para producción

- Migración a PostgreSQL (mismo patrón que el módulo de facturación).
- Vincular `certificate_context` con el motor de facturación (ya construido
  por separado) para que cada reserva alimente automáticamente el registro
  de vuelo facturable al cerrarse, sin doble captura.
- Reglas de duty time más realistas (descansos mínimos entre turnos,
  acumulado semanal/mensual, no solo diario).
- Notificaciones (email/SMS) al publicar o modificar una reserva.
- Autenticación y permisos por rol (despachador, piloto, administrador).
