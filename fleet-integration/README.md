# Capa de integración

`sync.js` conecta los once módulos vía sus APIs REST, en ocho flujos que
se corren en orden porque cada uno depende del anterior:

1. **`syncMasterData()`** — Maestro (`fleet-core-module`) → Facturación,
   Programación, Mantenimiento (aeronaves) y Programación, Tripulación,
   Entrenamiento (tripulantes). Reparte identidad (matrícula/legajo) a
   cada módulo ANTES de que cualquier otro flujo la necesite.
2. **`syncAirworthiness()`** — Mantenimiento → Programación. Si una
   aeronave no está aeronavegable, marca el espejo `airworthy` en
   Programación, que bloquea cualquier reserva nueva sobre ella.
3. **`syncInventoryAlerts()`** — Mantenimiento → Inventario. Si un
   componente está `due_soon` u `overdue` y su `part_number` no tiene
   stock disponible en Inventario, genera automáticamente una orden de
   compra (`triggered_by: 'auto_maintenance_alert'`), sin duplicar si ya
   hay una abierta para esa parte.
4. **`syncTrainingQualifications()`** — Entrenamiento (`fleet-training-module`)
   → Programación. Empuja las habilitaciones de tipo de aeronave
   **vigentes** (no vencidas) de cada piloto hacia la tabla de
   habilitaciones de Programación, que ya usa ese dato para bloquear
   reservas (`checkPilotQualification`). Antes de este módulo, esa tabla
   se cargaba a mano; ahora Entrenamiento certifica y Programación solo
   respeta — mismo patrón que el flujo 2.
5. **`syncBookingsToBilling()`** — Programación → Facturación (el flujo
   original: reservas completadas se vuelven vuelos facturables,
   idempotente por `source_booking_id`).
6. **`syncFuelFromDispatch()`** — Despacho (`fleet-dispatch-module`) →
   Combustible (`fleet-fuel-module`). Cuando un despacho de vuelo se
   cierra, su plan de combustible (peso, kg) se convierte en un uplift
   real (volumen, litros) en el tanque de la base correspondiente — el
   consumo planeado se vuelve consumo registrado, sin que nadie lo cargue
   a mano. Es el único flujo que involucra a Despacho; en todo lo demás
   ese módulo sigue siendo independiente (ver
   `fleet-dispatch-module/README.md`).
7. **`syncFatigueToSms()`** — Tripulación (`fleet-crew-module`) → SMS
   (`fleet-sms-module`). Para cada piloto, refresca la última fotografía
   de su score de fatiga REAL (`computeFatigueScore`, calculado a partir
   de horas de servicio) en `fatigue_snapshots`. El FRAT
   (`POST /frat` o `/frat/preview`) ya no necesita que alguien adivine o
   ingrese a mano qué tan cansado está el piloto: si se pasa
   `pilotEmployeeCode` y NO se pasa `fatigueScore` explícito, lo hereda de
   ahí automáticamente (`fatigue_source: 'tripulacion'` en el registro
   resultante, en vez de `'manual'`).
8. **`syncFlightLogsToMaintenance()`** — Bitácora (`fleet-dispatch-module`)
   → Mantenimiento. El cierre del ciclo del tech log, como AMOSeTL o TRAX
   en las aerolíneas: (a) las horas de vuelo REALES de cada bitácora que
   el piloto carga post-vuelo se suman a la aeronave y a todos sus
   componentes instalados (`POST /flights` con `actualFlight: true` — un
   vuelo ya volado se registra SIEMPRE, aun si deja un componente
   excedido: la excedencia se avisa fuerte en el log y el flujo 2 saca la
   aeronave de Programación); y (b) si el piloto reportó novedades
   técnicas (squawks), se abre automáticamente una orden de trabajo de
   inspección con su texto literal. Idempotente por
   `synced_to_maintenance`.

Correr `node sync.js` sin argumentos ejecuta los ocho, en ese orden.

## Autenticación

Desde que se agregó `fleet-auth-module`, `sync.js` hace login UNA vez al
arrancar como la cuenta de servicio `fleet-integration` (rol
`integration`) y reutiliza ese token en todas las llamadas de la corrida
(con un reintento automático si expira a mitad de camino). Variables
relevantes: `AUTH_URL` (por defecto `http://localhost:3007`),
`AUTH_INTEGRATION_USERNAME` (por defecto `fleet-integration`),
`AUTH_INTEGRATION_PASSWORD` (por defecto `changeme123`, la contraseña de
demostración sembrada por `fleet-auth-module` — cámbiala antes de
producción).

## Cómo probarlo

