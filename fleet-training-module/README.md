# fleet-training-module

Entrenamiento y vigencias de tripulación para el sistema de control de
flota de helicópteros. Es el 10º módulo, y cubre el punto de la hoja de
ruta sobre entrenamiento/currency (`AUDITORIA_Y_HOJA_DE_RUTA.docx`,
sección 6): hasta ahora, `fleet-scheduling-module` tenía una tabla mínima
de habilitaciones (`crew_qualifications`: modelo de aeronave + fecha de
vencimiento) que alguien cargaba a mano para bloquear reservas. Este
módulo es la **fuente de verdad real** detrás de ese dato.

## Qué rastrea, por tripulante

- **Licencias** (`licenses`): tipo, número, autoridad emisora, vencimiento.
- **Certificados médicos** (`medical_certificates`): clase, vencimiento.
- **Habilitaciones de tipo de aeronave** (`type_ratings`) — el foco
  principal que pediste: **en qué material (modelo de helicóptero) está
  habilitado cada piloto**, con fecha de última verificación de pericia y
  vencimiento.
- **Habilitaciones especiales** (`special_qualifications`): NVG (visión
  nocturna), HEMS (tripulación médica aérea), carga externa, offshore,
  montaña, izado/hoist, instructor, examinador.
- **Entrenamientos recurrentes** (`recurrent_trainings`): CRM, mercancías
  peligrosas, emergencias/evacuación, supervivencia, etc.

Cada registro con fecha de vencimiento se clasifica automáticamente como
`vigente`, `por_vencer` (dentro de 60 días — umbral de ejemplo, no
regulatorio) o `vencido`. `GET /currency/:employeeCode` arma el perfil
completo de un tripulante; `GET /currency` arma el tablero de toda la
flota de tripulantes.

## El gate: `checkPilotCurrency`

`GET /currency/:employeeCode/:aircraftModel` responde si ese tripulante
puede volar ese modelo HOY: licencia vigente + médico vigente +
habilitación de tipo vigente para ese modelo específico. Si algo falta o
está vencido, devuelve el motivo exacto — mismo patrón "bloquear antes, no
descubrir después" que el resto del sistema (mantenimiento, inventario,
despacho).

## Referencia de mercado

Los sistemas de gestión de tripulación de aerolíneas grandes (p. ej.
**Lufthansa Systems NetLine/Crew**) mantienen, por cada tripulante, un
perfil único con licencias, habilitaciones de tipo, chequeos de línea y
certificados médicos, con alertas configurables antes del vencimiento —
es el mismo concepto que aplicamos aquí, a la escala de un operador de
helicópteros. Fuente: búsqueda web sobre software de gestión de
tripulación en aerolíneas (julio 2026) — no se verificó el detalle interno
de ese producto específico, solo el patrón general de qué rastrea.

**Importante — lo que NO está verificado ni codificado como regla fija:**
este módulo no asume una periodicidad regulatoria específica para
chequeos de línea, entrenamiento recurrente, ni el umbral de "por vencer".
Cada operador define esos plazos según su programa de entrenamiento
aprobado y la autoridad de aviación civil que le aplique — los valores en
`src/seed.js` son solo datos de ejemplo, no cifras oficiales.

## Enlace con otros módulos

- `employee_code` es la misma clave de negocio que usan
  `fleet-core-module`, `fleet-crew-module` y `fleet-scheduling-module` —
  no hay FK real entre bases de datos distintas.
- **Flujo 5 de integración** (`fleet-integration/sync.js`,
  `syncTrainingToScheduling`): empuja las habilitaciones de tipo
  **vigentes** (no vencidas) hacia la tabla `crew_qualifications` de
  Programación, que ya usa esos datos para bloquear reservas de pilotos
  sin habilitación vigente (`checkPilotQualification`). Mismo patrón que
  el flujo 2 (Mantenimiento → Programación, aeronavegabilidad): este
  módulo certifica, Programación solo respeta. Ver
  `fleet-integration/README.md`.
- No se sincroniza (todavía) hacia `fleet-dispatch-module` — el despacho
  no vuelve a verificar la vigencia del piloto al liberar el vuelo en esta
  versión; queda como posible siguiente paso.

## Uso

```bash
node src/cli-demo.js       # demo de consola: tablero completo + 5 casos del gate
SEED=1 npm start           # servidor HTTP en :3010 con datos de ejemplo
```

## Endpoints

Todos (salvo `GET /health`) requieren `Authorization: Bearer <token>`.
Lectura abierta a cualquier rol autenticado; escritura restringida a
`admin`/`crew` (mismos roles que usa `fleet-crew-module` para datos de
tripulación), salvo `POST /crew` que también acepta `integration` (para
que `fleet-integration/sync.js` pueda registrar tripulantes desde el
maestro, igual que en los demás módulos).

| Método | Ruta | Roles | Qué hace |
|---|---|---|---|
| GET | `/health` | público | estado del servicio |
| GET | `/currency` | cualquiera | tablero de vigencia de toda la tripulación |
| GET | `/currency/:employeeCode` | cualquiera | perfil de vigencia completo de un tripulante |
| GET | `/currency/:employeeCode/:aircraftModel` | cualquiera | gate: ¿puede volar ese modelo hoy? |
| POST | `/crew` | admin, integration | crea/actualiza un tripulante (upsert por employee_code) |
| POST | `/licenses` | admin, crew | agrega una licencia |
| POST | `/medical-certificates` | admin, crew | agrega un certificado médico |
| POST | `/type-ratings` | admin, crew | agrega/actualiza una habilitación de tipo (upsert por modelo) |
| POST | `/special-qualifications` | admin, crew | agrega una habilitación especial |
| POST | `/recurrent-trainings` | admin, crew | agrega un entrenamiento recurrente |

### Ejemplo

```bash
TOKEN=$(curl -s -X POST http://localhost:3007/login -H "Content-Type: application/json" \
  -d '{"username":"carla.nunez","password":"changeme123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -s http://localhost:3010/currency/EMP-0001 -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3010/currency/EMP-0001/Airbus%20H145 -H "Authorization: Bearer $TOKEN"
```

## Modo dual SQLite / PostgreSQL

Igual que el resto de los módulos: sin `DATABASE_URL`, usa `node:sqlite`;
con `DATABASE_URL` definido, usa PostgreSQL vía el paquete opcional `pg`
(no probado localmente).

## Qué falta para producción

- No hay carga de documentos (PDF de licencia, certificado médico
  escaneado) — solo metadatos y fechas.
- No hay alertas proactivas (correo/notificación) a 90/30/7 días — hoy hay
  que consultar el tablero activamente.
- No calcula horas de vuelo recientes para currency basada en horas (p.
  ej. "3 despegues y aterrizajes en los últimos 90 días") — solo vigencia
  por fecha de vencimiento de cada registro.
- El gate `checkPilotCurrency` no está conectado (todavía) a
  `fleet-dispatch-module` — solo a Programación vía el flujo 5.
- No hay versión histórica de habilitaciones (si se actualiza una
  habilitación de tipo, se sobrescribe — no queda auditoría de cambios).
