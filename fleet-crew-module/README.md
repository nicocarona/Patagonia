# Módulo de Tripulación y Fatiga — Sistema de Control de Flota de Helicópteros

Prototipo funcional del módulo de gestión de tripulación (sección 5 de la
especificación funcional). A diferencia del módulo de Programación —que
valida disponibilidad para VUELOS específicos—, este módulo es la fuente de
verdad de horas de servicio de **cualquier actividad** (vuelo,
entrenamiento, standby, trabajo administrativo) y aplica las reglas de
fatiga acumuladas.

## Requisitos

Node.js 22+. Mismo criterio de SQLite/PostgreSQL dual que los otros
módulos — ver `fleet-billing-module/README.md` para la explicación completa.

## Autenticación

Toda ruta salvo `GET /health` exige `Authorization: Bearer <token>`
(`POST /login` contra `fleet-auth-module`, puerto 3007). Editar
habilitaciones, períodos de servicio y licencias exige rol `admin`, `crew`
u `ops` (según la ruta); actualizar el maestro de identidad exige `admin`
o `integration`. Ver `fleet-auth-module/README.md`.

## Estructura

```
fleet-crew-module/
├── schema.sql / schema.postgres.sql   Tripulación, calificaciones, duty_periods, licencias
├── src/
│   ├── db.js                Capa de acceso a datos (SQLite/Postgres dual)
│   ├── fatigueEngine.js     Motor de reglas de fatiga (5 validaciones + score)
│   ├── seed.js                Datos de ejemplo
│   ├── cli-demo.js          Demo de consola: 5 escenarios + scores de fatiga
│   └── server.js             API HTTP
└── package.json
```

## Uso rápido

```bash
node src/cli-demo.js          # Demo de consola
SEED=1 node src/server.js     # API en http://localhost:3003 con datos de ejemplo
```

## Reglas de fatiga implementadas

1. **Licencia/vacaciones** — rechaza cualquier turno dentro de un rango de
   licencia aprobada.
2. **Descanso mínimo** — compara la hora de inicio del nuevo turno contra
   el fin del turno de servicio inmediatamente anterior (revisa el día
   actual y el anterior, por si cruza medianoche); rechaza si el descanso
   es menor al mínimo (10h por defecto).
3. **Límite diario** — suma todas las actividades del tripulante ese día
   (no solo vuelos); rechaza si excede el máximo (8h por defecto).
4. **Límite semanal** — ventana rodante de 7 días terminando en la fecha
   del turno (no semana calendario fija); rechaza si excede el máximo
   (36h por defecto).
5. **Límite mensual** — ventana rodante de 28 días; rechaza si excede el
   máximo (100h por defecto).

Los límites son parámetros de referencia — cada operador debe ajustarlos a
la normativa real de su autoridad (FAA Part 135, EASA Part-ORO.FTL, etc.),
pasándolos como argumento opcional en cada llamada (`maxDailyHours`,
`maxWeeklyHours`, `maxMonthlyHours`, `minRestHours`).

## Score de fatiga

`GET /crew/:id/fatigue-score?date=YYYY-MM-DD` devuelve un indicador de
0 a 100+ (bajo / moderado / alto / crítico) basado en qué tan cerca está el
tripulante de sus límites semanal y mensual. Es un indicador de referencia
para priorizar revisión humana — **no** es un algoritmo biomatemático de
fatiga certificado (tipo FAID/SAFE real), que requeriría datos de sueño y
sería un desarrollo mucho más especializado.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/crew` | Lista de tripulantes |
| GET | `/crew/:id/qualifications` | Habilitaciones de un tripulante |
| POST | `/crew/:id/qualifications` | Registrar una habilitación |
| GET | `/crew/:id/fatigue-score?date=` | Score de fatiga a una fecha |
| GET | `/duty-periods?crewId=&date=` | Consultar períodos de servicio |
| POST | `/duty-periods/validate` | Validar sin crear |
| POST | `/duty-periods` | Validar y crear |
| GET | `/leave-requests?crewId=` | Consultar licencias |
| POST | `/leave-requests` | Registrar una licencia |

## Relación con el módulo de Programación

Este módulo y `fleet-scheduling-module` son independientes a propósito
(mismo criterio arquitectónico que facturación/programación). En un sistema
integrado real, cada reserva confirmada en Programación generaría
automáticamente un `duty_period` aquí (vía un `sync.js` como el que conecta
Programación con Facturación), para que el límite de horas de servicio
considere TODA la actividad del tripulante, no solo los vuelos.

## Qué falta para producción

- Migración a PostgreSQL en un entorno real (mismo patrón, sin probar aquí
  por falta de acceso a internet en este entorno de generación).
- Integración con Programación (duty_period automático al confirmar/cerrar
  una reserva).
- Algoritmo de fatiga más riguroso si el operador requiere certificación
  (ej. licenciar SAFTE-FAST u otro modelo biomatemático reconocido).
- Notificaciones automáticas cuando el score cruza un umbral.
- Autenticación y permisos por rol.