Necesitas los once módulos + este proyecto en el mismo nivel (o ajusta
las URLs por variable de entorno: `AUTH_URL`, `CORE_URL`, `BILLING_URL`,
`SCHEDULING_URL`, `CREW_URL`, `SMS_URL`, `MAINTENANCE_URL`,
`INVENTORY_URL`, `TRAINING_URL`, `DISPATCH_URL`, `FUEL_URL`).

```bash
# Una terminal por módulo (o usa fleet-system/start-all.js para hacerlo de un tiro)
export AUTH_SECRET=un-secreto-compartido-cualquiera
cd fleet-auth-module        && SEED=1 PORT=3007 AUTH_SECRET=$AUTH_SECRET node src/server.js
cd fleet-core-module        && SEED=1 PORT=3006 AUTH_SECRET=$AUTH_SECRET node src/server.js
cd fleet-billing-module     && SEED=1 PORT=3001 AUTH_SECRET=$AUTH_SECRET node src/server.js
cd fleet-scheduling-module  && SEED=1 PORT=3002 AUTH_SECRET=$AUTH_SECRET node src/server.js
cd fleet-crew-module        && SEED=1 PORT=3003 AUTH_SECRET=$AUTH_SECRET node src/server.js
cd fleet-sms-module         && SEED=1 PORT=3004 AUTH_SECRET=$AUTH_SECRET node src/server.js
cd fleet-maintenance-module && SEED=1 PORT=3005 AUTH_SECRET=$AUTH_SECRET node src/server.js
cd fleet-inventory-module   && SEED=1 PORT=3008 AUTH_SECRET=$AUTH_SECRET node src/server.js
cd fleet-dispatch-module    && SEED=1 PORT=3009 AUTH_SECRET=$AUTH_SECRET node src/server.js
cd fleet-training-module    && SEED=1 PORT=3010 AUTH_SECRET=$AUTH_SECRET node src/server.js
cd fleet-fuel-module        && SEED=1 PORT=3011 AUTH_SECRET=$AUTH_SECRET node src/server.js

# En otra terminal
cd fleet-integration && node sync.js
```

(`fleet-system/start-all.js` hace todo esto por ti, incluyendo generar un
`AUTH_SECRET` compartido si no defines uno — ver su README.)

Vas a ver algo así:

```
== 1/7 Maestro (fleet-core-module) -> módulos operativos ==
Maestro sincronizado: 12 escritura(s) de aeronave, 15 escritura(s) de tripulante.
== 2/7 Mantenimiento -> Programación (aeronavegabilidad) ==
  ✘ XA-HEL1: Programación actualizada a NO AERONAVEGABLE.
Aeronavegabilidad sincronizada: 1 actualización(es), 3 sin cambio.
== 3/7 Mantenimiento -> Inventario (alertas de reposición) ==
Alertas de inventario sincronizadas: 2 orden(es) de compra generada(s), 3 sin necesidad, 0 omitida(s).
== 4/7 Entrenamiento -> Programación (habilitaciones de tipo) ==
  ✔ EMP-0001 (Ana Reyes): Programación actualizada — Airbus H125 vigente hasta 2026-10-01.
Habilitaciones de tipo sincronizadas: 3 actualización(es), 0 sin cambio, 1 omitida(s) (vencidas o tripulante no encontrado).
== 5/7 Programación -> Facturación (reservas completadas) ==
No hay reservas completadas pendientes de sincronizar.
== 6/7 Despacho -> Combustible (consumo real por vuelo) ==
  ✔ Despacho #1 (XA-HEL1): uplift #3 registrado — 275L en Base Norte.
Consumo de combustible sincronizado: 1 procesado(s), 0 omitido(s).
== 7/7 Tripulación -> SMS (fatiga real para FRAT) ==
  ✔ EMP-0001 (Ana Reyes): fatiga 25/100 (bajo) reflejada en SMS.
  ✔ EMP-0002 (Luis Camacho): fatiga 83/100 (alto) reflejada en SMS.
Fatiga sincronizada: 2 piloto(s) actualizado(s), 0 omitido(s).
```

Para probar solo un flujo (útil al depurar): `node sync.js --only=master-data`,
`--only=airworthiness`, `--only=inventory-alerts`,
`--only=training-qualifications`, `--only=bookings`, `--only=fuel` o
`--only=fatigue`.

Correrlo dos veces seguidas no duplica nada en los primeros seis flujos —
cada uno es idempotente: el maestro hace upsert por clave única, la
aeronavegabilidad y las habilitaciones de tipo solo escriben si
cambiaron, el inventario no abre una segunda orden si ya hay una
`auto_maintenance_alert` abierta, las reservas se marcan sincronizadas
tras procesarse, y el combustible marca cada despacho como sincronizado
(y además el uplift usa `source_flight_release_id` como clave única de
respaldo). El flujo 7 es distinto a propósito: no es una cola de eventos
pendientes, es una fotografía que se **refresca en cada corrida** (upsert
por `employee_code`) — correrlo de nuevo no duplica nada, pero sí
actualiza el score si cambió, que es el comportamiento correcto para un
dato que varía día a día.

