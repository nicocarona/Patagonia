# Módulo SMS (Seguridad) — Sistema de Control de Flota de Helicópteros

Prototipo funcional del módulo de Sistema de Gestión de Seguridad (sección 6
de la especificación funcional): evaluación de riesgo de vuelo (FRAT) antes
de cada misión, reporte de ocurrencias, registro de peligros (hazard
register) y seguimiento de acciones correctivas.

## Requisitos

Node.js 22+. Mismo patrón dual SQLite/PostgreSQL que los demás módulos —
ver `fleet-billing-module/README.md` para el detalle completo.

## Uso rápido

```bash
node src/cli-demo.js          # Demo de consola
SEED=1 node src/server.js     # API en http://localhost:3004 con datos de ejemplo
```

## Autenticación

Toda ruta salvo `GET /health` y `POST /frat/preview` (solo calcula, no
guarda) exige `Authorization: Bearer <token>` (`POST /login` contra
`fleet-auth-module`, puerto 3007). Reportar ocurrencias, peligros y
acciones correctivas exige rol `admin` o `safety`; crear una evaluación
FRAT real acepta además `ops`. Ver `fleet-auth-module/README.md`.

## FRAT — Flight Risk Assessment Tool

Antes de cada misión se califican 6 factores de 0 (sin riesgo) a 4 (riesgo
máximo):

| Factor | Qué mide |
|---|---|
| `weatherScore` | Condiciones meteorológicas |
| `terrainScore` | Familiaridad/complejidad del terreno de operación |
| `pilotCurrencyScore` | Actualidad/experiencia reciente del piloto en el tipo |
| `fatigueScore` | Nivel de fatiga — manual, o heredado del score real de `fleet-crew-module` (ver abajo) |
| `aircraftStatusScore` | Ítems MEL abiertos / estado de mantenimiento |
| `operationalPressureScore` | Presión comercial/de horario para salir de todos modos |

La suma (0 a 24) determina el nivel de riesgo:

| Score | Nivel | Requiere aprobación |
|---|---|---|
| 0–6 | Bajo | No |
| 7–12 | Moderado | No |
| 13–18 | Alto | **Sí** |
| 19–24 | Extremo | **Sí** |

Si el nivel es alto o extremo, `POST /frat` **rechaza** la creación a menos
que se incluya `approvedBy` (nombre de quien autoriza) — el mismo patrón de
bloqueo usado en Programación (disponibilidad) y Tripulación (fatiga): la
regla se hace cumplir en el momento de crear el registro, no se descubre
después. `POST /frat/preview` calcula el resultado sin guardarlo, para que
la interfaz muestre el nivel de riesgo mientras se llena el formulario.

**Importante:** estos umbrales (0-6/7-12/13-18/19-24) son un modelo de
referencia que armé para este prototipo, inspirado en cómo funcionan las
herramientas FRAT reales — no son una tabla oficial de una autoridad
específica. Cada operador debe calibrar los pesos y umbrales según su
propio manual de SMS aprobado.

## Fatiga real (conectado a Tripulación)

`fleet-crew-module` calcula un score de fatiga real (0-100) a partir de
horas de servicio (`computeFatigueScore`) — antes, ese número nunca
llegaba al FRAT: quien lo llenaba tenía que adivinar o preguntar. Ahora:

1. El **flujo 7** de `fleet-integration/sync.js` (`syncFatigueToSms`)
   refresca, para cada piloto, una fotografía de su score real en
   `fatigue_snapshots` (traducido a una banda 0-4: `score/25` redondeado
   hacia abajo, tope en 4 — traducción propia de este sistema, no una
   tabla de una autoridad, mismo criterio que los umbrales de arriba).
2. Al crear o previsualizar un FRAT (`POST /frat`, `POST /frat/preview`),
   si se pasa `pilotEmployeeCode` y **no** se pasa `fatigueScore`
   explícito, el valor se hereda automáticamente de esa fotografía. El
   registro resultante queda marcado `fatigue_source: 'tripulacion'` (en
   vez de `'manual'`), así siempre se sabe si el número vino calculado o
   lo tipeó una persona. Si se pasa `fatigueScore` a mano, ese valor
   manda igual — la herencia automática nunca sobrescribe una entrada
   explícita.

`GET /fatigue-snapshots` expone la última fotografía conocida de cada
piloto (útil para que una UI muestre el nivel de fatiga antes de llenar
el formulario). Ver `fleet-integration/README.md` para el detalle
completo del flujo 7.

## Ocurrencias y peligros

- **Ocurrencias** (`occurrences`): incidentes, accidentes, cuasi-accidentes
  o reportes de peligro puntuales. No se pueden cerrar sin registrar causa
  raíz (`root_cause`) — `POST /occurrences/:id/close` lo exige.
- **Peligros** (`hazards`): identificación proactiva, calificados con
  matriz de riesgo clásica (`likelihood` 1-5 × `consequence` 1-5 = `risk_score`
  de 1 a 25).
- **Acciones correctivas** (`corrective_actions`): vinculadas a una
  ocurrencia o a un peligro, con responsable y fecha límite.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET/POST | `/occurrences` | Listar / reportar ocurrencias |
| POST | `/occurrences/:id/close` | Cerrar (exige causa raíz) |
| GET/POST | `/hazards` | Listar / registrar peligros |
| GET/POST | `/corrective-actions` | Listar / crear acciones correctivas |
| POST | `/corrective-actions/:id/complete` | Marcar como completada |
| POST | `/frat/preview` | Calcular score sin guardar (hereda fatiga real si aplica) |
| GET/POST | `/frat` | Listar / crear evaluaciones FRAT (hereda fatiga real si aplica) |
| GET | `/fatigue-snapshots` | Última fotografía de fatiga real conocida por piloto |
| POST | `/fatigue-snapshots` | Usado por `fleet-integration` (flujo 7) para refrescarla |
| GET | `/dashboard` | Resumen de seguridad (ocurrencias, peligros, acciones, FRAT recientes) |

## Qué falta para producción

- Integración con `fleet-scheduling-module` para exigir un FRAT aprobado
  antes de confirmar una reserva de alto riesgo (hoy son independientes).
- Compatibilidad con formato ECCAIRS/ICAO Annex 19 para reportar a la
  autoridad si el operador lo requiere.
- Notificaciones automáticas cuando se abre una ocurrencia crítica o un
  peligro de risk_score alto.
- Autenticación y permisos por rol (quién puede aprobar un FRAT de alto riesgo).