## Cómo funciona cada flujo

**Maestro → módulos:** `GET /aircraft` y `GET /crew` en el maestro, luego
`POST /aircraft` (upsert por `tailNumber`) y `POST /crew` (upsert por
`employeeCode`) en cada módulo destino. Cada escritura exitosa (o fallida)
se registra con `POST /sync-log` en el maestro, para poder auditar después
qué módulo quedó desactualizado y por qué.

**Mantenimiento → Programación:** `GET /dashboard` en Mantenimiento trae el
booleano `airworthy` calculado por aeronave (ver `fleet-maintenance-module`).
Se empareja por matrícula con `GET /aircraft` en Programación y, si el
estado cambió, `POST /aircraft/:id/airworthy` lo actualiza. Programación
usa ese campo para bloquear reservas nuevas — el mismo patrón "no lo
descubras después, bloquéalo antes" del resto del sistema.

**Mantenimiento → Inventario:** `GET /dashboard` en Mantenimiento trae
componentes `due_soon`/`overdue` con su `part_number`. Se cruza contra
`GET /dashboard` en Inventario; si no hay stock y no hay ya una orden
automática abierta para esa parte, `POST /purchase-orders` genera una con
`triggered_by: 'auto_maintenance_alert'`.

**Entrenamiento → Programación:** `GET /currency` en Entrenamiento trae el
perfil de vigencia de cada tripulante, incluidas sus habilitaciones de
tipo con estado calculado (`vigente`/`por_vencer`/`vencido`). Se empareja
por `employeeCode` con `GET /crew` en Programación; por cada habilitación
NO vencida que todavía no esté reflejada, `POST /crew/:id/qualifications`
la agrega. Las habilitaciones vencidas deliberadamente NO se empujan — sin
una fila vigente para ese modelo, el gate existente de Programación
(`checkPilotQualification`) bloquea la reserva por su cuenta.

**Programación → Facturación:** `GET /bookings/pending-sync` trae reservas
`status = 'completed'` con `synced_to_billing = 0`; se traduce
`aircraft_id` por matrícula; `POST /flights/from-booking` es idempotente
por `source_booking_id` (columna `UNIQUE`); `POST /bookings/:id/mark-synced`
evita reprocesar.

**Despacho → Combustible:** `GET /dispatch/pending-fuel-sync` trae
despachos `status = 'closed'` con `synced_to_fuel = 0`. Por cada uno, se
convierte `fuelPlan.trip_fuel_kg` a litros con una densidad de referencia
(0.8 kg/L, aproximación explícitamente marcada como no regulatoria — ver
el código) y se llama `POST /uplifts` en Combustible con
`sourceFlightReleaseId` (columna `UNIQUE`, así el flujo es idempotente
incluso si `mark-fuel-synced` fallara). Si el tanque de esa base no tiene
suficiente combustible registrado, el uplift se rechaza (409) y el
despacho NO se marca como sincronizado, para poder reintentar después de
la próxima entrega — el error se reporta por consola pero no detiene el
resto de la corrida.

**Tripulación → SMS:** `GET /crew` en Tripulación trae todos los
tripulantes; se filtra a los de `role: 'pilot'` con `employee_code`. Por
cada uno, `GET /crew/:id/fatigue-score?date=hoy` calcula el score real
(0-100, ver `fleet-crew-module/src/fatigueEngine.js`), y
`POST /fatigue-snapshots` en SMS lo guarda (upsert por `employee_code`,
traducido a una banda 0-4 para el FRAT — ver
`fleet-sms-module/src/smsEngine.js`). No hay cola de pendientes: cada
corrida simplemente refresca la fotografía de todos los pilotos.

## En producción

Estos siete flujos correrían como jobs programados (cron, o un worker que
escuche webhooks/eventos en vez de hacer polling). La arquitectura
federada — cada módulo con su propia base de datos, integración vía API —
es intencional: así cada módulo puede evolucionar, escalar o incluso
reemplazarse por separado. Es más parecida a cómo Babcock Mission Critical
Services conecta su ERP Sage X3 con sistemas de vuelo independientes que a
la plataforma única de Bristow/Ramco — ver
`AUDITORIA_Y_HOJA_DE_RUTA.docx` en la raíz del paquete para el detalle y
las fuentes.
